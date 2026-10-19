/* @gxx-labs/mcp-ui-dsh client bundle (esbuild) */
window.__ModuleLoader__.load({
  id: "@gxx-labs/mcp-ui-dsh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  McpSection: () => McpSection,
  NS: () => NS,
  SECTION_ID: () => SECTION_ID,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// client/model.js
var TRANSPORTS = ["stdio", "streamable-http"];
var SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
var DEFAULT_TIMEOUT_MS = 6e4;
function nextServerName(existing) {
  const taken = existing instanceof Set ? existing : new Set(existing ?? []);
  if (!taken.has("server")) return "server";
  for (let i = 2; i < 1e3; i++) {
    const candidate = `server-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `server-${Date.now()}`;
}
function createServer(existingNames, transport = "stdio") {
  return {
    serverName: nextServerName(existingNames),
    transport,
    command: transport === "stdio" ? "" : void 0,
    url: transport === "streamable-http" ? "" : void 0,
    args: [],
    env: {},
    headers: {},
    cwd: "",
    toolCallTimeoutMs: DEFAULT_TIMEOUT_MS,
    failOnStartupError: false
  };
}
var rowSeq = 0;
function nextRowId(seed) {
  rowSeq += 1;
  const base = seed === void 0 || seed === null || seed === "" ? "row" : String(seed);
  return `${base}#${String(rowSeq)}`;
}
function ensureRowIds(servers) {
  const taken = /* @__PURE__ */ new Set();
  return (servers ?? []).map((server) => {
    const draft = server?.draft ?? {};
    let id = draft.rowId;
    if (typeof id !== "string" || id === "" || taken.has(id)) id = nextRowId();
    taken.add(id);
    return { ...server, draft: { ...draft, rowId: id } };
  });
}
function switchTransport(server, transport) {
  if (!TRANSPORTS.includes(transport) || transport === server.transport) return server;
  if (transport === "stdio") {
    const { url, headers, ...rest2 } = server;
    return { ...rest2, transport, command: server.command ?? "", env: server.env ?? {} };
  }
  const { command, args, env, cwd, ...rest } = server;
  return { ...rest, transport, url: server.url ?? "", headers: server.headers ?? {} };
}
function validateServer(server, allNames) {
  return validateServerFields(server, allNames).map((e) => e.message);
}
function validateServerFields(server, allNames) {
  const out = [];
  const name = server?.serverName;
  if (typeof name !== "string" || name === "") {
    out.push({ field: "serverName", message: "serverName \u5FC5\u586B" });
  } else if (!SERVER_NAME_PATTERN.test(name)) {
    out.push({ field: "serverName", message: "serverName \u53EA\u80FD\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u3001\u8FDE\u5B57\u7B26\uFF0C\u957F\u5EA6 1\u201332" });
  } else if ((allNames ?? []).filter((n) => n === name).length > 1) {
    out.push({ field: "serverName", message: `serverName "${name}" \u4E0E\u53E6\u4E00\u4E2A\u670D\u52A1\u91CD\u590D` });
  }
  if (!TRANSPORTS.includes(server?.transport)) {
    out.push({ field: "transport", message: "\u8BF7\u9009\u62E9\u4F20\u8F93\u65B9\u5F0F" });
  } else if (server.transport === "stdio") {
    if (typeof server.command !== "string" || server.command.trim() === "") {
      out.push({ field: "command", message: "stdio \u4F20\u8F93\u5FC5\u987B\u586B\u5199 command" });
    }
  } else {
    const url = server.url;
    if (typeof url !== "string" || url.trim() === "") {
      out.push({ field: "url", message: "streamable-http \u4F20\u8F93\u5FC5\u987B\u586B\u5199 url" });
    } else {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          out.push({ field: "url", message: "url \u5FC5\u987B\u4EE5 http:// \u6216 https:// \u5F00\u5934" });
        }
      } catch {
        out.push({ field: "url", message: "url \u4E0D\u662F\u5408\u6CD5\u5730\u5740" });
      }
    }
  }
  return out;
}
function badgesOf(server) {
  const out = [];
  const envCount = countKeys(server?.env);
  const headerCount = countKeys(server?.headers);
  if (envCount > 0) out.push(`env \xD7 ${envCount}`);
  if (headerCount > 0) out.push(`headers \xD7 ${headerCount}`);
  if (server?.failOnStartupError === true) out.push("fail-fast");
  return out;
}
function countKeys(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.keys(value).length;
}
function draftToServer(draft, transport) {
  const t = TRANSPORTS.includes(transport) ? transport : "stdio";
  const server = {
    serverName: (draft.serverName ?? "").trim(),
    transport: t,
    toolCallTimeoutMs: toTimeout(draft.toolCallTimeoutMs),
    failOnStartupError: draft.failOnStartupError === true
  };
  if (t === "stdio") {
    server.command = (draft.command ?? "").trim();
    server.args = parseArgs(draft.args);
    server.env = kvToObject(draft.envRows);
    server.cwd = (draft.cwd ?? "").trim();
  } else {
    server.url = (draft.url ?? "").trim();
    server.headers = kvToObject(draft.headersRows);
  }
  if (draft.extra !== null && typeof draft.extra === "object") {
    for (const [k, v] of Object.entries(draft.extra)) {
      if (server[k] === void 0) server[k] = v;
    }
  }
  return server;
}
function serverToDraft(server) {
  const known = /* @__PURE__ */ new Set([
    "transport",
    "serverName",
    "command",
    "url",
    "cwd",
    "args",
    "env",
    "headers",
    "toolCallTimeoutMs",
    "failOnStartupError",
    "rowId"
  ]);
  const extra = {};
  for (const [k, v] of Object.entries(server ?? {})) {
    if (!known.has(k)) extra[k] = v;
  }
  return {
    serverName: server?.serverName ?? "",
    command: server?.command ?? "",
    url: server?.url ?? "",
    cwd: server?.cwd ?? "",
    args: formatArgs(server?.args),
    envRows: objectToKv(server?.env),
    headersRows: objectToKv(server?.headers),
    toolCallTimeoutMs: server?.toolCallTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    failOnStartupError: server?.failOnStartupError === true,
    /*
     * 稳定行 id：优先沿用宿主返回的 rowId（同一行跨刷新保持同一身份），
     * 否则现分一个。它绝不进 extra，也就不会写进配置文件。
     */
    rowId: nextRowId(server?.rowId),
    extra
  };
}
function parseArgs(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function formatArgs(args) {
  return (Array.isArray(args) ? args : []).map((a) => /[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a)).join(" ");
}
function kvToObject(rows) {
  const out = {};
  for (const row of rows ?? []) {
    const key = (row?.key ?? "").trim();
    if (key === "") continue;
    out[key] = row?.value ?? "";
  }
  return out;
}
function objectToKv(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? "") }));
}
function toTimeout(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TIMEOUT_MS;
}
function jsonFromServers(list) {
  const doc = {};
  for (const item of list ?? []) {
    if (item === null || typeof item !== "object") continue;
    const raw = item.draft !== void 0 ? draftToServer(item.draft, item.transport) : item;
    const transport = TRANSPORTS.includes(raw.transport) ? raw.transport : "stdio";
    const advanced = {};
    const branchFields = /* @__PURE__ */ new Set([
      "command",
      "args",
      "env",
      "cwd",
      "url",
      "headers",
      "transport",
      "serverName",
      "rowId",
      "toolCallTimeoutMs",
      "failOnStartupError"
    ]);
    for (const [k, v] of Object.entries(raw)) {
      if (!branchFields.has(k) && v !== void 0) advanced[k] = v;
    }
    const entry = {
      transport,
      toolCallTimeoutMs: raw.toolCallTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      failOnStartupError: raw.failOnStartupError === true
    };
    if (transport === "stdio") {
      entry.command = raw.command ?? "";
      entry.args = Array.isArray(raw.args) ? raw.args : [];
      entry.env = raw.env && typeof raw.env === "object" && !Array.isArray(raw.env) ? raw.env : {};
      entry.cwd = raw.cwd ?? "";
    } else {
      entry.url = raw.url ?? "";
      entry.headers = raw.headers && typeof raw.headers === "object" && !Array.isArray(raw.headers) ? raw.headers : {};
    }
    Object.assign(entry, advanced);
    doc[raw.serverName || ""] = entry;
  }
  return doc;
}
function serversToJsonText(list) {
  return `${JSON.stringify(jsonFromServers(list), null, 2)}
`;
}
function draftsToJsonText(drafts) {
  return serversToJsonText(drafts ?? []);
}

// client/Mui.module.css
var Mui_default = {
  Mui_page: "Mui_Mui_page",
  Mui_heading: "Mui_Mui_heading",
  Mui_intro: "Mui_Mui_intro",
  Mui_notice: "Mui_Mui_notice",
  Mui_error: "Mui_Mui_error",
  Mui_toolbar: "Mui_Mui_toolbar",
  Mui_grow: "Mui_Mui_grow",
  Mui_path: "Mui_Mui_path",
  Mui_hint: "Mui_Mui_hint",
  Mui_list: "Mui_Mui_list",
  Mui_card: "Mui_Mui_card",
  Mui_cardOpen: "Mui_Mui_cardOpen",
  Mui_head: "Mui_Mui_head",
  Mui_headOpen: "Mui_Mui_headOpen",
  Mui_toggle: "Mui_Mui_toggle",
  Mui_caret: "Mui_Mui_caret",
  Mui_headMain: "Mui_Mui_headMain",
  Mui_name: "Mui_Mui_name",
  Mui_headAside: "Mui_Mui_headAside",
  Mui_badges: "Mui_Mui_badges",
  Mui_badge: "Mui_Mui_badge",
  Mui_dot: "Mui_Mui_dot",
  Mui_dotOk: "Mui_Mui_dotOk",
  Mui_dotWait: "Mui_Mui_dotWait",
  Mui_dotBad: "Mui_Mui_dotBad",
  Mui_body: "Mui_Mui_body",
  Mui_section: "Mui_Mui_section",
  Mui_sectionHead: "Mui_Mui_sectionHead",
  Mui_sectionTitle: "Mui_Mui_sectionTitle",
  Mui_sectionLine: "Mui_Mui_sectionLine",
  Mui_field: "Mui_Mui_field",
  Mui_label: "Mui_Mui_label",
  Mui_row: "Mui_Mui_row",
  Mui_kv: "Mui_Mui_kv",
  Mui_kvRow: "Mui_Mui_kvRow",
  Mui_kvDel: "Mui_Mui_kvDel",
  Mui_tools: "Mui_Mui_tools",
  Mui_toolHead: "Mui_Mui_toolHead",
  Mui_toolCount: "Mui_Mui_toolCount",
  Mui_toolList: "Mui_Mui_toolList",
  Mui_tool: "Mui_Mui_tool",
  Mui_toolName: "Mui_Mui_toolName",
  Mui_toolDesc: "Mui_Mui_toolDesc",
  Mui_empty: "Mui_Mui_empty",
  Mui_emptyTitle: "Mui_Mui_emptyTitle",
  Mui_emptyText: "Mui_Mui_emptyText",
  Mui_inlineError: "Mui_Mui_inlineError",
  Mui_textarea: "Mui_Mui_textarea",
  Mui_jsonError: "Mui_Mui_jsonError",
  Mui_footer: "Mui_Mui_footer"
};

// client/index.jsx
var NS = "mcp-ui";
var SECTION_ID = "mcp";
var API = {
  state: "/api/mcp-ui/state",
  save: "/api/mcp-ui/save",
  tools: "/api/mcp-ui/tools"
};
function cx(...names) {
  return names.filter(Boolean).join(" ");
}
var zh = {
  nav: "MCP",
  title: "MCP \u670D\u52A1",
  intro: "\u914D\u7F6E Model Context Protocol \u670D\u52A1\uFF0C\u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\uFF08\u5199\u5165 profile \u7684 cordis.patch.yml\uFF0C\u7531 DSH \u70ED\u91CD\u8F7D\uFF09\uFF0C\u65E0\u9700\u91CD\u542F\u3002",
  mode: "\u914D\u7F6E\u65B9\u5F0F",
  modeForm: "\u8868\u5355",
  modeJson: "JSON",
  add: "\u6DFB\u52A0\u670D\u52A1",
  save: "\u4FDD\u5B58\u5E76\u751F\u6548",
  saving: "\u6B63\u5728\u5E94\u7528\u2026",
  reload: "\u91CD\u65B0\u8BFB\u53D6",
  savedOk: "\u5DF2\u4FDD\u5B58\u5E76\u751F\u6548\uFF1A{n} \u4E2A MCP \u670D\u52A1",
  savedApplying: "\u5DF2\u4FDD\u5B58 {n} \u4E2A MCP \u670D\u52A1\uFF0C\u6B63\u5728\u751F\u6548\u2026",
  savedNoop: "\u914D\u7F6E\u6CA1\u6709\u53D8\u5316\uFF0C\u672A\u5199\u5165",
  loadFailed: "\u8BFB\u53D6\u914D\u7F6E\u5931\u8D25",
  saveFailed: "\u4FDD\u5B58\u5931\u8D25",
  fileLabel: "\u5199\u5165\u6587\u4EF6",
  empty: "\u8FD8\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55 MCP \u670D\u52A1",
  emptyText: "\u70B9\u51FB\u300C\u6DFB\u52A0\u670D\u52A1\u300D\u5F00\u59CB\uFF1B\u4E5F\u53EF\u4EE5\u5207\u5230 JSON \u6A21\u5F0F\u7C98\u8D34\u73B0\u6210\u914D\u7F6E\u3002",
  remove: "\u5220\u9664\u6B64\u670D\u52A1",
  confirmRemoveTitle: "\u5220\u9664\u670D\u52A1\u300C{name}\u300D\uFF1F",
  confirmRemoveDesc: "\u4FDD\u5B58\u540E\u8BE5 MCP \u670D\u52A1\u5668\u4F1A\u4ECE\u914D\u7F6E\u4E2D\u79FB\u9664\u5E76\u65AD\u5F00\u8FDE\u63A5\uFF0C\u5176\u5DE5\u5177\u4F1A\u7ACB\u5373\u4ECE Agent \u7684\u53EF\u7528\u5DE5\u5177\u91CC\u6D88\u5931\u3002",
  cancel: "\u53D6\u6D88",
  secConnection: "\u8FDE\u63A5",
  secSecrets: "\u73AF\u5883\u53D8\u91CF\u4E0E\u8BF7\u6C42\u5934",
  secAdvanced: "\u9AD8\u7EA7",
  secTools: "\u5DF2\u751F\u6548\u5DE5\u5177",
  serverName: "\u670D\u52A1\u540D",
  transport: "\u4F20\u8F93\u65B9\u5F0F",
  command: "\u542F\u52A8\u547D\u4EE4",
  args: "\u542F\u52A8\u53C2\u6570",
  cwd: "\u5DE5\u4F5C\u76EE\u5F55",
  url: "\u670D\u52A1\u5730\u5740",
  env: "\u73AF\u5883\u53D8\u91CF\uFF08env\uFF09",
  headers: "\u8BF7\u6C42\u5934\uFF08headers\uFF09",
  kvKey: "\u540D\u79F0",
  kvValue: "\u503C",
  kvAdd: "\u6DFB\u52A0\u4E00\u9879",
  kvEmpty: "\u6682\u65E0",
  timeout: "\u8C03\u7528\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
  failFast: "\u542F\u52A8\u5931\u8D25\u5373\u62A5\u9519",
  toolsNone: "\u6682\u65E0\u5DE5\u5177",
  toolsApplying: "\u6B63\u5728\u751F\u6548\u2026",
  toolsCount: "{n} \u4E2A\u5DE5\u5177",
  stOk: "\u5DF2\u751F\u6548",
  stApplying: "\u751F\u6548\u4E2D",
  stNoTools: "\u65E0\u5DE5\u5177",
  stInvalid: "\u914D\u7F6E\u6709\u8BEF",
  jsonLabel: "\u914D\u7F6E JSON",
  jsonInvalid: "JSON \u683C\u5F0F\u6709\u8BEF",
  jsonFormat: "\u683C\u5F0F\u5316",
  unsupported: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 MCP \u914D\u7F6E\uFF08\u672A\u6302\u8F7D Web \u5BBF\u4E3B\u670D\u52A1\uFF09\u3002",
  waiting: "\u6B63\u5728\u8FDE\u63A5\u5BBF\u4E3B\u670D\u52A1\u2026",
  loading: "\u6B63\u5728\u8BFB\u53D6 MCP \u914D\u7F6E\u2026",
  dirty: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
  fieldError: "\u8BF7\u5148\u4FEE\u6B63\u6807\u7EA2\u7684\u5B57\u6BB5"
};
var en = {
  nav: "MCP",
  title: "MCP servers",
  intro: "Configure Model Context Protocol servers. A save writes the profile's cordis.patch.yml and DSH hot-reloads it \u2014 no restart needed.",
  mode: "Configuration",
  modeForm: "Form",
  modeJson: "JSON",
  add: "Add server",
  save: "Save and apply",
  saving: "Applying\u2026",
  reload: "Reload",
  savedOk: "Saved and applied: {n} MCP server(s)",
  savedApplying: "Saved {n} MCP server(s); applying\u2026",
  savedNoop: "No changes to write",
  loadFailed: "Failed to load configuration",
  saveFailed: "Save failed",
  fileLabel: "Written file",
  empty: "No MCP servers configured yet",
  emptyText: "Click \u201CAdd server\u201D to start, or switch to JSON and paste an existing configuration.",
  remove: "Remove this server",
  confirmRemoveTitle: "Remove server \u201C{name}\u201D?",
  confirmRemoveDesc: "After saving, this MCP server is removed and disconnected; its tools disappear from the Agent immediately.",
  cancel: "Cancel",
  secConnection: "Connection",
  secSecrets: "Environment & headers",
  secAdvanced: "Advanced",
  secTools: "Active tools",
  serverName: "Server name",
  transport: "Transport",
  command: "Command",
  args: "Arguments",
  cwd: "Working directory",
  url: "URL",
  env: "Environment (env)",
  headers: "Headers",
  kvKey: "Name",
  kvValue: "Value",
  kvAdd: "Add entry",
  kvEmpty: "None",
  timeout: "Tool call timeout (ms)",
  failFast: "Fail on startup error",
  toolsNone: "No tools yet",
  toolsApplying: "Applying\u2026",
  toolsCount: "{n} tool(s)",
  stOk: "Active",
  stApplying: "Applying",
  stNoTools: "No tools",
  stInvalid: "Invalid",
  jsonLabel: "Configuration JSON",
  jsonInvalid: "Invalid JSON",
  jsonFormat: "Format",
  unsupported: "MCP configuration is unavailable in this environment (no Web host service).",
  waiting: "Connecting to the host service\u2026",
  loading: "Loading MCP configuration\u2026",
  dirty: "Unsaved changes",
  fieldError: "Fix the highlighted fields first"
};
function format(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] === void 0 ? "" : String(vars[k]));
}
async function request(url, options) {
  const res = await fetch(url, options);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`\u54CD\u5E94\u89E3\u6790\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
  }
  if (data?.ok === false) throw new Error(data.error ?? "\u64CD\u4F5C\u5931\u8D25");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return data;
}
var postJson = (url, body) => request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {})
});
var WAIT_TICK_MS = 250;
var MAX_WAIT_TICKS = 40;
var TOOLS_POLL_MS = 1500;
var TOOLS_POLL_MAX = 6;
function Section(props) {
  return import_react.default.createElement(
    "div",
    { className: Mui_default.Mui_section },
    import_react.default.createElement(
      "div",
      { className: Mui_default.Mui_sectionHead },
      import_react.default.createElement("span", { className: Mui_default.Mui_sectionTitle }, props.title),
      import_react.default.createElement("span", { className: Mui_default.Mui_sectionLine }),
      props.aside ?? null
    ),
    props.children
  );
}
function KeyValueEditor(props) {
  const { t, rows, onChange, keyLabel, valueLabel, addLabel, disabled } = props;
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));
  const add = () => onChange([...rows, { key: "", value: "" }]);
  return import_react.default.createElement(
    "div",
    { className: Mui_default.Mui_kv },
    rows.length === 0 && import_react.default.createElement("span", { className: Mui_default.Mui_hint }, t("kvEmpty")),
    rows.map(
      (row, index) => import_react.default.createElement(
        "div",
        { className: Mui_default.Mui_kvRow, key: `kv-${String(index)}` },
        import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
          value: row.key,
          placeholder: keyLabel,
          "aria-label": keyLabel,
          disabled,
          onChange: (e) => update(index, { key: e.target.value })
        }),
        import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
          value: row.value,
          placeholder: valueLabel,
          "aria-label": valueLabel,
          disabled,
          /* 明文显示（个人 agent 配置页）；关掉自动填充以免浏览器覆盖已存值。 */
          autoComplete: "off",
          spellCheck: false,
          onChange: (e) => update(index, { value: e.target.value })
        }),
        import_react.default.createElement(import_dsh_client_ui_primitives.Button, {
          size: "sm",
          className: Mui_default.Mui_kvDel,
          "aria-label": t("remove"),
          title: t("remove"),
          disabled,
          icon: import_react.default.createElement(import_dsh_client_ui_primitives.IconCloseOutlineMedium, { size: 16 }),
          onClick: () => remove(index)
        })
      )
    ),
    import_react.default.createElement(
      import_dsh_client_ui_primitives.Button,
      {
        size: "sm",
        disabled,
        icon: import_react.default.createElement(import_dsh_client_ui_primitives.IconPlusOutlineMedium, { size: 16 }),
        onClick: add
      },
      addLabel
    )
  );
}
function ToolsSection(props) {
  const { t, tools, pending, serverName, expanded, onToggle } = props;
  const count = (tools ?? []).length;
  const isPending = (pending ?? []).includes(serverName);
  const aside = import_react.default.createElement(
    "button",
    { type: "button", className: Mui_default.Mui_toolHead, onClick: onToggle },
    import_react.default.createElement(
      "span",
      { className: Mui_default.Mui_toolCount },
      count > 0 ? format(t("toolsCount"), { n: count }) : t("toolsNone")
    ),
    import_react.default.createElement(import_dsh_client_ui_primitives.IconChevronRightOutlineMedium, {
      size: 14,
      className: expanded ? cx(Mui_default.Mui_caret, Mui_default.Mui_caretOpen) : Mui_default.Mui_caret
    })
  );
  return import_react.default.createElement(
    Section,
    { title: t("secTools"), aside },
    count > 0 && expanded ? import_react.default.createElement(
      "ul",
      { className: Mui_default.Mui_toolList },
      tools.map(
        (tool) => import_react.default.createElement(
          "li",
          { className: Mui_default.Mui_tool, key: tool.name },
          import_react.default.createElement("span", { className: Mui_default.Mui_toolName }, tool.rawName ?? tool.name),
          tool.description !== "" && import_react.default.createElement("span", { className: Mui_default.Mui_toolDesc, title: tool.description }, tool.description)
        )
      )
    ) : count === 0 && isPending ? import_react.default.createElement("span", { className: Mui_default.Mui_hint }, t("toolsApplying")) : null
  );
}
function ServerCard(props) {
  const {
    t,
    server,
    errors,
    tools,
    pending,
    onChange,
    onTransport,
    onRemove,
    onToggle,
    onToggleTools,
    expanded,
    toolsExpanded,
    disabled
  } = props;
  const draft = server.draft;
  const transport = server.transport;
  const list = errors ?? [];
  const bad = (field) => list.some((e) => e.field === field);
  const built = draftToServer(draft, transport);
  const toolCount = (tools ?? []).length;
  const isPending = (pending ?? []).includes(draft.serverName);
  const hasErrors = list.length > 0;
  const dotClass = hasErrors ? Mui_default.Mui_dotBad : isPending || toolCount === 0 ? Mui_default.Mui_dotWait : Mui_default.Mui_dotOk;
  const dotTitle = hasErrors ? t("stInvalid") : isPending ? t("stApplying") : toolCount === 0 ? t("stNoTools") : t("stOk");
  const badges = badgesOf(built);
  return import_react.default.createElement(
    "li",
    { className: expanded ? cx(Mui_default.Mui_card, Mui_default.Mui_cardOpen) : Mui_default.Mui_card },
    /* ---- 折叠态：整行可点 ---- */
    import_react.default.createElement(
      "div",
      { className: expanded ? cx(Mui_default.Mui_head, Mui_default.Mui_headOpen) : Mui_default.Mui_head },
      import_react.default.createElement(
        "button",
        {
          type: "button",
          className: Mui_default.Mui_toggle,
          onClick: onToggle,
          "aria-expanded": expanded
        },
        import_react.default.createElement(import_dsh_client_ui_primitives.IconChevronRightOutlineMedium, {
          size: 16,
          className: expanded ? cx(Mui_default.Mui_caret, Mui_default.Mui_caretOpen) : Mui_default.Mui_caret
        }),
        import_react.default.createElement(
          "span",
          { className: Mui_default.Mui_headMain },
          import_react.default.createElement(
            "span",
            { className: Mui_default.Mui_name },
            import_react.default.createElement("span", { className: cx(Mui_default.Mui_dot, dotClass), title: dotTitle }),
            draft.serverName || t("serverName")
          )
        )
      ),
      import_react.default.createElement(
        "div",
        { className: Mui_default.Mui_headAside },
        import_react.default.createElement(
          "div",
          { className: Mui_default.Mui_badges },
          import_react.default.createElement("span", { className: Mui_default.Mui_badge }, transport),
          toolCount > 0 && import_react.default.createElement("span", { className: Mui_default.Mui_badge }, format(t("toolsCount"), { n: toolCount })),
          badges.map((b) => import_react.default.createElement("span", { className: Mui_default.Mui_badge, key: b }, b))
        ),
        import_react.default.createElement(import_dsh_client_ui_primitives.Button, {
          size: "sm",
          variant: "danger",
          "aria-label": t("remove"),
          title: t("remove"),
          disabled,
          icon: import_react.default.createElement(import_dsh_client_ui_primitives.IconTrashOutlineMedium, { size: 16 }),
          onClick: onRemove
        })
      )
    ),
    /* ---- 展开态：分区表单 ---- */
    expanded && import_react.default.createElement(
      "div",
      { className: Mui_default.Mui_body },
      /* 连接 */
      import_react.default.createElement(
        Section,
        { title: t("secConnection") },
        import_react.default.createElement(
          "div",
          { className: Mui_default.Mui_row },
          import_react.default.createElement(
            "div",
            { className: Mui_default.Mui_field },
            import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("serverName")),
            import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
              value: draft.serverName,
              disabled,
              "aria-invalid": bad("serverName") || void 0,
              onChange: (e) => onChange({ serverName: e.target.value })
            })
          ),
          import_react.default.createElement(
            "div",
            { className: Mui_default.Mui_field },
            import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("transport")),
            import_react.default.createElement(import_dsh_client_ui_primitives.SegmentedControl, {
              /* id 用稳定行 id：若用 serverName，改名会换 id，控件被重建。 */
              id: `mcp-transport-${draft.rowId ?? "new"}`,
              value: transport,
              options: TRANSPORTS.map((value) => ({ value, label: value })),
              onChange: onTransport,
              label: t("transport"),
              disabled
            })
          )
        ),
        transport === "stdio" ? import_react.default.createElement(
          import_react.default.Fragment,
          null,
          import_react.default.createElement(
            "div",
            { className: Mui_default.Mui_field },
            import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("command")),
            import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
              value: draft.command ?? "",
              disabled,
              "aria-invalid": bad("command") || void 0,
              placeholder: "npx",
              onChange: (e) => onChange({ command: e.target.value })
            })
          ),
          import_react.default.createElement(
            "div",
            { className: Mui_default.Mui_field },
            import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("args")),
            import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
              value: draft.args ?? "",
              disabled,
              placeholder: "-y @modelcontextprotocol/server-filesystem D:\\work",
              onChange: (e) => onChange({ args: e.target.value })
            })
          ),
          import_react.default.createElement(
            "div",
            { className: Mui_default.Mui_field },
            import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("cwd")),
            import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
              value: draft.cwd ?? "",
              disabled,
              onChange: (e) => onChange({ cwd: e.target.value })
            })
          )
        ) : import_react.default.createElement(
          "div",
          { className: Mui_default.Mui_field },
          import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("url")),
          import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
            value: draft.url ?? "",
            disabled,
            "aria-invalid": bad("url") || void 0,
            placeholder: "http://127.0.0.1:3000/mcp",
            onChange: (e) => onChange({ url: e.target.value })
          })
        )
      ),
      /* 环境变量 / 请求头（按传输方式只显示相关那一个） */
      import_react.default.createElement(
        Section,
        { title: t("secSecrets") },
        transport === "stdio" ? import_react.default.createElement(
          "div",
          { className: Mui_default.Mui_field },
          import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("env")),
          import_react.default.createElement(KeyValueEditor, {
            t,
            rows: draft.envRows ?? [],
            keyLabel: t("kvKey"),
            valueLabel: t("kvValue"),
            addLabel: t("kvAdd"),
            disabled,
            onChange: (rows) => onChange({ envRows: rows })
          })
        ) : import_react.default.createElement(
          "div",
          { className: Mui_default.Mui_field },
          import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("headers")),
          import_react.default.createElement(KeyValueEditor, {
            t,
            rows: draft.headersRows ?? [],
            keyLabel: t("kvKey"),
            valueLabel: t("kvValue"),
            addLabel: t("kvAdd"),
            disabled,
            onChange: (rows) => onChange({ headersRows: rows })
          })
        )
      ),
      /* 高级 */
      import_react.default.createElement(
        Section,
        { title: t("secAdvanced") },
        import_react.default.createElement(
          "div",
          { className: Mui_default.Mui_row },
          import_react.default.createElement(
            "div",
            { className: Mui_default.Mui_field },
            import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("timeout")),
            import_react.default.createElement(import_dsh_client_ui_primitives.Input, {
              value: String(draft.toolCallTimeoutMs ?? ""),
              disabled,
              inputMode: "numeric",
              onChange: (e) => onChange({ toolCallTimeoutMs: e.target.value })
            })
          ),
          import_react.default.createElement(
            "div",
            { className: Mui_default.Mui_field },
            import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("failFast")),
            import_react.default.createElement(import_dsh_client_ui_primitives.Switch, {
              checked: draft.failOnStartupError === true,
              disabled,
              label: t("failFast"),
              onChange: (checked) => onChange({ failOnStartupError: checked })
            })
          )
        ),
        /* 只在真的有 JSON 高级字段时才显示；空着不占位（"无"是噪音）。 */
        draft.extra !== void 0 && Object.keys(draft.extra).length > 0 && import_react.default.createElement("span", { className: Mui_default.Mui_path }, JSON.stringify(draft.extra))
      ),
      /* 已生效工具 */
      import_react.default.createElement(ToolsSection, {
        t,
        serverName: draft.serverName,
        tools,
        pending,
        expanded: toolsExpanded,
        onToggle: onToggleTools
      }),
      hasErrors && import_react.default.createElement(
        "div",
        { className: Mui_default.Mui_field },
        list.map(
          (error, index) => import_react.default.createElement(
            "span",
            { className: Mui_default.Mui_inlineError, key: `err-${String(index)}` },
            error.message
          )
        )
      )
    )
  );
}
function McpSection(props) {
  const { t, supported: supportedProp } = props;
  const supported = supportedProp !== false;
  const [phase, setPhase] = (0, import_react.useState)("loading");
  const [file, setFile] = (0, import_react.useState)("");
  const [servers, setServers] = (0, import_react.useState)([]);
  const [tools, setTools] = (0, import_react.useState)({});
  const [pending, setPending] = (0, import_react.useState)([]);
  const [mode, setMode] = (0, import_react.useState)("form");
  const [json, setJson] = (0, import_react.useState)("");
  const [jsonError, setJsonError] = (0, import_react.useState)(null);
  const [expanded, setExpanded] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
  const [toolsOpen, setToolsOpen] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const [toast, setToast] = (0, import_react.useState)(null);
  const [confirmRemove, setConfirmRemove] = (0, import_react.useState)(null);
  const [dirty, setDirty] = (0, import_react.useState)(false);
  const seq = (0, import_react.useRef)(0);
  const notify = (0, import_react.useCallback)((next) => {
    seq.current += 1;
    setToast({ ...next, seq: seq.current });
  }, []);
  const adopt = (0, import_react.useCallback)((list, meta) => {
    setServers(
      /* ensureRowIds：给每一行分配稳定身份，编辑时改字段不会换 key。 */
      ensureRowIds(
        (list ?? []).map((server) => ({
          draft: serverToDraft(server),
          transport: server.transport
        }))
      )
    );
    if (meta?.file !== void 0) setFile(meta.file);
    if (meta?.tools !== void 0) setTools(meta.tools ?? {});
    if (meta?.pending !== void 0) setPending(meta.pending ?? []);
    setJsonError(null);
    setDirty(false);
  }, []);
  const load = (0, import_react.useCallback)(async () => {
    setPhase("loading");
    setError(null);
    try {
      const data = await request(API.state);
      adopt(data.servers ?? [], { file: data.file, tools: data.tools, pending: [] });
      setJson(serversToJsonText(data.servers ?? []));
      setPhase("ready");
    } catch (e) {
      setError(`${t("loadFailed")}\uFF1A${e instanceof Error ? e.message : String(e)}`);
      setPhase("failed");
    }
  }, [adopt, t]);
  (0, import_react.useEffect)(() => {
    if (!supported) return void 0;
    load();
    return void 0;
  }, [supported, load]);
  const [waited, setWaited] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    if (supported) return void 0;
    const timer = setInterval(() => {
      setWaited((n) => {
        if (n + 1 >= MAX_WAIT_TICKS) clearInterval(timer);
        return Math.min(n + 1, MAX_WAIT_TICKS);
      });
    }, WAIT_TICK_MS);
    return () => clearInterval(timer);
  }, [supported]);
  const [submitted, setSubmitted] = (0, import_react.useState)(false);
  const errorsByName = (0, import_react.useMemo)(() => {
    if (!submitted) return servers.map(() => []);
    const allNames = servers.map((s) => s.draft.serverName);
    return servers.map((server) => validateServerFields(draftToServer(server.draft, server.transport), allNames));
  }, [submitted, servers]);
  const formInvalid = errorsByName.some((e) => e.length > 0);
  const updateServer = (0, import_react.useCallback)((index, patch) => {
    setServers(
      (prev) => prev.map((server, i) => i === index ? { ...server, draft: { ...server.draft, ...patch } } : server)
    );
    setSubmitted(false);
    setDirty(true);
  }, []);
  const changeTransport = (0, import_react.useCallback)((index, transport) => {
    setServers(
      (prev) => prev.map((server, i) => {
        if (i !== index) return server;
        const moved = switchTransport({ ...server.draft, transport: server.transport }, transport);
        return { ...server, transport, draft: { ...server.draft, ...moved } };
      })
    );
    setSubmitted(false);
    setDirty(true);
  }, []);
  const addServer = (0, import_react.useCallback)(() => {
    const created = createServer(servers.map((s) => s.draft.serverName));
    const draft = serverToDraft(created);
    setServers((prev) => [...prev, { draft, transport: created.transport }]);
    setExpanded((open) => /* @__PURE__ */ new Set([...open, draft.rowId]));
    setSubmitted(false);
    setDirty(true);
  }, [servers]);
  const doRemove = (0, import_react.useCallback)((index) => {
    setServers((prev) => prev.filter((_, i) => i !== index));
    setSubmitted(false);
    setDirty(true);
    setConfirmRemove(null);
  }, []);
  const afterSave = (0, import_react.useCallback)(
    async (result) => {
      adopt(result.servers ?? [], {
        file: result.file,
        tools: result.tools,
        pending: result.pending ?? []
      });
      setJson(serversToJsonText(result.servers ?? []));
      const stillPending = (result.pending ?? []).length > 0;
      if (result.changed === false) {
        notify({ text: t("savedNoop"), tone: void 0 });
        return;
      }
      notify(
        stillPending ? {
          text: format(t("savedApplying"), { n: (result.servers ?? []).length }),
          tone: void 0,
          icon: import_react.default.createElement(import_dsh_client_ui_primitives.IconClockOutlineMedium, { size: 16 }),
          holdMs: 5e3
        } : {
          text: format(t("savedOk"), { n: (result.servers ?? []).length }),
          tone: "success",
          icon: import_react.default.createElement(import_dsh_client_ui_primitives.IconCheckOutlineMedium, { size: 16 })
        }
      );
      for (let i = 0; i < TOOLS_POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, TOOLS_POLL_MS));
        try {
          const fresh = await postJson(API.tools);
          const table = fresh.tools ?? {};
          setTools(table);
          const names = Object.keys(table);
          const total = names.reduce((n, k) => n + (table[k] ?? []).length, 0);
          if (total > 0) {
            setPending([]);
            setToolsOpen((open) => /* @__PURE__ */ new Set([...open, names[0]]));
            return;
          }
        } catch {
          break;
        }
      }
      setPending([]);
    },
    [adopt, notify, t]
  );
  const submitForm = (0, import_react.useCallback)(async () => {
    const payload = servers.map((server) => draftToServer(server.draft, server.transport));
    const allNames = servers.map((s) => s.draft.serverName);
    const found = payload.map((server) => validateServer(server, allNames));
    const bad = found.findIndex((messages) => messages.length > 0);
    setSubmitted(true);
    if (bad >= 0) {
      const rowId = servers[bad]?.draft?.rowId;
      if (rowId !== void 0) setExpanded((open) => /* @__PURE__ */ new Set([...open, rowId]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await afterSave(await postJson(API.save, { servers: payload }));
    } catch (e) {
      setError(`${t("saveFailed")}\uFF1A${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [servers, afterSave, t]);
  const submitJson = (0, import_react.useCallback)(async () => {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setJsonError(`${t("jsonInvalid")}\uFF1A${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setJsonError(null);
    setBusy(true);
    setError(null);
    try {
      await afterSave(await postJson(API.save, { json: JSON.stringify(parsed) }));
    } catch (e) {
      setError(`${t("saveFailed")}\uFF1A${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [json, afterSave, t]);
  const formatJson = (0, import_react.useCallback)(() => {
    try {
      setJson(`${JSON.stringify(JSON.parse(json), null, 2)}
`);
      setJsonError(null);
    } catch (e) {
      setJsonError(`${t("jsonInvalid")}\uFF1A${e instanceof Error ? e.message : String(e)}`);
    }
  }, [json, t]);
  const switchMode = (0, import_react.useCallback)(
    (next) => {
      if (next === "json") {
        setJson(draftsToJsonText(servers.map((s) => draftToServer(s.draft, s.transport))));
        setJsonError(null);
      }
      setMode(next);
    },
    [servers]
  );
  if (!supported) {
    const giveUp = waited >= MAX_WAIT_TICKS;
    return import_react.default.createElement(
      "div",
      { className: Mui_default.Mui_page },
      import_react.default.createElement(
        "p",
        { className: Mui_default.Mui_notice, role: "status" },
        giveUp ? t("unsupported") : t("waiting")
      )
    );
  }
  const modeOptions = [
    { value: "form", label: t("modeForm") },
    { value: "json", label: t("modeJson") }
  ];
  const toggleIn = (setter, value) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
  return import_react.default.createElement(
    "div",
    { className: Mui_default.Mui_page },
    import_react.default.createElement("h1", { className: Mui_default.Mui_heading }, t("title")),
    import_react.default.createElement("p", { className: Mui_default.Mui_intro }, t("intro")),
    error !== null && import_react.default.createElement(
      "p",
      { className: Mui_default.Mui_error, role: "alert" },
      error,
      import_react.default.createElement(import_dsh_client_ui_primitives.Button, { size: "sm", onClick: () => setError(null) }, t("cancel"))
    ),
    import_react.default.createElement(
      "div",
      { className: Mui_default.Mui_toolbar },
      import_react.default.createElement(import_dsh_client_ui_primitives.SegmentedControl, {
        id: "mcp-mode",
        value: mode,
        options: modeOptions,
        onChange: switchMode,
        label: t("mode"),
        disabled: busy
      }),
      dirty && import_react.default.createElement(import_dsh_client_ui_primitives.Tag, { tone: "outline" }, t("dirty")),
      import_react.default.createElement("span", { className: Mui_default.Mui_grow }),
      import_react.default.createElement(
        import_dsh_client_ui_primitives.Button,
        {
          size: "sm",
          disabled: busy || mode !== "form",
          icon: import_react.default.createElement(import_dsh_client_ui_primitives.IconPlusOutlineMedium, { size: 16 }),
          onClick: addServer
        },
        t("add")
      ),
      import_react.default.createElement(
        import_dsh_client_ui_primitives.Button,
        {
          size: "sm",
          disabled: busy,
          icon: import_react.default.createElement(import_dsh_client_ui_primitives.IconRefreshOutlineMedium, { size: 16 }),
          onClick: load
        },
        t("reload")
      )
    ),
    file !== "" && import_react.default.createElement("span", { className: Mui_default.Mui_path }, `${t("fileLabel")}: ${file}`),
    phase === "loading" && import_react.default.createElement("p", { className: Mui_default.Mui_notice, role: "status" }, t("loading")),
    phase !== "loading" && mode === "form" && (servers.length === 0 ? import_react.default.createElement(
      "div",
      { className: Mui_default.Mui_empty, role: "status" },
      import_react.default.createElement("p", { className: Mui_default.Mui_emptyTitle }, t("empty")),
      import_react.default.createElement("p", { className: Mui_default.Mui_emptyText }, t("emptyText"))
    ) : import_react.default.createElement(
      "ul",
      { className: Mui_default.Mui_list },
      servers.map((server, index) => {
        const name = server.draft.serverName;
        const rowId = server.draft.rowId;
        return import_react.default.createElement(ServerCard, {
          key: rowId,
          t,
          server,
          errors: errorsByName[index],
          tools: tools[name],
          pending,
          disabled: busy,
          expanded: expanded.has(rowId),
          toolsExpanded: toolsOpen.has(rowId),
          onToggle: () => toggleIn(setExpanded, rowId),
          onToggleTools: () => toggleIn(setToolsOpen, rowId),
          onChange: (patch) => updateServer(index, patch),
          onTransport: (value) => changeTransport(index, value),
          onRemove: () => setConfirmRemove({ index, name: name || t("serverName") })
        });
      })
    )),
    phase !== "loading" && mode === "json" && import_react.default.createElement(
      import_react.default.Fragment,
      null,
      import_react.default.createElement(
        "div",
        { className: Mui_default.Mui_field },
        import_react.default.createElement("label", { className: Mui_default.Mui_label }, t("jsonLabel")),
        import_react.default.createElement("textarea", {
          className: Mui_default.Mui_textarea,
          value: json,
          spellCheck: false,
          disabled: busy,
          "aria-label": t("jsonLabel"),
          onChange: (e) => {
            setJson(e.target.value);
            setJsonError(null);
            setDirty(true);
          }
        })
      ),
      jsonError !== null && import_react.default.createElement("p", { className: Mui_default.Mui_jsonError, role: "alert" }, jsonError),
      import_react.default.createElement(
        "div",
        { className: Mui_default.Mui_row },
        import_react.default.createElement(import_dsh_client_ui_primitives.Button, { size: "sm", disabled: busy, onClick: formatJson }, t("jsonFormat"))
      )
    ),
    phase !== "loading" && import_react.default.createElement(
      "div",
      { className: Mui_default.Mui_footer },
      import_react.default.createElement(
        import_dsh_client_ui_primitives.Button,
        {
          variant: "primary",
          size: "sm",
          disabled: busy || !dirty,
          onClick: mode === "form" ? submitForm : submitJson
        },
        busy ? t("saving") : t("save")
      ),
      mode === "form" && formInvalid && import_react.default.createElement("span", { className: Mui_default.Mui_inlineError }, t("fieldError"))
    ),
    import_react.default.createElement(import_dsh_client_ui_primitives.Modal, {
      open: confirmRemove !== null,
      onClose: () => setConfirmRemove(null),
      title: format(t("confirmRemoveTitle"), { name: confirmRemove?.name ?? "" }),
      closeLabel: t("cancel"),
      description: t("confirmRemoveDesc"),
      footer: [
        import_react.default.createElement(import_dsh_client_ui_primitives.Button, { key: "cancel", size: "sm", onClick: () => setConfirmRemove(null) }, t("cancel")),
        import_react.default.createElement(
          import_dsh_client_ui_primitives.Button,
          { key: "go", variant: "danger", size: "sm", onClick: () => doRemove(confirmRemove.index) },
          t("remove")
        )
      ],
      children: null
    }),
    toast !== null && import_react.default.createElement(import_dsh_client_ui_primitives.Toast, {
      text: toast.text,
      tone: toast.tone,
      icon: toast.icon,
      holdMs: toast.holdMs,
      onDone: () => setToast(null),
      key: `mcp-toast-${String(toast.seq)}`
    })
  );
}
var inject = ["slots", "locale"];
function apply(ctx) {
  const locale = ctx.locale ?? ctx.get("locale");
  if (locale !== void 0 && locale.register !== void 0) {
    ctx.effect(() => locale.register(NS, { zh, en }), "@gxx-labs/mcp-ui-dsh: dictionaries");
  }
  const t = (key) => {
    if (locale === void 0 || locale.bind === void 0) return zh[key] ?? key;
    try {
      return locale.bind(NS)(key);
    } catch {
      return zh[key] ?? key;
    }
  };
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: SECTION_ID,
        order: 26,
        /* label 必须是 thunk：导航每次投影时重读，切语言即跟随。 */
        label: () => t("nav"),
        locale: NS,
        inject: () => ({})
      },
      McpSection
    )
  );
}
var __cssTagId = "@gxx-labs/mcp-ui-dsh/Mui.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(__cssTagId) + "]") === null) {
  var __styleTag = document.createElement("style");
  __styleTag.dataset.plugin = "@gxx-labs/mcp-ui-dsh";
  __styleTag.dataset.pluginCss = __cssTagId;
  __styleTag.textContent = "/* client/Mui.module.css */\n.Mui_Mui_page {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  padding: 4px 2px 24px;\n  max-width: 940px;\n}\n.Mui_Mui_heading {\n  margin: 0;\n  font-size: 18px;\n  font-weight: 600;\n  line-height: 1.4;\n  color: var(--dsw-alias-label-primary);\n}\n.Mui_Mui_intro {\n  margin: 0;\n  font-size: 13px;\n  line-height: 1.6;\n  color: var(--dsw-alias-label-secondary);\n}\n.Mui_Mui_notice {\n  margin: 0;\n  font-size: 13px;\n  line-height: 1.6;\n  color: var(--dsw-alias-label-secondary);\n}\n.Mui_Mui_error {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 12px;\n  margin: 0;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n  font-size: 13px;\n  line-height: 1.6;\n  color: var(--dsw-alias-state-error-primary);\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.Mui_Mui_toolbar {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 10px;\n}\n.Mui_Mui_grow {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n.Mui_Mui_path {\n  font-family:\n    ui-monospace,\n    \"Cascadia Mono\",\n    Consolas,\n    monospace;\n  font-size: 11px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-secondary);\n  overflow-wrap: anywhere;\n}\n.Mui_Mui_hint {\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-secondary);\n}\n.Mui_Mui_list {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n.Mui_Mui_card {\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-1);\n  overflow: hidden;\n}\n.Mui_Mui_cardOpen {\n  border-color: var(--dsw-alias-border-l2);\n}\n.Mui_Mui_head {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 9px 12px;\n}\n.Mui_Mui_headOpen {\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n  background: var(--dsw-alias-bg-layer-2);\n}\n.Mui_Mui_toggle {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  flex: 1 1 auto;\n  min-width: 0;\n  border: 0;\n  background: transparent;\n  padding: 0;\n  cursor: pointer;\n  text-align: left;\n  color: inherit;\n  font: inherit;\n}\n.Mui_Mui_caret {\n  flex: 0 0 auto;\n  display: inline-flex;\n  align-items: center;\n  color: var(--dsw-alias-label-secondary);\n}\n.Mui_Mui_headMain {\n  display: flex;\n  align-items: center;\n  gap: 1px;\n  min-width: 0;\n  flex: 1 1 auto;\n}\n.Mui_Mui_name {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  font-size: 13px;\n  font-weight: 600;\n  line-height: 1.4;\n  color: var(--dsw-alias-label-primary);\n  overflow-wrap: anywhere;\n}\n.Mui_Mui_headAside {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex: 0 0 auto;\n}\n.Mui_Mui_badges {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n}\n.Mui_Mui_badge {\n  font-size: 11px;\n  line-height: 1.4;\n  padding: 1px 6px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 999px;\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n}\n.Mui_Mui_dot {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  flex: 0 0 auto;\n}\n.Mui_Mui_dotOk {\n  background: var(--dsw-alias-state-success-primary);\n}\n.Mui_Mui_dotWait {\n  background: var(--dsw-alias-state-warn-primary);\n}\n.Mui_Mui_dotBad {\n  background: var(--dsw-alias-state-error-primary);\n}\n.Mui_Mui_body {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  padding: 12px;\n}\n.Mui_Mui_section {\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n}\n.Mui_Mui_sectionHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.Mui_Mui_sectionTitle {\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.04em;\n  text-transform: uppercase;\n  color: var(--dsw-alias-label-secondary);\n}\n.Mui_Mui_sectionLine {\n  flex: 1 1 auto;\n  height: 1px;\n  background: var(--dsw-alias-border-l1);\n}\n.Mui_Mui_field {\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n}\n.Mui_Mui_label {\n  font-size: 12px;\n  font-weight: 500;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-primary);\n}\n.Mui_Mui_row {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 10px;\n  align-items: flex-start;\n}\n.Mui_Mui_row > .Mui_Mui_field {\n  flex: 1 1 200px;\n  min-width: 0;\n}\n.Mui_Mui_kv {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.Mui_Mui_kvRow {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n}\n.Mui_Mui_kvRow > :first-child {\n  flex: 0 1 36%;\n  min-width: 0;\n}\n.Mui_Mui_kvRow > :nth-child(2) {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n.Mui_Mui_kvDel {\n  flex: 0 0 auto;\n}\n.Mui_Mui_tools {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.Mui_Mui_toolHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  border: 0;\n  background: transparent;\n  padding: 0;\n  cursor: pointer;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n}\n.Mui_Mui_toolCount {\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-secondary);\n}\n.Mui_Mui_toolList {\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  margin: 0;\n  padding: 8px 10px;\n  list-style: none;\n  max-height: 320px;\n  overflow-y: auto;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-base);\n}\n.Mui_Mui_tool {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n}\n.Mui_Mui_toolName {\n  font-family:\n    ui-monospace,\n    \"Cascadia Mono\",\n    Consolas,\n    monospace;\n  font-size: 11.5px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-primary);\n  overflow-wrap: anywhere;\n}\n.Mui_Mui_toolDesc {\n  font-size: 11.5px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-secondary);\n  overflow-wrap: anywhere;\n}\n.Mui_Mui_empty {\n  padding: 26px 16px;\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: 10px;\n  text-align: center;\n}\n.Mui_Mui_emptyTitle {\n  margin: 0 0 6px;\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-primary);\n}\n.Mui_Mui_emptyText {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.6;\n  color: var(--dsw-alias-label-secondary);\n}\n.Mui_Mui_inlineError {\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-state-error-primary);\n}\n.Mui_Mui_textarea {\n  width: 100%;\n  min-height: 300px;\n  box-sizing: border-box;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary);\n  font-family:\n    ui-monospace,\n    \"Cascadia Mono\",\n    Consolas,\n    monospace;\n  font-size: 12px;\n  line-height: 1.6;\n  resize: vertical;\n  tab-size: 2;\n}\n.Mui_Mui_textarea:focus {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: -1px;\n}\n.Mui_Mui_jsonError {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.6;\n  color: var(--dsw-alias-state-error-primary);\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n.Mui_Mui_footer {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 10px;\n  padding-top: 2px;\n}\n\n/* .build-tmp/entry.css */\n";
  document.head.appendChild(__styleTag);
}

    return module.exports;
  }
});
