/**
 * 表单 ↔ 服务配置的纯逻辑（无 React、无 DOM，可在 node 里单测）。
 *
 * 从 client/index.jsx 抽出来是为了两件事：
 *   1. 可单测——表单的增删改、敏感值占位、URL 校验这类逻辑最容易写错；
 *   2. 构建产物更小、可读性更好。
 */

/** 支持的传输方式（与宿主 lib/mcp.js 的 TRANSPORTS 对齐）。 */
export const TRANSPORTS = ["stdio", "streamable-http"]

/** serverName 合法模式（与 mcp-client 的 SERVER_NAME_PATTERN 一致）。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** 默认工具调用超时（毫秒），与 mcp-client 的默认值一致。 */
export const DEFAULT_TIMEOUT_MS = 60000

/**
 * 生成一个不与现有服务重名的默认服务名。
 *
 * @param existing - 现有服务名集合（数组或 Set）
 * @returns 形如 `server` / `server-2` 的唯一名字
 */
export function nextServerName(existing) {
  const taken = existing instanceof Set ? existing : new Set(existing ?? [])
  if (!taken.has("server")) return "server"
  for (let i = 2; i < 1000; i++) {
    const candidate = `server-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `server-${Date.now()}`
}

/**
 * 新建一个空白服务（表单用）。
 *
 * @param existingNames - 现有服务名，用于避免重名
 * @param transport - 传输方式，默认 stdio
 * @returns 服务配置对象
 */
export function createServer(existingNames, transport = "stdio") {
  return {
    serverName: nextServerName(existingNames),
    transport,
    command: transport === "stdio" ? "" : undefined,
    url: transport === "streamable-http" ? "" : undefined,
    args: [],
    env: {},
    headers: {},
    cwd: "",
    toolCallTimeoutMs: DEFAULT_TIMEOUT_MS,
    failOnStartupError: false,
  }
}

/**
 * 表单行的**稳定身份**。
 *
 * 为什么必须有它（这是 0.2.5 修的那个「敲一个字符光标就丢」的根因）：
 * 列表渲染曾用 `key = serverName + index`，而服务名正是用户要编辑的字段——
 * 敲下第一个字符，key 就变了，React 于是**卸载并重建**整个卡片，
 * `<input>` 连同它的焦点与光标位置一起被销毁。表现就是「输入一个字符后光标消失」。
 *
 * 稳定 id 一旦分配就不再随字段变化，React 因此能原地复用同一个 DOM 节点，
 * 光标自然留在原处。它只是**界面内部**的行标识，不会写进 cordis.patch.yml，
 * 因此不影响配置契约（提交前由 draftToServer 丢弃）。
 *
 * @param seed - 可选种子（从宿主读来时用 rowId / serverName，便于跨刷新稳定）
 * @returns 形如 `row-3` 的唯一 id
 */
let rowSeq = 0

export function nextRowId(seed) {
  rowSeq += 1
  /*
   * 种子仅作为**前缀**，并总是拼上自增序号：
   * 若直接把种子当 id 返回，宿主返回的两行带同一个 rowId（或一行无 rowId
   * 而序号恰好撞上别处的种子）就会得到重复 key——那正是我们要根除的
   * 「节点被重建」问题的另一副面孔。
   */
  const base = seed === undefined || seed === null || seed === "" ? "row" : String(seed)
  return `${base}#${String(rowSeq)}`
}

/**
 * 给一批服务草稿补齐稳定行 id（缺失或重复时重新分配）。
 *
 * @param servers - [{ draft, transport }]
 * @returns 新的数组，每项 draft.rowId 均有唯一值
 */
export function ensureRowIds(servers) {
  const taken = new Set()
  return (servers ?? []).map((server) => {
    const draft = server?.draft ?? {}
    let id = draft.rowId
    if (typeof id !== "string" || id === "" || taken.has(id)) id = nextRowId()
    taken.add(id)
    return { ...server, draft: { ...draft, rowId: id } }
  })
}

/**
 * 切换传输方式时收拾字段：切到 stdio 清 url/headers，切到 http 清 command/args/env/cwd。
 *
 * 为什么必须清：mcp-client 的 Config 是 `z.union`，两个分支都是**严格对象**。
 * 给 stdio 分支带上 `url` 之类的多余字段，Schemastery 可能直接拒绝该行，
 * 表现为「保存成功但服务没起来」。
 *
 * @param server - 原服务
 * @param transport - 目标传输
 * @returns 新服务对象
 */
export function switchTransport(server, transport) {
  if (!TRANSPORTS.includes(transport) || transport === server.transport) return server
  if (transport === "stdio") {
    const { url, headers, ...rest } = server
    return { ...rest, transport, command: server.command ?? "", env: server.env ?? {} }
  }
  const { command, args, env, cwd, ...rest } = server
  return { ...rest, transport, url: server.url ?? "", headers: server.headers ?? {} }
}

/**
 * 校验单个服务，只返回文案（宿主侧也会再校验一次）。
 *
 * 注意：客户端**不再**逐字实时调用它——表单在点击保存时才校验一次
 * （实时标红会让输入过程很吵，见 client/index.jsx 里 submitted 的说明）。
 *
 * @param server - 服务配置
 * @param allNames - 全部服务名（判重）
 * @returns 错误消息数组
 */
export function validateServer(server, allNames) {
  return validateServerFields(server, allNames).map((e) => e.message)
}

/**
 * 校验单个服务并**保留字段归属**，供界面精确标红。
 *
 * 为什么需要它：早先界面靠 `errors.some(m => m.includes("command"))` 猜字段，
 * 属于子串匹配——消息文案一改就错位，且容易误伤（例如把 url 的报错
 * 匹配到别的字段上）。这里直接给出 `field`，界面不再猜。
 *
 * 规则只有这一份实现，validateServer 是它的「只取文案」视图，
 * 两者不会各说各话。
 *
 * @param server - 服务配置
 * @param allNames - 全部服务名（判重）
 * @returns [{ field, message }]，field ∈ serverName|transport|command|url
 */
export function validateServerFields(server, allNames) {
  const out = []
  const name = server?.serverName
  if (typeof name !== "string" || name === "") {
    out.push({ field: "serverName", message: "serverName 必填" })
  } else if (!SERVER_NAME_PATTERN.test(name)) {
    out.push({ field: "serverName", message: "serverName 只能包含字母、数字、下划线、连字符，长度 1–32" })
  } else if ((allNames ?? []).filter((n) => n === name).length > 1) {
    out.push({ field: "serverName", message: `serverName "${name}" 与另一个服务重复` })
  }

  if (!TRANSPORTS.includes(server?.transport)) {
    out.push({ field: "transport", message: "请选择传输方式" })
  } else if (server.transport === "stdio") {
    if (typeof server.command !== "string" || server.command.trim() === "") {
      out.push({ field: "command", message: "stdio 传输必须填写 command" })
    }
  } else {
    const url = server.url
    if (typeof url !== "string" || url.trim() === "") {
      out.push({ field: "url", message: "streamable-http 传输必须填写 url" })
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          out.push({ field: "url", message: "url 必须以 http:// 或 https:// 开头" })
        }
      } catch {
        out.push({ field: "url", message: "url 不是合法地址" })
      }
    }
  }
  return out
}

/**
 * 折叠态右栏的「关键信息」标签（紧凑显示，不占一行）。
 *
 * 折叠行只显示**服务名**（用户要求：目标地址属于展开后的细节，
 * 不应挤占列表行）。badges 则把「配置是否完备」压缩成几个短标签，
 * 让用户不展开也能一眼分辨。
 *
 * @param server - 规范化后的服务配置
 * @returns 标签文本数组
 */
export function badgesOf(server) {
  const out = []
  const envCount = countKeys(server?.env)
  const headerCount = countKeys(server?.headers)
  if (envCount > 0) out.push(`env × ${envCount}`)
  if (headerCount > 0) out.push(`headers × ${headerCount}`)
  if (server?.failOnStartupError === true) out.push("fail-fast")
  return out
}

/** 统计对象键数（非对象视为 0）。 */
export function countKeys(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return 0
  return Object.keys(value).length
}

/**
 * 表单原始状态 → 提交给宿主的服务对象。
 *
 * env / headers **明文直传**：界面回显真实值（含 token），用户改什么就存什么。
 * （旧版用「空串 = 保持原值」占位语义，导致用户改不掉已有值，已废弃。）
 *
 * @param draft - 表单草稿（含 keys 数组，因为对象无法表达「正在输入的空键」）
 * @param transport - 传输方式
 * @returns 服务配置对象
 */
export function draftToServer(draft, transport) {
  const t = TRANSPORTS.includes(transport) ? transport : "stdio"
  const server = {
    serverName: (draft.serverName ?? "").trim(),
    transport: t,
    toolCallTimeoutMs: toTimeout(draft.toolCallTimeoutMs),
    failOnStartupError: draft.failOnStartupError === true,
  }

  if (t === "stdio") {
    server.command = (draft.command ?? "").trim()
    server.args = parseArgs(draft.args)
    server.env = kvToObject(draft.envRows)
    server.cwd = (draft.cwd ?? "").trim()
  } else {
    server.url = (draft.url ?? "").trim()
    server.headers = kvToObject(draft.headersRows)
  }

  /* 保留 JSON 模式遗留的高级字段（reconnect / maxInstructionBytes 等）。 */
  if (draft.extra !== null && typeof draft.extra === "object") {
    for (const [k, v] of Object.entries(draft.extra)) {
      if (server[k] === undefined) server[k] = v
    }
  }
  return server
}

/**
 * 服务对象 → 表单草稿（含把 env/headers 摊成可编辑的行）。
 *
 * 宿主要求返回明文，因此这里直接显示真实值（含 token）——
 * 用户能一眼看到存了什么、也能改掉它。
 *
 * @param server - 服务配置（宿主返回，含明文 env/headers）
 * @returns 表单草稿
 */
export function serverToDraft(server) {
  const known = new Set([
    "transport",
    "serverName",
    "command",
    "url",
    "cwd",
    "args",
    "env",
    "headers",
    "toolCallTimeoutMs",
    "failOnStartupError",
    "rowId",
  ])
  const extra = {}
  for (const [k, v] of Object.entries(server ?? {})) {
    if (!known.has(k)) extra[k] = v
  }
  return {
    serverName: server?.serverName ?? "",
    command: server?.command ?? "",
    url: server?.url ?? "",
    cwd: server?.cwd ?? "",
    args: formatArgs(server?.args),
    envRows: objectToKv(server?.env),
    headersRows: objectToKv(server?.headers),
    toolCallTimeoutMs: server?.toolCallTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    failOnStartupError: server?.failOnStartupError === true,
    /*
     * 稳定行 id：优先沿用宿主返回的 rowId（同一行跨刷新保持同一身份），
     * 否则现分一个。它绝不进 extra，也就不会写进配置文件。
     */
    rowId: nextRowId(server?.rowId),
    extra,
  }
}

/** 解析命令行参数：按空格切分，支持双引号包裹（"a b" 视作一个参数）。 */
export function parseArgs(text) {
  if (typeof text !== "string" || text.trim() === "") return []
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** 参数数组 → 编辑用文本（含空格或引号的项加双引号）。 */
export function formatArgs(args) {
  return (Array.isArray(args) ? args : [])
    .map((a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a)))
    .join(" ")
}

/** 键值行数组 → 普通对象。 */
export function kvToObject(rows) {
  const out = {}
  for (const row of rows ?? []) {
    const key = (row?.key ?? "").trim()
    if (key === "") continue
    out[key] = row?.value ?? ""
  }
  return out
}

/**
 * 对象 → 键值行数组（明文，值原样显示）。
 *
 * @param obj - 明文对象（可为 undefined）
 * @returns 行数组
 */
export function objectToKv(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return []
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? "") }))
}

/** 超时值收敛：非法 → 默认值。 */
export function toTimeout(value) {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TIMEOUT_MS
}

/**
 * 服务对象 → JSON 模式要显示的普通对象（服务名 → 配置）。
 *
 * **原样透出**：JSON 模式就该显示「磁盘上真实的那份配置」——不裁剪、
 * 不隐藏、不改字段名，用户可以直接对照 profile 文件看。
 *
 * 入参可能是两种形状之一，必须分流处理（这里曾经出过 bug）：
 *   - 宿主返回的**扁平服务对象**（`env` / `headers` 是普通对象）→ 原样用；
 *   - 表单草稿包装 `{ draft, transport }`（值在 `envRows` / `headersRows`
 *     的「行数组」里）→ 经 draftToServer 转换。
 * 早先一律走 draftToServer，扁平对象被当成草稿读，`headers` 变成 `{}`，
 * 于是界面上看到的 JSON **丢了 Authorization**。单测已钉死这一点。
 *
 * 输出做一次**规范化**：只保留该传输方式真正用得上的字段
 * （stdio → command/args/env/cwd；http → url/headers），
 * 这样「宿主读来的」与「表单刚编的」两种来源产出的 JSON 完全一致，
 * 不会因为一侧多了空 `args: []` 就看起来像配置变了。
 *
 * @param list - 宿主返回的扁平服务数组，或 { draft, transport } 包装
 * @returns 可 JSON.stringify 的普通对象
 */
export function jsonFromServers(list) {
  const doc = {}
  for (const item of list ?? []) {
    if (item === null || typeof item !== "object") continue
    const raw = item.draft !== undefined ? draftToServer(item.draft, item.transport) : item
    const transport = TRANSPORTS.includes(raw.transport) ? raw.transport : "stdio"

    /* 保留 JSON 里可能出现的高级字段（reconnect / maxInstructionBytes…）。 */
    const advanced = {}
    const branchFields = new Set([
      "command",
      "args",
      "env",
      "cwd",
      "url",
      "headers",
      "transport",
      "serverName",
      "rowId",
      "toolCallTimeoutMs",
      "failOnStartupError",
    ])
    for (const [k, v] of Object.entries(raw)) {
      if (!branchFields.has(k) && v !== undefined) advanced[k] = v
    }

    const entry = {
      transport,
      toolCallTimeoutMs: raw.toolCallTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      failOnStartupError: raw.failOnStartupError === true,
    }
    if (transport === "stdio") {
      entry.command = raw.command ?? ""
      entry.args = Array.isArray(raw.args) ? raw.args : []
      entry.env = raw.env && typeof raw.env === "object" && !Array.isArray(raw.env) ? raw.env : {}
      entry.cwd = raw.cwd ?? ""
    } else {
      entry.url = raw.url ?? ""
      entry.headers = raw.headers && typeof raw.headers === "object" && !Array.isArray(raw.headers) ? raw.headers : {}
    }
    Object.assign(entry, advanced)
    doc[raw.serverName || ""] = entry
  }
  return doc
}

/**
 * 服务数组 → JSON 模式文本。
 *
 * @param list - 同 jsonFromServers
 * @returns 结尾带换行的 JSON 文本
 */
export function serversToJsonText(list) {
  return `${JSON.stringify(jsonFromServers(list), null, 2)}\n`
}

/**
 * 表单草稿（已由 draftToServer 转好的服务对象）→ JSON 模式文本。
 *
 * 注意：这里传进来的**已经是成品服务对象**，直接走 jsonFromServers 的
 * 「扁平」分支。早先又包了一层 `{ draft: d }`，于是被当成表单草稿再转一次，
 * 而成品对象没有 `headersRows` → `headers` 又被清空。
 *
 * @param drafts - draftToServer 产出的服务对象数组
 * @returns JSON 文本
 */
export function draftsToJsonText(drafts) {
  return serversToJsonText(drafts ?? [])
}
