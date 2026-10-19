/**
 * store.js 的**真实执行**验证：在临时 profile 上跑完整的 readServers /
 * writeServers 流程（写盘、读回、校验、原子写、幂等）。
 *
 * ⚠️ 版本历史（重要，别改回去）：
 *   0.1.1 曾在这里断言「writeServers 会驱动 Loader 重载」（注入了根 Include
 *   替身、断言 config.patches 被改写）。那是**错误的设计**——DSH 自带的
 *   @deepseek-ai/dsh-hmr 已经监听 cordis.patch.yml 并自己 reconcile，
 *   插件只需写文件。自己再塞一遍裸 patch 会绕过 prepareProfilePatches，
 *   导致 patch 被应用两遍、**整个 DSH 挂掉**。
 *   因此现在的契约是：**writeServers 只写文件，绝不 update 任何 Loader 条目。**
 *   下面第一组测试就是钉死这一点的。
 */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { documentToPatches, parsePatchDocument, readServers, writeServers } from "../lib/store.js"

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

/** 造一个临时 profile 并让 DSH_PROFILE_DIR 指向它。 */
async function withProfile(initial, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ui-e2e-"))
  await fs.writeFile(path.join(dir, "cordis.patch.yml"), initial, "utf8")
  const saved = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = dir
  try {
    return await fn(dir)
  } finally {
    if (saved === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = saved
    await fs.rm(dir, { recursive: true, force: true })
  }
}

/**
 * 假 ctx。
 *
 * 关键：`loader` 上的变更 API 一旦被调用就**记录并抛错**——因为
 * writeServers 绝不该碰 Loader 条目（那正是 0.1.1 搞挂 DSH 的原因）。
 * 这条断言比任何注释都管用：以后谁再"顺手"加一次 update，测试立刻红。
 */
function fakeCtx() {
  const violations = []
  const rows = []
  const makeBoom = (label) => () => {
    violations.push(label)
    throw new Error(`测试失败：writeServers 不该调用 ${label}`)
  }
  const loader = {
    entries: () => rows,
    async await() {
      return undefined
    },
    update: makeBoom("loader.update"),
    create: makeBoom("loader.create"),
    remove: makeBoom("loader.remove"),
  }
  /* 故意放一个「像根 Include」的条目：即使它存在，也不该被 update。 */
  rows.push({
    options: { id: "include", name: "cordis:include", config: { path: "cordis.yml", patches: [] } },
    update: makeBoom("rootInclude.update"),
  })

  return {
    _violations: violations,
    _rows: rows,
    logger: { info() {}, warn() {}, error() {} },
    get(name) {
      if (name === "profileContext") {
        return { patchPath: path.join(process.env.DSH_PROFILE_DIR, "cordis.patch.yml") }
      }
      if (name === "loader") return loader
      return undefined
    },
  }
}

const server = (name, command) => ({
  serverName: name,
  transport: "stdio",
  command,
  args: [],
  env: {},
  cwd: "",
  toolCallTimeoutMs: 60000,
  failOnStartupError: false,
})

/* ============================ 核心安全契约 ============================ */

test("writeServers：绝不碰 Loader（这是 0.1.1 搞挂 DSH 的根因）", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    await writeServers(ctx, [server("fs", "npx")], { logger() {} })
    assert.deepEqual(ctx._violations, [], "writeServers 只该写文件，不该调用任何 loader 变更 API")
  })
})

test("writeServers：根 Include 的 config.patches 保持不变", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    const rootInclude = ctx._rows[0]
    const before = JSON.stringify(rootInclude.options.config)
    await writeServers(ctx, [server("fs", "npx")], { logger() {} })
    assert.equal(
      JSON.stringify(rootInclude.options.config),
      before,
      "根 Include 的 config 必须原样不动（改了它等于让 patch 被应用两遍）",
    )
  })
})

/* ============================ 读 ============================ */

test("readServers：只读出本插件管理的行（用户手写的不算）", async () => {
  await withProfile(SAMPLE, async () => {
    const { servers } = await readServers(fakeCtx())
    assert.deepEqual(servers, [], "用户手写的行没有 mcp-ui- 前缀，不该被认领")
  })
})

/* ============================ 写 ============================ */

test("writeServers：新增服务 → 落盘 + 用户内容原样保留", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    const result = await writeServers(ctx, [server("fs", "npx")], { logger() {} })

    assert.equal(result.changed, true)
    assert.equal(result.added, 1)
    assert.equal(result.updated, 0)
    assert.equal(result.removed, 0)

    const text = await fs.readFile(path.join(process.env.DSH_PROFILE_DIR, "cordis.patch.yml"), "utf8")
    assert.match(text, /# 用户的补丁层/)
    assert.match(text, /id: user-mcp/)
    assert.match(text, /id: mcp-ui-fs/)
    assert.match(text, /@deepseek-ai\/dsh-mcp-client/)
    assert.match(text, /serverName: fs/)
  })
})

test("writeServers：读回与写入一致（往返）", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    await writeServers(ctx, [server("fs", "npx")], { logger() {} })
    const { servers } = await readServers(ctx)
    assert.equal(servers.length, 1)
    assert.equal(servers[0].serverName, "fs")
    assert.equal(servers[0].command, "npx")
  })
})

test("writeServers：第二次写相同内容 → changed=false，不重复落盘", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    await writeServers(ctx, [server("a", "x")], { logger() {} })
    const second = await writeServers(ctx, [server("a", "x")], { logger() {} })
    assert.equal(second.changed, false)
    assert.equal(second.added, 0)
    assert.equal(second.updated, 0)
  })
})

test("writeServers：删除 → 行移除，用户内容保留", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    await writeServers(ctx, [server("a", "x")], { logger() {} })

    const result = await writeServers(ctx, [], { logger() {} })
    assert.equal(result.changed, true)
    assert.equal(result.removed, 1)

    const text = await fs.readFile(path.join(process.env.DSH_PROFILE_DIR, "cordis.patch.yml"), "utf8")
    assert.doesNotMatch(text, /mcp-ui-/)
    assert.match(text, /id: user-mcp/)
    assert.match(text, /id: locale/)
  })
})

test("writeServers：校验失败 → 抛错且**文件不变**", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    const file = path.join(process.env.DSH_PROFILE_DIR, "cordis.patch.yml")
    const before = await fs.readFile(file, "utf8")

    await assert.rejects(() => writeServers(ctx, [server("bad name", "x")], { logger() {} }), /配置校验失败/)
    assert.equal(await fs.readFile(file, "utf8"), before, "校验失败绝不能改文件")
  })
})

test("writeServers：写盘后文件仍是合法 patch（HMR 会立刻读它）", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    await writeServers(ctx, [server("fs", "npx"), server("git", "uvx")], { logger() {} })
    const text = await fs.readFile(path.join(process.env.DSH_PROFILE_DIR, "cordis.patch.yml"), "utf8")

    /* HMR 的 refresh 会 readProfilePatches → 必须能解析且是数组。 */
    const doc = parsePatchDocument(text)
    const patches = documentToPatches(doc)
    assert.ok(Array.isArray(patches))
    assert.ok(patches.length > 0)
    /* 解析错误必须为 0，否则 HMR 会保持旧树（用户看到「保存了没生效」）。 */
    assert.equal(doc.errors.length, 0)
  })
})

test("writeServers：activated/pending 只是提示，不影响成功", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    /* 目标行不在 Loader 里（HMR 还没轮到）→ 不该抛错。 */
    const result = await writeServers(ctx, [server("new", "x")], { logger() {} })
    assert.equal(result.changed, true)
    assert.deepEqual(result.activated, [])
    assert.deepEqual(result.pending, ["mcp-ui-new"])
  })
})

test("原子写不会留下临时文件", async () => {
  await withProfile(SAMPLE, async () => {
    const ctx = fakeCtx()
    await writeServers(ctx, [server("fs", "npx")], { logger() {} })
    const files = await fs.readdir(process.env.DSH_PROFILE_DIR)
    const leftovers = files.filter((f) => f.includes(".tmp"))
    assert.deepEqual(leftovers, [], `不该留下临时文件：${leftovers.join(", ")}`)
  })
})

test("parsePatchDocument / documentToPatches：放行 !!js", () => {
  const doc = parsePatchDocument("- id: x\n  config:\n    v: !!js process.env.HOME\n")
  const patches = documentToPatches(doc)
  assert.equal(patches[0].id, "x")
  assert.ok(patches[0].config.v !== undefined)
})
