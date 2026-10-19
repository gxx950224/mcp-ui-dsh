# @gxx-labs/mcp-ui-dsh

DSH 插件：在**设置 →「MCP」页签**里用**表单**或 **JSON** 配置 MCP（Model Context Protocol）服务，
**保存即生效**（写入 profile 的 `cordis.patch.yml` 并经 Loader 热重载，无需重启 DSH）。
界面复用 DSH 的设计令牌与 primitives，与官方设置页观感一致。

---

## 功能

| 能力 | 说明 |
|---|---|
| 设置页签 | 设置 → MCP（`settings.section`，order 26，排在官方页签之后） |
| 表单配置 | 逐服务卡片式编辑：服务名 / 传输方式 / 命令 / 参数 / 工作目录 / 环境变量 / 请求头 / 超时 / 启动失败即报错 |
| JSON 配置 | 直接编辑整份配置；支持三种格式（见下），可一键格式化 |
| 即时生效 | 保存 → 写盘 → DSH 自带的 HMR 监听 `cordis.patch.yml` 并热重载，MCP 工具立刻可用 |
| 两种传输 | `stdio`（本地进程）与 `streamable-http`（远程端点） |
| 密钥保护 | `env` / `headers` 的值**不下发浏览器**；留空即保持原值 |
| 双语 | 中文 / English，跟随 DSH 语言设置 |

---

## 安装

```bash
npm install @gxx-labs/mcp-ui-dsh
```

或在 DSH 插件管理器里「添加插件」→ 填 `@gxx-labs/mcp-ui-dsh`。
装完**完全重启一次 DSH**（托盘退出后重新打开），设置里就会出现「MCP」页签。

> 首次安装后重启是必须的：客户端 bundle 由宿主在启动时扫描 `dsh.client` 装载。

---

## 使用

### 表单模式

1. 设置 → **MCP** → 「添加服务」
2. 填 `serverName`（工具会以 `mcp__<serverName>__<工具名>` 暴露）
3. 选传输方式：
   - **stdio**：填 `command`（如 `npx`）、`args`（如 `-y @modelcontextprotocol/server-filesystem`）、可选 `cwd` 与 `env`
   - **streamable-http**：填 `url`（如 `http://127.0.0.1:3000/mcp`）、可选 `headers`
4. 「保存并生效」

保存成功后页面会提示已应用的服务数；对应工具立即出现在 Agent 的可用工具里。

### 校验时机（0.2.5 起）

**输入过程中不做任何校验**，点「保存并生效」时才校验一次：

- 还没点保存 → 一行红字都不会出现，可以安静地把字打完；
- 点了保存 → 逐条检查必填与合规（服务名非空/字符合法/不重名、stdio 必须有
  `command`、http 必须有合法 `url`）。有问题就**不发请求**，把出错的字段标红、
  自动展开那一行，并在下方列出原因；
- 继续编辑 → 上一次的报错快照立即撤下，避免「改好了红字还挂着」。

> 早期版本是逐字实时校验，且列表 `key` 用了 `serverName`——服务名恰好是正在
> 输入的字段，于是**敲一个字符就重建整张卡片，光标当场丢失**，同时还立刻标红。
> 现在每行有独立的**稳定行 id** 作为 `key` 与展开态标识（不写进配置文件），
> 输入框节点全程复用，光标不再丢失。回归测试见
> `test/form-typing.test.mjs` 与 `test/render-typing.test.mjs`。

### JSON 模式

点顶部「JSON」切换。接受三种形状，**保存时整体替换**本插件管理的服务：

```jsonc
// A. 本插件导出格式（服务名 → 配置）
{
  "fs": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\work"],
    "env": {},
    "cwd": "",
    "toolCallTimeoutMs": 60000,
    "failOnStartupError": false
  }
}
```

```jsonc
// B. Claude Desktop / Cursor 习惯（mcpServers 包裹）
{
  "mcpServers": {
    "demo": { "command": "uvx", "args": ["mcp-server-demo"] }
  }
}
```

```jsonc
// C. patch 行数组
[{ "id": "mcp-ui-demo", "name": "@deepseek-ai/dsh-mcp-client",
   "config": { "serverName": "demo", "transport": "streamable-http", "url": "http://127.0.0.1:3000/mcp" } }]
```

未知字段（如 `reconnect`、`maxInstructionBytes`）**原样保留**——用 JSON 配的高级选项不会因为
在表单里保存一次就消失。

---

## 它到底做了什么

MCP 服务在 DSH 里**不是**某个服务的可写数据，而是 **Loader 行**：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: mcp-ui-fs
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: fs
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem']
```

官方 `@deepseek-ai/dsh-mcp-client` 的 `apply()` 只建立连接，**没有任何 CRUD API**；
`mcpResources` 也只有 `register`。所以「新增 / 修改 MCP 服务」唯一正规做法就是写 Loader 行。

### 即时生效的实现

保存时本插件只做两件事：

1. 用 YAML Document 编辑 `cordis.patch.yml`（保留注释、`!!js` 标签、字段顺序）
2. 原子写盘（同目录临时文件 + rename）

**然后什么都不做** —— DSH 自带 `@deepseek-ai/dsh-hmr`，用 chokidar 监听
`profile.patchPath`（就是 `cordis.patch.yml`），文件一变即执行：

```js
const patches = readProfilePatches("dsh", profile);
await reconcileProfilePatches(this.ownerContext.root, patches, "dsh");
```

也就是**官方已经替我们做了正确的热重载**。写盘后本插件只会只读地
`loader.await()` 等一下让状态收敛（超时不算失败），再回一个
`pending` 提示，让页面能显示「已保存，正在生效」。

> 🔴 **千万不要自己去驱动 Loader**（0.1.1 就是这么把整个 DSH 搞挂的）。
> 当时的做法是拿根 Include 条目再
> `entry.update({ config: { ...cfg, patches: <裸 patch 列表> } })`，
> 这**绕过了官方 `prepareProfilePatches`**：
>
> ```js
> function prepareProfilePatches(ctx, patches, parentURL, binName) {
>   if (ctx.get("profileContext") === void 0) return patches;
>   const rows = prepareProfileEntries(
>     ctx, applyEntryPatches([], patches, patchWarning(ctx)), parentURL, binName);
>   return rows.length === 0 ? [] : [{ insert: rows }];
> }
> ```
>
> `applyEntryPatches([], patches, warn)` 以**空数组**为基底，把 patch 物化成真正的条目行
> （`insert:` 展开成扁平行，`- id:` 覆盖式 patch 因无基底被丢弃并告警），再包成
> 单个 `{ insert: rows }`。塞**未转换的裸 patch** 进去 → 同一批 patch 被应用两遍
> → 所有条目被重复/错误重建 → 大量服务失联 → **整个 DSH 崩**。
>
> 测试里加了硬约束：假 ctx 的 `loader.update/create/remove` 一旦被调用即**抛错**。
> 以后谁再"顺手"加一次 update，测试立刻红。
>
> 另：`findRootIncludeEntry()` 保留但**只用于诊断**。它的判定要注意根 Include 的
> `options.name` 是 **`cordis:include`**（`ctx.loader.create({ id:"include", name:"cordis:include" })`
> 创建，属 Loader builtin 语法），**不是** npm 包名 `@deepseek-ai/cordis-plugin-include`。

### 只动自己的行

profile 里可能有用户手写的 MCP 行或其他插件的行。本插件**只增删改 id 带 `mcp-ui-` 前缀**
且 `name` 为 `@deepseek-ai/dsh-mcp-client` 的行，其余内容逐字保留（含注释）。
删完最后一个服务时，会把因此变空的 `insert:` 块一并清掉，不留空壳。

---

## 安全模型

- **读**：同源页面即可。但 `env` / `headers` 的**值不下发**，只回传键名与数量。
- **写**：仅限本机 loopback（`127.0.0.1` / `::1`），因为写的是 profile 配置文件。
- **密钥往返**：表单里已有键显示为空，**留空提交 = 保持原值**（宿主按空串还原）。
  想真正删除某个键，就在表单里删掉那一行。

---

## HTTP 路由

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/mcp-ui/state` | 当前已配置的服务（env/headers 已脱敏）+ 写入文件路径 |
| POST | `/api/mcp-ui/save` | 保存并生效；体为 `{ servers: [...] }` 或 `{ json: "..." }` |
| POST | `/api/mcp-ui/json` | 取当前配置的 JSON 文本 |

---

## 开发

```bash
npm install
npm run build      # 构建 dist/client.js（esbuild 产物 + ModuleLoader 包装 + CSS 注入）
npm run verify     # 产物契约校验（15 项：id/导出/CSS 令牌/类名对齐/无宿主模块泄漏…）
npm test           # 77 个测试
npm run check      # build + verify + test
```

### 目录

```
lib/mcp.js        服务领域模型：规范化、校验、与 patch 行互转（无 DSH 依赖，可单测）
lib/store.js      profile patch 读写 + Loader 热重载（即时生效）
lib/paths.js      定位 profile 的 cordis.patch.yml
lib/index.js      宿主半：三条同源 HTTP 路由
client/index.jsx  浏览器半：设置页签 UI
client/model.js   表单 ↔ 配置的纯逻辑
client/Mui.module.css  样式（只用 --dsw-* 令牌）
cordis.patch.yml  本插件自己的 bundle patch（声明 Loader 行）
```

### 测试覆盖

| 文件 | 覆盖 |
|---|---|
| `test/mcp.test.mjs` | 规范化、校验、serverName 唯一性、JSON 三形状、patch 行往返 |
| `test/store.test.mjs` | YAML 文档编辑：增删改只落在自己的行、用户内容逐字保留、幂等 |
| `test/e2e.test.mjs` | **真实 writeServers**：落盘/读回、校验失败不改文件、原子写不留临时文件、**「绝不碰 Loader」硬约束** |
| `test/routes.test.mjs` | 脱敏（密钥不外发）、密钥合并、loopback 限制、方法/请求体错误映射 |
| `test/model.test.mjs` | 表单字段收拾（切换传输不留残字段）、参数切分、密钥占位往返 |
| `test/form-typing.test.mjs` | **输入体验回归**：稳定行 id（改名不换 key）、`rowId` 不进配置文件、校验字段归属精确 |
| `test/render-typing.test.mjs` | **真实渲染**（jsdom + React）：逐字输入时 `<input>` 不被重建、未保存不标红、点保存才校验 |

---

## 已知限制

- **服务名唯一**：`serverName` 全局唯一。重复会让第二个 `mcp-client` 实例启动即抛错
  （官方 `activeServerNames` 保留表），因此保存前会拦截。
- **一个服务一行**：官方 `mcp-client` 一个实例连一个服务器，所以 N 个服务 = N 个 Loader 行。
- **生效是异步的**：保存成功后 DSH 的 HMR 会自行装载，通常瞬间完成；
  若页面提示「正在生效」，稍等即可（文件已经写好，不会丢）。
- **连接结果要看工具**：保存成功只代表配置已写对、行已装载。
  `failOnStartupError` 关闭时，服务器连不上不会让保存失败——请在对话里试
  `mcp__<serverName>__<工具名>` 确认连通性。
- `cwd` / `command` 路径在 Windows 上请用双反斜杠或正斜杠（JSON 转义）。

---

## 版本历史

| 版本 | 变更 |
|---|---|
| 0.2.5 | **修复「服务名敲一个字符就丢光标」**：列表 `key` 不再用 `serverName`（改用稳定的内部行 id），并取消逐字实时校验，改为**点保存时**校验必填与合规；校验错误精确到字段。新增输入体验回归测试（模型层 + jsdom 真实渲染）。 |
| 0.1.2 | **修复把整个 DSH 搞挂的严重 bug**：不再自己驱动 Loader，改为只写文件（HMR 自动重载）。加硬约束测试。 |
| 0.1.1 | 修复根 Include 识别名（`cordis:include`，非 npm 包名）。 |
| 0.1.0 | 首个版本。 |

---

## 许可

MIT
