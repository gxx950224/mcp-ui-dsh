/**
 * 产物契约与规范校验。发布前跑一遍，把最容易在浏览器里才炸的问题挡在构建期。
 *
 * 校验项：
 *   1. bundle 包装的 id 必须等于 package.json 的 name；
 *   2. 必须导出 apply / inject，且 inject 含 "slots"（没有它拿不到槽位）；
 *   3. 声明的 external 必须保持 external（不能被打进 bundle）；
 *   4. CSS 已注入且带 data-plugin / data-plugin-css 两个属性；
 *   5. CSS 只用 --dsw-* 令牌，无硬编码颜色；
 *   6. 无 window.confirm（破坏性操作必须走 Modal）；
 *   7. CSS 类名与 JS 映射表逐一对齐（曾经因此整套样式失效）；
 *   8. 浏览器半不得 import 宿主专有模块（app.asar 内的包浏览器解析不到）；
 *   9. 注册的是 settings.section 槽位且 id 为 mcp。
 *
 * 注意：bundle 用 --format=cjs 构建，esbuild 产出的是**普通** `require("x")`，
 * 而不是 iife 模式下的 `__require("x")` —— 校验必须匹配实际形态。
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const bundlePath = path.join(root, "dist", "client.js")

const failures = []
const notes = []
const fail = (msg) => failures.push(msg)
const pass = (msg) => notes.push(`  ok  ${msg}`)

if (!fs.existsSync(bundlePath)) {
  console.error("dist/client.js 不存在，请先运行 npm run build")
  process.exit(1)
}
const js = fs.readFileSync(bundlePath, "utf8")

/* 1. bundle id === 包名。 */
if (!js.includes(`id: ${JSON.stringify(pkg.name)}`)) {
  fail(`bundle 的 id 不等于包名 ${pkg.name}（client-modules 按包名建模块表键，写错会在浏览器里才炸）`)
} else {
  pass(`bundle id === ${pkg.name}`)
}

/* 2. 导出面。 */
for (const name of ["apply", "inject"]) {
  if (!new RegExp(`\\b${name}\\b`).test(js)) fail(`bundle 未导出 ${name}`)
  else pass(`导出 ${name}`)
}
if (!js.includes('"slots"')) fail('inject 未包含 "slots"，无法注册槽位')
else pass("inject 含 slots")

/* 3. external 纯度：声明为 external 的模块必须仍以 require 引用。 */
const declaredExternal = [...new Set(["react", ...(pkg.dsh?.client?.external ?? [])])]
for (const mod of declaredExternal) {
  if (!js.includes(`require(${JSON.stringify(mod)})`)) {
    fail(`声明为 external 但未以 require 方式引用 ${mod}（声明与实现不一致）`)
  } else {
    pass(`external ${mod}`)
  }
}
if (/react\.production\.min\.js|ReactCurrentDispatcher/.test(js)) {
  fail("bundle 里疑似打进了 React 本体，必须保持 external")
} else {
  pass("未打进 React 本体")
}

/* 4/5/7. CSS 注入、令牌与类名对齐。 */
const cssMatch = js.match(/__styleTag\.textContent = "((?:[^"\\]|\\.)*)"/)
if (cssMatch === null) {
  fail("bundle 未注入 CSS（claimStyles 找不到可认领的 style）")
} else {
  const css = JSON.parse(`"${cssMatch[1]}"`)
  if (!js.includes("__styleTag.dataset.plugin") || !js.includes("__styleTag.dataset.pluginCss")) {
    fail("style 标签缺少 data-plugin / data-plugin-css（卸载时无法清理，会残留）")
  } else {
    pass("CSS 注入带 data-plugin / data-plugin-css")
  }

  const hardcoded = [...css.matchAll(/(?:^|[:\s(,])(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/g)].map((m) => m[1])
  if (hardcoded.length > 0) {
    fail(`CSS 存在硬编码颜色：${[...new Set(hardcoded)].join(", ")}（必须只用 --dsw-* 令牌）`)
  } else {
    pass("CSS 无硬编码颜色")
  }

  const vars = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))]
  const nonDsw = vars.filter((v) => !v.startsWith("--dsw-"))
  if (nonDsw.length > 0) fail(`CSS 使用了非 --dsw-* 变量：${nonDsw.join(", ")}`)
  else pass(`CSS 变量全部为 --dsw-*（${vars.length} 个）`)

  /*
   * 类名对齐：映射表是 { Mui_page: "Mui_Mui_page" }，**值**才是真实类名，
   * 必须逐个出现在 CSS 里。
   */
  const cssClasses = new Set([...css.matchAll(/\.(Mui_Mui_[\w-]+)/g)].map((m) => m[1]))
  const mapMatch = js.match(/var Mui_default = \{([\s\S]*?)\};/)
  if (mapMatch === null) {
    fail("未找到 local-css 的类名映射表（Mui_default）")
  } else {
    const values = [...mapMatch[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => m[2])
    const missing = values.filter((v) => !cssClasses.has(v))
    if (missing.length > 0) {
      fail(`有 ${missing.length} 个映射类名在 CSS 中不存在：${missing.join(", ")}`)
    } else {
      pass(`CSS 类名与 JS 映射对齐（${values.length} 个）`)
    }
  }
}

/* 6. 禁止 window.confirm / window.alert。 */
if (/window\.confirm|window\.alert|\bconfirm\(/.test(js)) {
  fail("产物中存在 window.confirm/alert（破坏性操作必须走 Modal 组件）")
} else {
  pass("无 window.confirm/alert")
}

/*
 * 8. 浏览器半不得 import 宿主专有模块。
 *    这些包只存在于 app.asar（dsh/node_modules/...），浏览器侧解析不到，
 *    esbuild 会尝试打包它们并因找不到而失败，或产出无法运行的 require。
 *    本插件**唯一**允许从宿主侧引用的东西是通过 HTTP 路由拿数据。
 */
const forbidden = ["@deepseek-ai/dsh-app-boot", "@deepseek-ai/dsh-atomic-write", "@deepseek-ai/dsh-mcp-client", "node:"]
let hostLeak = false
for (const mod of forbidden) {
  if (js.includes(`require(${JSON.stringify(mod)})`)) {
    fail(`浏览器半引用了宿主专有模块 ${mod}（应改为走 /api/mcp-ui/* 路由）`)
    hostLeak = true
  }
}
if (!hostLeak) pass("浏览器半未引用宿主专有模块")

/* 9. 注册的槽位与 id。 */
if (!js.includes('"settings.section"')) fail("未注册 settings.section 槽位（设置页签不会出现）")
else pass("注册 settings.section")
if (!js.includes('"mcp"')) fail('未使用预期的页签 id "mcp"')
else pass('页签 id === "mcp"')

console.log(`verify-bundle: ${pkg.name}@${pkg.version}`)
console.log(notes.join("\n"))
if (failures.length > 0) {
  console.error(`\n校验失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`\n全部校验通过（${notes.length} 项）`)
