/**
 * 真·渲染验证：在 jsdom 里挂载**真实的** McpSection，逐字输入服务名，
 * 断言 `<input>` 元素始终是**同一个 DOM 节点**（React 没有重建它）。
 *
 * 为什么需要这层验证：form-typing.test.mjs 只能证明「行 id 稳定」，
 * 但真正决定光标去留的是 client/index.jsx 里 `<ServerCard key={...}>` 用的是
 * 什么。万一将来有人把 key 改回 serverName，模型层的测试仍然全绿，
 * 而 bug 会原样回来。这里直接把界面跑起来，钉死端到端行为。
 *
 * 做法：用 esbuild 把 index.jsx 打成 CJS（primitives / react 走外部桩），
 * 然后在 jsdom 里渲染，模拟用户输入。
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import test from "node:test"

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const work = path.join(root, ".typing-test-tmp")

/** 找到 esbuild 可执行文件（与 build-client.mjs 同样的策略）。 */
function esbuildBin() {
  for (const c of ["@esbuild/win32-x64/esbuild.exe", "@esbuild/linux-x64/bin/esbuild"]) {
    try {
      const p = require.resolve(c)
      if (fs.existsSync(p)) return p
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error("未找到 esbuild 可执行文件")
}

/**
 * 把 index.jsx 打成可在 node 里 require 的 CJS。
 * react / primitives / jsdom 无所谓——外部依赖单独处理：
 *   - react 保持 external（用测试进程里的同一份）
 *   - primitives 用桩替换（它需要浏览器环境，且与本 bug 无关）
 *   - CSS 用空对象替换（样式不影响 DOM 结构）
 */
function buildComponent() {
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })

  /*
   * primitives 桩：行为尽量贴近真实实现。
   * 真实的 Input 是 `<span class=wrap><input .../></span>`（见
   * dsh-client-ui-primitives/lib/index.js），因此这里必须**丢弃 children**——
   * input 是 void 元素，带上 children React 会直接抛错。
   */
  fs.writeFileSync(
    path.join(work, "primitives-stub.cjs"),
    `const React = require("react")
const passthrough = (tag) => {
  const isVoid = tag === "input"
  return React.forwardRef((props, ref) => {
    const { children, icon, ...rest } = props
    return React.createElement(tag, { ...rest, ref }, isVoid ? null : (icon ?? children ?? null))
  })
}
const noop = (name) => (props) => React.createElement("div", { "data-stub": name }, props.children ?? null)
module.exports = {
  Button: passthrough("button"),
  Input: (props) => React.createElement(
    "span",
    { className: "stub-wrap" },
    props.icon != null ? React.createElement("span", { className: "stub-icon" }, props.icon) : null,
    React.createElement("input", { ...props, icon: undefined }),
  ),
  Tag: passthrough("span"),
  Switch: noop("Switch"),
  Toast: noop("Toast"),
  Modal: noop("Modal"),
  SegmentedControl: (props) => React.createElement(
    "div",
    { "data-stub": "SegmentedControl" },
    (props.options ?? []).map((o) => React.createElement("button", { key: o.value, "data-value": o.value }, o.label)),
  ),
  IconCheckOutlineMedium: noop("IconCheck"),
  IconChevronRightOutlineMedium: noop("IconChevron"),
  IconClockOutlineMedium: noop("IconClock"),
  IconCloseOutlineMedium: noop("IconClose"),
  IconPlusOutlineMedium: noop("IconPlus"),
  IconRefreshOutlineMedium: noop("IconRefresh"),
  IconTrashOutlineMedium: noop("IconTrash"),
}
`,
  )

  /*
   * CSS 用 esbuild 的 .css=js loader：把样式当普通模块编成空对象。
   * （样式不影响 DOM 结构，本测试只关心节点是否被重建。）
   */

  const out = path.join(work, "index.cjs")
  execFileSync(
    esbuildBin(),
    [
      path.join(root, "client", "index.jsx"),
      "--bundle",
      "--format=cjs",
      "--platform=node",
      "--target=es2022",
      "--jsx=automatic",
      "--loader:.css=js",
      "--log-level=warning",
      "--external:react",
      `--alias:@deepseek-ai/dsh-client-ui-primitives=${path.join(work, "primitives-stub.cjs")}`,
      `--outfile=${out}`,
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  )
  return out
}

let bundlePath
try {
  bundlePath = buildComponent()
} catch (e) {
  console.error("构建测试用组件失败：", e.message)
  throw e
}

/* ---- 搭 jsdom 环境 ---- */
const { JSDOM } = require("jsdom")
const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://127.0.0.1/",
  pretendToBeVisual: true,
})
global.window = dom.window
global.document = dom.window.document
/* navigator 在 node 24 里是只读的 getter，不能直接赋值——用 defineProperty。 */
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true, writable: true })
global.HTMLElement = dom.window.HTMLElement
global.IS_REACT_ACT_ENVIRONMENT = true

const React = require("react")
const ReactDOMClient = require("react-dom/client")
const { act } = require("react-dom/test-utils")

/** 供页面用的宿主状态：一个已配置好的 stdio 服务。 */
const HOST_STATE = {
  ok: true,
  file: "C:\\Users\\x\\.dsh\\profiles\\desktop\\cordis.patch.yml",
  servers: [
    {
      serverName: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "pkg"],
      env: {},
      cwd: "",
      toolCallTimeoutMs: 60000,
      failOnStartupError: false,
      rowId: "mcp-ui-fs",
    },
  ],
  tools: {},
  pending: [],
}

/** 极简 fetch 桩：state 返回上面的配置；save 回显。 */
global.fetch = async (url) => {
  const body = url.includes("/state") ? HOST_STATE : HOST_STATE
  return { ok: true, status: 200, json: async () => body }
}

/** 把组件挂到 jsdom 里，等首屏加载完成。 */
async function mount() {
  const mod = require(bundlePath)
  const container = document.getElementById("root")
  let root_
  await act(async () => {
    root_ = ReactDOMClient.createRoot(container)
    root_.render(React.createElement(mod.McpSection, { t: (k) => k, supported: true }))
  })
  /* 让 load() 的 promise 落地。 */
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return { mod, container, root: root_ }
}

/** 展开第一张卡片。 */
async function expandFirstCard(container) {
  const toggle = container.querySelector("button[aria-expanded]")
  await act(async () => {
    toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  })
}

test("真实渲染：逐字输入服务名时，input 始终是同一个 DOM 节点（光标不会丢）", async () => {
  const { container } = await mount()
  await expandFirstCard(container)

  const input = container.querySelector('input[aria-invalid], input')
  assert.ok(input, "展开后应当有输入框")

  /*
   * 关键断言：React 复用同一个节点 → DOM 对象引用不变。
   * 修复前 key 用 serverName，第一次输入就会换 key，React 会新建 <input>，
   * 这里拿到的引用会与之前不同（且浏览器里表现为失焦 + 光标归零）。
   */
  const before = input
  const names = ["fs2", "fs23", "fs234"]

  for (const value of names) {
    const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set
    await act(async () => {
      nativeSetter.call(before, value)
      before.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    })

    const after = container.querySelector("input")
    assert.equal(
      after,
      before,
      `输入 "${value}" 后 input 被重建了 —— React 换了 key，光标会丢失（这正是本次修的 bug）`,
    )
    assert.equal(after.value, value, "受控输入的值应当跟上")
  }
})

test("真实渲染：未点保存前不出现标红（不做实时校验）", async () => {
  const { container } = await mount()
  await expandFirstCard(container)

  /* 把服务名清空——按旧行为会立刻标红。 */
  const input = container.querySelector("input")
  const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    nativeSetter.call(input, "")
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  })

  assert.equal(
    container.querySelectorAll('input[aria-invalid="true"]').length,
    0,
    "还没点保存，不该有任何字段被标红（实时校验已被移除）",
  )
})

test("真实渲染：点保存后才出现校验错误提示", async () => {
  const { container } = await mount()
  await expandFirstCard(container)

  const input = container.querySelector("input")
  const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    nativeSetter.call(input, "")
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  })

  /* 找到「保存并生效」按钮（footer 里的 primary）。 */
  const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("save"))
  assert.ok(saveBtn, "应当有保存按钮")
  await act(async () => {
    saveBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  })

  assert.ok(
    container.querySelector('input[aria-invalid="true"]'),
    "点了保存且服务名为空 —— 应当标红",
  )
})

test("真实渲染：改名后卡片展开态保持（不再按名字记展开）", async () => {
  const { container } = await mount()
  await expandFirstCard(container)

  /* 展开态：能看到输入框。 */
  const input = container.querySelector("input")
  assert.ok(input, "展开后应有输入框")

  const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    nativeSetter.call(input, "renamed")
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  })

  assert.ok(
    container.querySelector("input"),
    "改名后卡片不该自动收起（展开态按稳定行 id 记，不按服务名）",
  )
})

/*
 * 收尾：清掉构建临时目录。
 *
 * 不清理会把 .typing-test-tmp/（含打包产物与桩文件）留在源码树里，
 * 既脏了工作区，也可能被 npm 一并发布出去。
 * 放在 process exit 上是为了覆盖断言失败提前退出的情况。
 */
process.on("exit", () => {
  try {
    fs.rmSync(work, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响测试结论 */
  }
})

