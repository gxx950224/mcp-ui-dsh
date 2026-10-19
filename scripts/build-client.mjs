/**
 * 构建浏览器半 dist/client.js。
 *
 * 实现说明（重要）：这里**直接调用 esbuild 可执行文件**，而不是 `import { build } from "esbuild"`。
 * 原因：esbuild 的 JS API 会以 piped stdio 启动一个子进程，在受限沙箱下会
 * `spawn EPERM`。直接跑二进制并把产物写到文件即可绕开该限制，且行为等价。
 *
 * 输出必须符合 DSH 客户端模块契约：
 *   window.__ModuleLoader__.load({ id: <包名>, factory: (require) => module.exports })
 *
 * 四个容易踩的坑（写在这里避免回归）：
 *   1. **bundle 的 id 必须等于 package.json 的 name** —— 客户端加载器按包名建
 *      模块表键，写错会在浏览器里才炸。因此这里从 package.json 读取，不硬编码。
 *   2. **必须用 --format=cjs，不能用 iife** —— 入口是 ESM，esbuild 的 iife 输出
 *      **不会**把导出挂到 module.exports 上，包装层的 `return module.exports`
 *      会拿到空对象，浏览器侧表现为"模块加载了但 apply 未定义"。
 *   3. **CSS 必须由 JS `import`** —— local-css 会给类名加作用域前缀，JS 里读到的
 *      是映射后的类名。若只靠本脚本单独编 CSS 而 JS 不 import，两边类名不一致，
 *      样式会全部失效。本脚本兼容两种情形：优先用 JS 产物里的映射，回退到
 *      独立抽取的 CSS。
 *   4. **CSS 抽取要以 CSS 为入口** —— 入口是 JS 时 esbuild 会把 JS 文本写进
 *      `--outfile=x.css`（同名不同扩展），拿到的"CSS"其实是 JS。
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))

const CSS_MODULE_ID = `${pkg.name}/Mui.module.css`
const outFile = path.join(root, "dist", "client.js")
const tmpDir = path.join(root, ".build-tmp")

/** 解析 esbuild 二进制路径：平台包优先。 */
function esbuildBin() {
  const candidates = [
    "@esbuild/win32-x64/esbuild.exe",
    "@esbuild/linux-x64/bin/esbuild",
    "@esbuild/darwin-x64/bin/esbuild",
    "@esbuild/darwin-arm64/bin/esbuild",
  ]
  for (const c of candidates) {
    try {
      const p = require.resolve(c)
      if (fs.existsSync(p)) return p
    } catch {
      /* 换下一个 */
    }
  }
  throw new Error("未找到 esbuild 可执行文件，请先安装对应平台的 @esbuild/<platform> 包")
}

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true })
fs.mkdirSync(path.join(root, "dist"), { recursive: true })
fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

const externals = ["react", "react/jsx-runtime", "react-dom", ...(pkg.dsh?.client?.external ?? [])]
const externalArgs = externals.map((m) => `--external:${m}`)

/*
 * 浏览器半**禁止**引用宿主专有模块：它们只存在于 app.asar
 * （dsh/node_modules/...），浏览器侧解析不到。这里列进 external 让 esbuild
 * 直接报「找不到」而不是打进来一个注定运行不了的 require（fail loud）。
 */
const hostOnly = [
  "@deepseek-ai/dsh-app-boot",
  "@deepseek-ai/dsh-atomic-write",
  "@deepseek-ai/dsh-mcp-client",
]
const hostOnlyArgs = hostOnly.map((m) => `--external:${m}`)

const commonArgs = [
  path.join(root, "client", "index.jsx"),
  "--bundle",
  /* 见文件头第 2 条：cjs 才会把导出挂到 module.exports。 */
  "--format=cjs",
  "--platform=browser",
  "--target=es2022",
  "--jsx=automatic",
  "--loader:.css=local-css",
  "--log-level=warning",
  "--legal-comments=none",
  ...externalArgs,
  ...hostOnlyArgs,
]

/*
 * 第一遍：以 CSS 为入口单独抽取样式（见文件头第 4 条）。
 * 该结果既作为 style 注入内容，也用于校验类名对齐。
 */
const cssEntry = path.join(tmpDir, "entry.css")
fs.writeFileSync(cssEntry, `@import "../client/Mui.module.css";\n`)
const cssStage = path.join(tmpDir, "stage.css")
execFileSync(
  esbuildBin(),
  [cssEntry, "--bundle", "--loader:.css=local-css", "--log-level=warning", `--outfile=${cssStage}`],
  { stdio: "inherit", cwd: root },
)
let css = fs.existsSync(cssStage) ? fs.readFileSync(cssStage, "utf8") : ""

/* 第二遍：正式产出 JS（写到 dist，与临时目录隔离）。 */
execFileSync(esbuildBin(), [...commonArgs, `--outfile=${outFile}`], { stdio: "inherit", cwd: root })

/*
 * esbuild 见到 JS 入口里有 `import "*.css"` 时会**顺便**再吐一个
 * `dist/client.css`。样式已经内联进 client.js 的 style 标签
 * （下面 cssTag 那段），这个旁路产物没有任何引用者，且会随包发布出去
 * 造成困惑（使用者以为要手动引入）。直接删掉。
 */
fs.rmSync(path.join(root, "dist", "client.css"), { force: true })

/* 注入 ModuleLoader 包装 + CSS style 标签。 */
const banner =
  `/* ${pkg.name} client bundle (esbuild) */\n` +
  `window.__ModuleLoader__.load({\n` +
  `  id: ${JSON.stringify(pkg.name)},\n` +
  `  factory: (require) => {\n` +
  `    var module = { exports: {} };\n` +
  `    var exports = module.exports;\n`

const footer = `\n    return module.exports;\n  }\n});\n`

const cssTag =
  css.trim() === ""
    ? ""
    : `var __cssTagId = ${JSON.stringify(CSS_MODULE_ID)};\n` +
      `if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(__cssTagId) + "]") === null) {\n` +
      `  var __styleTag = document.createElement("style");\n` +
      `  __styleTag.dataset.plugin = ${JSON.stringify(pkg.name)};\n` +
      `  __styleTag.dataset.pluginCss = __cssTagId;\n` +
      `  __styleTag.textContent = ${JSON.stringify(css)};\n` +
      `  document.head.appendChild(__styleTag);\n` +
      `}\n`

fs.writeFileSync(outFile, banner + fs.readFileSync(outFile, "utf8") + cssTag + footer)

/* 清掉临时目录。 */
fs.rmSync(tmpDir, { recursive: true, force: true })

/*
 * 构建期自检：CSS 里的类名必须与 JS 映射表的值一一对应。
 * 这条曾经真的断过（CSS 编出 Mui_Mui_page 而 JS 用 Mui_page），导致整套样式失效，
 * 所以放在构建里当硬失败。
 */
const built = fs.readFileSync(outFile, "utf8")
const cssClasses = new Set((css.match(/\.(Mui_Mui_[\w-]+)/g) ?? []).map((s) => s.slice(1)))
const mapMatch = built.match(/var Mui_default = \{([\s\S]*?)\};/)
if (mapMatch === null) {
  console.error("构建自检失败：未找到 local-css 类名映射表（Mui_default）")
  process.exit(1)
}
const mapped = [...mapMatch[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => m[2])
const missing = mapped.filter((v) => !cssClasses.has(v))
if (missing.length > 0) {
  console.error(`构建自检失败：有 ${missing.length} 个类名在 CSS 中不存在：${missing.join(", ")}`)
  process.exit(1)
}

console.log(
  `built ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB) ` +
    `id=${pkg.name} css=${css.length}B classes=${cssClasses.size}/${mapped.length} ✓`,
)
