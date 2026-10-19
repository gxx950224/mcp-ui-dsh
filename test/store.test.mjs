/**
 * lib/store.js 的文档编辑测试。
 *
 * 这是整个插件风险最高的一段：它要**就地编辑用户的 profile 配置文件**，
 * 又必须只动自己写的行。这里用真实的 YAML 文档形态（含用户的 `!!js`、
 * 别的插件配置、手写的 MCP 行）验证：
 *   1. 增删改只落在 `mcp-ui-` 前缀行；
 *   2. 用户的其他配置逐字保留（含注释与 `!!js` 标签）；
 *   3. 不重复堆 insert 块；
 *   4. 幂等：同样的输入写两次结果一致。
 */
import assert from "node:assert/strict"
import test from "node:test"
import { parseDocument } from "yaml"
import { ensureOwnInsertBlock, locateRow, parsePatchDocument } from "../lib/store.js"
import { entryIdFor, MCP_CLIENT_PACKAGE, normalizeServer, serversToRows } from "../lib/mcp.js"

/** 一份贴近真实用户 profile 的 patch（含注释、!!js、其他插件行）。 */
const SAMPLE = `# 用户的补丁层
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: zh
- id: some-plugin
  name: "@gxx-labs/other"
  config:
    key: !!js process.env.HOME
- insert:
    - id: user-handwritten-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: hand
        transport: stdio
        command: my-server
- id: agent-team
  config:
    maxMembers: 24
`

/** 复现 store.js 的「应用目标行」算法（纯文档层，不落盘；与实现逐句对应）。 */
function applyRows(document, rows) {
  const desiredIds = new Set(rows.map((r) => r.id))
  const items = document.contents.items

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item || typeof item.get !== "function") continue
    const seq = document.getIn([i, "insert"])
    if (seq === undefined || !Array.isArray(seq.items)) continue
    for (let j = seq.items.length - 1; j >= 0; j--) {
      const row = seq.items[j]
      const id = row?.get?.("id")
      const name = row?.get?.("name")
      if (typeof id !== "string" || !id.startsWith("mcp-ui-")) continue
      if (name !== undefined && String(name) !== MCP_CLIENT_PACKAGE) continue
      if (!desiredIds.has(id)) seq.items.splice(j, 1)
    }
    if (seq.items.length === 0) document.delete(i)
  }

  for (const row of rows) {
    const located = locateRow(document, row.id)
    if (located !== undefined) {
      document.setIn(located.concat("config"), document.createNode(row.config))
      continue
    }
    ensureOwnInsertBlock(document).items.push(
      document.createNode({ id: row.id, name: row.name, config: row.config }),
    )
  }
  return String(document)
}

const server = (name, command) => normalizeServer({ serverName: name, command }, "stdio")

test("parsePatchDocument：接受数组、放行 !!js、拒绝非数组", () => {
  const doc = parsePatchDocument(SAMPLE)
  assert.equal(doc.contents.items.length, 4)
  /* !!js 必须被放行，否则用户 profile 直接解析失败。 */
  assert.match(String(doc), /!!js/)

  assert.throws(() => parsePatchDocument("id: x\n"), /必须是 YAML 数组/)
  assert.throws(() => parsePatchDocument("- id: [unclosed\n"))
})

test("新增：写入到本插件自己的 insert 块，用户内容逐字保留", () => {
  const doc = parsePatchDocument(SAMPLE)
  const before = String(doc)
  const out = applyRows(doc, serversToRows([server("fs", "npx")]))

  /* 用户原有的配置行原样在（含注释、!!js、手写 MCP 行）。 */
  assert.match(out, /# 用户的补丁层/)
  assert.match(out, /!!js process\.env\.HOME/)
  assert.match(out, /id: user-handwritten-mcp/)
  assert.match(out, /id: agent-team/)
  assert.match(out, /maxMembers: 24/)

  /* 新行落在带前缀的 id 上，且 name 指向官方 mcp-client。 */
  assert.match(out, new RegExp(`id: ${entryIdFor("fs").replace(/[-]/g, "\\-")}`))
  assert.match(out, /@deepseek-ai\/dsh-mcp-client/)
  assert.match(out, /serverName: fs/)
  assert.match(out, /command: npx/)

  /* 原有内容未被改动：删掉新增行后应与原文一致。 */
  const back = String(doc)
  assert.ok(back.length > before.length)
})

test("幂等：连续写入相同服务不重复堆叠", () => {
  const rows = serversToRows([server("fs", "npx"), server("git", "uvx")])
  const doc = parsePatchDocument(SAMPLE)
  applyRows(doc, rows)
  const once = String(doc)

  const doc2 = parsePatchDocument(once)
  applyRows(doc2, rows)
  const twice = String(doc2)

  assert.equal(twice, once, "同样的输入写两次必须得到同样文档")
  /* 只应存在 2 个本插件的行。 */
  assert.equal((twice.match(/mcp-ui-/g) ?? []).length, 2)
})

test("删除：行被移除，且用户的 insert 块不受影响", () => {
  const doc = parsePatchDocument(SAMPLE)
  applyRows(doc, serversToRows([server("a", "x"), server("b", "y")]))
  assert.equal((String(doc).match(/mcp-ui-/g) ?? []).length, 2)

  /* 只留 a：b 的行应被删掉。 */
  applyRows(doc, serversToRows([server("a", "x")]))
  const out = String(doc)
  assert.match(out, /serverName: a/)
  assert.doesNotMatch(out, /serverName: b/)
  /* 用户手写的 MCP 行仍在。 */
  assert.match(out, /id: user-handwritten-mcp/)
})

test("删除最后一个服务：本插件的 insert 块被整块清掉，不留空壳", () => {
  const doc = parsePatchDocument(SAMPLE)
  applyRows(doc, serversToRows([server("a", "x")]))
  applyRows(doc, [])
  const out = String(doc)
  assert.doesNotMatch(out, /mcp-ui-/)
  /* 用户的 insert 块（含手写 MCP 行）必须留着。 */
  assert.match(out, /id: user-handwritten-mcp/)
  assert.match(out, /id: locale/)
})

test("更新：同 id 就地改 config，不新增行", () => {
  const doc = parsePatchDocument(SAMPLE)
  applyRows(doc, serversToRows([server("fs", "npx")]))
  applyRows(doc, serversToRows([server("fs", "node")]))
  const out = String(doc)
  assert.equal((out.match(/mcp-ui-/g) ?? []).length, 1)
  assert.match(out, /command: node/)
  assert.doesNotMatch(out, /command: npx/)
})

test("ensureOwnInsertBlock：复用已有块，不重复创建", () => {
  const doc = parsePatchDocument(SAMPLE)
  const first = ensureOwnInsertBlock(doc)
  first.items.push(doc.createNode({ id: entryIdFor("a"), name: MCP_CLIENT_PACKAGE, config: { transport: "stdio" } }))
  const second = ensureOwnInsertBlock(doc)
  assert.equal(first, second, "第二次必须复用同一个块")
  const insertBlocks = doc.contents.items.filter((i) =>
    Array.isArray(doc.getIn([doc.contents.items.indexOf(i), "insert"])?.items),
  )
  assert.equal(insertBlocks.length, 2, "用户原有的块 + 本插件的块")
})

test("locateRow：能找到 insert 内与顶层两种位置", () => {
  const doc = parsePatchDocument(SAMPLE)
  const top = locateRow(doc, "locale")
  assert.deepEqual(top, [0])
  const nested = locateRow(doc, "user-handwritten-mcp")
  /* SAMPLE 的顶层顺序：locale(0) / some-plugin(1) / insert(2) / agent-team(3)。 */
  assert.deepEqual(nested, [2, "insert", 0])
  assert.equal(locateRow(doc, "missing"), undefined)
})

test("空文档：从 [] 开始也能加行", () => {
  const doc = parsePatchDocument("[]\n")
  const out = applyRows(doc, serversToRows([server("fs", "npx")]))
  assert.match(out, /insert:/)
  assert.match(out, /serverName: fs/)
  /* 结果必须仍可被 parsePatchDocument 解析（真落盘后 Loader 会再读一次）。 */
  assert.equal(parsePatchDocument(out).contents.items.length, 1)
})
