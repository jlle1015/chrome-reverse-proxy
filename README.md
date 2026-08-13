# Chrome Reverse Proxy

在浏览器内实现 nginx 风格的**反向代理**：把页面发往 A 域的请求，在后台转发到 B 域的真实后端，
从而**规避浏览器跨域（CORS）限制**，并支持**按白名单携带原请求头**、**注入附加请求头**。

## 架构

```
页面 (MAIN world)                         页面 (ISOLATED world)               Service Worker
┌─────────────────────────┐   postMessage  ┌──────────────────────┐   sendMessage   ┌──────────────────────────┐
│ page-proxy.js           │ ─────────────► │ content.js           │ ──────────────► │ background.js             │
│ 重写 window.fetch       │ ◄───────────── │ 规则缓存+消息中转     │ ◄────────────── │ 用 host_permissions fetch │
│ 重写 XMLHttpRequest     │                │                      │                 │ 目标(无 CORS)             │
│ 捕获请求头/体/cookie    │                │                      │                 │ + 注入附加请求头        │
└─────────────────────────┘                └──────────────────────┘                 │ + 白名单转发请求头        │
                                                                                    │ + URL 重写(proxy_pass)   │
                                                                                    └──────────────────────────┘
```

- `page-proxy.js` 以 `world: "MAIN"` 注入页面主世界，`document_start` 时机挂钩 `fetch` / `XMLHttpRequest`，
  命中规则的请求被拦截并序列化（URL、方法、可读请求头、请求体、Cookie），不命中的请求原样走原生实现。
- `content.js` 运行在隔离世界，缓存规则并把页面请求通过 `chrome.runtime.sendMessage` 转给后台。
- `background.js`（Service Worker）拥有 `host_permissions`，直接 `fetch` 目标后端，天然不受 CORS 限制；
  在此完成 URL 重写、请求头白名单转发、附加请求头注入，再把响应体（base64）+ 响应头原样送回页面。
- 响应在页面侧重建为原生 `Response` / XHR 事件，页面代码无需任何改动。

## 为什么能规避跨域

浏览器页面内发起的跨域请求受 CORS 限制。本方案把请求从页面**搬到了扩展的 Service Worker**：
Service Worker 持有目标域名的主机权限，发出的请求等价于服务器端代理（无 Origin 预检限制），
返回后由 content script 在页面侧**重写重建响应**，因此响应头无需携带任何 CORS 字段也能被页面读取。

## 规则说明（等价 nginx）

| 字段 | 说明 |
| --- | --- |
| 规则名称 | 仅用于展示 |
| 匹配类型 | `前缀`（nginx `location` 风格）或 `正则` |
| 匹配规则 | 页面请求 URL 的匹配前缀/正则。如 `https://app.example.com/api/` |
| 转发目标 | 目标前缀/替换模板，语义同 nginx `proxy_pass`：`目标URL = 转发目标 + 原始URL去掉匹配前缀`，查询参数自动保留 |
| 转发请求头 | 逗号分隔的白名单，`*` 表示转发全部**页面代码可读**的请求头；`content-length`、`host` 等 hop-by-hop 头始终剔除 |
| 附加请求头 | JSON，如 `{"Authorization":"Bearer xxx"}`，**只在后台注入，页面与请求发起方都看不到** |
| 携带页面 Cookie | 把页面 `document.cookie` 作为 `Cookie` 头发送到目标 |
| 携带目标 Cookie | 后台 `fetch` 使用 `credentials: 'include'`，携带目标域名自己的 Cookie（需主机权限） |

前缀匹配对 **http/https 协议不敏感**：规则写成 `http://...` 也能命中 `https://...` 的实际请求，
重写结果以「转发目标」里的协议为准。正则匹配则完全由正则本身决定。

例：匹配前缀 `https://app.example.com/api/` + 转发目标 `https://backend.internal:8443/`
将 `https://app.example.com/api/users/1?x=1` 转发为 `https://backend.internal:8443/users/1?x=1`。

## 安装（开发者模式）

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目目录
4. 在扩展详情中确保已授予「读取和更改所有网站数据」权限

## 使用

1. 点击工具栏扩展图标 → 「打开规则配置」
2. 新增规则并保存（配置实时生效，无需刷新页面）
3. 在页面上照常调用被代理的接口，无需任何 CORS 配置

## 插件面板（popup）

无需进入配置页即可完成常用操作：

- **启用/停用全部**：一键开关所有规则；每条规则也可单独勾选开关
- **最近拦截日志**：直接展示最近 8 条代理日志（时间、方法、状态、URL、耗时），点「查看全部日志」跳转配置页
- **当前页面状态**：面板顶部显示当前标签页是否已注入 Content Script 及规则数量；
  显示「未检测到 Content Script」时说明需要刷新页面或重新加载扩展
- 页面控制台可直接调试：`window.__chromeNginxStatus()` 查看规则缓存，
  `await window.__chromeNginxProbe(url)` 探测某 URL 是否被代理（返回的响应带 `X-Chrome-Nginx: 1` 即被代理）

## 已知限制

- 请求体暂不支持二进制流式传输，整体在后台缓冲后再转发；大文件上传/下载走流式接口（如 `fetch` body stream）
  时不适用。
- 页面代码设置但受浏览器保护的请求头（`origin`、`referer`、`cookie` 等）无法被 JS 读取，
  需用「携带页面 Cookie」选项显式转发；其余自定义头（含 `authorization`）正常走白名单转发。
- 响应 `set-cookie` 无法注入页面（浏览器安全策略），但目标返回的 `Set-Cookie` 会在后台 fetch 时由浏览器
  直接写入目标域 Cookie 存储。
- 页面 JS 对 `fetch`/`XHR` 的拦截依赖 `document_start` 注入，若页面自身在更早时机替换了这两个全局对象，
  可能无法拦截（极少见）。
- **仅拦截页面主线程经 `fetch`/`XHR` 发出的请求**；`<img>`、`<form>`、页面跳转以及 Web Worker 内部发起的
  请求无法被拦截。

## 排查：请求没有被拦截 / 没有日志

按以下顺序检查（配合 options 页「调试模式」，在页面控制台看 `[Chrome Reverse Proxy]` 输出最直观）：

1. **刷新目标页面**。修改或重新加载扩展后，已打开页面里的 content script 不会自动更新，必须刷新一次
   （`Ctrl+R`）。新增/修改规则后也建议刷新。
2. **在 options 页用「测试匹配」粘贴实际请求 URL**，确认能命中规则并得到预期重写结果。XHR 以
   **相对路径**发起（如 `axios` 的 `baseURL` + 相对路径）时，扩展会自动补全为绝对 URL 再匹配。
   测试时注意分别用 `http://` 和 `https://` 各试一次（前缀匹配对协议不敏感，但若实际请求走的是
   `https` 而规则只写成 `http`，历史上正是最常见的漏拦截原因之一）。
3. **请求必须由页面 JS 的 `fetch`/`XMLHttpRequest` 发出**。若请求来自 Web Worker / `sendBeacon` /
   资源标签（`<script>`、`<img>`）则不会被拦截，也不会产生日志。
4. **开启「调试模式」**后刷新页面，控制台会输出每条请求的命中/未命中判断（「→ 未命中，直连」表示未代理）。
5. 打开 `chrome://extensions` 中本扩展的「Service Worker」控制台，查看后台是否报错。
6. 确认规则处于「启用中」，且其前面没有更早命中的规则。

## 拦截日志

每条被代理请求都会在 options 页「拦截日志」表格中记录，**点击任意一行可查看完整详情**：

- 基本信息：时间、规则、方法、状态码、耗时、原始 URL、重写后的目标 URL
- **请求头**（实际转发出去的，含注入的附加请求头）与**请求体（入参）**
- **响应头**与**响应体（出参）**

二进制/非文本的请求体、响应体会以 `[二进制 N 字节，内容类型: xxx]` 占位；
文本内容超过 4096 字符会截断并标注。详情弹窗内可「复制日志」（整条 JSON 到剪贴板）。
日志保存在 `chrome.storage.local`（上限 200 条），可在 options 页或 popup 面板一键**清空**；
「启用日志记录」开关可完全关闭记录。

## 插件面板（popup）

无需进入配置页即可完成常用操作：

- **启用/停用全部**：一键开关所有规则；每条规则也可单独勾选开关
- **最近拦截日志**：直接展示最近 8 条代理日志（时间、方法、状态、URL、耗时），实时刷新，并可直接**清空日志**
- **当前页面状态**：面板顶部显示当前标签页是否已注入 Content Script 及规则数量；
  显示「未检测到 Content Script」时说明需要刷新页面或重新加载扩展
- 页面控制台可直接调试：`window.__chromeNginxStatus()` 查看规则缓存，
  `await window.__chromeNginxProbe(url)` 探测某 URL 是否被代理（返回的响应带 `X-Chrome-Nginx: 1` 即被代理）

## 配置复制

- options 页「规则列表」右上角**复制配置**：把全部配置（规则 + 日志开关）复制为 JSON 到剪贴板
- 每条规则行内的**复制**按钮：快速克隆该规则（追加到原规则之后，名称带「（副本）」）

## 导入 / 导出配置

options 页「规则列表」右上角可**导出配置**（下载 `chrome-reverse-proxy-config.json`，包含全部规则与日志开关）
或**导入配置**（同一 JSON 文件，导入会先询问确认后替换当前规则）。导出文件结构：

```json
{
  "app": "chrome-reverse-proxy",
  "version": 1,
  "exportedAt": "2026-08-11T...",
  "loggingEnabled": true,
  "rules": [ { "id": "...", "name": "...", "matchType": "prefix", "pattern": "...", "target": "...", "forwardHeaders": [...], "addHeaders": {...}, "forwardPageCookie": false, "includeCookies": false, "enabled": true } ]
}
```

也兼容直接传入 `rules` 数组的简化格式；缺失字段会在导入时自动规范化。

## 文件结构

```
manifest.json               MV3 声明（双 world content script + service worker，必须位于根目录）
js/background/background.js Service Worker：代理请求、URL 重写、头转发、附加请求头注入、拦截日志
js/content/content.js       隔离世界：规则缓存 + postMessage 与 sendMessage 双向中转
js/content/page-proxy.js    MAIN world：挂钩 fetch/XHR，捕获请求并重建响应
js/shared/common.js         公共工具：HTML 转义、域名匹配（一级域名/子域/IP）、规则相关性判断
js/views/options.js         配置页逻辑（规则管理 + 日志详情 + 导入导出）
js/views/popup.js           面板逻辑（快捷开关 + 最近日志 + 打开侧边栏）
js/views/sidepanel.js       侧边栏逻辑（页面规则 + 拦截日志）
js/views/view-common.js     popup/侧边栏共用：渲染、事件绑定、重新注入 Content Script
html/options.html           配置页
html/popup.html             插件面板
html/sidepanel.html         浏览器侧边栏
css/options.css             配置页样式
```
