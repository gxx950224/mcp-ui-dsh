/**
 * 回归测试：「服务名输入一个字符，光标就丢」+「不该实时校验」。
 *
 * 背景（用户报的真实问题，0.2.5 修）：
 *   在设置 → MCP 的表单里，服务名输入框敲下一个字符后光标就消失，
 *   必须重新点一下才能继续输，体验极差。
 *
 * 根因（两个叠加）：
 *   1. 列表渲染的 key 写成 `serverName + index`。服务名恰恰是用户正在编辑的
 *      字段，敲第一个字符 → key 变了 → React **卸载并重建**整张卡片 →
 *      `<input>` 连焦点和光标位置一起被销毁。这是光标丢失的直接原因。
 *   2. 每一帧输入都跑一遍 validateServer（useMemo 依赖 servers），并把结果
 *      喂给 aria-invalid 做实时标红，于是「刚敲一个字就飘红」。
 *
 * 修法：
 *   - 每行分配一个**稳定行 id**，key / 展开态都用它，不再用可变字段；
 *   - 校验推迟到**点击保存**时做一次。
 *
 * 下面把这些不变量钉死，防止回归。
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  draftToServer,
  ensureRowIds,
  nextRowId,
  serverToDraft,
  validateServer,
  validateServerFields,
} from "../client/model.js"

/* ==================== 1. 稳定行 id 是不变量 ==================== */

test("nextRowId：每次都给出唯一 id，即使种子相同", () => {
  const a = nextRowId("svc")
  const b = nextRowId("svc")
  assert.notEqual(a, b, "相同种子也必须得到不同 id，否则 React key 会重复")
  const c = nextRowId()
  assert.notEqual(c, a)
  assert.notEqual(c, b)
})

test("nextRowId：空种子也能用（新建的行还没有服务名）", () => {
  for (const seed of [undefined, null, ""]) {
    assert.equal(typeof nextRowId(seed), "string")
  }
})

test("ensureRowIds：种子重复时重新分配，保证一行一个唯一 id", () => {
  const rows = [{ draft: { rowId: "same" } }, { draft: { rowId: "same" } }, { draft: {} }]
  const out = ensureRowIds(rows)
  const ids = out.map((r) => r.draft.rowId)
  assert.equal(new Set(ids).size, 3, `id 必须互不相同，实际 ${JSON.stringify(ids)}`)
})

test("ensureRowIds：不改动原数组（纯函数）", () => {
  const rows = [{ draft: { rowId: "x" } }]
  const before = JSON.stringify(rows)
  ensureRowIds(rows)
  assert.equal(JSON.stringify(rows), before)
})

/* ==================== 2. 改名不换 key（bug 的核心） ==================== */

/*
 * 这是最关键的一条：模拟「用户逐字输入服务名」。
 * 修复前，每次输入都会让 key 变化 → React 重建节点 → 光标丢失。
 * 现在 key 取自行草稿的 rowId，改名**必须**保持 key 不变。
 */
test("改名后行 id 不变 —— 逐字输入不会重建节点（光标得以保留）", () => {
  let server = { draft: serverToDraft({ serverName: "a", transport: "stdio", command: "npx" }), transport: "stdio" }
  const [first] = ensureRowIds([server])
  const keyBefore = first.draft.rowId

  /* 模拟 updateServer 的逐字输入：只改 serverName，其余原样。 */
  let current = first
  const keys = []
  for (const typed of ["ab", "abc", "abcd", "abcde"]) {
    current = { ...current, draft: { ...current.draft, serverName: typed } }
    keys.push(current.draft.rowId)
  }
  assert.deepEqual(
    new Set(keys),
    new Set([keyBefore]),
    "输入过程中行 id 必须恒定；一旦变化，React 会重建卡片并夺走光标",
  )
})

test("serverToDraft：能从宿主 rowId 派生稳定身份，且不重复", () => {
  const a = serverToDraft({ serverName: "a", transport: "stdio", rowId: "mcp-ui-a" })
  const b = serverToDraft({ serverName: "b", transport: "stdio", rowId: "mcp-ui-b" })
  assert.match(a.rowId, /^mcp-ui-a#/)
  assert.match(b.rowId, /^mcp-ui-b#/)
  assert.notEqual(a.rowId, b.rowId)
})

test("serverToDraft：每调用一次都得到新 id（不会两行撞车）", () => {
  const a = serverToDraft({ serverName: "a", transport: "stdio" })
  const b = serverToDraft({ serverName: "a", transport: "stdio" })
  assert.notEqual(a.rowId, b.rowId)
})

/* ==================== 3. 行 id 绝不进配置文件 ==================== */

/*
 * 行 id 纯粹是界面用的。若它被写进 cordis.patch.yml，mcp-client 的严格
 * union 可能直接拒绝该行（表现为「保存成功但服务起不来」）。
 */
test("draftToServer：rowId 被丢弃，不污染提交给宿主的配置", () => {
  const draft = serverToDraft({ serverName: "fs", transport: "stdio", command: "npx" })
  assert.ok(draft.rowId, "草稿里应当有行 id")
  const server = draftToServer(draft, "stdio")
  assert.equal(server.rowId, undefined, "提交的配置里绝不能带 rowId")
  assert.equal(Object.hasOwn(server, "rowId"), false)
  /* 也不能从 extra 漏出去。 */
  assert.deepEqual(Object.keys(server).includes("rowId"), false)
})

test("draftToServer：带 rowId 的草稿往返后仍不含 rowId", () => {
  const draft = { ...serverToDraft({ serverName: "x", transport: "stdio", command: "c" }), rowId: "row#9" }
  const back = draftToServer(draft, "stdio")
  assert.equal(back.rowId, undefined)
  assert.equal(back.serverName, "x")
  assert.equal(back.command, "c")
})

/* ==================== 4. 校验规则与字段归属 ==================== */

test("validateServerFields：精确给出出错字段，供界面标红", () => {
  const empty = validateServerFields({ serverName: "", transport: "stdio", command: "" }, [""])
  assert.deepEqual(
    empty.map((e) => e.field).sort(),
    ["command", "serverName"],
  )

  const badName = validateServerFields({ serverName: "bad name", transport: "stdio", command: "x" }, ["bad name"])
  assert.deepEqual(badName.map((e) => e.field), ["serverName"])

  const dup = validateServerFields({ serverName: "a", transport: "stdio", command: "x" }, ["a", "a"])
  assert.deepEqual(dup.map((e) => e.field), ["serverName"])

  const badUrl = validateServerFields({ serverName: "a", transport: "streamable-http", url: "ftp://x" }, ["a"])
  assert.deepEqual(badUrl.map((e) => e.field), ["url"])

  const emptyUrl = validateServerFields({ serverName: "a", transport: "streamable-http", url: "" }, ["a"])
  assert.deepEqual(emptyUrl.map((e) => e.field), ["url"])

  const badTransport = validateServerFields({ serverName: "a", transport: "nope" }, ["a"])
  assert.deepEqual(badTransport.map((e) => e.field), ["transport"])

  /* 合法配置不报错。 */
  assert.deepEqual(validateServerFields({ serverName: "ok", transport: "stdio", command: "npx" }, ["ok"]), [])
})

test("validateServer 与 validateServerFields 是同一套规则（不会各说各话）", () => {
  const cases = [
    { serverName: "", transport: "stdio", command: "" },
    { serverName: "bad name", transport: "stdio", command: "x" },
    { serverName: "a", transport: "streamable-http", url: "nope" },
    { serverName: "a", transport: "streamable-http", url: "ftp://x/y" },
    { serverName: "ok", transport: "stdio", command: "npx" },
  ]
  for (const server of cases) {
    assert.deepEqual(
      validateServer(server, [server.serverName]),
      validateServerFields(server, [server.serverName]).map((e) => e.message),
      `两种视图必须一致：${JSON.stringify(server)}`,
    )
  }
})

test("字段归属修掉了子串误伤：url 的报错不再匹配到别的字段", () => {
  /*
   * 旧实现是 errors.some(m => m.includes("url"))。文案里出现 "url" 的
   * 其他错误会连带标红 url 输入框；结构化后只认 field。
   */
  const onlyCommand = validateServerFields({ serverName: "a", transport: "stdio", command: "" }, ["a"])
  assert.deepEqual(onlyCommand.map((e) => e.field), ["command"])
  assert.equal(
    onlyCommand.some((e) => e.field === "url"),
    false,
    "command 缺失不该把 url 标红",
  )

  /*
   * 反方向也必须成立：url 真的有问题时，红的一定是 url 字段。
   * （缺了这条，"把 url 的报错记到 command 上" 这种错位就抓不出来——
   *   变异测试实测发现过这个漏洞。）
   */
  for (const url of ["nope", "ftp://x/y", ""]) {
    const e = validateServerFields({ serverName: "a", transport: "streamable-http", url }, ["a"])
    assert.deepEqual(
      e.map((x) => x.field),
      ["url"],
      `url=${JSON.stringify(url)} 的报错必须归到 url 字段`,
    )
  }
})
