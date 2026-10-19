/**
 * lib/index.js 的路由层测试：明文下发、工具清单、请求分发、错误映射。
 *
 * ⚠️ 版本变更（2026-10，按用户要求）：
 *   早期版本对 env / headers **脱敏**（只回传键名），配「留空 = 保持原值」的
 *   占位语义。实测体验很差：用户既看不到存了什么，也改不掉已有 token。
 *   现在改为**明文直传**——这是本机的个人 agent 配置页，与 DSH 自己的设置页
 *   同级别；明文只在本机 loopback 上传输。
 *   因此下面断言「明文可见」，而**不再**断言「密钥不外发」。
 *   仍然保留的硬约束：写操作限本机 loopback、工具归属只按前缀确定性切分。
 */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { buildRouteSpecs, collectMcpTools, isLoopback, presentServers, ROUTES } from "../lib/index.js"
import { normalizeServer } from "../lib/mcp.js"

const withSecrets = () =>
  normalizeServer(
    {
      serverName: "gh",
      command: "npx",
      env: { GITHUB_TOKEN: "ghp_supersecret", PLAIN: "visible" },
    },
    "stdio",
  )

test("presentServers：明文下发 env / headers（用户要能看见并编辑）", () => {
  const [out] = presentServers([withSecrets()])
  assert.equal(out.env.GITHUB_TOKEN, "ghp_supersecret")
  assert.equal(out.env.PLAIN, "visible")
  /* 不得意外丢弃其他字段。 */
  assert.equal(out.serverName, "gh")
  assert.equal(out.command, "npx")
  assert.equal(out.transport, "stdio")
  /* 返回新对象，避免调用方改动污染原数组。 */
  assert.notEqual(out, withSecrets())
})

test("presentServers：http 传输的 headers 同样明文", () => {
  const server = normalizeServer(
    { serverName: "api", url: "http://x/mcp", headers: { Authorization: "Bearer abc123" } },
    "streamable-http",
  )
  const [out] = presentServers([server])
  assert.equal(out.headers.Authorization, "Bearer abc123")
})

test("presentServers：不修改入参（纯函数）", () => {
  const input = [withSecrets()]
  const before = JSON.stringify(input)
  presentServers(input)
  assert.equal(JSON.stringify(input), before)
})

test("isLoopback：只认本机回环地址", () => {
  assert.equal(isLoopback({ socket: { remoteAddress: "127.0.0.1" } }), true)
  assert.equal(isLoopback({ socket: { remoteAddress: "::1" } }), true)
  assert.equal(isLoopback({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), true)
  assert.equal(isLoopback({ socket: { remoteAddress: "192.168.1.5" } }), false)
  assert.equal(isLoopback({ socket: { remoteAddress: "" } }), false)
  assert.equal(isLoopback({}), false)
})

/* ============================ 工具清单 ============================ */

/** 造一个假 ctx，其 tools.schemas() 返回给定工具。 */
function ctxWithTools(names) {
  return {
    get(name) {
      if (name !== "tools") return undefined
      return {
        schemas: () => names.map((name) => ({ name, description: `desc of ${name}` })),
      }
    },
  }
}

test("collectMcpTools：按 mcp__<server>__ 前缀归属到服务", () => {
  const servers = [{ serverName: "obsidian" }, { serverName: "git" }]
  const tools = collectMcpTools(
    ctxWithTools([
      "mcp__obsidian__read_note",
      "mcp__obsidian__search_notes",
      "mcp__git__status",
      "mcp__other__x",
      "read", /* 非 MCP 工具应被忽略 */
    ]),
    servers,
  )
  assert.deepEqual(Object.keys(tools).sort(), ["git", "obsidian"])
  assert.equal(tools.obsidian.length, 2)
  assert.deepEqual(
    tools.obsidian.map((t) => t.rawName),
    ["read_note", "search_notes"],
  )
  assert.equal(tools.git.length, 1)
  /* 未配置的服务不出现。 */
  assert.equal(tools.other, undefined)
})

test("collectMcpTools：rawName 保留内层下划线（只切前两段）", () => {
  const tools = collectMcpTools(ctxWithTools(["mcp__srv__read_multiple_notes"]), [{ serverName: "srv" }])
  assert.equal(tools.srv[0].rawName, "read_multiple_notes")
})

test("collectMcpTools：工具带描述时一并返回", () => {
  const tools = collectMcpTools(ctxWithTools(["mcp__a__t"]), [{ serverName: "a" }])
  assert.equal(tools.a[0].description, "desc of mcp__a__t")
})

test("collectMcpTools：每个配置的服务都出现，即使工具为 0", () => {
  const tools = collectMcpTools(ctxWithTools([]), [{ serverName: "empty" }])
  assert.deepEqual(tools, { empty: [] })
})

test("collectMcpTools：tools 服务不可用时返回空表而不抛错", () => {
  const servers = [{ serverName: "a" }]
  assert.deepEqual(collectMcpTools({ get: () => undefined }, servers), { a: [] })
  assert.deepEqual(collectMcpTools({ get: () => ({ schemas: () => { throw new Error("boom") } }) }, servers), { a: [] })
  /* 无 ctx 也不该炸。 */
  assert.deepEqual(collectMcpTools(undefined, servers), { a: [] })
})

test("collectMcpTools：跳过畸形名称（不误归属）", () => {
  const tools = collectMcpTools(
    ctxWithTools(["mcp__", "mcp__onlyserver", "mcp____x", "mcp__a__"]),
    [{ serverName: "a" }],
  )
  /* `mcp__a__` 的 rawName 为空串——前缀正确但工具名为空，仍归属 a；
     `mcp__` / `mcp__onlyserver` / `mcp____x` 的分隔符不合法，全部忽略。 */
  assert.deepEqual(
    tools.a.map((t) => t.name),
    ["mcp__a__"],
  )
})

/* ============================ 路由分发 ============================ */

/** 造一个假的 req/res 来跑路由 handler。 */
function invoke(spec, { method = "GET", body, remoteAddress = "127.0.0.1" } = {}) {
  return new Promise((resolve) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method,
      socket: { remoteAddress },
      on(event, cb) {
        if (event === "data") for (const c of chunks) cb(c)
        if (event === "end") cb()
      },
    }
    let status = 0
    const res = {
      writeHead(code) {
        status = code
      },
      end(text) {
        resolve({ status, body: safeParse(text ?? "") })
      },
    }
    spec.handler(req, res)
  })
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** 伪造 ctx：提供 logger / get() / root。 */
function fakeCtx() {
  return {
    logger: { info() {}, warn() {} },
    get: () => undefined,
    root: {},
  }
}

test("路由表：四条路由都已声明", () => {
  const specs = buildRouteSpecs(fakeCtx())
  assert.deepEqual(
    specs.map((s) => s.path).sort(),
    [ROUTES.state, ROUTES.save, ROUTES.json, ROUTES.tools].sort(),
  )
  assert.ok(specs.every((s) => s.kind === "exact"))
})

test("写路由：非本机来源被 403 拒绝", async () => {
  const save = buildRouteSpecs(fakeCtx()).find((s) => s.path === ROUTES.save)
  const res = await invoke(save, { method: "POST", body: { servers: [] }, remoteAddress: "10.0.0.9" })
  assert.equal(res.status, 403)
  assert.match(res.body.error, /仅允许本机/)
})

test("写路由：方法不符返回 405", async () => {
  const save = buildRouteSpecs(fakeCtx()).find((s) => s.path === ROUTES.save)
  assert.equal((await invoke(save, { method: "GET" })).status, 405)
})

/*
 * 下面的用例会走到 readServers——也就是**真的去读 profile 文件**。
 * 若不隔离，测试会读（甚至写）开发者本机的真实 profile。因此这里把
 * DSH_PROFILE_DIR 指向临时目录，测完还原。
 */
async function withTempProfile(initial, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ui-route-"))
  await fs.writeFile(path.join(dir, "cordis.patch.yml"), initial, "utf8")
  const savedDir = process.env.DSH_PROFILE_DIR
  const savedHome = process.env.DSH_HOME
  process.env.DSH_PROFILE_DIR = dir
  delete process.env.DSH_HOME
  try {
    return await fn(dir)
  } finally {
    if (savedDir === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = savedDir
    if (savedHome !== undefined) process.env.DSH_HOME = savedHome
    await fs.rm(dir, { recursive: true, force: true })
  }
}

test("读路由：profile 路径不可解析时返回 500 与可读错误（不静默）", async () => {
  const saved = { ...process.env }
  delete process.env.DSH_PROFILE_DIR
  delete process.env.DSH_HOME
  try {
    const state = buildRouteSpecs(fakeCtx()).find((s) => s.path === ROUTES.state)
    const res = await invoke(state, { method: "GET" })
    assert.equal(res.status, 500)
    assert.equal(res.body.ok, false)
    assert.match(res.body.error, /无法定位 profile/)
  } finally {
    Object.assign(process.env, saved)
  }
})

test("写路由：请求体既无 servers 也无 json → 可读错误", async () => {
  await withTempProfile("[]\n", async () => {
    const save = buildRouteSpecs(fakeCtx()).find((s) => s.path === ROUTES.save)
    const res = await invoke(save, { method: "POST", body: { nope: 1 } })
    assert.equal(res.body.ok, false)
    assert.match(res.body.error, /servers 数组或 json 字符串/)
  })
})

test("写路由：非法配置 → 返回逐条校验错误，且不写文件", async () => {
  await withTempProfile("[]\n", async (dir) => {
    const file = path.join(dir, "cordis.patch.yml")
    const before = await fs.readFile(file, "utf8")

    const save = buildRouteSpecs(fakeCtx()).find((s) => s.path === ROUTES.save)
    const res = await invoke(save, {
      method: "POST",
      body: { servers: [{ serverName: "bad name", transport: "stdio", command: "x" }] },
    })
    assert.equal(res.body.ok, false)
    assert.match(res.body.error, /校验失败/)
    assert.equal(res.body.errors.length, 1)
    assert.equal(await fs.readFile(file, "utf8"), before, "校验失败不能改文件")
  })
})

test("写路由：JSON 模式语法错误 → 可读错误，不写文件", async () => {
  await withTempProfile("[]\n", async (dir) => {
    const file = path.join(dir, "cordis.patch.yml")
    const before = await fs.readFile(file, "utf8")
    const save = buildRouteSpecs(fakeCtx()).find((s) => s.path === ROUTES.save)
    const res = await invoke(save, { method: "POST", body: { json: "{ not json" } })
    assert.equal(res.body.ok, false)
    assert.match(res.body.error, /JSON 解析失败/)
    assert.equal(await fs.readFile(file, "utf8"), before)
  })
})

test("读路由：返回写入路径、明文服务列表与工具表", async () => {
  const initial = `- insert:
    - id: mcp-ui-gh
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: gh
        transport: stdio
        command: npx
        env:
          TOKEN: super-secret
`
  await withTempProfile(initial, async (dir) => {
    const state = buildRouteSpecs(fakeCtx()).find((s) => s.path === ROUTES.state)
    const res = await invoke(state, { method: "GET" })
    assert.equal(res.body.ok, true)
    assert.equal(res.body.file, path.join(dir, "cordis.patch.yml"))
    assert.deepEqual(res.body.transports, ["stdio", "streamable-http"])
    assert.equal(res.body.servers.length, 1)
    /* 明文：用户要能在界面上看到已存的 token。 */
    assert.equal(res.body.servers[0].env.TOKEN, "super-secret")
    /* tools 服务不可用时是空表，但键必须存在（页面据它渲染「已生效工具」）。 */
    assert.deepEqual(res.body.tools, { gh: [] })
  })
})

test("工具路由：GET 返回工具表（服务来自真实 profile）", async () => {
  const initial = `- insert:
    - id: mcp-ui-obs
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: obs
        transport: streamable-http
        url: http://127.0.0.1:8765/mcp
`
  await withTempProfile(initial, async () => {
    const ctx = {
      logger: { info() {}, warn() {} },
      root: {},
      get(name) {
        if (name !== "tools") return undefined
        return { schemas: () => [{ name: "mcp__obs__read_note", description: "read" }] }
      },
    }
    const tools = buildRouteSpecs(ctx).find((s) => s.path === ROUTES.tools)
    const res = await invoke(tools, { method: "GET" })
    assert.equal(res.body.ok, true)
    assert.equal(res.body.tools.obs.length, 1)
    assert.equal(res.body.tools.obs[0].rawName, "read_note")
  })
})
