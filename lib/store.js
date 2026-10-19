/**
 * profile patch 的读写（MCP 服务 = Loader 行的增删改）。
 *
 * 为什么写 Loader 行（读 app.asar 核验的链路，勿凭记忆改）：
 *   MCP 服务在 DSH 里**不是**某个服务的可写数据，而是 Loader 行——
 *   `insert: [{ id, name: '@deepseek-ai/dsh-mcp-client', config: {...} }]`
 *   （见 @deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/
 *    templates/mcp/cordis.patch.yml）。官方 mcp-client 的 apply() 只
 *   `ctx.effect` 建立连接，没有任何 CRUD API；`mcpResources` 也只有
 *   register。因此「新增/修改 MCP 服务」唯一正规做法就是写 Loader 行。
 *
 * ============================================================================
 * ⚠️ 为什么不再自己驱动重载（0.1.1 把整个 DSH 搞挂的教训，务必读完）
 * ============================================================================
 *
 * DSH **自带**配置热重载：`@deepseek-ai/dsh-hmr` 用 chokidar 监听
 * `profile.patchPath`（就是本文件）与 `profile.json`，文件一变就执行
 * （见 dsh-hmr/lib/index.js 的 refresh()）：
 *
 *     const patches = readProfilePatches("dsh", profile);
 *     await reconcileProfilePatches(this.ownerContext.root, patches, "dsh");
 *
 * 也就是说：**我们只要把文件写好，「即时生效」由 DSH 自己完成。**
 *
 * 0.1.1 的错误做法是自己拿根 Include 条目再
 * `entry.update({ config: { ...cfg, patches: <裸 patch 列表> } })`。
 * 这漏掉了官方 `prepareProfilePatches` 这一步——它会
 * `applyEntryPatches([], patches, warn)` 把 patch 列表**物化**成真正的条目行，
 * 再包成单个 `{ insert: rows }`：
 *
 *     prepareProfilePatches → applyEntryPatches([], patches, warn)
 *                           → rows.length === 0 ? [] : [{ insert: rows }]
 *
 * 把**未转换的裸 patch** 直接塞进 config.patches，会让同一批 patch 被应用
 * 两遍（因为 Include 还会拿它去 patch 已经包含这些行的 data），
 * 结果是所有插件条目被重复创建/覆盖成错误形状、依赖它们的服务全部失联
 * → **整个 DSH 不可用**。这是很严重的回归，绝不能再犯。
 *
 * 结论：**只写文件，不要碰 Loader。** 若将来真需要同步等待，
 * 也只能只读地 `loader.await()`（见 waitForLoader），绝不 update entry。
 * ============================================================================
 *
 * 写盘细节：
 *   - YAML Document 编辑（保留注释、`!!js` 标签、字段顺序）
 *   - 原子写（同目录临时文件 + rename，带权限）
 */
import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument, isSeq, isMap } from "yaml"
import {
  MCP_CLIENT_PACKAGE,
  normalizeServer,
  rowsToServers,
  serversToRows,
  validateServers,
} from "./mcp.js"
import { resolvePatchPath } from "./paths.js"

/** 空 patch 文档（profile 里文件不存在时的初值，与官方一致）。 */
const EMPTY_DOCUMENT = "[]\n"

/**
 * 根 Include 条目的识别名。
 *
 * **踩过的坑（别改回 npm 包名）**：根 Include 由 dsh-app-boot 用
 * `ctx.loader.create({ id: "include", name: "cordis:include", config: { path, patches } })`
 * 创建（见 app-boot 里 bootstrapProfileIncludes 一段），所以 `options.name`
 * 是 **`"cordis:include"`** —— 那是 Loader 的 builtin 前缀语法，
 * **不是** `@deepseek-ai/cordis-plugin-include` 这个 npm 包名。
 * 早先按包名比较，导致永远找不到根 Include，保存时报
 * 「找不到根 Include 条目（profile 结构变化？）」。
 */
const ROOT_INCLUDE_NAMES = ["cordis:include", "include"]

/** 读取 patch 文件文本；不存在时返回空文档。 */
async function readPatchText(file) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return EMPTY_DOCUMENT
    throw error
  }
}

/**
 * 把 patch 文本解析为 YAML Document。
 *
 * `customTags` 必须放行 `!!js`：用户 profile 里可能有 `!!js` 表达式
 * （官方 config-editor 与 plugin-manager 都这么处理），不放行会让
 * parseDocument 报错，插件就完全无法读写了。
 *
 * @param text - 文件内容
 * @returns YAML Document
 */
export function parsePatchDocument(text) {
  const document = parseDocument(text, {
    customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (value) => value }],
  })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error("profile patch 必须是 YAML 数组（序列）")
  return document
}

/** 把 Document 转成普通 JS 值（`!!js` 节点会变成 { __jsExpr } 形式）。 */
export function documentToPatches(document) {
  return document.toJS() ?? []
}

/**
 * 原子写文件：同目录临时文件 + rename（对齐官方 writeFileAtomic 的语义）。
 *
 * 为什么不用 fs.writeFile 直接覆盖：Loader 可能正在读该文件；非原子写会
 * 让它读到半截 YAML 并抛错。rename 在同一文件系统内是原子的。
 *
 * @param file - 目标绝对路径
 * @param content - 内容
 * @param mode - 权限（默认 0o600，与官方一致）
 */
export async function writeFileAtomic(file, content, mode = 0o600) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now().toString(16)}.tmp`)
  try {
    await fs.writeFile(tmp, content, { mode })
    await fs.rename(tmp, file)
  } catch (error) {
    /* 失败时清掉临时文件，不留垃圾在用户 profile 里。 */
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 找出承载 profile patch 的根 Include 条目（**仅用于诊断**，不用于驱动重载）。
 *
 * ⚠️ 历史教训：0.1.1 曾用它拿 entry 再 `entry.update({ config: { patches } })`
 * 来「主动触发重载」，结果**把整个 DSH 搞挂了**（见文件头「为什么不再自己重载」）。
 * 现在它只用于把根 Include 的路径信息写进日志，帮助排查。
 *
 * 判定从严到宽：
 *   1. `options.name` 是 `cordis:include` / `include`（app-boot 的原始写法）；
 *   2. `options.id` 是 `include`（bootstrapProfileIncludes 里写死的 id）；
 *   3. 结构兜底：`subtree.applyPatches` 是函数（Include 类特征）。
 *
 * @param ctx - 宿主插件上下文
 * @returns Loader 条目，或 undefined
 */
export function findRootIncludeEntry(ctx) {
  const loader = ctx?.get?.("loader")
  if (loader?.entries === undefined) return undefined

  let structural = undefined
  for (const entry of loader.entries()) {
    const options = entry?.options ?? {}

    /* 1/2. 按名字或 id 精确命中。 */
    if (ROOT_INCLUDE_NAMES.includes(options.name)) return entry
    if (options.id === "include") return entry

    /* 3. 结构兜底：记下第一个像 Include 的条目（不要立刻返回，
       优先让精确匹配赢，避免误认嵌套的 include）。 */
    if (structural === undefined && typeof entry?.subtree?.applyPatches === "function") {
      structural = entry
    }
  }
  return structural
}

/**
 * 等待 Loader 把文件变化消化完（**只读等待，绝不驱动重载**）。
 *
 * 为什么只等不推：见文件头「为什么不再自己重载」。DSH 自带的 HMR 会监听
 * `cordis.patch.yml`，文件一变就自己 reconcile；我们只需写入，然后（可选地）
 * 等一下让状态收敛，好让页面能立刻反映结果。
 *
 * @param ctx - 宿主插件上下文
 * @param timeoutMs - 最长等待时间（超过就放弃，不报错）
 * @returns 是否等到了 Loader 空闲
 */
export async function waitForLoader(ctx, timeoutMs = 4000) {
  const loader = ctx?.get?.("loader")
  if (loader?.await === undefined) return false
  try {
    await Promise.race([
      loader.await(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ])
    return true
  } catch {
    /* Loader 里某个不相关的条目失败不该影响我们；文件已经写好了。 */
    return false
  }
}

/**
 * 按 id 找 Loader 条目（含嵌套）。仅用于诊断/只读判断。
 *
 * @param ctx - 宿主插件上下文
 * @param id - 条目 id
 * @returns 条目，或 undefined
 */
export function findEntryById(ctx, id) {
  const loader = ctx?.get?.("loader")
  if (loader?.entries === undefined) return undefined
  for (const row of loader.entries()) {
    if (row?.options?.id === id) return row
  }
  return undefined
}

/** 把任意错误转成简短可读文本。 */
function formatError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 读出当前 profile 里由本插件管理的 MCP 服务。
 *
 * @param ctx - 宿主上下文
 * @returns `{ file, servers }`（servers 已规范化）
 */
export async function readServers(ctx) {
  const file = resolvePatchPath(ctx)
  const document = parsePatchDocument(await readPatchText(file))
  return { file, servers: rowsToServers(documentToPatches(document)) }
}

/**
 * 用给定的服务列表整体替换 profile 里「本插件管理的」MCP 行。
 *
 * 语义（重要，避免误伤用户数据）：
 *   - 只增删改 **id 带 `mcp-ui-` 前缀** 且 name === mcp-client 的行；
 *   - 用户手写的其他 MCP 行、其他插件的行、其他配置**原样保留**；
 *   - 顶层 `insert:` 块里本插件写的行被移除后，若该 insert 块空了，
 *     就把这个 insert 块也删掉（不留空壳）。
 *
 * @param ctx - 宿主上下文
 * @param servers - 目标服务列表（会先校验）
 * @param options - `{ logger }`
 * @returns `{ changed, file, servers, added, updated, removed }`
 */
export async function writeServers(ctx, servers, options = {}) {
  const log = options.logger ?? (() => {})
  const normalized = servers.map((s) => normalizeServer(s, s?.transport))
  const check = validateServers(normalized)
  if (!check.ok) {
    const detail = check.errors
      .filter((e) => e.messages.length > 0)
      .map((e) => `[${e.serverName || "(未命名)"}] ${e.messages.join("；")}`)
      .join(" / ")
    throw new Error(`配置校验失败：${detail}`)
  }

  const file = resolvePatchPath(ctx)
  const before = await readPatchText(file)
  const document = parsePatchDocument(before)

  const nextRows = serversToRows(normalized)
  const desiredIds = new Set(nextRows.map((r) => r.id))

  /*
   * 第 1 步：删掉本插件写过、但目标列表里已不存在的行。
   * 倒序遍历，避免删除时索引位移。
   */
  const items = document.contents.items
  let removed = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!isMap(item)) continue
    /* 顶层直接写的服务行（少见，但用户可能手工搬过来）。 */
    const topId = document.getIn([i, "id"])
    if (typeof topId === "string" && topId.startsWith("mcp-ui-") && !item.has("insert")) {
      if (!desiredIds.has(topId)) {
        document.delete(i)
        removed += 1
      }
      continue
    }    /* 常规形态：服务行在某个 `insert:` 块里。 */
    const inserted = insertSeqAt(document, i)
    if (inserted === undefined) continue
    for (let j = inserted.items.length - 1; j >= 0; j--) {
      const row = inserted.items[j]
      const id = row?.get?.("id")
      const name = row?.get?.("name")
      if (typeof id !== "string" || !id.startsWith("mcp-ui-")) continue
      /* 只删自己写的 mcp-client 行；同前缀但指向别的包的（不该存在）跳过。 */
      if (name !== undefined && String(name) !== MCP_CLIENT_PACKAGE) continue
      if (!desiredIds.has(id)) {
        inserted.items.splice(j, 1)
        removed += 1
      }
    }
    /* insert 块空了就整块删掉，不留空壳。这是清理动作，不计入 removed
       （removed 的语义是「被删掉的服务行数」，块本身不是服务）。 */
    if (inserted.items.length === 0) document.delete(i)
  }

  /*
   * 第 2 步：写入/更新目标行。
   * 先在文档里找同 id 的行（含 insert 内），找到就就地 set config，
   * 找不到就追加到**本插件自己的 insert 块**末尾（存在则复用）。
   */
  let added = 0
  let updated = 0
  for (const row of nextRows) {
    const located = locateRow(document, row.id)
    if (located !== undefined) {
      document.setIn(located.concat("config"), document.createNode(row.config))
      if (document.getIn(located.concat("name")) === undefined) {
        document.setIn(located.concat("name"), row.name)
      }
      updated += 1
      continue
    }
    const block = ensureOwnInsertBlock(document)
    block.items.push(document.createNode({ id: row.id, name: row.name, config: row.config }))
    added += 1
  }

  const text = String(document)
  if (text === before) {
    log("mcp-ui: profile patch 无变化，跳过写入")
    return { changed: false, file, servers: normalized, added: 0, updated: 0, removed: 0 }
  }

  await writeFileAtomic(file, text)

  /*
   * 「即时生效」就到这里为止——**只写文件，不自己驱动重载**。
   *
   * 为什么不再自己调 entry.update({config:{patches}})（0.1.1 的错误做法）：
   *   DSH 自带 HMR（@deepseek-ai/dsh-hmr）已经用 chokidar 监听
   *   `profile.patchPath`（即本文件）与 manifest，文件一变就走
   *   `readProfilePatches() → reconcileProfilePatches(root, patches, "dsh")`。
   *   那条路径会正确地做 prepareProfilePatches（含兼容性 preflight 与
   *   applyEntryPatches 的形状归一），我们自己塞裸 patches 会**绕过**这一步，
   *   导致 patch 被应用两遍 / 形状错乱，把整个 DSH 搞挂。
   *
   *   HMR 的 debounce 默认很短（配置项 this.config.debounce），因此用户感知
   *   就是「保存后立刻生效」。
   *
   * 这里只做一次**只读等待**：让 Loader 把这次变化消化完，好让页面能立刻
   * 反映结果。等待超时或失败都不算保存失败——文件已经写好了，HMR 会继续处理。
   */
  await waitForLoader(ctx)

  const verified = verifyRowsActive(ctx, nextRows.map((r) => r.id))
  log(
    `mcp-ui: 已写入 ${normalized.length} 个 MCP 服务（+${added} ~${updated} -${removed}）` +
      `，等待 HMR 生效${verified.pending.length > 0 ? `（尚未激活：${verified.pending.join(", ")}）` : ""}`,
  )
  return {
    changed: true,
    file,
    servers: normalized,
    added,
    updated,
    removed,
    /*
     * 只做「提示」，不作失败：HMR 是异步的，刚写完还没轮到它很常见；
     * 而且 mcp-client 连不上服务器时该行本来就该是失败态（那是用户配置问题，
     * 不是我们保存失败）。页面据此可以显示「已保存，正在生效」。
     */
    activated: verified.active,
    pending: verified.pending,
  }
}

/**
 * 只读检查：这批行是否已在 Loader 里激活。
 *
 * 刻意**不抛错**：HMR 异步、mcp-client 也可能因为服务器连不上而失败，
 * 都不该让「保存」这个动作报错（文件确实写成功了）。
 *
 * @param ctx - 宿主插件上下文
 * @param ids - 期望激活的行 id
 * @returns `{ active, pending }`
 */
export function verifyRowsActive(ctx, ids) {
  const active = []
  const pending = []
  for (const id of ids) {
    const row = findEntryById(ctx, id)
    if (row?.fiber?.state === 2) active.push(id)
    else pending.push(id)
  }
  return { active, pending }
}


/**
 * 取第 i 个顶层行的 `insert:` **YAMLSeq 节点**（不是 JS 数组）。
 *
 * 关键：`document.getIn([i, "insert"])` 返回的是节点对象，其元素在
 * `.items` 里。早先误当普通数组用（`.length` / `.splice` / `.push`），
 * 结果所有增删都静默失效——这类 bug 在单测里才会暴露，务必保持。
 *
 * @param document - YAML Document
 * @param i - 顶层行下标
 * @returns YAMLSeq 节点，或 undefined
 */
function insertSeqAt(document, i) {
  const node = document.getIn([i, "insert"])
  return isSeq(node) ? node : undefined
}

/**
 * 在文档里定位一个 Loader 行，返回其路径（数组），供 setIn 使用。
 *
 * @param document - YAML Document
 * @param id - 目标行 id
 * @returns 路径数组，或 undefined
 */
export function locateRow(document, id) {
  const items = document.contents?.items ?? []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!isMap(item)) continue
    if (document.getIn([i, "id"]) === id && !item.has("insert")) return [i]
    const inserted = insertSeqAt(document, i)
    if (inserted === undefined) continue
    for (let j = 0; j < inserted.items.length; j++) {
      if (inserted.items[j]?.get?.("id") === id) return [i, "insert", j]
    }
  }
  return undefined
}

/**
 * 找到（或创建）本插件专用的 `insert:` 块，返回它的 **YAMLSeq 节点**
 * （往里加行用 `seq.items.push(node)`）。
 *
 * 复用而非每次新建：反复保存不该让 profile 里堆出几十个 insert 块。
 *
 * @param document - YAML Document
 * @returns insert 的 YAMLSeq 节点
 */
export function ensureOwnInsertBlock(document) {
  const items = document.contents.items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!isMap(item)) continue
    const inserted = insertSeqAt(document, i)
    if (inserted === undefined) continue
    const owns = inserted.items.some((row) => {
      const id = row?.get?.("id")
      return typeof id === "string" && id.startsWith("mcp-ui-")
    })
    if (owns) return inserted
  }
  const node = document.createNode({ insert: [] })
  document.add(node)
  const index = document.contents.items.length - 1
  return document.getIn([index, "insert"])
}
