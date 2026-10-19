/**
 * @gxx-labs/mcp-ui-dsh 宿主半：注册「设置 → MCP」页签所需的同源 HTTP 路由。
 *
 * 为什么必须有宿主半：
 *   MCP 服务是 **Loader 行**，写入需要 profile 的 cordis.patch.yml 文件操作。
 *   （热重载由 DSH 自带的 HMR 完成，插件不参与——见 lib/store.js 文件头。）
 *   浏览器半拿不到文件系统，也无法读取已注册的工具表；
 *   同源 webServer 路由是本类插件读写宿主能力的可行路径
 *   （delivery-board-dsh、sapbuddy-dsh、session-manager-dsh 均以此模式工作）。
 *
 * 安全模型（按用户要求放开明文，但边界仍然清晰）：
 *   - 读：**返回 env / headers 的明文**，让用户能在界面里直接查看与编辑
 *     （这是「个人 agent」的本地配置页，与 DSH 自己的设置页一致；
 *      也修掉了旧版「值不回显 → 用户改不了、也不知道存了什么」的体验问题）。
 *   - 写：仍限本机 loopback——写的是 profile 配置文件。
 *   - 服务只监听本机（DSH webServer 即如此），因此明文不会离开本机。
 */
import {
  MCP_TOOL_PREFIX,
  TRANSPORTS,
  normalizeServer,
  parseJsonConfig,
  serversToJson,
  validateServer,
} from "./mcp.js"
import { readServers, writeServers } from "./store.js"
import { resolvePatchPath } from "./paths.js"

export const ROUTES = {
  state: "/api/mcp-ui/state",
  save: "/api/mcp-ui/save",
  json: "/api/mcp-ui/json",
  tools: "/api/mcp-ui/tools",
}

/** 仅允许本机回环访问写操作。 */
export function isLoopback(req) {
  const a = req?.socket?.remoteAddress ?? ""
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1"
}

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error(`请求体不是合法 JSON：${e instanceof Error ? e.message : String(e)}`))
      }
    })
    req.on("error", reject)
  })
}

/**
 * 准备下发给浏览器的服务数组。
 *
 * **按用户要求返回 env / headers 明文**：这是本机的个人 agent 配置页，
 * 用户需要能直接看到并编辑已存的 token（旧版「不回显 + 留空保持原值」
 * 导致用户既看不到存了什么、也无法把值改掉，体验很差）。
 *
 * 明文只在本机 loopback 上传输（DSH webServer 只监听本机）。
 * 这里保留为独立函数，以便将来若要恢复脱敏只需改这一处。
 *
 * @param servers - 规范化后的服务数组
 * @returns 可下发的服务数组（含明文）
 */
export function presentServers(servers) {
  return servers.map((server) => ({ ...server }))
}

/**
 * 构造全部路由规格（纯数据，不触碰 webServer，便于单测）。
 *
 * @param ctx - 宿主插件上下文
 * @returns 路由规格数组
 */
export function buildRouteSpecs(ctx) {
  const get = (path, handler) => ({
    kind: "exact",
    path,
    async handler(req, res) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return json(res, 405, { ok: false, error: "仅支持 GET" })
      }
      try {
        return await handler(req, res)
      } catch (e) {
        return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })

  const post = (path, handle) => ({
    kind: "exact",
    path,
    async handler(req, res) {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "仅支持 POST" })
      if (!isLoopback(req)) return json(res, 403, { ok: false, error: "仅允许本机访问" })
      let body
      try {
        body = await readBody(req)
      } catch (e) {
        return json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      try {
        return json(res, 200, await handle(body))
      } catch (e) {
        return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })

  return [
    /* 读：当前已配置的 MCP 服务 + 已注册的工具（明文，见 presentServers 注释）。 */
    get(ROUTES.state, async (_req, res) => {
      const { file, servers } = await readServers(ctx)
      return json(res, 200, {
        ok: true,
        file,
        transports: TRANSPORTS,
        servers: presentServers(servers),
        tools: collectMcpTools(ctx, servers),
      })
    }),

    /*
     * 工具：单独取一次，供页面在保存后轮询刷新（HMR 是异步装载的）。
     * 只读，因此不需要 loopback 限制之外的东西。
     */
    get(ROUTES.tools, async (_req, res) => {
      const { servers } = await readServers(ctx)
      return json(res, 200, { ok: true, tools: collectMcpTools(ctx, servers) })
    }),

    /*
     * 保存：整体替换本插件管理的 MCP 行，由 DSH 自带的 HMR 热重载生效。
     * 接受两种载荷：
     *   { servers: [...] }  —— 表单模式
     *   { json: "..." }     —— JSON 模式
     */
    post(ROUTES.save, async (body) => {
      let incoming
      if (typeof body?.json === "string" && body.json.trim() !== "") {
        const parsed = parseJsonConfig(body.json)
        if (!parsed.ok) return { ok: false, error: parsed.error }
        incoming = parsed.servers
      } else if (Array.isArray(body?.servers)) {
        incoming = body.servers.map((s) => normalizeServer(s, s?.transport))
      } else {
        return { ok: false, error: "请求体必须包含 servers 数组或 json 字符串" }
      }

      /* 明文直传：界面回显了真实值，用户改什么就存什么（不再有空串语义）。 */
      const merged = incoming

      /* 逐条校验，把可读错误回给页面（写盘层还会再校验一次兜底）。 */
      const errors = merged
        .map((server, index) => ({ index, serverName: server?.serverName ?? "", messages: validateServer(server) }))
        .filter((e) => e.messages.length > 0)
      if (errors.length > 0) {
        return { ok: false, error: "配置校验失败", errors }
      }

      const result = await writeServers(ctx, merged, {
        logger: (msg) => {
          try {
            ctx.logger?.info?.(msg)
          } catch {
            /* 日志失败不影响业务 */
          }
        },
      })
      return {
        ok: true,
        changed: result.changed,
        file: result.file,
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        /*
         * activated / pending 只是**提示**，不是成败：
         * HMR 是异步的，刚写完还没轮到很常见；mcp-client 连不上服务器时
         * 该行本来就该是失败态（那是用户配置问题）。页面据此显示
         * 「已保存，正在生效」而不是报错。
         */
        activated: result.activated ?? [],
        pending: result.pending ?? [],
        servers: presentServers(result.servers),
        /* 顺带回一次工具清单，省掉页面一次请求。 */
        tools: collectMcpTools(ctx, result.servers),
      }
    }),

    /* JSON 模式：返回当前配置的 JSON 文本（含明文 env/headers，便于直接编辑）。 */
    post(ROUTES.json, async () => {
      const { servers } = await readServers(ctx)
      return { ok: true, json: serversToJson(servers) }
    }),
  ]
}

/**
 * 收集每个已配置 MCP 服务**当前已注册**的工具。
 *
 * 数据来源：`ctx.get("tools").schemas()`（官方工具注册表，返回不含执行回调的
 * 模型可见 schema）。mcp-client 把每个服务器工具注册为
 * `mcp__<serverName>__<rawName>`，因此按其前缀归属到服务。
 *
 * 为什么走注册表而不是再发一次 MCP 请求：
 *   - 注册表是**权威且零成本**的（已在内存里）；再连一次服务器既慢又可能
 *     因连接状态不同而给出与实际可用工具不一致的结果。
 *   - 页面要回答的问题是「我现在能用哪些工具」，正是注册表的内容。
 *
 * 只读、容错：tools 服务不可用（headless / 尚未挂载）时返回空表，
 * 而不是让整个 state 请求失败——配置本身仍然要能显示。
 *
 * @param ctx - 宿主插件上下文
 * @param servers - 已配置的服务数组
 * @returns `{ [serverName]: { name, description }[] }`
 */
export function collectMcpTools(ctx, servers) {
  const out = {}
  for (const server of servers ?? []) {
    if (typeof server?.serverName === "string" && server.serverName !== "") out[server.serverName] = []
  }

  let schemas = []
  try {
    const tools = ctx?.get?.("tools")
    if (tools?.schemas !== undefined) schemas = tools.schemas() ?? []
  } catch {
    /* 工具表不可用：返回空对象，页面显示「暂无」而不是整体失败。 */
    return out
  }

  for (const schema of schemas) {
    const name = schema?.name
    if (typeof name !== "string" || !name.startsWith(MCP_TOOL_PREFIX)) continue
    /* `mcp__<serverName>__<rawName>`；rawName 里可能含下划线，故只切前两段。 */
    const rest = name.slice(MCP_TOOL_PREFIX.length)
    const sep = rest.indexOf("__")
    if (sep <= 0) continue
    const serverName = rest.slice(0, sep)
    if (!Object.hasOwn(out, serverName)) continue
    out[serverName].push({
      name,
      /* 原始工具名（去掉前缀），便于用户对照 MCP 服务器自己的文档。 */
      rawName: rest.slice(sep + 2),
      description: typeof schema.description === "string" ? schema.description : "",
    })
  }

  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * 注册全部路由。返回 disposer 列表；调用方负责并入 ctx.effect。
 *
 * 注册是"全有或全无"的：webServer 对重复的 (kind,path) 会抛错，
 * 若中途失败就把已注册的路由回滚掉再抛出，避免留下半套路由却没人卸载。
 *
 * @param webServer - 宿主 webServer 服务
 * @param ctx - 宿主插件上下文
 */
export function installRoutes(webServer, ctx) {
  const specs = buildRouteSpecs(ctx)
  const disposers = []
  try {
    for (const spec of specs) disposers.push(webServer.register(spec))
  } catch (e) {
    for (const d of disposers) {
      try {
        d()
      } catch {
        /* 回滚失败不再掩盖原始错误 */
      }
    }
    throw e
  }
  return disposers
}

/**
 * 插件入口。用 ctx.inject 而非硬依赖，这样 headless profile（无 webServer）下
 * 插件仍能正常加载，只是不注册路由。
 */
export function apply(ctx) {
  ctx.inject(["webServer"], (webCtx) => {
    const webServer = webCtx.get("webServer")
    if (webServer === undefined) return
    const disposers = installRoutes(webServer, ctx)

    /*
     * 启动自检（只记日志，不阻塞加载）：把 profile patch 路径打出来，
     * 便于用户在「保存没反应」时第一时间确认插件写的是哪个文件。
     */
    try {
      ctx.logger?.info?.(`mcp-ui: profile patch = ${resolvePatchPath(ctx)}`)
    } catch (error) {
      ctx.logger?.warn?.(`mcp-ui: ${error instanceof Error ? error.message : String(error)}`)
    }

    webCtx.effect(() => () => {
      for (const d of disposers) {
        try {
          d()
        } catch {
          /* 单个卸载失败不影响其余 */
        }
      }
    })
    // eslint-disable-next-line no-console
    console.log(`[mcp-ui-dsh] 已注册 ${disposers.length} 条 MCP 配置路由`)
  })
}

export default { name: "mcp-ui-dsh", apply }
