# AI 阅读助手 P3.0 验收清单

## 目标

P3.0 是进入 P3 结构性改造前的验收门禁。目标不是新增功能，而是确认 P0-P2 已形成稳定体验，并明确哪些问题必须在 P3.1 或 P3.2 中解决。

## 验收结论

当前结论：可以进入 P3.0 验收，不应直接进入 P3.1 实施。

更新：P3.1-P3.3 已完成，最终页面级 QA 已补充记录，见 `docs/ai-reading-assistant-p3-final-qa.md`。

原因：

- P0-P2 的核心闭环已具备代码和测试基础。
- 历史结构化输出恢复仍缺少消息级结构化字段。
- P3.1 涉及本地数据库结构变更，需要单独确认后实施。

## 验收范围

### 1. AI 对话面板

验收项：

- 右侧非模态抽屉展示。
- 支持关闭按钮和 Esc 关闭。
- 不对主内容做高斯模糊。
- 不点击侧边栏外部区域自动关闭。
- 历史、设置、聊天不挤在同一视图内。
- 输入区采用一体化 composer，Enter 发送，Shift+Enter 换行。

状态：通过代码验收；后续已通过构建产物页面级 QA。

依据：

- `src/components/ReadingAssistantPanel.tsx`
- `src/styles.css`

### 2. 快捷问题与追问

验收项：

- 初始态只展示通用快捷问题。
- 有 AI 回答后，优先展示回答内追问。
- 回答内追问不与历史列表或设置面板挤在同一区域。
- 去重、限量，避免快捷问题过多。

状态：通过代码验收。

依据：

- `src/components/ReadingAssistantPanel.tsx`

### 3. AI 推荐到候选书架

验收项：

- 推荐书籍由 AI 输出 `recommendedBooks`，不是只从候选书架反推。
- 推荐卡片支持搜索确认。
- 用户确认后加入候选书架。
- 对已存在候选进行去重，避免重复加入。
- 微信读书搜索结果不持久化到 AI 历史中。

状态：通过代码验收。

依据：

- `src/components/ReadingAssistantPanel.tsx`
- `src/lib/reading-assistant-recommendations.ts`
- `src/lib/reading-assistant-recommendations.test.ts`

### 4. 候选书架确认状态

验收项：

- 候选书架能区分已确认、待确认和轻管理候选。
- 顶部统计展示候选书、已确认、待确认。
- 支持按来源状态筛选。
- 未确认 AI 候选支持搜索确认。
- 空态能区分无候选和筛选无结果。

状态：通过代码验收。

依据：

- `src/pages/candidate-books.ts`
- `src/pages/CandidateBookshelfPage.tsx`
- `src/pages/candidate-books.test.ts`

### 5. Markdown-lite 渲染

验收项：

- 支持段落、无序列表、有序列表、加粗、行内代码。
- HTML、链接、图片只作为普通文本，不渲染为可执行或可点击内容。
- 有输入长度、块数量、列表项、内联节点上限。
- 不引入完整 Markdown 渲染器。

状态：通过代码验收。

依据：

- `src/lib/reading-assistant-markdown-lite.ts`
- `src/lib/reading-assistant-markdown-lite.test.ts`

### 6. 历史会话恢复

验收项：

- 历史消息能恢复文本、状态、上下文、模型和错误信息。
- 历史消息当前不能恢复推荐卡片和快捷追问。
- 不从历史文本中反推推荐书籍或追问。

状态：部分通过，这是 P3.1 的核心改造点。

依据：

- `src-tauri/src/db.rs`
- `src-tauri/src/services/ai.rs`
- `src/lib/types.ts`

现状说明：

`ai_assistant_messages` 当前字段包含 `content`、`used_context_json`、`prompt_version`、`input_hash`、`provider_model`、`error_code`、`error_message` 等，但没有消息级 `output_json`。因此当前会话内的 `recommendedBooks` 和 `suggestions` 不能稳定恢复到历史会话。

## 风险清单

### R1：P3.1 涉及数据库结构变更

风险：需要为 `ai_assistant_messages` 增加结构化输出字段，例如 `output_json TEXT NULL`。

处理：实施前必须单独确认，不夹带在普通 UI 调整里。

### R2：流式输出可能破坏结构化 JSON 稳定性

风险：推荐书卡片、候选书决策等依赖完整结构化响应，不适合直接流式。

处理：P3.2 只覆盖普通解释型问答，结构化场景继续等待完整响应。

### R3：阅读记忆容易过度设计

风险：直接做向量库、全文问答、后台索引会显著扩大隐私、性能和维护成本。

处理：P3.3 只做阅读记忆检索-lite，来源可追溯、范围可控、用户可关闭。

### R4：AI 面板继续堆功能会降低可用性

风险：把历史列表、推荐卡片、设置、对话内容都放在同一视图会重新拥挤。

处理：保持单视图切换，不把 P3 能力全部塞进主聊天区。

## P3.1 进入条件

进入 P3.1 前需要满足：

- P3.0 验证命令通过。
- 明确允许本地数据库结构变更。
- 明确不迁移旧历史消息。
- 明确 `output_json` 只保存稳定结构化子集。
- 明确不持久化微信读书搜索结果列表。

## 验证记录

验证日期：2026-07-03。

结果：

- `npx tsc --noEmit --pretty false`：通过。
- `npx vitest run "src/lib/reading-assistant-markdown-lite.test.ts" "src/lib/reading-assistant-recommendations.test.ts" "src/pages/candidate-books.test.ts" "src/App.test.ts" "src/lib/reading-api.test.ts" "src/pages/SettingsPage.test.tsx"`：通过，6 个测试文件，70 个测试。
- `npm run build`：通过。

备注：

- 构建存在 Vite chunk size warning，属于既有体积提示，不阻塞 P3.0。
- 后续已完成 P3 最终页面级 QA，覆盖桌面和移动端 AI 面板、阅读记忆设置、流式输出和取消生成状态。

## 建议下一步

P3.0 验证命令已通过，下一步可以进入 P3.1 的实施决策。

推荐路径：

1. 先进行一次 AI 面板人工视觉验收。
2. 确认是否允许修改本地数据库结构。
3. 若允许，进入 P3.1 历史结构化输出持久化设计和实现。
4. 若暂不允许，先进入 P3.2 普通问答流式输出详细设计。

推荐验证命令：

```bash
npx tsc --noEmit --pretty false
npx vitest run "src/lib/reading-assistant-markdown-lite.test.ts" "src/lib/reading-assistant-recommendations.test.ts" "src/pages/candidate-books.test.ts" "src/App.test.ts" "src/lib/reading-api.test.ts" "src/pages/SettingsPage.test.tsx"
npm run build
```
