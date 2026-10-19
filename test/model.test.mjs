/**
 * client/model.js 的表单逻辑测试。
 *
 * 重点：字段收拾（传输切换）、参数切分、密钥占位往返——这三处最容易
 * 造成「保存成功但服务起不来」或「密钥被清空」。
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  badgesOf,
  createServer,
  draftToServer,
  draftsToJsonText,
  formatArgs,
  jsonFromServers,
  kvToObject,
  nextServerName,
  objectToKv,
  parseArgs,
  serverToDraft,
  serversToJsonText,
  switchTransport,
  toTimeout,
  validateServer,
  DEFAULT_TIMEOUT_MS,
} from "../client/model.js"

test("nextServerName：避开已占用的名字", () => {
  assert.equal(nextServerName([]), "server")
  assert.equal(nextServerName(["server"]), "server-2")
  assert.equal(nextServerName(["server", "server-2"]), "server-3")
  /* 接受 Set。 */
  assert.equal(nextServerName(new Set(["server"])), "server-2")
})

test("createServer：stdio 默认形状可直接通过校验（补上 command 后）", () => {
  const s = createServer(["server"])
  assert.equal(s.serverName, "server-2")
  assert.equal(s.transport, "stdio")
  assert.equal(s.toolCallTimeoutMs, DEFAULT_TIMEOUT_MS)
  assert.match(validateServer({ ...s, command: "npx" }, ["server-2"]).join("|"), /^$/)
})

test("switchTransport：切到 stdio 清掉 url/headers，切到 http 清掉 command/args/env/cwd", () => {
  const http = { serverName: "a", transport: "streamable-http", url: "http://x/mcp", headers: { A: "1" } }
  const asStdio = switchTransport(http, "stdio")
  assert.equal(asStdio.transport, "stdio")
  assert.equal(asStdio.url, undefined)
  assert.equal(asStdio.headers, undefined)

  const stdio = { serverName: "a", transport: "stdio", command: "npx", args: ["-y"], env: { B: "2" }, cwd: "/tmp" }
  const asHttp = switchTransport(stdio, "streamable-http")
  assert.equal(asHttp.transport, "streamable-http")
  assert.equal(asHttp.command, undefined)
  assert.equal(asHttp.args, undefined)
  assert.equal(asHttp.env, undefined)
  assert.equal(asHttp.cwd, undefined)
  /* 关键：不能残留旧传输的字段——mcp-client 的 Config 是严格 union。 */
  assert.equal(Object.hasOwn(asHttp, "command"), false)
})

test("switchTransport：同传输或非法传输时原样返回", () => {
  const s = { serverName: "a", transport: "stdio", command: "x" }
  assert.equal(switchTransport(s, "stdio"), s)
  assert.equal(switchTransport(s, "nope"), s)
})

test("parseArgs：空格切分 + 引号包裹", () => {
  assert.deepEqual(parseArgs(""), [])
  assert.deepEqual(parseArgs("  "), [])
  assert.deepEqual(parseArgs("-y @modelcontextprotocol/server-filesystem /tmp"), [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/tmp",
  ])
  assert.deepEqual(parseArgs('-y "C:\\Program Files\\x"'), ["-y", "C:\\Program Files\\x"])
  assert.deepEqual(parseArgs("'single quoted'"), ["single quoted"])
})

test("formatArgs：含空格或引号的参数被包裹", () => {
  assert.equal(formatArgs(["-y", "plain"]), "-y plain")
  assert.equal(formatArgs(["a b"]), '"a b"')
  /* 往返一致。 */
  const args = ["-y", "pkg", "C:\\Program Files\\x"]
  assert.deepEqual(parseArgs(formatArgs(args)), args)
})

test("kvToObject：跳过空键，保留空值", () => {
  const out = kvToObject([
    { key: "A", value: "1" },
    { key: "", value: "ignored" },
    { key: "  ", value: "ignored" },
    { key: " B ", value: "" },
  ])
  assert.deepEqual(out, { A: "1", B: "" })
})

test("objectToKv：明文直出（值原样保留，含空串键）", () => {
  assert.deepEqual(objectToKv({ A: "1" }), [{ key: "A", value: "1" }])
  assert.deepEqual(objectToKv({ TOKEN: "secret" }), [{ key: "TOKEN", value: "secret" }])
  /* 空串也要保留：用户可能就是想存一个空值。 */
  assert.deepEqual(objectToKv({ EMPTY: "" }), [{ key: "EMPTY", value: "" }])
  assert.deepEqual(objectToKv(undefined), [])
  assert.deepEqual(objectToKv(null), [])
  assert.deepEqual(objectToKv([]), [])
})

test("toTimeout：非法值回退默认", () => {
  assert.equal(toTimeout("5000"), 5000)
  assert.equal(toTimeout(0), DEFAULT_TIMEOUT_MS)
  assert.equal(toTimeout("abc"), DEFAULT_TIMEOUT_MS)
  assert.equal(toTimeout(-1), DEFAULT_TIMEOUT_MS)
})

test("validateServer：重复名、缺 command/url 被抓出", () => {
  const a = { serverName: "dup", transport: "stdio", command: "x" }
  assert.match(validateServer(a, ["dup", "dup"]).join("|"), /重复/)
  assert.match(validateServer({ ...a, command: "" }, ["dup"]).join("|"), /必须填写 command/)
  assert.match(
    validateServer({ serverName: "h", transport: "streamable-http", url: "ftp://x" }, ["h"]).join("|"),
    /http:\/\/ 或 https:\/\//,
  )
  assert.match(
    validateServer({ serverName: "h", transport: "streamable-http", url: "nope" }, ["h"]).join("|"),
    /不是合法地址/,
  )
})

test("draftToServer / serverToDraft：表单往返保持关键字段", () => {
  const draft = serverToDraft({
    serverName: "fs",
    transport: "stdio",
    command: "npx",
    args: ["-y", "pkg"],
    env: { A: "1" },
    cwd: "/tmp",
    toolCallTimeoutMs: 5000,
    failOnStartupError: true,
  })
  assert.equal(draft.args, "-y pkg")
  assert.deepEqual(draft.envRows, [{ key: "A", value: "1" }])

  const back = draftToServer(draft, "stdio")
  assert.equal(back.serverName, "fs")
  assert.deepEqual(back.args, ["-y", "pkg"])
  assert.deepEqual(back.env, { A: "1" })
  assert.equal(back.cwd, "/tmp")
  assert.equal(back.toolCallTimeoutMs, 5000)
  assert.equal(back.failOnStartupError, true)
})

test("serverToDraft：高级字段进 extra，不丢也不混进表单字段", () => {
  const draft = serverToDraft({
    serverName: "fs",
    transport: "stdio",
    command: "npx",
    reconnect: { enabled: false, maxAttempts: 3 },
    maxInstructionBytes: 4096,
  })
  assert.deepEqual(draft.extra, { reconnect: { enabled: false, maxAttempts: 3 }, maxInstructionBytes: 4096 })

  /* 再提交时必须原样带回（否则用户用 JSON 配的高级选项会静默消失）。 */
  const back = draftToServer(draft, "stdio")
  assert.deepEqual(back.reconnect, { enabled: false, maxAttempts: 3 })
  assert.equal(back.maxInstructionBytes, 4096)
})

test("draftToServer：serverName 与路径字段去空白", () => {
  const built = draftToServer(
    { serverName: "  fs  ", command: " npx ", cwd: " /tmp ", url: " http://x/mcp " },
    "stdio",
  )
  assert.equal(built.serverName, "fs")
  assert.equal(built.command, "npx")
  assert.equal(built.cwd, "/tmp")
})

test("draftToServer：http 传输只带该分支的字段", () => {
  const built = draftToServer({ serverName: "h", url: "http://x/mcp", headersRows: [{ key: "A", value: "1" }] }, "streamable-http")
  assert.equal(built.transport, "streamable-http")
  assert.deepEqual(built.headers, { A: "1" })
  assert.equal(built.command, undefined)
  assert.equal(built.args, undefined)
  assert.equal(built.env, undefined)
})

test("serverToDraft：明文 env 直接摊成可编辑行（用户能看见真实 token）", () => {
  const draft = serverToDraft({
    serverName: "gh",
    transport: "stdio",
    command: "npx",
    env: { TOKEN: "secret-value" },
  })
  assert.deepEqual(draft.envRows, [{ key: "TOKEN", value: "secret-value" }])
  /* 往返不丢：改完保存回去还是同一个值。 */
  assert.deepEqual(draftToServer(draft, "stdio").env, { TOKEN: "secret-value" })
})

test("宿主→客户端契约：明文服务形状能被表单正确读出", async () => {
  /*
   * 端到端形状契约：宿主 GET /state 返回的是
   *   presentServers(rowsToServers(...)) —— 扁平的
   *   { serverName, transport, command, env: {...明文}, rowId, ... }
   * 客户端把它直接交给 serverToDraft。这里用宿主的**真实**函数产出该形状，
   * 再喂给客户端的 serverToDraft，确保两侧不会各改一半而静默错位。
   */
  const { rowsToServers } = await import("../lib/mcp.js")
  const { presentServers } = await import("../lib/index.js")

  const patches = [
    {
      insert: [
        {
          id: "mcp-ui-gh",
          name: "@deepseek-ai/dsh-mcp-client",
          config: {
            transport: "stdio",
            serverName: "gh",
            command: "npx",
            args: ["-y", "pkg"],
            env: { GITHUB_TOKEN: "ghp_secret" },
          },
        },
      ],
    },
  ]

  const payload = presentServers(rowsToServers(patches))
  assert.equal(payload.length, 1)
  /* 明文：用户要能在界面上确认自己存了什么。 */
  assert.equal(payload[0].env.GITHUB_TOKEN, "ghp_secret")

  const draft = serverToDraft(payload[0])
  assert.equal(draft.serverName, "gh")
  assert.equal(draft.command, "npx")
  assert.equal(draft.args, "-y pkg")
  assert.deepEqual(draft.envRows, [{ key: "GITHUB_TOKEN", value: "ghp_secret" }])

  /* 往返保持原值（不再有「留空 = 保持不变」的间接语义）。 */
  assert.deepEqual(draftToServer(draft, "stdio").env, { GITHUB_TOKEN: "ghp_secret" })
})

test("serverToDraft：rowId 不进 extra（它是宿主内部字段）", () => {
  const draft = serverToDraft({ serverName: "a", transport: "stdio", command: "x", rowId: "mcp-ui-a" })
  assert.deepEqual(draft.extra, {})
})

test("badgesOf：折叠行右栏的关键信息标签", () => {
  assert.deepEqual(badgesOf({ transport: "stdio", command: "x" }), [])
  assert.deepEqual(badgesOf({ transport: "stdio", env: { A: "1", B: "2" } }), ["env × 2"])
  assert.deepEqual(badgesOf({ transport: "streamable-http", headers: { Authorization: "x" } }), ["headers × 1"])
  assert.deepEqual(
    badgesOf({ transport: "stdio", env: { A: "1" }, failOnStartupError: true }),
    ["env × 1", "fail-fast"],
  )
  /* 非对象 / 数组不计。 */
  assert.deepEqual(badgesOf({ transport: "stdio", env: [] }), [])
  assert.deepEqual(badgesOf(undefined), [])
})

/* ==================== JSON 模式：必须完整显示原文 ==================== */

/*
 * 回归测试：JSON 模式曾丢掉 headers。
 *
 * 根因：jsonFromServers 一律把入参当「表单草稿」喂给 draftToServer()，
 * 而宿主返回的是**扁平成品对象**（`headers` 直接在顶层）。
 * draftToServer 读的是 `draft.headersRows`（行数组），扁平对象没有它，
 * 于是 `headers` 变成 `{}` —— 界面上看到的 JSON **少了 Authorization**。
 *
 * 这是很隐蔽的数据丢失：用户以为 JSON 就是真相，实际少了密钥。
 * 下面把「两种入参形状都必须完整」钉死。
 */

const FLAT_SERVER = {
  transport: "streamable-http",
  serverName: "obsidian",
  url: "http://localhost:8765/mcp",
  headers: { Authorization: "Bearer secret-token" },
  env: {},
  cwd: "",
  args: [],
  toolCallTimeoutMs: 60000,
  failOnStartupError: true,
  rowId: "mcp-ui-obsidian",
}

test("jsonFromServers：扁平成品对象原样透出（含 headers 明文）", () => {
  const doc = jsonFromServers([FLAT_SERVER])
  assert.deepEqual(Object.keys(doc), ["obsidian"])
  const cfg = doc.obsidian
  /* 关键：headers 必须完整，不能被清空。 */
  assert.deepEqual(cfg.headers, { Authorization: "Bearer secret-token" })
  assert.equal(cfg.url, "http://localhost:8765/mcp")
  assert.equal(cfg.transport, "streamable-http")
  assert.equal(cfg.toolCallTimeoutMs, 60000)
  assert.equal(cfg.failOnStartupError, true)
  /* rowId 是内部字段，不该出现在用户 JSON 里。 */
  assert.equal(cfg.rowId, undefined)
  assert.equal(cfg.serverName, undefined)
})

test("jsonFromServers：stdio 扁平对象的 env 也完整", () => {
  const doc = jsonFromServers([
    { transport: "stdio", serverName: "fs", command: "npx", args: ["-y", "pkg"], env: { TOKEN: "abc" }, cwd: "" },
  ])
  assert.deepEqual(doc.fs.env, { TOKEN: "abc" })
  assert.deepEqual(doc.fs.args, ["-y", "pkg"])
})

test("jsonFromServers：草稿包装仍能正确转换（两条路径都要通）", () => {
  const draft = serverToDraft(FLAT_SERVER)
  const doc = jsonFromServers([{ draft, transport: "streamable-http" }])
  assert.deepEqual(doc.obsidian.headers, { Authorization: "Bearer secret-token" })
  assert.equal(doc.obsidian.url, "http://localhost:8765/mcp")
})

test("jsonFromServers：两种形状产出完全一致", () => {
  const draft = serverToDraft(FLAT_SERVER)
  const fromFlat = jsonFromServers([FLAT_SERVER])
  const fromDraft = jsonFromServers([{ draft, transport: "streamable-http" }])
  assert.deepEqual(fromFlat, fromDraft, "同一条配置，两种入参形状必须得到同样的 JSON")
})

test("serversToJsonText：是可 parse 的 JSON 且以换行结尾", () => {
  const text = serversToJsonText([FLAT_SERVER])
  assert.ok(text.endsWith("\n"))
  const parsed = JSON.parse(text)
  assert.deepEqual(parsed.obsidian.headers, { Authorization: "Bearer secret-token" })
})

test("draftsToJsonText：表单草稿路径也完整", () => {
  const draft = serverToDraft(FLAT_SERVER)
  const parsed = JSON.parse(draftsToJsonText([draftToServer(draft, "streamable-http")]))
  assert.deepEqual(parsed.obsidian.headers, { Authorization: "Bearer secret-token" })
})

test("jsonFromServers：跳过非对象条目，不抛错", () => {
  assert.deepEqual(jsonFromServers([]), {})
  assert.deepEqual(jsonFromServers([null, undefined, "x", 3]), {})
  assert.deepEqual(jsonFromServers(undefined), {})
})
