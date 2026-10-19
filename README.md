# MCP UI DSH

在 DSH 的「设置 → MCP」页签中配置 MCP（Model Context Protocol）服务，支持表单和 JSON 两种方式。保存后配置写入当前 profile，并由 DSH 自动重新加载。

[![npm](https://img.shields.io/npm/v/@gxx-labs/mcp-ui-dsh)](https://www.npmjs.com/package/@gxx-labs/mcp-ui-dsh) [GitHub](https://github.com/gxx950224/mcp-ui-dsh)

## 功能

- 在设置页中按服务编辑 `stdio` 和 `streamable-http` 配置。
- 配置命令、参数、工作目录、环境变量、请求头、超时和启动失败策略。
- 使用 JSON 直接编辑整份配置，支持常见的服务名映射和 `mcpServers` 包裹格式。
- 保存时校验服务名、必填字段、传输方式和 URL；错误会定位到对应字段。
- `env` 和 `headers` 的值不会返回浏览器；表单留空表示保持原值。
- 中文和 English 界面跟随 DSH 语言设置。

## 安装

在 DSH 的插件管理器中安装：

```text
@gxx-labs/mcp-ui-dsh
```

也可以安装到 desktop profile：

```bash
npm install @gxx-labs/mcp-ui-dsh --prefix "$HOME/.dsh/profiles/desktop"
```

首次安装或升级后，从托盘完全退出并重新启动 DSH，使宿主扫描新的客户端 bundle。

## 使用

### 表单模式

1. 打开「设置 → MCP」，选择「添加服务」。
2. 填写唯一的 `serverName`。
3. 选择 `stdio` 或 `streamable-http`。
4. 填写命令和参数，或填写服务 URL；按需设置环境变量、请求头、工作目录和超时。
5. 选择「保存并生效」。

服务对应的工具名称为 `mcp__<serverName>__<toolName>`。保存成功只代表配置已写入；连接是否可用需要在对话中实际调用工具确认。

### JSON 模式

JSON 可以使用以下形状：

```json
{
  "mcpServers": {
    "demo": {
      "command": "npx",
      "args": ["mcp-server-demo"]
    }
  }
}
```

也支持服务名到配置的映射，以及本插件使用的 patch 行数组。未知字段会原样保留，适合配置表单未展示的高级选项。

保存 JSON 时会整体替换本插件管理的服务；删除服务前请确认配置内容。

## 配置语义

- `stdio` 需要 `command`，可选 `args`、`cwd`、`env`、`toolCallTimeoutMs` 和 `failOnStartupError`。
- `streamable-http` 需要合法 `url`，可选 `headers`、`toolCallTimeoutMs` 和 `failOnStartupError`。
- `serverName` 必须唯一。
- 写入只限本机 loopback。
- Windows 路径在 JSON 中使用双反斜杠或正斜杠。

## 开发

```bash
npm install
npm run build
npm run verify
npm test
npm run check
```

## 许可

MIT
