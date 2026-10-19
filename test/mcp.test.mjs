/**
 * lib/mcp.js 的契约测试：规范化、校验、序列化、与 patch 行互转。
 *
 * 重点覆盖「会让插件静默出错」的那些点：
 *   - 透传未知字段（reconnect 等）不能在表单保存后丢失
 *   - serverName 唯一性（重复会让第二个 mcp-client 实例启动即抛错）
 *   - 只认自己写的前缀行，不误伤用户手写的 MCP 行
 *   - JSON 三种形状都能解析
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  ENTRY_ID_PREFIX,
  MCP_CLIENT_PACKAGE,
  entryIdFor,
  isOwnEntryId,
  jsonToServers,
  normalizeServer,
  parseJsonConfig,
  rowsToServers,
  serverNameFromEntryId,
  serversToJson,
  serversToRows,
  validateServer,
  validateServers,
} from "../lib/mcp.js"

test("entryIdFor / isOwnEntryId / serverNameFromEntryId 互逆", () => {
  const id = entryIdFor("github")
  assert.equal(id, `${ENTRY_ID_PREFIX}github`)
  assert.equal(isOwnEntryId(id), true)
  assert.equal(serverNameFromEntryId(id), "github")
  /* 别的插件的行不该被认领。 */
  assert.equal(isOwnEntryId("@gxx-labs/session-manager-dsh"), false)
  assert.equal(serverNameFromEntryId("@gxx-labs/session-manager-dsh"), undefined)
})

test("normalizeServer：stdio 默认值补齐", () => {
  const s = normalizeServer({ serverName: "fs", command: "npx" }, "stdio")
  assert.equal(s.transport, "stdio")
  assert.deepEqual(s.args, [])
  assert.deepEqual(s.env, {})
  assert.equal(s.cwd, "")
  assert.equal(s.toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS)
  assert.equal(s.failOnStartupError, false)
})

test("normalizeServer：args/env 形状收敛（含剔除非法值）", () => {
  const s = normalizeServer(
    { serverName: "x", command: "node", args: ["a", 1, null], env: { A: "1", B: 2, C: null, D: { nested: 1 } } },
    "stdio",
  )
  assert.deepEqual(s.args, ["a", "1", "null"])
  /* 嵌套对象与 null 必须被剔除：mcp-client 的 env 是 z.dict(String)。 */
  assert.deepEqual(s.env, { A: "1", B: "2" })
})

test("normalizeServer：未知字段原样透传（reconnect / maxInstructionBytes）", () => {
  const s = normalizeServer(
    {
      serverName: "x",
      command: "node",
      reconnect: { enabled: false, maxAttempts: 3 },
      maxInstructionBytes: 4096,
    },
    "stdio",
  )
  assert.deepEqual(s.reconnect, { enabled: false, maxAttempts: 3 })
  assert.equal(s.maxInstructionBytes, 4096)
})

test("normalizeServer：非法超时回退默认值", () => {
  assert.equal(normalizeServer({ toolCallTimeoutMs: 0 }, "stdio").toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS)
  assert.equal(normalizeServer({ toolCallTimeoutMs: -5 }, "stdio").toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS)
  assert.equal(normalizeServer({ toolCallTimeoutMs: "abc" }, "stdio").toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS)
  assert.equal(normalizeServer({ toolCallTimeoutMs: 1234 }, "stdio").toolCallTimeoutMs, 1234)
})

test("validateServer：serverName 模式与必填", () => {
  assert.deepEqual(validateServer(normalizeServer({ serverName: "ok-1_a", command: "x" }, "stdio")), [])
  assert.match(validateServer(normalizeServer({ command: "x" }, "stdio"))[0], /serverName 必填/)
  assert.match(validateServer(normalizeServer({ serverName: "bad name", command: "x" }, "stdio"))[0], /只能包含/)
  assert.match(validateServer(normalizeServer({ serverName: "a".repeat(33), command: "x" }, "stdio"))[0], /只能包含/)
})

test("validateServer：按传输方式要求必填项", () => {
  assert.match(
    validateServer(normalizeServer({ serverName: "a" }, "stdio")).join("|"),
    /stdio 传输必须提供 command/,
  )
  assert.match(
    validateServer(normalizeServer({ serverName: "a" }, "streamable-http")).join("|"),
    /必须提供 url/,
  )
  assert.deepEqual(
    validateServer(normalizeServer({ serverName: "a", url: "http://127.0.0.1:3000/mcp" }, "streamable-http")),
    [],
  )
})

test("validateServer：非 http(s) 与畸形 URL 被拒", () => {
  assert.match(
    validateServer(normalizeServer({ serverName: "a", url: "ftp://x/y" }, "streamable-http")).join("|"),
    /http:\/\/ 或 https:\/\//,
  )
  assert.match(
    validateServer(normalizeServer({ serverName: "a", url: "not a url" }, "streamable-http")).join("|"),
    /不是合法地址/,
  )
})

test("validateServers：serverName 重复被抓出", () => {
  const dup = [
    normalizeServer({ serverName: "same", command: "a" }, "stdio"),
    normalizeServer({ serverName: "same", command: "b" }, "stdio"),
  ]
  const result = validateServers(dup)
  assert.equal(result.ok, false)
  assert.ok(result.errors.every((e) => e.messages.some((m) => /重复/.test(m))))
})

test("serversToRows / rowsToServers 往返一致", () => {
  const servers = [
    normalizeServer({ serverName: "fs", command: "npx", args: ["-y", "pkg"] }, "stdio"),
    normalizeServer({ serverName: "web", url: "http://127.0.0.1:3000/mcp" }, "streamable-http"),
  ]
  const rows = serversToRows(servers)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, MCP_CLIENT_PACKAGE)
  assert.equal(rows[0].id, entryIdFor("fs"))

  /* 真实 profile 里的形态：一个 insert 块包着多行。 */
  const round = rowsToServers([{ insert: rows }])
  assert.equal(round.length, 2)
  assert.deepEqual(
    round.map((s) => s.serverName),
    ["fs", "web"],
  )
  assert.deepEqual(round[0].args, ["-y", "pkg"])
})

test("rowsToServers：返回**扁平**形状（脱敏与密钥合并依赖这一点）", () => {
  const patches = [
    {
      insert: [
        {
          id: entryIdFor("gh"),
          name: MCP_CLIENT_PACKAGE,
          config: {
            transport: "stdio",
            serverName: "gh",
            command: "npx",
            env: { TOKEN: "secret" },
            headers: { Authorization: "Bearer x" },
          },
        },
      ],
    },
  ]
  const [server] = rowsToServers(patches)

  /*
   * 这是安全相关的形状契约：redactServers 读的是顶层 server.env，
   * mergeSecrets 读的也是顶层 server.env。若这里退化成
   * { serverName, config: {...} }，两处都会静默失效 —— 后果是
   * **密钥被原样下发给浏览器**。已经踩过一次，别再改回去。
   */
  assert.equal(server.env.TOKEN, "secret", "env 必须在顶层")
  assert.equal(server.headers.Authorization, "Bearer x", "headers 必须在顶层")
  assert.equal(server.command, "npx")
  assert.equal(server.transport, "stdio")
  assert.equal(server.rowId, entryIdFor("gh"))
  assert.equal(server.config, undefined, "不得嵌套 config")
})

test("rowsToServers：serverName 以行 id 为准（config 里缺失也能救回）", () => {
  const patches = [
    {
      insert: [
        { id: entryIdFor("from-id"), name: MCP_CLIENT_PACKAGE, config: { transport: "stdio", command: "x" } },
      ],
    },
  ]
  const [server] = rowsToServers(patches)
  assert.equal(server.serverName, "from-id")
})

test("rowsToServers：不认领用户手写的 MCP 行", () => {
  const patches = [
    {
      insert: [
        /* 用户自己手写的行：id 没有本插件前缀 → 不属于本插件。 */
        { id: "my-github", name: MCP_CLIENT_PACKAGE, config: { transport: "stdio", serverName: "gh", command: "x" } },
        /* 本插件的行。 */
        { id: entryIdFor("fs"), name: MCP_CLIENT_PACKAGE, config: { transport: "stdio", serverName: "fs", command: "npx" } },
        /* 前缀对但指向别的包：也不该被认领。 */
        { id: entryIdFor("other"), name: "@deepseek-ai/dsh-other", config: { transport: "stdio" } },
      ],
    },
    /* 无前缀的顶层配置行。 */
    { id: "locale", config: { preference: "zh" } },
  ]
  const found = rowsToServers(patches)
  assert.deepEqual(
    found.map((s) => s.serverName),
    ["fs"],
  )
})

test("serversToJson / parseJsonConfig 往返（本插件导出格式）", () => {
  const servers = [normalizeServer({ serverName: "fs", command: "npx", args: ["-y", "p"] }, "stdio")]
  const text = serversToJson(servers)
  const parsed = parseJsonConfig(text)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.servers.length, 1)
  assert.equal(parsed.servers[0].serverName, "fs")
  assert.deepEqual(parsed.servers[0].args, ["-y", "p"])
})

test("parseJsonConfig：接受 mcpServers 包裹（Claude Desktop 习惯）", () => {
  const parsed = parseJsonConfig(
    JSON.stringify({ mcpServers: { demo: { command: "uvx", args: ["mcp-server-demo"] } } }),
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.servers[0].serverName, "demo")
  assert.equal(parsed.servers[0].transport, "stdio")
  assert.deepEqual(parsed.servers[0].args, ["mcp-server-demo"])
})

test("parseJsonConfig：接受 patch 行数组与 { insert } 形状（并从 id 反推服务名）", () => {
  const fromArray = parseJsonConfig(
    JSON.stringify([{ id: entryIdFor("a"), name: MCP_CLIENT_PACKAGE, config: { transport: "stdio", command: "x" } }]),
  )
  assert.equal(fromArray.ok, true)
  assert.equal(fromArray.servers[0].serverName, "a")

  const fromInsert = parseJsonConfig(
    JSON.stringify({
      insert: [{ id: entryIdFor("b"), name: MCP_CLIENT_PACKAGE, config: { transport: "streamable-http", url: "http://x/mcp" } }],
    }),
  )
  assert.equal(fromInsert.ok, true)
  assert.equal(fromInsert.servers[0].serverName, "b")
  assert.equal(fromInsert.servers[0].transport, "streamable-http")
})

test("parseJsonConfig：语法错误给出可读消息", () => {
  const parsed = parseJsonConfig("{ not json")
  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /JSON 解析失败/)
})

test("jsonToServers：显式 serverName 优先于键名", () => {
  const servers = jsonToServers({
    alias: { serverName: "real", command: "x" },
  })
  assert.equal(servers[0].serverName, "real")
})

test("jsonToServers：忽略非对象条目，不抛错", () => {
  assert.deepEqual(jsonToServers({ a: null, b: "str", c: 3 }), [])
  assert.deepEqual(jsonToServers(null), [])
  assert.deepEqual(jsonToServers([]), [])
})
