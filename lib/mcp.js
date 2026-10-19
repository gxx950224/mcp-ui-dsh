/**
 * MCP 服务的领域模型：规范化、校验、与 profile patch 行之间的双向转换。
 *
 * 这里**不依赖 DSH 宿主模块**，因此可以脱离运行时单测（test/mcp.test.mjs）。
 *
 * 契约来源（读 app.asar 核验，勿凭记忆改）：
 *   dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js
 *     const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
 *     const Config = z.union([
 *       z.object({ transport: z.const("stdio"), serverName: <required,pattern>,
 *                  command: <required>, args: z.array(String).default([]),
 *                  env: z.dict(String).default({}), cwd: z.string().default(""),
 *                  toolCallTimeoutMs: <default 60000>,
 *                  failOnStartupError: z.boolean().default(false),
 *                  maxInstructionBytes: ..., reconnect: Reconnect }),
 *       z.object({ transport: z.const("streamable-http"), serverName: <同上>,
 *                  url: <required>, headers: z.dict(String).default({}),
 *                  toolCallTimeoutMs, failOnStartupError, maxInstructionBytes, reconnect }),
 *     ])
 *
 * 关键设计决定：一行 patch 只挂一个 serverName（mcp-client 一个实例连一个服务器，
 * 且同一 scope 内 serverName 必须唯一——重复会抛
 * 'serverName "x" is already in use by another mcp-client instance'）。
 * 因此「配置 N 个服务」= profile patch 里的 N 个 `insert:` 行。
 *
 * 同时保留 JSON 模式的自由度：用户在 JSON 里写的**额外字段**（如 reconnect）
 * 原样透传，不被本模块吞掉——UI 只用表单覆盖它显式管理的字段。
 */

/** mcp-client 官方包名，作为 Loader 行的 name。 */
export const MCP_CLIENT_PACKAGE = "@deepseek-ai/dsh-mcp-client"

/** serverName 合法模式，与 mcp-client 的 SERVER_NAME_PATTERN 逐字一致。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** 支持的传输方式。 */
export const TRANSPORTS = ["stdio", "streamable-http"]

/** 默认单次工具调用超时（与 mcp-client 的 DEFAULT_TOOL_CALL_TIMEOUT_MS 一致）。 */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60000

/** 本插件管理的 Loader 行 id 前缀，用于识别「这行是本插件写的」。 */
export const ENTRY_ID_PREFIX = "mcp-ui-"

/**
 * mcp-client 注册工具时的公开名前缀。
 *
 * 官方规则（dsh-mcp-client/lib/index.js 的 publicToolName）：
 *   `mcp__<serverName>__<rawName>`
 * 名字过长或含非法字符时会截断并附 sha256 前 8 位；因此判断「某工具属于哪个
 * 服务」以**前缀匹配为主**（覆盖绝大多数情况），并把 serverName 一并传给
 * 过滤逻辑，便于宿主侧做更精确的归属判断。
 */
export const MCP_TOOL_PREFIX = "mcp__"

/**
 * 由 serverName 拼出该服务的工具前缀（用于过滤工具列表）。
 *
 * @param serverName - 服务名
 * @returns 形如 `mcp__obsidian__`
 */
export function toolPrefixFor(serverName) {
  return `${MCP_TOOL_PREFIX}${serverName}__`
}

/**
 * 由 serverName 推导 patch 行 id。
 *
 * 刻意**不用**纯 serverName 作为 id：用户 profile 里可能已有手写的 MCP 行，
 * 也可能有别的插件插入的行；带前缀既能避免碰撞，也让「哪些行归本插件管」
 * 可判定（卸载/重命名时只动自己写的行）。
 *
 * @param serverName - 已校验的服务名
 * @returns Loader 行 id
 */
export function entryIdFor(serverName) {
  return `${ENTRY_ID_PREFIX}${serverName}`
}

/** 判断一个 Loader 行 id 是否由本插件管理。 */
export function isOwnEntryId(id) {
  return typeof id === "string" && id.startsWith(ENTRY_ID_PREFIX)
}

/** 从本插件管理的行 id 反推 serverName；非本插件的行返回 undefined。 */
export function serverNameFromEntryId(id) {
  return isOwnEntryId(id) ? id.slice(ENTRY_ID_PREFIX.length) : undefined
}

/**
 * 把任意输入（来自表单或 JSON）规范化为「已知字段 + 透传字段」两部分。
 *
 * 规范化规则（全部宽松，只做形状收敛，不做拒绝——拒绝交给 validate）：
 *   - args：数组则逐项转字符串；空/非数组 → []
 *   - env / headers：对象则值转字符串，剔除非对象；否则 → {}
 *   - cwd：字符串或 ""
 *   - toolCallTimeoutMs：数值则保留；否则回退默认
 *   - failOnStartupError：严格布尔，缺省 false
 *
 * @param input - 原始配置对象
 * @param transport - 传输方式（决定哪些字段有意义）
 * @returns 规范化后的配置对象
 */
export function normalizeServer(input, transport) {
  const raw = input !== null && typeof input === "object" ? input : {}
  const t = TRANSPORTS.includes(transport) ? transport : raw.transport
  const out = { transport: TRANSPORTS.includes(t) ? t : "stdio" }

  if (typeof raw.serverName === "string") out.serverName = raw.serverName
  if (typeof raw.command === "string") out.command = raw.command
  if (typeof raw.url === "string") out.url = raw.url
  /* cwd 的默认值是 ""（与 mcp-client 的 z.string().default("") 一致），
     因此始终补全：缺省时也要作为空串存在，否则写进 patch 后该字段
     在「表单保存一次」与「原本没有」之间产生无意义 diff。 */
  out.cwd = typeof raw.cwd === "string" ? raw.cwd : ""

  out.args = Array.isArray(raw.args) ? raw.args.map((v) => String(v)) : []
  out.env = stringDict(raw.env)
  out.headers = stringDict(raw.headers)

  out.toolCallTimeoutMs =
    typeof raw.toolCallTimeoutMs === "number" && Number.isFinite(raw.toolCallTimeoutMs) && raw.toolCallTimeoutMs > 0
      ? raw.toolCallTimeoutMs
      : DEFAULT_TOOL_CALL_TIMEOUT_MS
  out.failOnStartupError = raw.failOnStartupError === true

  /*
   * 透传未知字段（典型：reconnect 策略、maxInstructionBytes）。
   * 表单不编辑它们，但 JSON 里写了就必须原样保留——否则用户用 JSON 配置
   * 的高级选项会在「表单保存一次」后静默消失，是很难排查的数据丢失。
   */
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
  ])
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k) && v !== undefined) out[k] = v
  }
  return out
}

/** 只保留「字符串 → 字符串」的键值对；其余丢弃（含嵌套对象、null）。 */
function stringDict(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {}
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue
    if (typeof v === "object") continue
    out[k] = String(v)
  }
  return out
}

/**
 * 校验一个规范化后的服务配置。
 *
 * 只做 mcp-client 自己会拒绝的检查（外加几条明显的用户输入错误），
 * 因为最终裁判是 mcp-client 的 Schemastery schema：这里多拦只会让
 * 用户的合法高级配置无法保存。
 *
 * @param server - normalizeServer 的输出
 * @returns 错误消息数组（空数组 = 通过）
 */
export function validateServer(server) {
  const errors = []
  if (server === null || typeof server !== "object") return ["配置必须是对象"]

  if (typeof server.serverName !== "string" || server.serverName === "") {
    errors.push("serverName 必填")
  } else if (!SERVER_NAME_PATTERN.test(server.serverName)) {
    errors.push("serverName 只能包含字母、数字、下划线、连字符，长度 1–32")
  }

  if (!TRANSPORTS.includes(server.transport)) {
    errors.push(`transport 必须是 ${TRANSPORTS.join(" 或 ")}`)
  } else if (server.transport === "stdio") {
    if (typeof server.command !== "string" || server.command.trim() === "") {
      errors.push("stdio 传输必须提供 command")
    }
  } else if (typeof server.url !== "string" || server.url.trim() === "") {
    errors.push("streamable-http 传输必须提供 url")
  } else {
    /* 提前给出可读错误：URL 构造失败时 mcp-client 只会抛一个晦涩的 TypeError。 */
    try {
      const parsed = new URL(server.url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push("url 必须是 http:// 或 https:// 地址")
      }
    } catch {
      errors.push("url 不是合法地址")
    }
  }
  return errors
}

/**
 * 由服务列表构造 patch 行。
 *
 * @param servers - 规范化后的服务配置数组
 * @returns `insert:` 列表用的 Loader 行数组
 */
export function serversToRows(servers) {
  return servers.map((server) => ({
    id: entryIdFor(server.serverName),
    name: MCP_CLIENT_PACKAGE,
    config: { ...server },
  }))
}

/**
 * 从 profile patch 里抽取本插件管理的 MCP 行。
 *
 * 识别依据是**行 id 前缀**，而不是 `name === mcp-client`：用户可能自己
 * 手写 MCP 行（那种行不该被本页签当成"自己的"去覆盖或删除），
 * 而本插件写的行一定有前缀。
 *
 * 返回**扁平**的服务对象（`{ serverName, rowId, ...规范化后的 config }`），
 * 与 `normalizeServer` 的输出同形。这一条是硬契约：
 * `presentServers`（下发）与 `draftToServer`（回写）都按扁平字段读
 * `env` / `headers`；若退化成嵌套的 `{ serverName, config: {...} }`，
 * 两侧都会静默失效——界面显示不出 token、保存时又把它们抹掉。
 * 单测里已钉死这个形状（见 test/mcp.test.mjs）。
 *
 * @param patches - 已解析的 profile patch 顶层行数组
 * @returns 扁平的服务数组
 */
export function rowsToServers(patches) {
  const out = []
  const seen = new Set()
  for (const patch of patches ?? []) {
    if (patch === null || typeof patch !== "object") continue
    /* insert 行本身不是服务行；服务行藏在它的 insert 列表里。 */
    const rows = Array.isArray(patch.insert) ? patch.insert : [patch]
    for (const row of rows) {
      if (row === null || typeof row !== "object") continue
      if (!isOwnEntryId(row.id)) continue
      if (row.name !== MCP_CLIENT_PACKAGE) continue
      const serverName = serverNameFromEntryId(row.id)
      if (serverName === undefined || seen.has(serverName)) continue
      seen.add(serverName)
      out.push({
        ...normalizeServer(row.config, row.config?.transport),
        /* serverName 以行 id 反推为准（config 里可能缺或写错）；
           rowId 供客户端回填/诊断，不参与校验。 */
        serverName,
        rowId: row.id,
      })
    }
  }
  return out
}

/**
 * 校验整份服务列表（逐个 + 跨条目唯一性 + id 冲突）。
 *
 * @param servers - 规范化后的服务数组
 * @returns `{ ok, errors: { serverName, messages }[] }`
 */
export function validateServers(servers) {
  const items = []
  const nameCount = new Map()
  for (const server of servers) {
    const messages = validateServer(server)
    if (typeof server?.serverName === "string" && server.serverName !== "") {
      nameCount.set(server.serverName, (nameCount.get(server.serverName) ?? 0) + 1)
    }
    items.push({ serverName: server?.serverName ?? "", messages })
  }
  /* serverName 必须全局唯一：重复的 serverName 在同一个 scope 里会让
     第二个实例启动即抛错（mcp-client 的 activeServerNames 保留表）。 */
  for (const item of items) {
    if ((nameCount.get(item.serverName) ?? 0) > 1) {
      item.messages.push(`serverName "${item.serverName}" 重复`)
    }
  }
  return { ok: items.every((i) => i.messages.length === 0), errors: items }
}

/**
 * 把整份服务列表序列化为 JSON 模式的文本。
 *
 * 刻意不写成 patch 行形状，而是写成更贴近官方 mcp-client 配置的
 * 「服务名 → 配置」映射，用户读起来更直观；解析时两种形状都接受。
 *
 * @param servers - 规范化后的服务数组
 * @returns 可编辑的 JSON 文本
 */
export function serversToJson(servers) {
  const doc = {}
  for (const server of servers) {
    const { serverName, ...rest } = server
    doc[serverName ?? ""] = rest
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * 解析 JSON 模式的文本。同时接受三种形状（宽容是刻意的——用户很可能
 * 从别处粘贴现成配置）：
 *   A. `{ "serverName": { transport, command, ... } }`（本插件导出格式）
 *   B. `{ "mcpServers": { ...同上 } }`（Claude Desktop / Cursor 习惯）
 *   C. `[{ serverName, transport, ... }]` 或 `{ insert: [...] }`（patch 行形状）
 *
 * @param text - 用户输入的 JSON 文本
 * @returns `{ ok: true, servers }` 或 `{ ok: false, error }`
 */
export function parseJsonConfig(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, servers: jsonToServers(raw) }
}

/**
 * 把上面三种形状统一成服务数组。
 *
 * @param raw - 已解析的 JSON 值
 * @returns 规范化后的服务数组
 */
export function jsonToServers(raw) {
  /* C 形状：数组，或 { insert: [...] }。 */
  if (Array.isArray(raw)) return raw.map(rowFromJson).filter(Boolean)
  if (raw !== null && typeof raw === "object" && Array.isArray(raw.insert)) {
    return raw.insert.map(rowFromJson).filter(Boolean)
  }
  /* B 形状：包一层 mcpServers。 */
  const table =
    raw !== null && typeof raw === "object" && raw.mcpServers !== null && typeof raw.mcpServers === "object"
      ? raw.mcpServers
      : raw
  if (table === null || typeof table !== "object") return []
  const out = []
  for (const [key, value] of Object.entries(table)) {
    if (value === null || typeof value !== "object") continue
    out.push(normalizeServer({ ...value, serverName: value.serverName ?? key }, value.transport))
  }
  return out
}

/** 把「patch 行形状」的一条转成服务配置；不是对象则返回 undefined。 */
function rowFromJson(row) {
  if (row === null || typeof row !== "object") return undefined
  const cfg = row.config !== null && typeof row.config === "object" ? row.config : row
  const fallbackName = typeof row.id === "string" ? serverNameFromEntryId(row.id) ?? row.id : undefined
  return normalizeServer({ ...cfg, serverName: cfg.serverName ?? fallbackName }, cfg.transport)
}
