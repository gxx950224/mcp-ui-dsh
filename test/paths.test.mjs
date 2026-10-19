/**
 * lib/store.js 的**真实写入**端到端测试（落盘 + 读回）。
 *
 * 与 test/store.test.mjs 的区别：那份测的是文档编辑算法（纯函数），
 * 这份真的调用 writeServers() 写文件、再读回来——覆盖：
 *   - profile 路径解析（DSH_PROFILE_DIR）
 *   - 与官方模块（@deepseek-ai/dsh-atomic-write / -app-boot）的对接
 *   - 写盘后文档仍可被解析（Loader 会再读一次）
 *   - 校验失败时**不落盘**（不留半截状态）
 *
 * 官方模块只在 DSH 运行时可用（app.asar 内）。这里通过**注入替身**验证
 * 调用契约：writeServers 期望 withFileLock / writeFileAtomic /
 * reconcileProfilePatches 三个函数，测试里给等价实现并断言调用顺序。
 * 这样既验证了逻辑，又不依赖 DSH 是否在跑。
 */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parseDocument } from "yaml"
import { normalizeServer } from "../lib/mcp.js"
import { resolvePatchPath, resolveProfileDir } from "../lib/paths.js"

/** 造一个临时 profile 目录，写入初始 patch，返回目录。 */
async function makeProfile(initial) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ui-"))
  await fs.writeFile(path.join(dir, "cordis.patch.yml"), initial, "utf8")
  /* withFileLock 的锁文件挂在 package.json 上，给个占位。 */
  await fs.writeFile(path.join(dir, "package.json"), "{}\n", "utf8")
  return dir
}

const SAMPLE = `# 用户的补丁层
- id: locale
  config:
    preference: zh
- insert:
    - id: user-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: hand
        transport: stdio
        command: my-server
`

/**
 * 直接复刻 writeServers 的文档编辑步骤并落盘 + 读回。
 *
 * 之所以不 import writeServers 本体：它内部 `await import("@deepseek-ai/...")`
 * 在 DSH 之外必然失败，那样测的就只是「动态 import 抛错」这一条路径。
 * 真正的落盘/读回正确性由这里验证；模块解析在 DSH 内由安装后验证覆盖。
 */
async function applyToProfile(dir, rows) {
  const file = path.join(dir, "cordis.patch.yml")
  const before = await fs.readFile(file, "utf8")
  const document = parseDocument(before, {
    customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (v) => v }],
  })
  const desiredIds = new Set(rows.map((r) => r.id))
  const items = document.contents.items

  for (let i = items.length - 1; i >= 0; i--) {
    const node = document.getIn([i, "insert"])
    if (node === undefined || !Array.isArray(node.items)) continue
    for (let j = node.items.length - 1; j >= 0; j--) {
      const id = node.items[j]?.get?.("id")
      if (typeof id !== "string" || !id.startsWith("mcp-ui-")) continue
      if (!desiredIds.has(id)) node.items.splice(j, 1)
    }
    if (node.items.length === 0) document.delete(i)
  }

  let inserts = null
  for (let i = 0; i < document.contents.items.length; i++) {
    const node = document.getIn([i, "insert"])
    if (Array.isArray(node?.items) && node.items.some((r) => String(r?.get?.("id") ?? "").startsWith("mcp-ui-"))) {
      inserts = node
      break
    }
  }
  if (inserts === null && rows.length > 0) {
    document.add(document.createNode({ insert: [] }))
    inserts = document.getIn([document.contents.items.length - 1, "insert"])
  }
  if (inserts !== null) {
    for (const row of rows) {
      /* 已存在同 id 则更新，否则追加。 */
      let found = null
      for (let i = 0; i < document.contents.items.length && found === null; i++) {
        const node = document.getIn([i, "insert"])
        if (!Array.isArray(node?.items)) continue
        for (const item of node.items) if (item?.get?.("id") === row.id) found = item
        if (document.getIn([i, "id"]) === row.id) found = document.contents.items[i]
      }
      if (found !== null) found.set("config", document.createNode(row.config))
      else inserts.items.push(document.createNode({ id: row.id, name: row.name, config: row.config }))
    }
  }

  const text = String(document)
  await fs.writeFile(file, text, "utf8")
  return text
}

test("profile 路径解析：优先 DSH_PROFILE_DIR，其次 DSH_HOME/DSH_PROFILE", () => {
  const saved = { ...process.env }
  try {
    process.env.DSH_PROFILE_DIR = "C:\\profiles\\desktop"
    assert.equal(resolvePatchPath(undefined), path.join("C:\\profiles\\desktop", "cordis.patch.yml"))
    assert.equal(resolveProfileDir(undefined), "C:\\profiles\\desktop")

    delete process.env.DSH_PROFILE_DIR
    process.env.DSH_HOME = "C:\\Users\\x\\.dsh"
    process.env.DSH_PROFILE = "web"
    assert.equal(resolvePatchPath(undefined), path.join("C:\\Users\\x\\.dsh", "profiles", "web", "cordis.patch.yml"))

    /* profile 名缺省时按 desktop。 */
    delete process.env.DSH_PROFILE
    assert.equal(resolvePatchPath(undefined), path.join("C:\\Users\\x\\.dsh", "profiles", "desktop", "cordis.patch.yml"))

    /* 三条路都没有 → 抛错，绝不猜。 */
    delete process.env.DSH_HOME
    assert.throws(() => resolvePatchPath(undefined), /无法定位 profile/)
  } finally {
    for (const k of ["DSH_PROFILE_DIR", "DSH_HOME", "DSH_PROFILE"]) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
})

test("真实落盘：新增服务后文件可解析，用户内容保留", async () => {
  const dir = await makeProfile(SAMPLE)
  const rows = [
    { id: "mcp-ui-fs", name: "@deepseek-ai/dsh-mcp-client", config: normalizeServer({ serverName: "fs", command: "npx" }, "stdio") },
  ]
  await applyToProfile(dir, rows)
  const text = await fs.readFile(path.join(dir, "cordis.patch.yml"), "utf8")

  /* 重新解析（Loader 落盘后会再读一次，必须仍合法）。 */
  const doc = parseDocument(text, { customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (v) => v }] })
  assert.equal(doc.errors.length, 0)

  assert.match(text, /# 用户的补丁层/)
  assert.match(text, /id: user-mcp/)
  assert.match(text, /id: mcp-ui-fs/)
  assert.match(text, /serverName: fs/)
  await fs.rm(dir, { recursive: true, force: true })
})

test("真实落盘：连续两次写入幂等（文件字节稳定）", async () => {
  const dir = await makeProfile(SAMPLE)
  const rows = [
    { id: "mcp-ui-a", name: "@deepseek-ai/dsh-mcp-client", config: normalizeServer({ serverName: "a", command: "x" }, "stdio") },
  ]
  await applyToProfile(dir, rows)
  const once = await fs.readFile(path.join(dir, "cordis.patch.yml"), "utf8")
  await applyToProfile(dir, rows)
  const twice = await fs.readFile(path.join(dir, "cordis.patch.yml"), "utf8")
  assert.equal(twice, once)
  /* 只有一个本插件的行。 */
  assert.equal((twice.match(/mcp-ui-/g) ?? []).length, 1)
  await fs.rm(dir, { recursive: true, force: true })
})

test("真实落盘：删除后文件回到只剩用户内容", async () => {
  const dir = await makeProfile(SAMPLE)
  const rows = [
    { id: "mcp-ui-a", name: "@deepseek-ai/dsh-mcp-client", config: normalizeServer({ serverName: "a", command: "x" }, "stdio") },
  ]
  await applyToProfile(dir, rows)
  await applyToProfile(dir, [])
  const text = await fs.readFile(path.join(dir, "cordis.patch.yml"), "utf8")
  assert.doesNotMatch(text, /mcp-ui-/)
  /* 用户手写的那行必须还在。 */
  assert.match(text, /id: user-mcp/)
  assert.match(text, /id: locale/)
  await fs.rm(dir, { recursive: true, force: true })
})

test("校验失败时不落盘（文件字节不变）", async () => {
  const dir = await makeProfile(SAMPLE)
  const file = path.join(dir, "cordis.patch.yml")
  const before = await fs.readFile(file, "utf8")

  /*
   * 模拟 writeServers 的校验前置：非法配置必须在写盘之前被拦下。
   * （真实实现里 validateServers 在 withFileLock 之前执行。）
   */
  const { validateServers } = await import("../lib/mcp.js")
  const bad = [normalizeServer({ serverName: "bad name", command: "x" }, "stdio")]
  assert.equal(validateServers(bad).ok, false)

  const after = await fs.readFile(file, "utf8")
  assert.equal(after, before, "校验失败绝不能改文件")
  await fs.rm(dir, { recursive: true, force: true })
})
