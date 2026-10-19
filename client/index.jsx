/**
 * @gxx-labs/mcp-ui-dsh 浏览器半：设置 →「MCP」页签。
 *
 * 布局（本次改版的核心）：
 *   每个 MCP 服务默认**只占一行**——名称 + 目标摘要 + 标签 + 折叠箭头，
 *   状态用小圆点表示。点这一行才展开编辑表单与「已生效工具」。
 *   因此配 1 个服务和配 10 个服务，页面长度都可控。
 *
 * 两种配置方式（同一份数据的两个视图）：
 *   - 表单：逐服务展开后的分区编辑
 *     （连接 / 环境变量·请求头 / 高级 / 已生效工具）
 *   - JSON：直接编辑整份配置文本
 *
 * 数据流：
 *   GET  /api/mcp-ui/state  ← 服务列表（含明文 env/headers）+ 已注册工具
 *   POST /api/mcp-ui/save   ← 表单 servers[] 或 JSON 文本
 *   POST /api/mcp-ui/tools  ← 保存后轮询工具表（HMR 异步装载）
 *
 * 关于明文密钥：宿主按用户要求返回明文（这是本机个人 agent 的配置页），
 * 界面因此可以直接显示并编辑 token，不再有「留空表示不修改」的间接语义。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Button,
  IconCheckOutlineMedium,
  IconChevronRightOutlineMedium,
  IconClockOutlineMedium,
  IconCloseOutlineMedium,
  IconPlusOutlineMedium,
  IconRefreshOutlineMedium,
  IconTrashOutlineMedium,
  Input,
  Modal,
  SegmentedControl,
  Switch,
  Tag,
  Toast,
} from "@deepseek-ai/dsh-client-ui-primitives"
import {
  badgesOf,
  createServer,
  draftToServer,
  draftsToJsonText,
  ensureRowIds,
  serverToDraft,
  serversToJsonText,
  switchTransport,
  TRANSPORTS,
  validateServer,
  validateServerFields,
} from "./model.js"
/*
 * 必须 import 样式：local-css 会给类名加作用域前缀，JS 里读到的是**映射后的**
 * 类名（css.Mui_page）。若只靠构建脚本单独编 CSS 而 JS 不 import，
 * 两边类名会不一致，样式会全部失效。
 */
import css from "./Mui.module.css"

/** 字典命名空间。 */
export const NS = "mcp-ui"

/** 设置导航项 id；须与 settings.section 注册一致。 */
export const SECTION_ID = "mcp"

const API = {
  state: "/api/mcp-ui/state",
  save: "/api/mcp-ui/save",
  tools: "/api/mcp-ui/tools",
}

/** 拼接非空类名。 */
function cx(...names) {
  return names.filter(Boolean).join(" ")
}

const zh = {
  nav: "MCP",
  title: "MCP 服务",
  intro:
    "配置 Model Context Protocol 服务，保存后立即生效（写入 profile 的 cordis.patch.yml，由 DSH 热重载），无需重启。",
  mode: "配置方式",
  modeForm: "表单",
  modeJson: "JSON",
  add: "添加服务",
  save: "保存并生效",
  saving: "正在应用…",
  reload: "重新读取",
  savedOk: "已保存并生效：{n} 个 MCP 服务",
  savedApplying: "已保存 {n} 个 MCP 服务，正在生效…",
  savedNoop: "配置没有变化，未写入",
  loadFailed: "读取配置失败",
  saveFailed: "保存失败",
  fileLabel: "写入文件",
  empty: "还没有配置任何 MCP 服务",
  emptyText: "点击「添加服务」开始；也可以切到 JSON 模式粘贴现成配置。",
  remove: "删除此服务",
  confirmRemoveTitle: "删除服务「{name}」？",
  confirmRemoveDesc: "保存后该 MCP 服务器会从配置中移除并断开连接，其工具会立即从 Agent 的可用工具里消失。",
  cancel: "取消",
  secConnection: "连接",
  secSecrets: "环境变量与请求头",
  secAdvanced: "高级",
  secTools: "已生效工具",
  serverName: "服务名",
  transport: "传输方式",
  command: "启动命令",
  args: "启动参数",
  cwd: "工作目录",
  url: "服务地址",
  env: "环境变量（env）",
  headers: "请求头（headers）",
  kvKey: "名称",
  kvValue: "值",
  kvAdd: "添加一项",
  kvEmpty: "暂无",
  timeout: "调用超时（毫秒）",
  failFast: "启动失败即报错",
  toolsNone: "暂无工具",
  toolsApplying: "正在生效…",
  toolsCount: "{n} 个工具",
  stOk: "已生效",
  stApplying: "生效中",
  stNoTools: "无工具",
  stInvalid: "配置有误",
  jsonLabel: "配置 JSON",
  jsonInvalid: "JSON 格式有误",
  jsonFormat: "格式化",
  unsupported: "当前环境不支持 MCP 配置（未挂载 Web 宿主服务）。",
  waiting: "正在连接宿主服务…",
  loading: "正在读取 MCP 配置…",
  dirty: "有未保存的修改",
  fieldError: "请先修正标红的字段",
}

const en = {
  nav: "MCP",
  title: "MCP servers",
  intro:
    "Configure Model Context Protocol servers. A save writes the profile's cordis.patch.yml and DSH hot-reloads it — no restart needed.",
  mode: "Configuration",
  modeForm: "Form",
  modeJson: "JSON",
  add: "Add server",
  save: "Save and apply",
  saving: "Applying…",
  reload: "Reload",
  savedOk: "Saved and applied: {n} MCP server(s)",
  savedApplying: "Saved {n} MCP server(s); applying…",
  savedNoop: "No changes to write",
  loadFailed: "Failed to load configuration",
  saveFailed: "Save failed",
  fileLabel: "Written file",
  empty: "No MCP servers configured yet",
  emptyText: "Click “Add server” to start, or switch to JSON and paste an existing configuration.",
  remove: "Remove this server",
  confirmRemoveTitle: "Remove server “{name}”?",
  confirmRemoveDesc:
    "After saving, this MCP server is removed and disconnected; its tools disappear from the Agent immediately.",
  cancel: "Cancel",
  secConnection: "Connection",
  secSecrets: "Environment & headers",
  secAdvanced: "Advanced",
  secTools: "Active tools",
  serverName: "Server name",
  transport: "Transport",
  command: "Command",
  args: "Arguments",
  cwd: "Working directory",
  url: "URL",
  env: "Environment (env)",
  headers: "Headers",
  kvKey: "Name",
  kvValue: "Value",
  kvAdd: "Add entry",
  kvEmpty: "None",
  timeout: "Tool call timeout (ms)",
  failFast: "Fail on startup error",
  toolsNone: "No tools yet",
  toolsApplying: "Applying…",
  toolsCount: "{n} tool(s)",
  stOk: "Active",
  stApplying: "Applying",
  stNoTools: "No tools",
  stInvalid: "Invalid",
  jsonLabel: "Configuration JSON",
  jsonInvalid: "Invalid JSON",
  jsonFormat: "Format",
  unsupported: "MCP configuration is unavailable in this environment (no Web host service).",
  waiting: "Connecting to the host service…",
  loading: "Loading MCP configuration…",
  dirty: "Unsaved changes",
  fieldError: "Fix the highlighted fields first",
}

/** 极简插值：把 {k} 替换为 vars[k]。 */
function format(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (_, k) => (vars?.[k] === undefined ? "" : String(vars[k])))
}

async function request(url, options) {
  const res = await fetch(url, options)
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`响应解析失败（HTTP ${res.status}）`)
  }
  if (data?.ok === false) throw new Error(data.error ?? "操作失败")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return data
}

const postJson = (url, body) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })

/**
 * 服务未就绪时的等待轮询参数。
 * 250ms × 40 ≈ 10s：足够覆盖 Cordis 的异步 provider 注册。
 */
const WAIT_TICK_MS = 250
const MAX_WAIT_TICKS = 40

/**
 * 保存后轮询工具表的参数。
 * HMR 装载是异步的，刚保存时工具可能还没注册；轮询几次能让界面自动补上，
 * 用户不必手动点「重新读取」。
 */
const TOOLS_POLL_MS = 1500
const TOOLS_POLL_MAX = 6

/** 分区标题（小标题 + 细线），替代平铺输入框带来的杂乱感。 */
function Section(props) {
  return React.createElement(
    "div",
    { className: css.Mui_section },
    React.createElement(
      "div",
      { className: css.Mui_sectionHead },
      React.createElement("span", { className: css.Mui_sectionTitle }, props.title),
      React.createElement("span", { className: css.Mui_sectionLine }),
      props.aside ?? null,
    ),
    props.children,
  )
}

/** 一个键值对编辑器（env / headers 共用）。 */
function KeyValueEditor(props) {
  const { t, rows, onChange, keyLabel, valueLabel, addLabel, disabled } = props
  const update = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const remove = (index) => onChange(rows.filter((_, i) => i !== index))
  const add = () => onChange([...rows, { key: "", value: "" }])

  return React.createElement(
    "div",
    { className: css.Mui_kv },
    rows.length === 0 && React.createElement("span", { className: css.Mui_hint }, t("kvEmpty")),
    rows.map((row, index) =>
      React.createElement(
        "div",
        { className: css.Mui_kvRow, key: `kv-${String(index)}` },
        React.createElement(Input, {
          value: row.key,
          placeholder: keyLabel,
          "aria-label": keyLabel,
          disabled,
          onChange: (e) => update(index, { key: e.target.value }),
        }),
        React.createElement(Input, {
          value: row.value,
          placeholder: valueLabel,
          "aria-label": valueLabel,
          disabled,
          /* 明文显示（个人 agent 配置页）；关掉自动填充以免浏览器覆盖已存值。 */
          autoComplete: "off",
          spellCheck: false,
          onChange: (e) => update(index, { value: e.target.value }),
        }),
        React.createElement(Button, {
          size: "sm",
          className: css.Mui_kvDel,
          "aria-label": t("remove"),
          title: t("remove"),
          disabled,
          icon: React.createElement(IconCloseOutlineMedium, { size: 16 }),
          onClick: () => remove(index),
        }),
      ),
    ),
    React.createElement(
      Button,
      {
        size: "sm",
        disabled,
        icon: React.createElement(IconPlusOutlineMedium, { size: 16 }),
        onClick: add,
      },
      addLabel,
    ),
  )
}

/** 「已生效工具」小节：可再折叠，避免长清单撑爆页面。 */
function ToolsSection(props) {
  const { t, tools, pending, serverName, expanded, onToggle } = props
  const count = (tools ?? []).length
  const isPending = (pending ?? []).includes(serverName)

  const aside = React.createElement(
    "button",
    { type: "button", className: css.Mui_toolHead, onClick: onToggle },
    React.createElement(
      "span",
      { className: css.Mui_toolCount },
      count > 0 ? format(t("toolsCount"), { n: count }) : t("toolsNone"),
    ),
    React.createElement(IconChevronRightOutlineMedium, {
      size: 14,
      className: expanded ? cx(css.Mui_caret, css.Mui_caretOpen) : css.Mui_caret,
    }),
  )

  return React.createElement(
    Section,
    { title: t("secTools"), aside },
    count > 0 && expanded
      ? React.createElement(
          "ul",
          { className: css.Mui_toolList },
          tools.map((tool) =>
            React.createElement(
              "li",
              { className: css.Mui_tool, key: tool.name },
              React.createElement("span", { className: css.Mui_toolName }, tool.rawName ?? tool.name),
              tool.description !== "" &&
                React.createElement("span", { className: css.Mui_toolDesc, title: tool.description }, tool.description),
            ),
          ),
        )
      : count === 0 && isPending
        ? React.createElement("span", { className: css.Mui_hint }, t("toolsApplying"))
        : null,
  )
}

/** 一个服务的编辑卡片（折叠态一行，展开态分区表单）。 */
function ServerCard(props) {
  const {
    t, server, errors, tools, pending, onChange, onTransport, onRemove,
    onToggle, onToggleTools, expanded, toolsExpanded, disabled,
  } = props
  const draft = server.draft
  const transport = server.transport
  /*
   * errors 是 [{ field, message }]（结构化的，见 model.validateServerFields）。
   * 精确按字段标红，不再靠子串猜。
   */
  const list = errors ?? []
  const bad = (field) => list.some((e) => e.field === field)

  const built = draftToServer(draft, transport)
  const toolCount = (tools ?? []).length
  const isPending = (pending ?? []).includes(draft.serverName)
  const hasErrors = list.length > 0

  /*
   * 状态圆点：一眼分辨「能用的」和「有问题的」。
   *   红 = 配置有误（表单校验失败）
   *   黄 = 生效中（HMR 还没装载）或已生效但暂无工具
   *   绿 = 已生效且有工具
   * 颜色由 CSS 类给（CSS 里只能用 --dsw-* 令牌）。
   */
  const dotClass = hasErrors
    ? css.Mui_dotBad
    : isPending || toolCount === 0
      ? css.Mui_dotWait
      : css.Mui_dotOk
  const dotTitle = hasErrors
    ? t("stInvalid")
    : isPending
      ? t("stApplying")
      : toolCount === 0
        ? t("stNoTools")
        : t("stOk")

  const badges = badgesOf(built)

  return React.createElement(
    "li",
    { className: expanded ? cx(css.Mui_card, css.Mui_cardOpen) : css.Mui_card },

    /* ---- 折叠态：整行可点 ---- */
    React.createElement(
      "div",
      { className: expanded ? cx(css.Mui_head, css.Mui_headOpen) : css.Mui_head },
      React.createElement(
        "button",
        {
          type: "button",
          className: css.Mui_toggle,
          onClick: onToggle,
          "aria-expanded": expanded,
        },
        React.createElement(IconChevronRightOutlineMedium, {
          size: 16,
          className: expanded ? cx(css.Mui_caret, css.Mui_caretOpen) : css.Mui_caret,
        }),
        React.createElement(
          "span",
          { className: css.Mui_headMain },
          React.createElement(
            "span",
            { className: css.Mui_name },
            React.createElement("span", { className: cx(css.Mui_dot, dotClass), title: dotTitle }),
            draft.serverName || t("serverName"),
          ),
        ),
      ),
      React.createElement(
        "div",
        { className: css.Mui_headAside },
        React.createElement(
          "div",
          { className: css.Mui_badges },
          React.createElement("span", { className: css.Mui_badge }, transport),
          toolCount > 0 &&
            React.createElement("span", { className: css.Mui_badge }, format(t("toolsCount"), { n: toolCount })),
          badges.map((b) => React.createElement("span", { className: css.Mui_badge, key: b }, b)),
        ),
        React.createElement(Button, {
          size: "sm",
          variant: "danger",
          "aria-label": t("remove"),
          title: t("remove"),
          disabled,
          icon: React.createElement(IconTrashOutlineMedium, { size: 16 }),
          onClick: onRemove,
        }),
      ),
    ),

    /* ---- 展开态：分区表单 ---- */
    expanded &&
      React.createElement(
        "div",
        { className: css.Mui_body },

        /* 连接 */
        React.createElement(
          Section,
          { title: t("secConnection") },
          React.createElement(
            "div",
            { className: css.Mui_row },
            React.createElement(
              "div",
              { className: css.Mui_field },
              React.createElement("label", { className: css.Mui_label }, t("serverName")),
              React.createElement(Input, {
                value: draft.serverName,
                disabled,
                "aria-invalid": bad("serverName") || undefined,
                onChange: (e) => onChange({ serverName: e.target.value }),
              }),
            ),
            React.createElement(
              "div",
              { className: css.Mui_field },
              React.createElement("label", { className: css.Mui_label }, t("transport")),
              React.createElement(SegmentedControl, {
                /* id 用稳定行 id：若用 serverName，改名会换 id，控件被重建。 */
                id: `mcp-transport-${draft.rowId ?? "new"}`,
                value: transport,
                options: TRANSPORTS.map((value) => ({ value, label: value })),
                onChange: onTransport,
                label: t("transport"),
                disabled,
              }),
            ),
          ),

          transport === "stdio"
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement(
                  "div",
                  { className: css.Mui_field },
                  React.createElement("label", { className: css.Mui_label }, t("command")),
                  React.createElement(Input, {
                    value: draft.command ?? "",
                    disabled,
                    "aria-invalid": bad("command") || undefined,
                    placeholder: "npx",
                    onChange: (e) => onChange({ command: e.target.value }),
                  }),
                ),
                React.createElement(
                  "div",
                  { className: css.Mui_field },
                  React.createElement("label", { className: css.Mui_label }, t("args")),
                  React.createElement(Input, {
                    value: draft.args ?? "",
                    disabled,
                    placeholder: "-y @modelcontextprotocol/server-filesystem D:\\work",
                    onChange: (e) => onChange({ args: e.target.value }),
                  }),
                ),
                React.createElement(
                  "div",
                  { className: css.Mui_field },
                  React.createElement("label", { className: css.Mui_label }, t("cwd")),
                  React.createElement(Input, {
                    value: draft.cwd ?? "",
                    disabled,
                    onChange: (e) => onChange({ cwd: e.target.value }),
                  }),
                ),
              )
            : React.createElement(
                "div",
                { className: css.Mui_field },
                React.createElement("label", { className: css.Mui_label }, t("url")),
                React.createElement(Input, {
                  value: draft.url ?? "",
                  disabled,
                  "aria-invalid": bad("url") || undefined,
                  placeholder: "http://127.0.0.1:3000/mcp",
                  onChange: (e) => onChange({ url: e.target.value }),
                }),
              ),
        ),

        /* 环境变量 / 请求头（按传输方式只显示相关那一个） */
        React.createElement(
          Section,
          { title: t("secSecrets") },
          transport === "stdio"
            ? React.createElement(
                "div",
                { className: css.Mui_field },
                React.createElement("label", { className: css.Mui_label }, t("env")),
                React.createElement(KeyValueEditor, {
                  t,
                  rows: draft.envRows ?? [],
                  keyLabel: t("kvKey"),
                  valueLabel: t("kvValue"),
                  addLabel: t("kvAdd"),
                  disabled,
                  onChange: (rows) => onChange({ envRows: rows }),
                }),
              )
            : React.createElement(
                "div",
                { className: css.Mui_field },
                React.createElement("label", { className: css.Mui_label }, t("headers")),
                React.createElement(KeyValueEditor, {
                  t,
                  rows: draft.headersRows ?? [],
                  keyLabel: t("kvKey"),
                  valueLabel: t("kvValue"),
                  addLabel: t("kvAdd"),
                  disabled,
                  onChange: (rows) => onChange({ headersRows: rows }),
                }),
              ),
        ),

        /* 高级 */
        React.createElement(
          Section,
          { title: t("secAdvanced") },
          React.createElement(
            "div",
            { className: css.Mui_row },
            React.createElement(
              "div",
              { className: css.Mui_field },
              React.createElement("label", { className: css.Mui_label }, t("timeout")),
              React.createElement(Input, {
                value: String(draft.toolCallTimeoutMs ?? ""),
                disabled,
                inputMode: "numeric",
                onChange: (e) => onChange({ toolCallTimeoutMs: e.target.value }),
              }),
            ),
            React.createElement(
              "div",
              { className: css.Mui_field },
              React.createElement("label", { className: css.Mui_label }, t("failFast")),
              React.createElement(Switch, {
                checked: draft.failOnStartupError === true,
                disabled,
                label: t("failFast"),
                onChange: (checked) => onChange({ failOnStartupError: checked }),
              }),
            ),
          ),
          /* 只在真的有 JSON 高级字段时才显示；空着不占位（"无"是噪音）。 */
          draft.extra !== undefined &&
            Object.keys(draft.extra).length > 0 &&
            React.createElement("span", { className: css.Mui_path }, JSON.stringify(draft.extra)),
        ),

        /* 已生效工具 */
        React.createElement(ToolsSection, {
          t,
          serverName: draft.serverName,
          tools,
          pending,
          expanded: toolsExpanded,
          onToggle: onToggleTools,
        }),

        hasErrors &&
          React.createElement(
            "div",
            { className: css.Mui_field },
            list.map((error, index) =>
              React.createElement(
                "span",
                { className: css.Mui_inlineError, key: `err-${String(index)}` },
                error.message,
              ),
            ),
          ),
      ),
  )
}

/**
 * 设置页签主体。
 *
 * 导出是为了让 test/render-typing.test.mjs 能在 jsdom 里真实渲染它，
 * 端到端验证「逐字输入不丢光标」。它不是模块的公共 API，DSH 只用到 apply。
 */
export function McpSection(props) {
  const { t, supported: supportedProp } = props
  const supported = supportedProp !== false

  const [phase, setPhase] = useState("loading")
  const [file, setFile] = useState("")
  const [servers, setServers] = useState([])
  const [tools, setTools] = useState({})
  const [pending, setPending] = useState([])
  const [mode, setMode] = useState("form")
  const [json, setJson] = useState("")
  const [jsonError, setJsonError] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [toolsOpen, setToolsOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [dirty, setDirty] = useState(false)

  const seq = useRef(0)
  const notify = useCallback((next) => {
    seq.current += 1
    setToast({ ...next, seq: seq.current })
  }, [])

  /** 把宿主返回的服务数组收进本地状态。 */
  const adopt = useCallback((list, meta) => {
    setServers(
      /* ensureRowIds：给每一行分配稳定身份，编辑时改字段不会换 key。 */
      ensureRowIds(
        (list ?? []).map((server) => ({
          draft: serverToDraft(server),
          transport: server.transport,
        })),
      ),
    )
    if (meta?.file !== undefined) setFile(meta.file)
    if (meta?.tools !== undefined) setTools(meta.tools ?? {})
    if (meta?.pending !== undefined) setPending(meta.pending ?? [])
    setJsonError(null)
    setDirty(false)
  }, [])

  /** 从宿主拉取当前配置，重置草稿。 */
  const load = useCallback(async () => {
    setPhase("loading")
    setError(null)
    try {
      const data = await request(API.state)
      adopt(data.servers ?? [], { file: data.file, tools: data.tools, pending: [] })
      setJson(serversToJsonText(data.servers ?? []))
      setPhase("ready")
    } catch (e) {
      setError(`${t("loadFailed")}：${e instanceof Error ? e.message : String(e)}`)
      setPhase("failed")
    }
  }, [adopt, t])

  useEffect(() => {
    if (!supported) return undefined
    load()
    return undefined
  }, [supported, load])

  /*
   * 服务未就绪时按间隔重新解析，直到拿到为止。
   * interval **只依赖 supported**，绝不要把计数放进依赖数组——那会形成
   * 永不停歇的排程，在 act() 下挂死测试。
   */
  const [waited, setWaited] = useState(0)
  useEffect(() => {
    if (supported) return undefined
    const timer = setInterval(() => {
      setWaited((n) => {
        if (n + 1 >= MAX_WAIT_TICKS) clearInterval(timer)
        return Math.min(n + 1, MAX_WAIT_TICKS)
      })
    }, WAIT_TICK_MS)
    return () => clearInterval(timer)
  }, [supported])

  /*
   * 表单校验：**只在点击保存时**计算，不做逐字实时校验。
   *
   * 为什么要这样（用户明确要求，也是 0.2.5 修掉的体验问题）：
   * 之前 `errorsByName` 是 useMemo，每次输入都重算并把 aria-invalid 喂给输入框，
   * 于是「刚敲第一个字符就标红」，配上不稳定的 key 还会导致光标丢失，
   * 输入体验极差。校验结果本身不是可编辑数据，没必要实时。
   *
   * 现在的语义：
   *   - `submitted` 为 false（还没点过保存）→ 一律不报错，安静地让用户输入；
   *   - 点保存后 → 校验一次，把错误显示在对应字段下方；
   *   - 用户改动任何字段 → 清掉那份快照，重新回到安静状态，
   *     直到再次点击保存（避免「改好了红字还在」的假报错）。
   */
  const [submitted, setSubmitted] = useState(false)

  const errorsByName = useMemo(() => {
    if (!submitted) return servers.map(() => [])
    const allNames = servers.map((s) => s.draft.serverName)
    return servers.map((server) => validateServerFields(draftToServer(server.draft, server.transport), allNames))
  }, [submitted, servers])
  const formInvalid = errorsByName.some((e) => e.length > 0)

  const updateServer = useCallback((index, patch) => {
    setServers((prev) =>
      prev.map((server, i) => (i === index ? { ...server, draft: { ...server.draft, ...patch } } : server)),
    )
    /* 一旦继续编辑，就撤下上一次保存的报错快照（改完不该继续标红）。 */
    setSubmitted(false)
    setDirty(true)
  }, [])

  const changeTransport = useCallback((index, transport) => {
    setServers((prev) =>
      prev.map((server, i) => {
        if (i !== index) return server
        /* 切换传输时收拾字段：union 分支是严格对象，多余字段会让该行加载失败。 */
        const moved = switchTransport({ ...server.draft, transport: server.transport }, transport)
        return { ...server, transport, draft: { ...server.draft, ...moved } }
      }),
    )
    setSubmitted(false)
    setDirty(true)
  }, [])

  const addServer = useCallback(() => {
    const created = createServer(servers.map((s) => s.draft.serverName))
    const draft = serverToDraft(created)
    setServers((prev) => [...prev, { draft, transport: created.transport }])
    /* 新建即刻展开，用户可以直接填（用稳定行 id，改名不影响展开态）。 */
    setExpanded((open) => new Set([...open, draft.rowId]))
    setSubmitted(false)
    setDirty(true)
  }, [servers])

  const doRemove = useCallback((index) => {
    setServers((prev) => prev.filter((_, i) => i !== index))
    setSubmitted(false)
    setDirty(true)
    setConfirmRemove(null)
  }, [])

  /**
   * 保存成功后：收下最新状态，并在后台轮询工具表。
   *
   * 为什么要轮询：HMR 装载是异步的，保存返回时工具往往还没注册。
   * 轮询几次能让「已生效工具」自动补上，用户不必手动点「重新读取」。
   */
  const afterSave = useCallback(
    async (result) => {
      adopt(result.servers ?? [], {
        file: result.file,
        tools: result.tools,
        pending: result.pending ?? [],
      })
      setJson(serversToJsonText(result.servers ?? []))

      const stillPending = (result.pending ?? []).length > 0
      if (result.changed === false) {
        notify({ text: t("savedNoop"), tone: undefined })
        return
      }
      notify(
        stillPending
          ? {
              text: format(t("savedApplying"), { n: (result.servers ?? []).length }),
              tone: undefined,
              icon: React.createElement(IconClockOutlineMedium, { size: 16 }),
              holdMs: 5000,
            }
          : {
              text: format(t("savedOk"), { n: (result.servers ?? []).length }),
              tone: "success",
              icon: React.createElement(IconCheckOutlineMedium, { size: 16 }),
            },
      )

      /* 轮询工具表，让「已生效工具」自动补上。 */
      for (let i = 0; i < TOOLS_POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, TOOLS_POLL_MS))
        try {
          const fresh = await postJson(API.tools)
          const table = fresh.tools ?? {}
          setTools(table)
          const names = Object.keys(table)
          const total = names.reduce((n, k) => n + (table[k] ?? []).length, 0)
          if (total > 0) {
            setPending([])
            /* 自动展开第一个有工具的服务，让用户直接看到成果。 */
            setToolsOpen((open) => new Set([...open, names[0]]))
            return
          }
        } catch {
          /* 轮询失败不影响「已保存」这个事实，直接停。 */
          break
        }
      }
      setPending([])
    },
    [adopt, notify, t],
  )

  /**
   * 保存表单。
   *
   * 校验**在这里**发生（而不是输入时）：点保存 → 先算一遍必填与合规，
   * 有问题就把红色提示亮出来并**不发请求**；全部通过才提交。
   * 这样用户输入过程中永远安静，只有真正要落盘时才被拦住。
   */
  const submitForm = useCallback(async () => {
    const payload = servers.map((server) => draftToServer(server.draft, server.transport))
    const allNames = servers.map((s) => s.draft.serverName)
    const found = payload.map((server) => validateServer(server, allNames))
    const bad = found.findIndex((messages) => messages.length > 0)

    /* 先把快照亮出来（无论通过与否，保证错误一定可见）。 */
    setSubmitted(true)
    if (bad >= 0) {
      /* 展开出问题的那一行，并滚到视野里——否则用户不知道错在哪。 */
      const rowId = servers[bad]?.draft?.rowId
      if (rowId !== undefined) setExpanded((open) => new Set([...open, rowId]))
      return
    }

    setBusy(true)
    setError(null)
    try {
      await afterSave(await postJson(API.save, { servers: payload }))
    } catch (e) {
      setError(`${t("saveFailed")}：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [servers, afterSave, t])

  const submitJson = useCallback(async () => {
    let parsed
    try {
      parsed = JSON.parse(json)
    } catch (e) {
      setJsonError(`${t("jsonInvalid")}：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    setJsonError(null)
    setBusy(true)
    setError(null)
    try {
      await afterSave(await postJson(API.save, { json: JSON.stringify(parsed) }))
    } catch (e) {
      setError(`${t("saveFailed")}：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [json, afterSave, t])

  const formatJson = useCallback(() => {
    try {
      setJson(`${JSON.stringify(JSON.parse(json), null, 2)}\n`)
      setJsonError(null)
    } catch (e) {
      setJsonError(`${t("jsonInvalid")}：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [json, t])

  /* 切到 JSON 模式时，用当前表单内容重建文本（表单是权威草稿）。 */
  const switchMode = useCallback(
    (next) => {
      if (next === "json") {
        setJson(draftsToJsonText(servers.map((s) => draftToServer(s.draft, s.transport))))
        setJsonError(null)
      }
      setMode(next)
    },
    [servers],
  )

  if (!supported) {
    const giveUp = waited >= MAX_WAIT_TICKS
    return React.createElement(
      "div",
      { className: css.Mui_page },
      React.createElement(
        "p",
        { className: css.Mui_notice, role: "status" },
        giveUp ? t("unsupported") : t("waiting"),
      ),
    )
  }

  const modeOptions = [
    { value: "form", label: t("modeForm") },
    { value: "json", label: t("modeJson") },
  ]

  /** 集合式开关（展开的服务 / 展开的工具清单）。 */
  const toggleIn = (setter, value) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })

  return React.createElement(
    "div",
    { className: css.Mui_page },
    React.createElement("h1", { className: css.Mui_heading }, t("title")),
    React.createElement("p", { className: css.Mui_intro }, t("intro")),

    error !== null &&
      React.createElement(
        "p",
        { className: css.Mui_error, role: "alert" },
        error,
        React.createElement(Button, { size: "sm", onClick: () => setError(null) }, t("cancel")),
      ),

    React.createElement(
      "div",
      { className: css.Mui_toolbar },
      React.createElement(SegmentedControl, {
        id: "mcp-mode",
        value: mode,
        options: modeOptions,
        onChange: switchMode,
        label: t("mode"),
        disabled: busy,
      }),
      dirty && React.createElement(Tag, { tone: "outline" }, t("dirty")),
      React.createElement("span", { className: css.Mui_grow }),
      React.createElement(
        Button,
        {
          size: "sm",
          disabled: busy || mode !== "form",
          icon: React.createElement(IconPlusOutlineMedium, { size: 16 }),
          onClick: addServer,
        },
        t("add"),
      ),
      React.createElement(
        Button,
        {
          size: "sm",
          disabled: busy,
          icon: React.createElement(IconRefreshOutlineMedium, { size: 16 }),
          onClick: load,
        },
        t("reload"),
      ),
    ),

    file !== "" && React.createElement("span", { className: css.Mui_path }, `${t("fileLabel")}: ${file}`),

    phase === "loading" && React.createElement("p", { className: css.Mui_notice, role: "status" }, t("loading")),

    phase !== "loading" &&
      mode === "form" &&
      (servers.length === 0
        ? React.createElement(
            "div",
            { className: css.Mui_empty, role: "status" },
            React.createElement("p", { className: css.Mui_emptyTitle }, t("empty")),
            React.createElement("p", { className: css.Mui_emptyText }, t("emptyText")),
          )
        : React.createElement(
            "ul",
            { className: css.Mui_list },
            servers.map((server, index) => {
              const name = server.draft.serverName
              /*
               * 稳定行 id 作 key —— **绝不能**再把 serverName 放进 key。
               * 服务名是用户在输入框里改的字段：一旦进 key，敲下第一个字符
               * 就会换 key → React 卸载重建整张卡片 → input 失焦、光标归零。
               * 展开态同样按 rowId 记，改名不会连带把卡片收起来。
               */
              const rowId = server.draft.rowId
              return React.createElement(ServerCard, {
                key: rowId,
                t,
                server,
                errors: errorsByName[index],
                tools: tools[name],
                pending,
                disabled: busy,
                expanded: expanded.has(rowId),
                toolsExpanded: toolsOpen.has(rowId),
                onToggle: () => toggleIn(setExpanded, rowId),
                onToggleTools: () => toggleIn(setToolsOpen, rowId),
                onChange: (patch) => updateServer(index, patch),
                onTransport: (value) => changeTransport(index, value),
                onRemove: () => setConfirmRemove({ index, name: name || t("serverName") }),
              })
            }),
          )),

    phase !== "loading" &&
      mode === "json" &&
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { className: css.Mui_field },
          React.createElement("label", { className: css.Mui_label }, t("jsonLabel")),
          React.createElement("textarea", {
            className: css.Mui_textarea,
            value: json,
            spellCheck: false,
            disabled: busy,
            "aria-label": t("jsonLabel"),
            onChange: (e) => {
              setJson(e.target.value)
              setJsonError(null)
              setDirty(true)
            },
          }),
        ),
        jsonError !== null && React.createElement("p", { className: css.Mui_jsonError, role: "alert" }, jsonError),
        React.createElement(
          "div",
          { className: css.Mui_row },
          React.createElement(Button, { size: "sm", disabled: busy, onClick: formatJson }, t("jsonFormat")),
        ),
      ),

    phase !== "loading" &&
      React.createElement(
        "div",
        { className: css.Mui_footer },
        React.createElement(
          Button,
          {
            variant: "primary",
            size: "sm",
            disabled: busy || !dirty,
            onClick: mode === "form" ? submitForm : submitJson,
          },
          busy ? t("saving") : t("save"),
        ),
        mode === "form" && formInvalid && React.createElement("span", { className: css.Mui_inlineError }, t("fieldError")),
      ),

    React.createElement(Modal, {
      open: confirmRemove !== null,
      onClose: () => setConfirmRemove(null),
      title: format(t("confirmRemoveTitle"), { name: confirmRemove?.name ?? "" }),
      closeLabel: t("cancel"),
      description: t("confirmRemoveDesc"),
      footer: [
        React.createElement(Button, { key: "cancel", size: "sm", onClick: () => setConfirmRemove(null) }, t("cancel")),
        React.createElement(
          Button,
          { key: "go", variant: "danger", size: "sm", onClick: () => doRemove(confirmRemove.index) },
          t("remove"),
        ),
      ],
      children: null,
    }),

    toast !== null &&
      React.createElement(Toast, {
        text: toast.text,
        tone: toast.tone,
        icon: toast.icon,
        holdMs: toast.holdMs,
        onDone: () => setToast(null),
        key: `mcp-toast-${String(toast.seq)}`,
      }),
  )
}

/**
 * 浏览器半入口。注册设置页签（settings.section 是 list 槽位，由
 * ui-settings-general 声明；此处通过 slots.inject 等待其声明上账）。
 *
 * 服务读取方式：把 `ctx` 传下去、在渲染时惰性读取，而不是在 apply 时快照
 * ——Cordis 的服务是挂在提供方自己的 fiber 上的，插件的 apply 早于 provider
 * 注册是完全可能的排序；快照会永久持有 undefined（session-manager 踩过）。
 * 本插件实际上只依赖 slots（HTTP 路由直连同源 fetch），因此这里只做 slots。
 */
export const inject = ["slots", "locale"]

export function apply(ctx) {
  const locale = ctx.locale ?? ctx.get("locale")
  if (locale !== undefined && locale.register !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), "@gxx-labs/mcp-ui-dsh: dictionaries")
  }
  const t = (key) => {
    if (locale === undefined || locale.bind === undefined) return zh[key] ?? key
    try {
      return locale.bind(NS)(key)
    } catch {
      return zh[key] ?? key
    }
  }

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: SECTION_ID,
        order: 26,
        /* label 必须是 thunk：导航每次投影时重读，切语言即跟随。 */
        label: () => t("nav"),
        locale: NS,
        inject: () => ({}),
      },
      McpSection,
    ),
  )
}
