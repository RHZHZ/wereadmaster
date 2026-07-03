# AI 阅读助手 P4 阶段规划

## 背景

P3 已完成：

- 历史结构化输出持久化。
- 普通问答流式输出。
- 阅读记忆检索-lite。
- 构建产物页面级 QA。

P3 的剩余风险不是“还缺更多功能”，而是：

- 真实 Tauri 桌面端 AI Provider 流式响应尚未做端到端联调。
- 取消、失败、网络中断等异常路径需要用真实命令链路确认。
- 长历史、长回答、复杂推荐输出需要压力场景验证。

因此 P4 不应继续扩展 UI 或新增 AI 能力，而应作为“桌面端联调与稳定性验收”阶段。

## P4 核心目标

P4 的目标是确认 AI 阅读助手在真实桌面壳中稳定工作，并把 P3 已完成的能力从“代码与页面 mock 验收通过”推进到“真实命令链路可交付”。

优先目标：

1. 真实桌面端流式输出链路可验证。
2. 取消、失败、超时和 provider 异常不会污染历史。
3. 长数据场景下 UI 不重叠、不明显卡顿。
4. 阅读记忆与隐私边界在真实上下文中仍可解释、可关闭。

## P4 阶段原则

- 不新增大型 UI 形态。
- 不改 P3 已确定的信息架构。
- 不做全量向量库或全文问答。
- 不为了兼容单一 Provider 写死特殊逻辑。
- 不默认调用真实付费 API 做自动化测试。
- 优先使用本地 OpenAI-compatible mock server 验证协议与异常路径。
- 真实 Provider 只作为人工联调或显式配置后的手动验收项。

## 非目标

P4 暂不做：

- 不做新的推荐算法。
- 不做对话自动转正式 AI 资产。
- 不做远端同步对话历史。
- 不做多端账号体系。
- 不重构整个 `reading-api.ts`。
- 不拆分 AI 服务层，除非真实联调暴露出明确边界问题。
- 不把 AI 面板改成全屏工作台。

## 推荐执行顺序

### P4.0：桌面联调准备

目标：

- 明确用什么方式验证真实 Tauri 命令链路。
- 准备可重复的本地 mock provider。

建议：

- 新增一个本地 OpenAI-compatible mock server，只用于测试。
- mock server 支持：
  - 普通 JSON 完整响应。
  - SSE 分块响应。
  - 慢响应。
  - 中途断流。
  - 非 JSON 错误。
  - 429 / 500 错误。
- AI Provider 设置指向本地 mock server，避免真实 API 成本和不稳定性。

产出：

- 桌面联调步骤文档。
- 本地 mock provider 使用说明。
- 是否需要纳入自动化脚本的判断。

### P4.1：真实 Tauri 流式链路验收

目标：

- 验证 `ask_reading_assistant_stream` 在桌面端真实运行时可用。
- 验证 `reading-assistant-stream` 事件能稳定到达前端。

验收：

- 普通问答能看到增量文本。
- 最终回答以完整结构落库。
- 历史回放不出现半截流式文本。
- `usedContext` 展示阅读记忆来源数量。
- `suggestions` 能恢复为快捷追问。

边界：

- 新书推荐、候选书决策等结构化输出仍不做流式。
- 不把 mock provider 输出质量当作真实推荐质量。

实施状态：

- 已新增桌面端流式联调清单：`docs/ai-reading-assistant-p4-desktop-stream-qa.md`。
- 已启动本地 mock provider，并成功启动 Tauri dev 桌面应用。
- 已通过 WebView2 CDP 端口 `9222` 接入真实 Tauri WebView，并用 Playwright 自动完成正常流式问答和历史回放验证。
- 正常流式链路通过：`ask_reading_assistant_stream`、SSE 增量、`reading-assistant-stream` 前端展示、最终回答、快捷追问和历史回放均可用。
- 验证过程中发现并修复 used context 重复 React key warning。
- 取消生成通过：首帧前取消和收到部分 delta 后取消均不残留半截回答。
- 断流错误通过：`broken-stream` 展示可理解错误并恢复输入区。
- Provider 500 通过：展示 provider 错误并恢复输入区。
- 阅读记忆关闭边界通过：关闭后上下文和 used context 均不含 `readingMemory`。
- 非流式结构化推荐通过：推荐卡片可见，历史回放可恢复推荐卡片和快捷追问。
- P4.1 完成标准已满足；429 和非法 SSE 可作为补充回归。

### P4.2：取消与失败路径

目标：

- 真实命令链路下取消和失败不污染会话历史。

验收：

- 点击“取消生成”后 pending 消息移除。
- 后端取消后不写入半截助手消息。
- SSE 中途断流时前端展示可理解错误。
- Provider 返回非 JSON 时错误可读。
- 超时或网络错误后输入区恢复可用。
- 重试不会复用已取消的 stream id。

建议用例：

- 慢响应后立即取消。
- 已收到部分 delta 后取消。
- mock server 中途断开连接。
- mock server 返回 500。
- mock server 返回无法解析的 JSON。

实施状态：

- P4.1 已覆盖首帧前取消、收到部分 delta 后取消、mock server 中途断流和 Provider 500。
- P4.2 已补充真实桌面链路验证：
  - `rate-limit`：Provider 429 展示“AI Provider 返回 HTTP 429：mock provider rate limited”，输入区恢复，无控制台错误。
  - `invalid-sse-json`：非法 SSE 展示“AI 流式返回包含无法解析的事件。”，输入区恢复，无控制台错误。
  - 未监听端口网络错误：展示“AI Provider 无法连接...”，输入区恢复，无控制台错误。
- 验证期间发现并修复设置弹层层级问题：设置弹层打开时不再被 AI 阅读助手面板遮挡关闭按钮。
- P4.2 完成标准已满足；真实超时可作为后续补充场景，不阻塞本阶段。

### P4.3：长数据压力场景

目标：

- 验证 P3 UI 和数据结构在长历史、长回答、复杂推荐输出下仍可用。

建议场景：

- 50 个历史线程。
- 单线程 80 条消息。
- 单条回答接近前端上限。
- 10 条快捷追问输入，最终只展示限量结果。
- 8 本推荐书，标题和作者较长。
- 阅读记忆片段达到注入预算上限。

验收：

- 历史子视图可滚动，不挤压聊天主视图。
- 主聊天区不横向溢出。
- 推荐卡片不撑破面板。
- 移动端仍可发送、关闭、返回设置。
- 输入框和发送按钮不被长内容挤出视口。

实施状态：

- 已新增 mock provider 压力场景：
  - `long-stream`：长流式回答、10 条快捷追问。
  - `long-json`：8 本长标题/长理由推荐书、10 条快捷追问。
- 已通过真实 Tauri WebView 验证长流式回答：主页面和助手面板无横向溢出，消息区可滚动，快捷追问由后端限制为 3 条，used context 含阅读记忆。
- 已通过真实 Tauri WebView 验证长推荐卡片：8 本输入被限制展示为 5 本，长标题和长理由未撑破面板，快捷追问限制为 3 条。
- 已临时关闭保存对话历史，在当前 UI 内连续发送 40 轮短问答形成 80 条消息；消息区可滚动，输入区恢复可用，未写入本地历史。
- 当前真实历史为 16 个会话；未向本机数据库批量制造 50 个历史线程，避免污染用户历史。该场景保留为后续临时数据目录或专用测试库验证。

### P4.4：阅读记忆边界审计

目标：

- 确认真实上下文构造仍符合 P3.3 的隐私和可解释边界。

验收：

- `useReadingMemory=false` 时不注入 `readingMemory`。
- `allowRawBookNotes=false` 时不注入原始笔记片段。
- `usedContext` 中只展示来源类型和数量，不泄露本地文件路径。
- prompt 输入不包含微信读书 API Key、AI API Key。
- 阅读记忆来源可追溯到正式资产、统计复盘、选书决策或候选状态。

实施状态：

- 已通过单元测试确认：
  - `useReadingMemory=false` 时不注入 `readingMemory`，且 `usedContext` 不包含 `ReadingMemory`。
  - `usePersonalizedContext=false` 时不注入书籍、复盘等个性化上下文。
  - 默认 `allowRawBookNotes=false` 时不注入原始划线正文。
  - book detail `raw_json` 中的 `apiKey`、`databasePath`、密钥片段不会进入 prompt payload，也不会进入 `usedContext` 序列化结果。
  - 阅读记忆 `sourceRef` 可追溯到候选状态等正式来源。
- P4.1 桌面联调已补充验证阅读记忆关闭边界：关闭后上下文 chips 和 used context 均不含阅读记忆。
- P4.4 完成标准已满足。

### P4.5：真实 Provider 手动验收

目标：

- 在用户显式配置真实 Provider 后做小样本人工验收。

建议样本：

- 普通解释型问题。
- 结合阅读记忆制定阅读计划。
- 请求推荐 3 本新书。
- 对候选书架做取舍建议。
- 追问上一轮回答。

验收：

- 输出不把候选书架误当作唯一推荐来源。
- 新书推荐能先由 AI 生成，再由用户搜索确认加入候选。
- 结构化推荐输出能正常显示推荐卡片。
- 回答能说明依据，且不过度声称读取了未授权内容。

实施状态：

- 用户已显式配置并确认允许小样本真实 Provider 调用。
- 设置页显示已配置 AI Provider：
  - Provider：DeepSeek。
  - Base URL：`https://api.deepseek.com/v1`。
  - Model：`deepseek-v4-flash`。
  - 兼容模式：`jsonObjectFirst`。
  - 验证错误：无。
- 已通过真实 Tauri WebView/CDP 完成两条小样本验收：
  - 普通解释型问题：回答完成，输入区恢复，主页面和助手面板无横向溢出，无控制台错误。
  - 新书推荐：回答完成并渲染 3 张推荐卡片，输入区恢复，无控制台错误。
- Browser plugin 已列出但本会话未暴露 JS 控制工具，验收改用 Playwright `connectOverCDP("http://127.0.0.1:9222")` 连接真实 WebView2。
- P4.5 完成标准已满足；P4 可整体收尾。

## P4 完成标准

P4 可以结束的条件：

- 本地 mock provider 覆盖正常、慢响应、取消、断流和错误路径。
- 桌面端真实 Tauri 壳中完成至少一轮流式问答。
- 历史落库和回放在流式完成后稳定。
- 取消和失败不会留下半截历史。
- 长数据场景没有明显重叠、裁切、横向溢出。
- 阅读记忆关闭后确认不注入相关片段。
- 真实 Provider 小样本人工验收无阻断问题。

## 建议验证命令

基础回归：

```bash
npx tsc --noEmit --pretty false
npx vitest run "src/lib/reading-api.test.ts" "src/lib/reading-assistant-recommendations.test.ts" "src/lib/reading-assistant-markdown-lite.test.ts" "src/pages/candidate-books.test.ts" "src/App.test.ts" "src/pages/SettingsPage.test.tsx"
cargo test --manifest-path "src-tauri/Cargo.toml"
npm run build
```

页面 QA：

```bash
npx playwright --version
```

桌面端联调：

```bash
npm run tauri
```

## 决策点

进入 P4 实施前需要明确：

1. 是否新增本地 OpenAI-compatible mock provider 脚本。
2. mock provider 是否仅作为手动联调工具，还是纳入自动化测试。
3. 是否允许在本机使用真实 Provider 做人工小样本验收。
4. 长数据压力场景是否通过 Playwright mock 覆盖，还是只保留手工验收。
5. P4 是否只处理阻断稳定性问题，不做新的产品功能。

## 推荐下一步

建议先做 P4.0：

1. 写本地 mock provider 设计。
2. 明确 mock server 的接口、SSE 分块格式和错误场景。
3. 再决定是否实现脚本并接入桌面联调。

原因：

- P4 的关键不是继续改 UI，而是让真实桌面命令链路可重复验证。
- 本地 mock provider 能避免真实 API 成本和网络波动。
- 先把异常路径设计清楚，可以减少后续反复试错。

P4.0 设计文档：`docs/ai-reading-assistant-p4-mock-provider-design.md`。

P4.0 当前状态：

- 已实现本地 mock provider：`scripts/mock-ai-provider.mjs`。
- 暂未修改 `package.json`，避免增加低频脚本噪声。
- 已完成最小冒烟：帮助信息、语法检查、健康检查、非流式 JSON、流式 SSE、429 错误体。
