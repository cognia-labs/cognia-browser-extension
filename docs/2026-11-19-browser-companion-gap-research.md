# Cognia Browser Companion 缺口与行业对标

调研日期为 2026-11-19，代码基线为 `70450c5`（0.1.7）。覆盖独立模式和连接 Cognia 后的网页采集、页面检查、证据交付、录制、请求规则及代理控制。同行能力通过官方文档核对。

Cognia 已经具备网页上下文采集、选取和实时修改、诊断、录制、Host 投递及代理接管。最值得补齐的是**让证据始终对应正确页面，让共享有明确授权，让录制生成的测试可验证**。这三项直接影响用户能否相信结果，也是本次在 Chromium 中观察到具体问题的环节。

| 顺序   | 改进                                                                    | 预期结果                                   |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| 1 · P1 | 01 页面与报告绑定、02 录制默认私有                                      | 避免错配页面证据，保障用户对录制的分享决定 |
| 2 · P1 | 03 录制审查与脚本验证、04 首次采集授权、05 离线证据包                   | 从一次操作得到可复核、可交付的结果         |
| 3 · P2 | 06 代理可见性、07 审计可信度、08 请求规则预检、09 设计复测、10 原生验收 | 让日常调试可解释，提高发布覆盖             |

P1 优先排入近期迭代。P2 可按实际使用场景推进。每项注明浏览器观察、源码依据或验收范围。

## 行业对标

| 场景               | 同行做法                                                                                                                                                                                             | Cognia 可以吸收的设计                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次使用与站点授权 | Chrome 将操作图标、快捷键和右键菜单视为用户主动触发的入口，`activeTab` 为当前标签页提供临时访问。Chrome Web Store 要求权限尽量收窄，可选权限也在该要求内，仅本地处理的数据同样需要披露。             | 采集入口优先呈现当前标签页的临时访问与站点授权，把全站授权留给明确需要长期跨站工作的用户。在界面上解释本地处理、发送到 Host 和代理访问的区别。 [Chrome 侧边栏](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) · [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) · [Chrome Web Store 隐私与权限 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)                                              |
| 网页采集与离线交付 | Obsidian Web Clipper 支持网页模板、结构化属性、持久高亮和本地 Markdown。Readwise Reader 支持在原网页选中文本或图像做高亮，再为高亮添加笔记。Jam 将浏览器信息、诊断和关键时间点集中在同一个问题记录。 | 聚焦可审查、可离线复用的任务证据，将截图、标注说明和诊断随 Markdown 归档。将网页出处、范围、截断状态和采集时间写入证据，便于接手者复核。 [Obsidian 采集](https://obsidian.md/help/web-clipper/capture) · [模板](https://obsidian.md/help/web-clipper/templates) · [Readwise 高亮与笔记](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes) · [Jam 复现信息](https://jam.dev/blog/6-new-features-for-even-faster-bug-repros/)                                              |
| 页面检查与无障碍   | VisBug 提供浮层工具和统一快捷键表。axe DevTools 将自动扫描、交互式检查和剩余人工检查串成工作流。W3C 的 24 CSS px 规则还包含间距、等效目标和浏览器控件等例外。                                        | 让用户从定位直接走到复测，给检查结果注明规则、覆盖范围、已知例外和人工确认项。把现有选取、测量和审计做成按任务可发现的入口。 [VisBug 快捷键](https://github.com/GoogleChromeLabs/ProjectVisBug/wiki/Keyboard-Master-List) · [Deque 剩余人工测试](https://docs.deque.com/devtools-for-web/4/en/devtools-whatslefttotest/) · [W3C 目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)                                                                              |
| 测试录制           | Chrome DevTools Recorder 支持逐步查看与编辑、显示候选选择器及其顺序，另有 JSON 导入导出。Playwright Codegen 支持在 Inspector 中高亮和编辑 locator、生成断言。                                        | 先让录制者检查和修改步骤、核对定位器和断言，再决定是否导出或分享。用本地测试夹具实际执行导出脚本验证可用性。 [Chrome DevTools Recorder](https://developer.chrome.com/docs/devtools/recorder/reference) · [Playwright Codegen](https://playwright.dev/docs/codegen)                                                                                                                                                                                                                      |
| 请求模拟           | Requestly 提供规则测试与命中验证。Chrome DNR 的 `testMatchOutcome()` 仅供未打包开发扩展使用。                                                                                                        | 发布版提供可解释的本地规则预检，并展示已同步、缺授权、不可用和已观察到命中等状态。浏览器内核是否实际匹配由平台结果或受控验收用例确认。 [Requestly 规则测试](https://interceptor-docs.requestly.com/http-rules/advanced-usage/test-rules) · [Requestly 命中验证](https://interceptor-docs.requestly.com/http-rules/advanced-usage/validate-rules-execution) · [Chrome DNR API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#method-testMatchOutcome) |
| 代理透明度         | Claude in Chrome 的官方文档将站点访问与部分敏感动作的人工确认分开，并在授权前说明计划和作用范围。                                                                                                    | 在面板上集中显示由哪个会话控制当前标签页、访问哪个 origin、为什么等待、授权持续到何时，以及停止、接管和恢复的结果。需要 Host 协同的控制改动单独做协议和端到端验收。 [Claude in Chrome 权限](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide)                                                                                                                                                                                                         |

## 对标发现与可验收改进

### 01 · P1 · 让报告绑定到实际采集的页面

**Chromium 已复现。** 在同一标签页对 A 运行 SEO 检查，导航至 B 并重新采集，导出的 Markdown 标题和 URL 是 B，SEO 仍携带 A 的描述。选取和测量在重新采集时同时核对 tab ID 与 URL，审计结果、调试报告和文字改动主要按 tab ID 保留。发送前组装也按 tab ID 选报告，因此同一归属问题适用于该调用链，Host 实际接收本次未单独复测。 [采集时清理](../src/components/side-panel.tsx#L870) · [审计归属](../src/lib/inspect/insights.ts#L47) · [导出与发送通用报告组装](../src/components/side-panel.tsx#L4502)

使用现有注入 API 返回的 `documentId` 关联采集、检查和附件，再为同一文档内的 SPA 路由变化定义更新策略。保留旧快照时标出来源和时间，要求复跑或显式加入历史证据后才能同新页面一起输出。异步结果完成时核对发起时的文档，避免旧检查覆盖新页面。验收覆盖跨路由、同 URL 刷新、切换标签页、检查期间导航，分别检查复制、导出和发送中的来源与正文。 [Chrome InjectionResult](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-InjectionResult)

### 02 · P1 · 手动录制默认私有，审查后按意图分享

**Chromium 已确认默认值和导出内容。** 在独立模式新建手动录制时，分享开关立即为开，测试输入的普通文本进入导出的 Playwright。界面说明使用的是「你共享的录制」。源码显示 `recording-v1` 路径按 `shared` 过滤列表和详情，手动录制的初值为 `true`，读取路径允许已共享的活动录制。实际 Agent 读取需已连接并具备运行时能力，本次复现使用独立模式。 [录制起始状态](../src/lib/recordings/controller.ts#L165) · [共享读取](../src/lib/recordings/controller.ts#L280) · [录制说明](../public/_locales/en/messages.json#L2623)

手动录制默认私有，停止后预览步骤、普通字段、URL 查询串和断言，再明确分享给当前会话或明确授权的范围。为既有录制定义迁移策略，能证明有用户选择的共享按原意处理。敏感字段继续用参数替代，让普通值也可改为参数。验收用已连接的 `recording-v1` 会话验证新录制在授权前不可列出或读取，授权后只在选定范围可读，撤销后立即生效。

### 03 · P1 · 录制生成可核对和可执行的测试

**Chromium 已复现导出行为。** 录制从 A 开始，在同一个标签页直接导航到 B，再执行 B 上的操作。生成脚本只有 `goto(A)`，随后用 `toHaveURL(B)` 表示这次导航，缺少能触发它的动作。当前模型把首次之后不同 URL 的导航都转为断言，这适合由上一步触发且能够归因的跳转。 [导航步骤折叠](../src/lib/recordings/model.ts#L235)

**慢页面在加载完成前的点击会漏录。** 在等待采集完成后开启录制，进入含慢速图片的页面并在 `load` 前按下按钮。录制开始后立即导航的 4 次检查均缺步骤，等待停止按钮可用再导航的 4 次中有 2 次缺步骤。开始流程先公布活动状态，再注入和注册脚本。后续文档上的 `document_start` 脚本仍要向 worker 异步确认后才开始监听。两处都是应验证的时间窗口。 [录制开始](../src/lib/recordings/controller.ts#L196) · [新文档初始化](../src/app/test-recorder.ts#L26) · [既有慢页面用例](../tests/e2e/recordings.spec.ts#L104)

先让面板的录制状态与实际就绪一致，并在导航后无法覆盖的时间段给出提示。再增加步骤详情、定位器选择和断言编辑，区分由点击触发的跳转、直接导航和需要用户确认原因的跳转。模型存候选定位器，生成脚本使用第一项。用受控本地页实际执行导出的 spec，覆盖加载期间点击、直接导航、点击导航、定位器重复和参数化字段。 [录制列表](../src/components/recordings.tsx#L154) · [生成器的定位器选择](../src/lib/recordings/model.ts#L263)

### 04 · P1 · 让第一次采集走最小权限路径

**Chromium 已观察首次路径。** 初始界面的一级标题是「连接 Cognia」，独立模式是并列入口之一。进入独立模式后，「发送」是默认标签，采集卡直接展示「允许所有网站」，按站点授权在失败恢复里出现。可以让初始页用同等清楚的动作说明「本地采集」和「连接后发送或使用代理」，默认标签随模式显示相应名称。在当前站点无权访问时优先提示工具栏、右键和已配置快捷键的临时访问，再提供按站授权，将全站授权移到站点权限管理。 [初始配对页](../src/components/pair-screen.tsx#L102) · [采集卡](../src/components/side-panel.tsx#L3788) · [全站授权](../src/components/site-access.tsx#L40) · [浏览器入口](../src/app/background/index.ts#L111)

成功条件是新安装用户在普通网页上用主动入口完成一次采集，无需批准全站访问。用真实 Chrome/Edge profile 验收工具栏、右键菜单、快捷键与地址栏，以及权限拒绝、受保护页面、切换标签页后的恢复。地址栏和快捷键的回退目前在异步查询标签页后请求打开侧栏，需验证真实用户触发链。 [用户激活约束](https://developer.chrome.com/docs/extensions/reference/api/sidePanel#programmatically_open_the_side_panel_on_user_interaction) · [快捷键与地址栏处理](../src/app/background/index.ts#L178)

### 05 · P1 · 交付可以独立打开的证据

独立模式可编辑采集、复制提示词或导出 Markdown。当前 Markdown 只列附件名，会话草稿有 24 小时上限，并且只记附件数量。优先保留 Markdown 快速导出，再加一个显式选择附件的离线证据包，包含带相对引用的 Markdown、已选截图与差异图、采集时间和视口、检查报告，以及可选录制。导出预览显示会打包的内容和大小，用户可移除或遮挡敏感项。成功条件是解压后离线可查阅，选中的文件齐全，未选文件及未审阅原始内容不会进入导出。 [Markdown 导出](../src/lib/inspect/inspect-markdown.ts#L259) · [草稿保存边界](../src/lib/panel/drafts.ts#L1) · [Jam 的自动遮挡场景](https://jam.dev/blog/just-launched-get-customer-bug-videos-w-o-private-data/)

### 06 · P2 · 匹配实际授权状态，让代理可见、可接管

当前已有按 origin 审批、页面内 Stop/Take over/Resume 和运行时权限检查。设置里的站点权限、下载和 Cookie 开关在面板挂载时采样，普通采集的全站权限控件已监听 Chrome 权限变化及窗口焦点。统一刷新行为，顶部或活动会话处显示可操作的状态。站点请求已经展示 origin 对应的主机和操作名称，可补请求来源会话与「仅本会话」的具体含义。成功条件是在 Chrome 扩展页变更权限后，已打开的面板同步变化，审批的来源、范围和接管结果可从侧栏读出。 [代理设置](../src/components/agent-settings.tsx#L78) · [授权变化监听](../src/components/site-access.tsx#L16) · [站点请求](../src/components/site-questions.tsx#L75) · [原有状态约束](../SECURITY.md#L9)

### 07 · P2 · 审计结果支持人工复核

**尺寸问题在 Chromium 已复现。** 页面上唯一的 16×16 CSS px 按钮也被列为目标尺寸问题。W3C 对与其他目标保持足够间距的控件单列例外。应将启发式结果明确标为「需复核」，补间距例外、覆盖范围和复测清单。验收用充分间距与密集小控件进行对照，并在零发现时说明覆盖与人工检查项。 [尺寸检查](../src/lib/inspect/a11y-audit.ts#L236) · [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

性能指标还有一个口径差异。当前面板将已观察到的最慢交互标为近似 INP，长任务则累计当前缓冲区中的阻塞量并标为 TBT。可以把后者标为「本次访问观察到的长任务阻塞时间」，或实现明确定义的统计窗口后再使用 TBT 名称。验收显示采样不可用、单次快照和统计窗口。 [本地性能快照](../src/lib/inspect/page-performance.ts#L127) · [Google INP 定义](https://web.dev/articles/inp) · [Google TBT 定义](https://web.dev/articles/tbt)

### 08 · P2 · 让请求规则的生效范围与验证结果可见

现有临时模拟有命中记录，持久规则面板有权限与同步状态汇总。把本页临时规则、持久站点规则与会话规则各自的范围和生命周期展示在规则行，把未匹配原因、缺少的授权或不支持的特性落到具体规则。预检从用户提供的示例 URL/请求类型解释匹配，使用已授权的项目测试站点验收实际生效。成功条件是相同规则在同路径不同 origin、干预开关和撤权等场景中，预检、面板状态和测试结果一致。 [持久规则面板](../src/components/network-rules.tsx#L689) · [临时模拟面板](../src/components/request-mocks.tsx) · [Chrome 开发验证 API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#method-testMatchOutcome)

### 09 · P2 · 建立可重复的设计验收

已有设计稿叠加、可见区域像素比较和几种视口尺寸，下一步保存每次比对的参考图、对齐参数、视口、缩放和浏览器环境，支持为变化内容标注忽略区，再把差异区域写入证据。明确视口尺寸预设的覆盖范围。Chrome DevTools Device Mode 还可以近似触控、DPR 等特征，并将真机验证保留为单独环节。成功条件是同一参考图与视口可再次得到可比的差异结果，接手者能复现分析时的环境。 [叠加参数](../src/lib/inspect/design-overlay.ts#L21) · [像素差异](../src/lib/inspect/design-diff.ts#L282) · [Chrome Device Mode](https://developer.chrome.com/docs/devtools/device-mode)

### 10 · P2 · 增加原生浏览器与真实 Host 的验收

现有 Playwright 流程加载真实 MV3 worker、面板与注入代码，Host 为 HTTP/WebSocket 夹具，流程测试变体仅把回环地址预授予。发布前可维护一张小型 Chrome/Edge 实机验收表，覆盖工具栏与快捷键触发、原生同意和拒绝、浏览器撤权、商店签名升级后扩展 ID 和配对连续性，以及真实 Host 连接、发送、暂停和恢复。验收使用独立配置和测试数据，记录浏览器版本、扩展包 hash 与 Host 版本。 [项目验证边界](../README.zh-CN.md#L61) · [测试变体](../tests/e2e/extension-profile.ts#L1)

## 本次验证

- 使用 Node 26、pnpm 11.25.0 和 Playwright 随附的 Chromium 156。用 agent-browser 将实际扩展面板作为标签页打开，检查初始界面、独立模式和工具入口。
- 用隔离配置和合成网页运行三条专项检查，确认 01、02、03 的导出行为及 07 的尺寸结果。另对 03 的慢页面录制做八次专项检查，其中六次缺步骤。
- 仓库 Playwright 全量基线一轮 78/78 通过。通过正式打包入口重跑时，录制未加载完成页用例因缺步骤失败，其余 77 项通过。压缩包 24 个文件的一致性校验通过。
- 将既有慢页面用例单独重复八次，三次通过、两次缺步骤、三次在打开录制入口阶段超时。测试发出采集请求后立即切工具页，面板处理采集结束会异步切回发送页。慢页面专项检查先等采集完成，避开了此测试时序干扰。 [原用例](../tests/e2e/recordings.spec.ts#L104) · [采集后切换面板](../src/components/side-panel.tsx#L1045)
- 本轮研究的桌面浏览器范围为 Chromium。原生授权弹窗、真实 Cognia Host、Edge 和商店升级仍属于第 10 项的验收范围。

## 源码续查（2026-11-19）

沿用 `70450c5` 基线。续查从面板、MV3 worker 和 Host client 的实际调用路径入手，新增 **14 项**。最先处理 11–14，分别涉及草稿留存、异步数据丢失、完整网址授权和重试幂等。随后修复采集与审核的内容一致性，以及停止录制、撤除规则的收尾行为。

| 范围                       | 编号  | 专项验证                                                 |
| -------------------------- | ----- | -------------------------------------------------------- |
| 发送、重试与数据范围       | 11–15 | 实际扩展面板及 React Testing Library                     |
| 采集、录制、请求规则、截图 | 16–22 | 实际扩展面板、React Testing Library 或 Chromium 原生滚动 |
| 旧任务状态与停止           | 23–24 | 生产 worker 与分页 Host 夹具                             |

### 11 · P1 · 失败重试记录在本地持久保存明文

**Chromium 扩展复现。** 向夹具 Host 发送时模拟网络失败，`chrome.storage.local` 的 `cognia.pending.v1` 中留有合成指令。清除采集并重载面板后仍能读到它。所谓 `fingerprint` 实际是 JSON 字符串，包含原指令、目标参数、采集标题和 URL；若选了完整网址，也可能带查询串。既有磁盘数据测试覆盖成功路径，成功回执会删除这条记录。 [指纹构造及写入](../src/components/side-panel.tsx#L1509) · [清除采集](../src/components/side-panel.tsx#L3343) · [成功路径测试](../tests/e2e/capture-and-submit.spec.ts#L263)

将可恢复的请求身份与用户内容拆开。续传元数据记录请求摘要和必要状态，定义废弃草稿、断开和过期后的清理，迁移时清除旧明文格式。验收覆盖网络失败、清除、面板重载和正常成功，检查 `storage.local` 只留允许持久化的数据。

### 12 · P1 · 旧提交成功会清空后来编辑的新草稿

**Chromium 扩展复现。** 暂停 A 的发送请求，其间采集 B、填写新指令，再让 A 完成。Host 夹具只收到 A，面板却清掉 B 和新指令。成功回调按当前面板状态清空正文、附件、检查结果和草稿，确认对象没有绑定到提交时的草稿版本。 [发送快照](../src/components/side-panel.tsx#L1467) · [成功后的清理](../src/components/side-panel.tsx#L1584)

为草稿和发送快照保留各自身份。A 的回执只结算 A 对应的内容，新草稿或后来修改的版本继续保留。验收延迟 A 的回执，在 B 中再添加附件和文字，确认 A 正常进入任务列表，B 可继续编辑及发送。

### 13 · P1 · 新采集继承了上一页的完整网址选择

**RTL 复现。** 在 A 勾选完整网址，清除后采集 B，B 的合成查询串和片段直接出现在发送请求里，而且 B 的选项消失。`includeFullUrl` 属于面板状态，清除和重新采集没有重置。采集时还以当前选择计算 `strippedQuery`，预览再据此决定是否显示可以反向取消的开关。 [采集规范化](../src/components/side-panel.tsx#L768) · [预览开关](../src/components/capture-preview.tsx#L83) · [清除采集](../src/components/side-panel.tsx#L3343)

把完整网址选择限制在对应采集项，每次采集默认净化地址。是否显示开关由原始地址与净化版本的差异决定。验收在 A 开启、清除后采集 B，并检查主页面和额外页面各自可见、可撤销的选择，及实际发送 URL。

### 14 · P1 · 等长内容修改会错误复用提交 ID

**RTL 复现。** 模拟响应丢失，将 `Alpha` 改成等字节长度的 `Bravo`，两次实际提交载荷不同，`submissionId` 相同。普通提交在 client 中把该 ID 用作默认 `Idempotency-Key`。当前比较以正文总字节数、附件 ID 和长度作为内容的近似，等长正文编辑已确认冲突。对真实 Host 的回执重放或冲突行为仍需联测。 [提交身份计算](../src/components/side-panel.tsx#L1502) · [默认幂等 key](../src/lib/client.ts#L294)

基于实际发送载荷和附件内容摘要区分原请求重试与修改后新请求。验收覆盖等长正文编辑、等长检查结果变化，以及原 ID 下替换同长度附件。相同请求重试复用原身份，内容变化后生成新身份。

### 15 · P1 · 正文模式的发送内容多于用户能审阅的内容

**RTL 复现正文模式。** 编辑器与剪贴板只显示当前正文，Host 夹具收到 `article` 之外还带此前页面选区的 Markdown。`buildPageContext` 对所有非 `metadata` 模式保留选区，因此整页模式也存在相同的组装条件。 [编辑器文本](../src/lib/panel/page-context.ts#L118) · [发送组装](../src/lib/panel/page-context.ts#L172) · [剪贴板正文](../src/lib/inspect/inspect-markdown.ts#L194)

约定正文、整页和选区各自包含的数据，额外选区如确有需要，应可见且可去除。验收在正文范围外选中合成文本，比较预览、导出与发送内容，确保每一类额外文本都有明确来源与选择。

### 16 · P1 · 较慢的旧采集可以覆盖新采集

**RTL 复现。** 发起 A 后让提取延迟，再发起 B 并先展示 B。A 完成后，标题、地址和正文被 A 覆盖。`runCapture` 在读标签页和提取后直接提交结果，缺少请求版本核对。 [采集入口与提交](../src/components/side-panel.tsx#L838)

让新采集、清除、切模式或工作窗口结束使旧请求失效。提交结果、错误或权限提示前检查相同的请求身份。验收控制 A、B 的完成顺序，并检查旧失败也无法覆盖 B 的提示。

### 17 · P1 · 删掉 Agent 规则后，当前页面仍使用旧模拟

**Chromium 扩展复现。** 在受控页面为 Agent 加入一条返回模拟响应的规则，从面板删除最后一条。规则列表即刻消失，当前文档继续返回模拟结果，刷新后才请求真实夹具响应。面板删除只改存储并同步规则，缺少对已载入文档的重装。进一步从源码看，接管时若规则集合已经为空，清理也会提前返回。 [面板删除](../src/components/network-rules.tsx#L723) · [worker 同步与刷新页面](../src/lib/network-rules/controller.ts#L148) · [接管清理](../src/lib/agent/agent-runtime.ts#L140)

将 Agent 规则撤除应用到已加载的会话文档，并在完成前明确显示待生效。验收删除最后一条后立即重试同一请求，再覆盖删除后接管、会话释放、页面已关闭和顶层跳转。

### 18 · P1 · 从侧栏停止录制会丢掉最后一笔输入

**Chromium 扩展复现。** 输入合成文本后立即从实际扩展面板调用停止命令，录制成功结束且徽标移除，最终只保留起始导航。输入有 600 ms 合并窗口。worker 先清除活动映射，再要求页面停止，页面此时冲刷的尾步骤已找不到录制。页内停止按钮有自己的先冲刷路径。 [输入合并](../src/lib/recordings/recorder.ts#L91) · [页面停止时冲刷](../src/lib/recordings/recorder.ts#L316) · [worker 结束顺序](../src/lib/recordings/controller.ts#L144)

设计明确的停止收尾协议，在有界时间内接收当前文档的尾步骤，之后再封存并撤销注册。验收覆盖侧栏停止、页内停止、导航离开、标签页关闭和重复停止。

### 19 · P1 · 标注尚未提交时仍可发送原始截图

**RTL 复现。** 在截图标注里添加编号和备注，发送按钮仍可用。触发发送时，上传的是原图，标注说明也未进入载荷。`canSubmit` 检查截图采集与裁剪状态，未检查标注会话及合成过程。 [标注提交](../src/components/side-panel.tsx#L1935) · [发送条件](../src/components/side-panel.tsx#L3334)

发送前要求应用或明确放弃当前改动，正在生成标注图时保持发送禁用。验收覆盖点按和键盘快捷键，并核对最终上传文件与标注说明一致。

### 20 · P2 · 超限截图直到发送才报错

**RTL 复现可见区域截图。** 合成截图超过 Host 协商限制时仍显示为已附加，发送时在首次上传前报错。区域截图完成后也直接入队。整页截图和标注成品已有加入附件前的大小校验。 [可见截图入队](../src/components/side-panel.tsx#L1877) · [区域截图入队](../src/components/side-panel.tsx#L1904) · [上传大小校验](../src/lib/attachment-upload.ts#L67)

所有附件入口使用统一的类型、大小、数量检查，在准备阶段给出调整或移除的选项。验收逐项检查不同附件入口并覆盖 Host 的不同上限。

### 21 · P2 · 格式化选区被截断时可能标记为完整

**RTL 复现。** 用 6 字节上限采集纯文本 `plain` 与 Markdown `**plain**`，Markdown 被截为 `**plai`，但预览无提示，发送的 `truncated` 为 `false`。采集和附加检查报告两条路径都只保留纯文本的裁剪标记。 [采集时裁剪](../src/lib/panel/page-context.ts#L46) · [检查内容合并](../src/lib/inspect/inspect-markdown.ts#L308)

根据实际展示及发送的内容形式分别保留截断标记。验收纯文本能保留而 Markdown 超限、检查报告超限、多字节边界和格式闭合。

### 22 · P2 · 整页截图滚动恢复与拼接可能失准

**Chromium 滚动与分段实测。** 直接调用产品的滚动函数，起始 `(300, 120)` 恢复为 `(0, 120)`。另将产品的整页截图逻辑接到启用平滑滚动的 1,000 CSS px 合成页和 400 px 视口，三个截屏时刻的位置为 `[0, 400, 600]`，交给拼接器的有效行却是 `[400, 0, 0]`，返回高度 `400` 且 `truncated: false`。测试记录拼接输入，实际 Chrome 截屏像素与 PNG 成品仍需核验。 [滚动辅助函数](../src/lib/agent/page-functions.ts#L157) · [整页分段和恢复](../src/lib/panel/screenshots.ts#L123)

记录并恢复 X/Y 坐标，滚动稳定后以实际采集时的位置计算有效行。验收使用可识别的分段图案，覆盖平滑滚动、横向偏移、最后一屏重叠和截屏失败后的恢复。

### 23 · P2 · 第 51 条活跃任务会从后台追踪消失

**生产 worker 加分页 Host 夹具复现。** 先观察到运行任务，随后让它落到第二页、第一页改为 50 个已完成任务。worker 清空角标、从状态快照移除它，并撤销后台轮询。状态检查只读最近 50 条。 [后台单页读取](../src/lib/background/worker.ts#L209) · [轮询条件](../src/lib/background/worker.ts#L267)

为已知的非终态任务按 ID 追踪至结束，或通过 Host 显式获取活跃任务。验收覆盖任务在后台被挤出最近页、之后完成及工作进程重新启动。

### 24 · P2 · 页内停止只在最近 100 条记录中查找 Host 任务

**生产 worker 加分页 Host 夹具复现。** 将关联的运行任务放在第三页。停止返回成功、浏览器会话进入接管，但 worker 没有请求第三页，也没有调用 Host 取消。另有 Host 不可达时吞掉取消错误的路径。 [Host 取消查找](../src/lib/background/worker.ts#L303) · [停止反馈](../src/lib/agent/agent-runtime.ts#L242)

使用会话与运行任务的明确映射，分别呈现「已暂停浏览器」和「Host 已确认停止」。验收覆盖第三页的任务、已终态的任务、网络错误及重连后的状态核对。

### 续查验证范围

- 在本地 Chromium 运行四条扩展专项用例，确认 11、12、17、18。请求模拟及提交均对本地合成页面和夹具 Host 执行。
- 八条临时 RTL 用例确认 12、13、14、15、16、19、20、21。另在 Chromium 中调用产品滚动函数和整页截图逻辑，用夹具收集分段参数，确认 22 的滚动与分段问题。
- 两条 Jest 用例通过真实 worker 代码和分页夹具确认 23、24。真实 Host 的幂等回执、取消确认与完整队列仍需联测。
- 复跑侧栏、采集预览、页面上下文、后台 worker、录制和请求规则的现有 Jest 测试，7 个套件共 182 项通过。
