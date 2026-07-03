# AI 阅读对话助手实施计划

## 目标

基于 [需求分析](./ai-reading-dialog-assistant-requirements-analysis.md) 和 [设计文档](./ai-reading-dialog-assistant-design.md)，按最小闭环实现 AI 阅读对话助手。

首轮只交付 P0：

- 全局/场景化 AI 对话入口。
- 结构化阅读上下文注入。
- 本地对话线程和消息持久化。
- 上下文来源说明。
- 个性化上下文和原始笔记开关。
- 清空对话历史。

首轮不交付：

- 完整向量知识库。
- 后台自动索引。
- 全书全文问答。
- 联网书单搜索。
- 聊天结果写入正式 AI 资产。

## 当前基线

### 已有能力

- `src-tauri/src/services/ai.rs` 已集中承载 AI Provider 设置、结构化输出、缓存读取和正式 AI 资产生成。
- `src-tauri/src/commands/ai.rs` 已注册 AI 设置、复盘、阅读指南、选书决策和本地阅读器选区问答命令。
- `src-tauri/src/db.rs` 已有 `ai_outputs`、`ai_feedback_records`、`reading_item_states` 等表。
- `src/lib/reading-api.ts` 已封装 Tauri invoke 和 Web Preview 降级。
- `src/lib/types.ts` 已有 AI 设置、AI 资产、阅读路线、选书决策等类型。

### 主要缺口

- 没有对话线程、消息和偏好表。
- 没有阅读助手命令。
- 没有统一的阅读助手上下文构建器。
- 没有全局对话面板和页面入口。
- 设置页没有阅读助手相关隐私开关。

## 实施原则

- KISS：P0 只做文本对话和结构化上下文，不做向量检索。
- YAGNI：不为未来 Agent、跨设备同步和全文问答提前铺复杂架构。
- DRY：复用现有 AI Provider 设置、响应格式兼容、错误处理和正式资产读取逻辑。
- SOLID：数据库、上下文构建、Prompt、Provider 调用和 UI 各自独立。

## 阶段 1：数据库与后端基础

目标：先建立可测试的本地对话存储和偏好读写，不调用 Provider。

### 1.1 数据库表

修改文件：

- `src-tauri/src/db.rs`

新增表：

- `ai_assistant_threads`
- `ai_assistant_messages`
- `ai_assistant_preferences`

暂不新增：

- `reading_memory_items`

验收：

- 应用启动时能自动建表。
- 表结构不影响旧数据迁移。
- 全量本地缓存清理策略后续可覆盖这些表。

### 1.2 后端类型

修改文件：

- `src-tauri/src/services/ai.rs`

新增类型：

- `AssistantContextScope`
- `ReadingAssistantContextOption`
- `ReadingAssistantRequest`
- `ReadingAssistantAnswer`
- `ReadingAssistantThreadSummary`
- `ReadingAssistantThreadDetail`
- `ReadingAssistantMessage`
- `ReadingAssistantPreferences`
- `ReadingAssistantUsedContext`

验收：

- 类型使用 `camelCase` 序列化。
- 枚举值与前端类型保持一致。
- 不复用正式 AI 资产类型承载聊天消息。

### 1.3 Repository

修改文件：

- `src-tauri/src/services/ai.rs`

新增内部能力：

- 创建线程。
- 更新线程标题和 `updated_at`。
- 保存用户消息。
- 保存助手消息。
- 保存失败消息。
- 列出最近线程。
- 读取线程详情。
- 删除单个线程。
- 清空全部对话历史。
- 读取和保存偏好。

实现约束：

- `used_context_json` 不保存原始笔记正文。
- 删除线程级联删除消息。
- 清空历史不删除 `ai_outputs`。

测试：

- 新增 Rust 单元测试覆盖消息按线程隔离。
- 测试清空历史后 `ai_outputs` 仍存在。
- 测试默认偏好值。

## 阶段 2：后端命令与权限

目标：前端可以调用本地线程和偏好命令，但 AI 问答仍可先返回 mock 或受控错误。

### 2.1 Tauri commands

修改文件：

- `src-tauri/src/commands/ai.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/build.rs`
- `src-tauri/capabilities/default.json`

新增命令：

- `ask_reading_assistant`
- `list_reading_assistant_threads`
- `get_reading_assistant_thread`
- `delete_reading_assistant_thread`
- `clear_reading_assistant_history`
- `get_reading_assistant_preferences`
- `save_reading_assistant_preferences`

验收：

- 命令在 `invoke_handler` 注册。
- `build.rs` 生成权限。
- `default.json` 允许命令。
- 现有 AI settings command 测试扩展覆盖新增命令。

### 2.2 前端 API 类型

修改文件：

- `src/lib/types.ts`
- `src/lib/reading-api.ts`

新增：

- 阅读助手相关 TS 类型。
- `askReadingAssistant()`
- `listReadingAssistantThreads()`
- `getReadingAssistantThread()`
- `deleteReadingAssistantThread()`
- `clearReadingAssistantHistory()`
- `getReadingAssistantPreferences()`
- `saveReadingAssistantPreferences()`

Web Preview 行为：

- 未运行在 Tauri 时，问答 API 抛出“需要桌面应用”。
- 偏好读取可以返回默认值。
- 不伪造 AI 回答。

测试：

- `reading-api.ts` 单元测试覆盖无 Tauri 降级。
- 命令参数命名与 Rust `camelCase` 对齐。

## 阶段 3：结构化上下文构建

目标：在不调用 Provider 的前提下，能稳定构建可发送给 AI 的最小上下文。

### 3.1 Context Builder

修改文件：

- `src-tauri/src/services/ai.rs`

建议新增内部结构：

```rust
struct ReadingAssistantContextBuildRequest {
    scope: AssistantContextScope,
    entity_id: Option<String>,
    enabled_context: Vec<ReadingAssistantContextOption>,
    thread_id: Option<String>,
}

struct ReadingAssistantContextBundle {
    payload: serde_json::Value,
    used_context: Vec<ReadingAssistantUsedContext>,
    source_count: usize,
}
```

### 3.2 Scope 支持顺序

第一批：

1. `BookDetail`
2. `ReadingStats`
3. `CandidateShelf`
4. `AiAsset`
5. `Global`

后置：

- `BookNotes` 原始笔记上下文。
- `LocalReaderSelection` 与全局助手历史打通。

### 3.3 数据边界

默认允许：

- 当前书基础信息。
- 阅读进度。
- 本地阅读状态。
- 已生成复盘摘要。
- 已生成阅读指南摘要。
- 已生成选书决策摘要。
- 当前周期结构化统计。
- 阅读画像。
- 候选书摘要，最多 8 本。

默认禁止：

- 原始笔记正文。
- 全量书架。
- 原始 WeRead API 响应。
- API Key。
- 数据库路径。
- 本地文件路径。

测试：

- `BookDetail` 不包含其他书原始笔记。
- `ReadingStats` 不包含笔记正文。
- `CandidateShelf` 候选数量不超过 8。
- 构建结果字符串不包含 `apiKey`、`databasePath`、`raw`。

## 阶段 4：AI 调用链

目标：实现真实 `ask_reading_assistant`，复用现有 Provider、响应格式兼容和错误处理。

### 4.1 Prompt Builder

修改文件：

- `src-tauri/src/services/ai.rs`

新增常量：

```rust
pub const READING_ASSISTANT_PROMPT_VERSION: &str = "reading-assistant-chat-v1";
pub const READING_ASSISTANT_FEATURE: &str = "reading-assistant-chat";
```

Prompt 约束：

- 只能基于输入上下文回答。
- 不编造阅读记录。
- 不声称读取整本书。
- 推荐必须说明依据和下一步动作。
- 正式资产生成需求必须引导到对应功能。
- 使用简体中文。

### 4.2 输出规范化

目标 JSON：

```json
{
  "answer": "string",
  "suggestions": ["string"],
  "basisNotice": "string"
}
```

约束：

- `answer` 为空时返回可控错误。
- `suggestions` 最多 3 条。
- `basisNotice` 缺失时由本地补默认说明。
- 不把 Provider 原始响应直接展示。

### 4.3 调用流程

实现顺序：

1. 校验消息非空和长度。
2. 读取 AI 设置和阅读助手偏好。
3. 创建或读取线程。
4. 保存用户消息。
5. 构建上下文。
6. 构建 prompt 和 `input_hash`。
7. 调用 Provider。
8. 规范化输出。
9. 保存助手消息。
10. 返回前端。

错误处理：

- 未配置 AI：返回 `ai_credential_missing`。
- Provider 失败：保存失败消息。
- 上下文不足：返回正常回答，不作为错误。

测试：

- 未配置 AI 返回设置引导错误。
- Provider mock 返回 JSON 时能保存助手消息。
- Provider mock 返回非法 JSON 时不泄露原始响应。

## 阶段 5：前端基础面板

目标：先实现可用的对话面板，不追求复杂动效和高级历史管理。

### 5.1 新增组件

建议文件：

- `src/components/reading-assistant/ReadingAssistantLauncher.tsx`
- `src/components/reading-assistant/ReadingAssistantPanel.tsx`
- `src/components/reading-assistant/ReadingAssistantMessageList.tsx`
- `src/components/reading-assistant/ReadingAssistantComposer.tsx`
- `src/components/reading-assistant/ReadingAssistantContextChips.tsx`
- `src/components/reading-assistant/ReadingAssistantPromptSuggestions.tsx`
- `src/components/reading-assistant/reading-assistant-suggestions.ts`

### 5.2 全局状态

可先放在 `App.tsx`：

- 当前是否打开助手。
- 当前 `scope`。
- 当前 `entityId`。

如果状态开始膨胀，再抽 `useReadingAssistantController`。

### 5.3 UI 行为

必须支持：

- 打开/关闭面板。
- 发送消息。
- 展示 pending、answered、failed。
- 展示上下文标签。
- 展示快捷问题。
- 展示未配置 AI 的设置引导。
- 清空历史入口。

暂不做：

- 复杂线程搜索。
- 多会话侧栏管理。
- Markdown 导出。
- 推荐反馈。

测试：

- 组件测试覆盖空态、发送中、失败态。
- 无 AI 配置时不展示假回答。
- 上下文标签能展示来源数量。

## 阶段 6：场景入口接入

目标：把助手接到主要阅读场景，但每个入口只做轻按钮，不改页面主信息架构。

### 6.1 书籍详情

修改文件：

- `src/pages/BookDetailPage.tsx`

入口：

- `问问这本书`

scope：

- `bookDetail`

entityId：

- `bookId`

### 6.2 统计页

修改文件：

- `src/pages/StatisticsPage.tsx`

入口：

- `问问我的阅读偏好`

scope：

- `readingStats`

entityId：

- `mode:baseTime`

### 6.3 候选书架

候选书架入口如果当前散落在书架或总览模块中，先接入承载候选列表的页面。

scope：

- `candidateShelf`

entityId：

- 可为空，后端读取本地候选摘要。

### 6.4 AI 资产页

修改文件视实际页面而定：

- 阅读指南结果页。
- 单本复盘详情。
- AI 资产版本详情。

scope：

- `aiAsset`

entityId：

- `feature:scopeId:inputHash`

验收：

- 四类入口都能打开同一个全局面板。
- 面板上下文标签随入口变化。
- 页面主流程不被助手入口打断。

## 阶段 7：设置与清理

目标：补齐隐私控制和清理语义。

### 7.1 设置项

修改文件：

- `src/pages/SettingsPage.tsx`

新增设置：

- 允许 AI 使用个性化阅读上下文。
- 允许 AI 使用阅读记忆。
- 默认允许原始笔记进入助手上下文，默认关闭。
- 保存本地对话历史。

### 7.2 清理入口

新增操作：

- 清空 AI 对话历史。

注意：

- 清空对话历史不删除 `ai_outputs`。
- 清空 AI 输出缓存仍只删除正式 AI 输出，不隐式删除对话历史。
- 全量清理本地缓存时需要覆盖对话历史表。

测试：

- 清空对话历史后线程为空。
- 书籍复盘、阅读指南、选书决策仍可查看。

## 阶段 8：P1 阅读资产摘要库

目标：在 P0 稳定后，再沉淀长期阅读记忆。

### 8.1 新增表

修改文件：

- `src-tauri/src/db.rs`

新增：

- `reading_memory_items`

### 8.2 写入时机

触发点：

- 单本复盘生成成功后。
- 阅读指南生成成功后。
- 选书决策生成成功后。
- 统计复盘生成成功后。

不触发：

- 普通对话消息。
- Provider 失败。
- 用户没有确认的原始笔记。

### 8.3 读取策略

首版读取：

- 按 `bookId`。
- 按 `itemType`。
- 按更新时间取最近。

不做：

- 语义向量召回。
- 全文检索复杂排序。

## 推荐提交顺序

如果后续需要拆 PR，推荐顺序：

1. 数据库表、后端类型、Repository。
2. Commands、权限、前端 API 类型。
3. Context Builder 和后端测试。
4. `ask_reading_assistant` Provider 调用链。
5. 前端全局面板。
6. 页面场景入口。
7. 设置与清理。
8. P1 阅读资产摘要库。

每个阶段都应独立可编译、可测试。

## 验证命令

建议按阶段运行：

```powershell
npm test -- --run src/lib/reading-api.test.ts
npm test -- --run src/pages/SettingsPage.test.tsx
npm test -- --run src/pages/BookDetailPage.test.tsx
npx tsc --noEmit --pretty false
npm run build
cargo test --manifest-path "src-tauri/Cargo.toml"
```

如果只改 Rust 后端：

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml"
```

如果只改前端类型和组件：

```powershell
npx tsc --noEmit --pretty false
npm test -- --run <相关测试文件>
```

## 风险与回滚

### 风险 1：上下文越界

控制：

- Context Builder 单元测试必须覆盖敏感字段。
- 默认不传原始笔记。
- `usedContext` 只保存摘要引用。

### 风险 2：UI 入口干扰主流程

控制：

- 场景入口只放轻按钮。
- 面板不替代现有结果页。
- 不在页面中铺长聊天流。

### 风险 3：聊天污染正式资产

控制：

- P0 不写 `ai_outputs`。
- 聊天表和正式 AI 资产表分离。
- 正式资产生成继续走现有页面。

### 风险 4：实现范围膨胀

控制：

- P0 不建 `reading_memory_items`。
- P0 不做向量库。
- P0 不做推荐反馈和 Markdown 导出。

## P0 完成定义

- 后端命令已注册并有权限。
- 对话历史本地持久化。
- `ask_reading_assistant` 能使用结构化上下文调用 Provider。
- 前端有可用对话面板。
- 书籍详情、统计页、候选书架、AI 资产页至少完成第一批入口。
- 用户能关闭个性化上下文。
- 用户能清空对话历史。
- 原始笔记默认不进入输入。
- 清空对话历史不影响正式 AI 资产。
