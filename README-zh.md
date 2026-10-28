[English](README.md) | [한국어](README-ko.md) | [简体中文](README-zh.md) | [日本語](README-ja.md)

# 手机上的 DSH——为 DSH Web UI 增加的一层手机专用适配

DSH（DeepSeek Harness）自带一个为桌面窗口构建的 Web UI。在手机宽度的屏幕上，它可以使用，但很局促，而且前端没有任何部分会响应屏幕宽度。本仓库在桌面入口**旁边**增加了一个手机入口：一个小型反向代理，会向它提供的页面注入窄屏样式表和脚本。桌面入口、DSH 安装及其数据均保持不变。

这里没有任何 fork。它包含一个 Node 脚本（无依赖）、一个样式表和一个脚本，以及如何让它持续运行并以私有方式暴露。

```
手机 ──HTTPS──▶ 私有网络代理（tailscale serve 等 :8450）
                        │
                        ▼
                 dsh-phone 网关（本仓库，127.0.0.1:8450）
                   ├── /m              → 302 → /?token=<当前 DSH token>
                   ├── /__dshm/*.css   → 手机用样式表
                   ├── /__dshm/*.js    → 手机用脚本
                   └── 其他所有路径    → 127.0.0.1:3080（DSH web）
桌面 ──HTTPS──▶ 原 DSH 入口（:8446）—— 未改动
```

## 为什么增加第二个入口而不是打补丁

在已发布前端（`@deepseek-ai/dsh` 0.2.1-rc.2，`dist/assets/index-*.css`）上测得：

- 基于宽度的媒体查询：**0**（仅有的 `@media` 规则是 `prefers-reduced-motion`），并且 bundle 中不包含 `matchMedia` 调用——布局从不随宽度变化
- 在 440px 视口下，左侧栏永久保留 **56px**；打开侧边栏会将网格变为 `280px | 160px`，给对话留下 **160px**
- composer chip 高 **28px**，可编辑区域为 **14px**，这会让 iOS 在聚焦时缩放页面（它会缩放任何小于 16px 的内容）
- 没有处理刘海/Home 指示条安全区域（`viewport-fit=cover`）

给打包后的资源打补丁只能撑到下一次 `npm update`。在请求时注入不会改动 DSH 安装，也能一步移除。但这并不意味着长期稳定：选择器依赖 DSH 的 `data-slot` 名称，后续构建改名就会失效（见文末限制）。

## 你会得到什么

- 左侧栏变成滑出面板，并配有一个浮动菜单按钮
- composer、头部和每条消息操作的点击目标为 36–40px
- 可编辑区域为 16px，因此 iOS 在聚焦时不再缩放
- 应用按*可见*区域调整尺寸，因此 composer 会停留在屏幕键盘上方（`visualViewport`）
- 为全屏/PWA 模式提供安全区域内边距，并增加主屏幕图标/manifest 路由
- 固定入口 URL（`/m`）会解析到当前 token——DSH 重启并轮换 token 后，主屏幕快捷方式仍可工作
- 长代码块和表格横向滚动，而不是溢出页面

## 要求

- DSH Web 正在运行，并可通过 HTTP origin 访问（默认 `http://127.0.0.1:3080`）
- 同一主机上的 Node.js 20 或更新版本（不需要 npm 包）
- 较新的手机浏览器；断点由你自己设置。本层只在一类设备上验证过（见文末限制）
- 可选：私有网络隧道（示例使用 Tailscale），让手机无需向互联网开放端口即可访问主机

## 安装

1. 将 `scripts/` 复制到运行 DSH 的主机，例如 `~/dsh-phone`。

2. 运行它（将 token 日志路径替换为 DSH 打印其 URL 的文件）：

   ```sh
   PORT=8450 \
   UPSTREAM=http://127.0.0.1:3080 \
   TOKEN_LOG="$HOME/.dsh/dsh-launchd.log" \
   node ~/dsh-phone/server.mjs
   ```

   `TRUSTED_HOST` 是可选参数，通常不需要。只有当你用 `--trusted-host <host:port>`
   启动 DSH 时，才在这里传入相同的值（例如
   `TRUSTED_HOST=myhost.example.ts.net:8446`）：网关会把 `Host`/`Origin` 呈现为该值，
   因此通过第二个端口到达的请求能通过 DSH 的 origin 检查。不设置时，头部原样转发。

3. 在本地检查：

   ```sh
   curl -s http://127.0.0.1:8450/__dshm/status
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8450/m   # expect 302
   ```

4. 让它持续运行。`deploy/com.example.dsh-phone.plist`（macOS launchd）和 `deploy/dsh-phone.service`（Linux systemd）是模板——填写路径和端口，然后按注释中的说明加载它们。

5. 以私有方式将其暴露给你的手机。使用 Tailscale：

   ```sh
   tailscale serve --bg --https=8450 http://127.0.0.1:8450
   ```

   **如果你的 tailnet ACL 显式列出了允许的端口，也要在那里加入新端口。** 未列出的端口会被静默丢弃——手机显示“无法连接”，而本地一切正常。这是设置看起来坏掉的最常见原因。

6. 在手机上打开 `https://<your-host>:8450/m`，然后使用浏览器的“添加到主屏幕”。`/m` 入口能在 token 轮换后继续存在；硬编码 token 的 URL 则不能。

   可选：将你自己的 `apple-touch-icon-180.png`、`icon-192.png` 和 `icon-512.png` 放入 `scripts/icons/`（只有这些文件存在时才会注入图标与 manifest 链接）。不要将 DSH 标志用作你自己的应用图标——它属于 DeepSeek；请使用你自己的图片，或者不使用图标。

## 针对你的手机调整

断点是一个值，出现在两处（`mobile.js` 中的 `MAX_W`，`mobile.css` 中的 `@media (max-width: 520px)` 块），两处要一起改。520px 是为了高于 Pro Max 级别设备的 440px 视口而选的。判定只看宽度：把桌面窗口缩到 520px 以下，同样会生效。

要测量你自己的设备：在手机上打开页面，把下面这行存成书签，从书签列表运行，或在浏览器的远程检查器中运行——

```js
javascript:prompt('', innerWidth + 'x' + innerHeight)
```

将 `MAX_W` 设置得略高于你的宽度（这样方向/横屏仍能匹配你的意图），并保持两个文件同步。在新设备上值得检查的事项：

- 键盘打开时 composer 是否保持可见（需要 `visualViewport`）
- 侧边栏和遮罩的尺寸是否正确（`min(320px, 86vw)`）
- 全屏模式下、两个方向上的安全区域内边距是否看起来正确
- 点击目标是否适合拇指操作，或者 40px 的下限是否应更大

## 它不做什么

- 它不添加身份验证。它依赖 DSH 自己的 token/cookie；请将该端口保持在私有网络/隧道之后。不要将其暴露到互联网。
- 它不改变宽窗口的布局：每条规则都位于由 `html.dshm` 控制的宽度查询内，而脚本只会在低于断点时添加该类。
- 它不是 DSH 的 fork。选择器有意使用 DSH 的 `data-slot` 属性名（CSS module 类名会按构建哈希化），但 DSH 更新仍可能重命名 slot 并破坏皮肤。发生这种情况时，在实时页面上运行 `document.querySelectorAll('[data-slot]')` 是重建选择器列表的最快方法。
- 它是在一台主机和一类手机上编写并检查的。尤其是键盘处理取决于设备——请在你自己的手机上验证。

## 故障排查

- **手机无法连接，主机本地正常。** 端口未被 ACL/防火墙允许，或手机不在私有网络上。检查网关日志中是否有带手机 user-agent 的 `hit` 行。
- **`/m` 返回 503。** 网关无法在 `TOKEN_LOG` 中找到 token。将其指向 DSH 写入启动 URL 的文件。
- **页面加载但皮肤没有生效。** 未添加 `html.dshm`：视口宽于 `MAX_W`，或脚本被阻止。检查 `innerWidth` 和控制台。
- **右侧头部图标看起来被裁切。** 有东西在裁剪该行。在默认布局中，为菜单按钮腾出空间的左内边距会将图标推到该行之外——不要给它添加 `overflow: hidden`。
- **侧边栏打开，但后面的页面没有变暗。** 遮罩被插入到 `document.body`；阻止内联样式的严格 CSP 会将其丢弃。

## 卸载

```sh
launchctl bootout gui/$(id -u)/com.example.dsh-phone   # or: systemctl --user disable --now dsh-phone
tailscale serve --https=8450 off
rm -rf ~/dsh-phone
```

没有向 DSH 写入任何内容，因此那里没有需要还原的东西。

## 致谢

- DSH（DeepSeek Harness）由 DeepSeek 开发——按原样使用，未修改，不涉及模型权重。`data-slot` 名称以及 token/URL 行为是本层所依赖的基础。
- 贡献者：**tenhkspark**（设计与实现）、**DeepSeek V4.1 Flash 1017**（审查与翻译校对，
  均在本地运行）。

MIT 许可——参见 [LICENSE](LICENSE)。