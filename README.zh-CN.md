# Cognia Browser Companion

[English](README.md) · [Cognia 主仓库](https://github.com/MaxQian888/cognia-next) · [官网仓库](https://github.com/cognia-labs/cognia-website)

面向 Chrome 和 Edge 的侧边栏插件：把正在阅读的页面发送给 Cognia，也可按需允许 Cognia 代理操作浏览器。本仓库独立维护完整插件、测试和发布压缩包。

## 安装与升级

从 [Releases](https://github.com/cognia-labs/cognia-browser-extension/releases) 下载 Chrome 压缩包并解压，在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，选中包含 `manifest.json` 的目录。需要 Chrome 116 或以上。仓库发布不会自动提交到插件商店。

在 Cognia 中启用 Browser Access 并创建 Browser Companion 配对码；打开插件侧边栏，粘贴配对码并同意可选的本机回环地址权限。配对协议、设备密钥、来源绑定和浏览器存储标识保持兼容。

升级已解压插件时，保留原目录并点击“重新加载”。目录变化会改变 Chrome 派生的插件 ID，需要重新配对。商店版更新必须保留原有签名和商店身份。

## 功能

- 捕获页面、正文或选区，生成可编辑 Markdown，保留元数据和支持的字幕。
- 添加截图、区域裁剪和其他页面；选择 Host 的投递目标并跟踪状态。
- 使用保存的指令和快捷操作，支持中英文界面与 Host 外观同步。
- 按需启用代理模式，逐站决定授权，使用实际注入的 overlay 检查页面并操作标签页。
- 立即停止或接管，明确恢复后才继续；撤权、断连、禁用和超时会取消待执行工作。

安装时不授予全站页面访问权限。页面访问、代理模式、通知、下载和 Cookie 权限由对应功能按需申请。没有静态内容脚本、debugger、原生消息或无痕窗口权限。详见 [安全与隐私](SECURITY.md)。

## 开发与验证

使用 `.nvmrc` 的 Node 版本及 `package.json` 固定的 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm format:check
pnpm exec playwright install chromium
pnpm test:e2e
```

正式构建输出到 `build/chrome-mv3/`，压缩包位于 `build/`，开发构建位于 `build/chrome-mv3-dev/`。CI 验证独立安装、格式、lint、类型、全部单测、真实 Chromium 流程和压缩包内容。`pnpm test:e2e` 先打包，再测试该构建，最后逐文件确认压缩包仍是同一份字节。安装包包含项目与依赖的许可证说明和精确源码版本。

E2E 使用实际 MV3 worker、面板、Chrome API 和 overlay，对接确定性的 HTTP/WebSocket Host。流程测试仅预授予回环地址权限，因为原生权限弹窗无法自动操作；另有测试加载实际发布 manifest，校验可选权限边界。原生权限弹窗、商店签名升级和打包 Cognia Host 联合验收仍需发布验证，不能由 mock Host 测试替代。

## 代码归属

`src/` 和 `public/` 是插件实现。`vendor/` 固定共享客户端、UI 和 overlay 的源代码快照及测试，消除对主仓目录和 npm 预发布的依赖。`provenance/source.json` 记录来源版本、导入时未提交状态和逐文件 SHA-256，包括本次撤权修复。

协议和 overlay 变更需要与 Host 协同。详见 [迁移与兼容说明](docs/migration.md)。日常安装、构建和测试不读取主仓库。

发布重试会解析精确 tag、恢复中断的草稿并保留已有附件字节。不同的安装包必须使用新版本，已发布附件不会被覆盖。

采用 AGPL-3.0-only，见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
