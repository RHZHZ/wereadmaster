# AI 阅读对话助手设计文档

## 目标

基于 [AI 阅读对话助手需求分析](./ai-reading-dialog-assistant-requirements-analysis.md)，设计一个可落地的“基于本地阅读上下文的 AI 阅读对话助手”。

首版目标：

- 支持全局唤起和场景化打开。
- 支持多轮文本对话。
- 支持结构化阅读上下文注入。
- 支持回答依据说明和本地对话历史。
- 支持关闭个性化上下文和清空对话历史。
- 不做完整向量知识库、不做全文问答、不做后台自动索引。

设计重点不是新增一个泛聊天页，而是给现有阅读资产体系补一个低摩擦解释层。

## 设计原则

### 1. 对话是解释层，不是正式资产层

现有正式 AI 资产包括：

- 单本书笔记复盘。
- 阅读统计复盘。
- 阅读指南 / 跨书路线图。
- 选书决策。
- 本地阅读器选区问答。

对话助手只负责解释、追问、草拟建议和引导跳转。用户要求生成正式复盘、阅读指南或选书决策时，应跳转到对应功能，不在聊天里静默写入或覆盖 `ai_outputs`。

### 2. 上下文最小化

每次问答只选择最小必要上下文：

- 默认使用结构化摘要。
- 原始笔记正文需要用户确认。
- 不默认发送全量书架、全量笔记或本地书全文。
- 回答必须展示使用了哪些上下文类型。

### 3. 本地优先

对话历史、阅读记忆和使用偏好保存在本机。AI Provider 调用继续经过 Tauri/Rust trusted layer，前端不直接读取或保存已配置 API Key。

### 4. 分阶段增强

P0 只做结构化阅读上下文库和对话线程。

P1 再做阅读资产摘要库。

P2 才评估本地向量知识库。

### 5. 推荐新书与候选书架决策分离

“推荐新书”和“从候选书架里选下一本”是两个不同任务。

- 推荐新书：基于阅读统计、阅读画像和已有 AI 资产给出新书建议，目标是让用户决定是否加入候选书架。
- 候选书架决策：只在用户已有候选书范围内排序、取舍和解释优先级。
- 聊天助手不应静默把 AI 推荐写入候选书架，加入候选必须由用户确认，并复用现有发现 / 书籍搜索 / 候选书架流程。
- 全局助手默认不把候选书架作为推荐池；候选书架上下文只在 `candidateShelf` 场景或用户明确要求“从候选书里选”时使用。

## 总体架构

```text
React UI
  ├─ ReadingAssistantLauncher
  ├─ ReadingAssistantPanel
  ├─ ContextChips / PrivacyControls / PromptSuggestions
  └─ reading-api.ts

Tauri Commands
  ├─ ask_reading_assistant
  ├─ list_reading_assistant_threads
  ├─ get_reading_assistant_thread
  ├─ delete_reading_assistant_thread
  ├─ clear_reading_assistant_history
  ├─ get_reading_assistant_preferences
  └─ save_reading_assistant_preferences

Rust Trusted Layer
  ├─ AiService
  ├─ ReadingAssistantService
  ├─ ReadingAssistantContextBuilder
  ├─ ReadingAssistantPromptBuilder
  ├─ ReadingAssistantRepository
  └─ existing Provider client / ai_outputs reader

SQLite
  ├─ ai_assistant_threads
  ├─ ai_assistant_messages
  ├─ ai_assistant_preferences
  └─ reading_memory_items    // P1
```

首版可以把 `ReadingAssistantService` 作为 `AiService` 内部模块实现，避免过早拆出复杂服务层。但职责边界必须清晰：上下文构建、Prompt 构建、Provider 调用、持久化、UI 展示不能混在一个函数里。

## 前端设计

### 入口

#### 全局入口

桌面端建议放在全局侧边栏或右下角悬浮入口。

入口行为：

- 点击后打开右侧对话面板。
- 面板保留当前页面可见，避免把用户从上下文中带走。
- 如果当前页面有可识别上下文，自动展示上下文标签。

#### 场景入口

在页面内放轻量按钮：

- 书籍详情：`问问这本书`
- 笔记页：`基于笔记提问`
- 统计页：`问问我的阅读偏好`
- 候选书架：`问问下一本读什么`
- AI 资产详情：`追问这份结果`

场景入口只负责携带上下文打开助手，不在页面内铺开聊天流。

### 组件拆分

```ts
type ReadingAssistantPanelProps = {
  open: boolean;
  scope: AssistantContextScope;
  entityId?: string;
  onClose: () => void;
};
```

建议组件：

- `ReadingAssistantLauncher`：全局入口。
- `ReadingAssistantPanel`：对话主容器。
- `ReadingAssistantThreadList`：历史线程列表，P0 可简化为当前线程和最近线程。
- `ReadingAssistantMessageList`：消息展示。
- `ReadingAssistantComposer`：输入区。
- `ReadingAssistantContextChips`：展示本次会使用的上下文类型。
- `ReadingAssistantPrivacyToggle`：关闭个性化上下文、允许使用原始笔记。
- `ReadingAssistantPromptSuggestions`：快捷问题。
- `ReadingAssistantSourceNotice`：回答依据说明。

### UI 状态

```ts
type ReadingAssistantPanelState =
  | "idle"
  | "loadingThread"
  | "ready"
  | "submitting"
  | "failed";
```

消息状态：

```ts
type ReadingAssistantMessageStatus =
  | "pending"
  | "answered"
  | "failed";
```

### 快捷问题

快捷问题根据 `scope` 动态生成：

```ts
const assistantSuggestions = {
  global: ["推荐 3 本可加入候选书架的新书", "总结我的阅读偏好", "帮我制定本周阅读计划"],
  bookDetail: ["这本书我现在该怎么读", "这本书适合我继续读吗", "为什么推荐这本书"],
  bookNotes: ["基于我的笔记总结重点", "这本书最值得复盘的点是什么"],
  readingStats: ["总结我的阅读偏好", "我最近阅读有什么盲区"],
  candidateShelf: ["从候选书架里先读哪本", "这些候选书怎么取舍"],
  aiAsset: ["解释这份结果的依据", "把行动项整理成今天可做的步骤"]
};
```

快捷问题不写死成营销文案，必须能直接触发一次有效对话。

## 前端 API

新增类型建议放在 `src/lib/types.ts`：

```ts
export type AssistantContextScope =
  | "global"
  | "bookDetail"
  | "bookNotes"
  | "readingStats"
  | "candidateShelf"
  | "aiAsset"
  | "localReaderSelection";

export type ReadingAssistantContextOption =
  | "currentBook"
  | "bookNotesSummary"
  | "rawBookNotes"
  | "readingStats"
  | "readingPersona"
  | "candidateBooks"
  | "aiAssetSummary"
  | "conversationHistory"
  | "readingMemory";

export type ReadingAssistantRequest = {
  threadId?: string;
  scope: AssistantContextScope;
  entityId?: string;
  message: string;
  enabledContext: ReadingAssistantContextOption[];
};

export type ReadingAssistantUsedContext = {
  type: ReadingAssistantContextOption;
  label: string;
  sourceRefs: string[];
  itemCount: number;
};

export type ReadingAssistantAnswer = {
  threadId: string;
  messageId: string;
  answer: string;
  suggestions: string[];
  usedContext: ReadingAssistantUsedContext[];
  generatedAt: string;
  promptVersion: string;
  providerModel?: string;
  basisNotice: string;
};
```

新增 API 建议放在 `src/lib/reading-api.ts`：

```ts
export async function askReadingAssistant(
  request: ReadingAssistantRequest
): Promise<ReadingAssistantAnswer>;

export async function listReadingAssistantThreads(): Promise<ReadingAssistantThreadSummary[]>;

export async function getReadingAssistantThread(
  threadId: string
): Promise<ReadingAssistantThreadDetail | undefined>;

export async function deleteReadingAssistantThread(threadId: string): Promise<void>;

export async function clearReadingAssistantHistory(): Promise<void>;

export async function getReadingAssistantPreferences(): Promise<ReadingAssistantPreferences>;

export async function saveReadingAssistantPreferences(
  preferences: ReadingAssistantPreferences
): Promise<ReadingAssistantPreferences>;
```

Web Preview 降级：

- 没有 Tauri runtime 时，助手入口可以展示“需要桌面应用”。
- 不在浏览器预览中调用 Provider。
- 不伪造 AI 回答。

## 后端命令设计

新增 Tauri commands：

```rust
#[tauri::command]
pub async fn ask_reading_assistant(
    app: AppHandle,
    request: ReadingAssistantRequest,
) -> Result<ReadingAssistantAnswer, AiCommandError>;

#[tauri::command]
pub fn list_reading_assistant_threads(
    app: AppHandle,
) -> Result<Vec<ReadingAssistantThreadSummary>, AiCommandError>;

#[tauri::command]
pub fn get_reading_assistant_thread(
    app: AppHandle,
    thread_id: String,
) -> Result<Option<ReadingAssistantThreadDetail>, AiCommandError>;

#[tauri::command]
pub fn delete_reading_assistant_thread(
    app: AppHandle,
    thread_id: String,
) -> Result<(), AiCommandError>;

#[tauri::command]
pub fn clear_reading_assistant_history(
    app: AppHandle,
) -> Result<(), AiCommandError>;

#[tauri::command]
pub fn get_reading_assistant_preferences(
    app: AppHandle,
) -> Result<ReadingAssistantPreferences, AiCommandError>;

#[tauri::command]
pub fn save_reading_assistant_preferences(
    app: AppHandle,
    preferences: ReadingAssistantPreferences,
) -> Result<ReadingAssistantPreferences, AiCommandError>;
```

注册要求：

- `src-tauri/src/commands/ai.rs` 增加 command。
- `src-tauri/src/lib.rs` 注册 invoke handler。
- `src-tauri/build.rs` 加入权限生成列表。
- `src-tauri/capabilities/default.json` 加入权限。
- 补 permission 生成验证测试。

## 后端类型设计

```rust
pub const READING_ASSISTANT_PROMPT_VERSION: &str = "reading-assistant-chat-v1";
pub const READING_ASSISTANT_FEATURE: &str = "reading-assistant-chat";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssistantContextScope {
    Global,
    BookDetail,
    BookNotes,
    ReadingStats,
    CandidateShelf,
    AiAsset,
    LocalReaderSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReadingAssistantContextOption {
    CurrentBook,
    BookNotesSummary,
    RawBookNotes,
    ReadingStats,
    ReadingPersona,
    CandidateBooks,
    AiAssetSummary,
    ConversationHistory,
    ReadingMemory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingAssistantRequest {
    pub thread_id: Option<String>,
    pub scope: AssistantContextScope,
    pub entity_id: Option<String>,
    pub message: String,
    pub enabled_context: Vec<ReadingAssistantContextOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingAssistantUsedContext {
    pub context_type: ReadingAssistantContextOption,
    pub label: String,
    pub source_refs: Vec<String>,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingAssistantAnswer {
    pub thread_id: String,
    pub message_id: String,
    pub answer: String,
    pub suggestions: Vec<String>,
    pub used_context: Vec<ReadingAssistantUsedContext>,
    pub generated_at: String,
    pub prompt_version: String,
    pub provider_model: Option<String>,
    pub basis_notice: String,
}
```

## 数据库设计

### P0：对话线程

```sql
CREATE TABLE IF NOT EXISTS ai_assistant_threads (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  context_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_assistant_threads_updated
  ON ai_assistant_threads(updated_at);
```

说明：

- `scope` 标识来源页面。
- `entity_id` 保存当前书籍、AI 资产或统计周期等实体 ID。
- `context_summary_json` 只保存上下文摘要，不保存完整 prompt。

### P0：对话消息

```sql
CREATE TABLE IF NOT EXISTS ai_assistant_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'answered', 'failed')),
  used_context_json TEXT NOT NULL,
  prompt_version TEXT,
  input_hash TEXT,
  provider_model TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(thread_id) REFERENCES ai_assistant_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_thread_created
  ON ai_assistant_messages(thread_id, created_at);
```

说明：

- 用户消息和助手消息都进入同一表。
- `used_context_json` 只保存上下文类型、来源引用和数量，不保存原始笔记正文。
- 失败消息也保存，方便用户看到失败原因和重试。

### P0：偏好设置

```sql
CREATE TABLE IF NOT EXISTS ai_assistant_preferences (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

首版只需要一条 key：

```json
{
  "usePersonalizedContext": true,
  "useReadingMemory": true,
  "allowRawBookNotes": false,
  "saveConversationHistory": true
}
```

### P1：阅读资产摘要库

```sql
CREATE TABLE IF NOT EXISTS reading_memory_items (
  id TEXT PRIMARY KEY NOT NULL,
  item_type TEXT NOT NULL,
  source_feature TEXT NOT NULL,
  source_scope_id TEXT NOT NULL,
  source_input_hash TEXT,
  book_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_feature, source_scope_id, source_input_hash, item_type)
);

CREATE INDEX IF NOT EXISTS idx_reading_memory_items_book_updated
  ON reading_memory_items(book_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_reading_memory_items_type_updated
  ON reading_memory_items(item_type, updated_at);
```

P0 不依赖这张表。P1 在生成正式 AI 资产后更新摘要库。

## 上下文构建

### 输入

```rust
struct ReadingAssistantContextBuildRequest {
    scope: AssistantContextScope,
    entity_id: Option<String>,
    enabled_context: Vec<ReadingAssistantContextOption>,
    thread_id: Option<String>,
}
```

### 输出

```rust
struct ReadingAssistantContextBundle {
    payload: serde_json::Value,
    used_context: Vec<ReadingAssistantUsedContext>,
    source_count: usize,
}
```

### 构建规则

#### Global

默认可用：

- 最近阅读摘要。
- 候选书摘要。
- 最新统计摘要。
- 最新阅读画像。
- 已生成选书决策摘要。

不读取：

- 原始笔记正文。
- 全量书架。

#### BookDetail

默认可用：

- 当前书基础信息。
- 当前书阅读进度。
- 本地阅读状态。
- 最新单本复盘摘要。
- 最新阅读指南摘要。

可选确认：

- 当前书原始笔记摘要。

#### BookNotes

默认可用：

- 当前书基础信息。
- 笔记数量、章节分布、已生成复盘摘要。

可选确认：

- 原始划线和想法，仍需要数量和字符上限。

#### ReadingStats

默认可用：

- 当前周期结构化统计。
- 本地阅读画像。
- 已生成统计复盘摘要。

不读取：

- 笔记正文。

#### CandidateShelf

默认可用：

- 本地候选书摘要，最多 8 本。
- 已生成选书决策摘要。
- 最近阅读和统计偏好摘要。

不读取：

- 未保存为候选的搜索结果。

#### AiAsset

默认可用：

- 当前 AI 资产结构化摘要。
- 对应书籍基础信息。
- 行动反馈摘要。

不读取：

- 该资产生成时的原始输入全文。

## Prompt 设计

### System Prompt 核心规则

```text
你是 wxreadmaster 的 AI 阅读对话助手。你只能基于输入中提供的本地阅读上下文回答。
不得编造用户没有读过、没有保存、没有生成过的阅读记录。
不得声称你读取了整本书，除非输入中明确包含全文。
推荐书籍时必须说明依据、不确定性和下一步动作。
当用户要求生成正式复盘、阅读指南或选书决策时，引导用户使用对应功能，不要在聊天中声称已经保存正式资产。
使用简体中文。
```

### User Payload 结构

```json
{
  "scope": "bookDetail",
  "userMessage": "这本书我现在该继续读吗？",
  "context": {
    "currentBook": {},
    "readingState": {},
    "latestBookSummary": {},
    "latestReadingRoute": {}
  },
  "usedContext": [
    {
      "type": "currentBook",
      "label": "当前书籍",
      "sourceRefs": ["book:book_123"],
      "itemCount": 1
    }
  ]
}
```

### 输出结构

首版建议继续要求 JSON 输出，便于 UI 展示：

```json
{
  "answer": "建议继续读，但先把下一次阅读目标收窄到一个章节。",
  "suggestions": ["帮我制定 45 分钟阅读计划", "解释推荐依据", "生成正式阅读指南"],
  "basisNotice": "基于当前书籍、阅读状态和已生成复盘摘要回答，未读取整本书全文。"
}
```

当 Provider 不支持 `json_schema` 时，沿用现有 `response_format_policy` 兼容策略。

## 调用流程

```text
用户提交问题
  -> 前端校验空输入和上下文选项
  -> ask_reading_assistant
  -> 读取 AI 设置和偏好
  -> 创建或更新 thread
  -> 保存 user message
  -> 构建 ReadingAssistantContextBundle
  -> 构建 prompt + input_hash
  -> 调 Provider
  -> 规范化输出
  -> 保存 assistant message
  -> 返回 ReadingAssistantAnswer
```

错误处理：

- 未配置 AI：返回 `ai_credential_missing`，前端引导设置。
- 上下文不足：返回正常回答，说明数据不足，不视为错误。
- Provider 失败：保存失败消息，允许用户重试。
- JSON 解析失败：复用现有宽松解析和 fallback 策略，仍不能输出未校验的敏感信息。

## 与现有能力的关系

### 与 `ai_outputs`

P0 不把聊天轮次写入 `ai_outputs`。

原因：

- `ai_outputs` 是正式 AI 资产缓存。
- 聊天消息频繁、上下文轻量、生命周期不同。
- 混入会污染 AI 资产列表和清理语义。

### 与书籍复盘

助手可以读取最新复盘摘要。

用户要求“重新总结这本书”时：

- 如果只是解释当前复盘，可以直接回答。
- 如果要生成正式复盘，应跳转 `BookAiSummaryPage`。

### 与阅读指南

助手可以解释阅读指南节点和行动项。

用户要求生成或更新正式阅读指南时，应跳转 `ReadingRoutePage`。

### 与选书决策

助手可以解释已生成的选书决策。

没有候选书时，不生成长书单，应引导用户去发现页保存候选。

### 与本地阅读器选区问答

本地阅读器选区问答继续保持“选区 -> 问题 -> 回答”的边界。

全局助手 P0 不接管选区问答历史。P2 再评估是否把选区问答摘要纳入阅读记忆。

## 隐私与设置

设置项：

- `usePersonalizedContext`：是否允许使用本地阅读上下文。
- `useReadingMemory`：是否允许使用阅读记忆。
- `allowRawBookNotes`：是否允许默认使用原始笔记正文，首版默认 false。
- `saveConversationHistory`：是否保存本地对话历史。

UI 要求：

- 对话面板顶部展示当前上下文标签。
- 发送前能看到“本次将使用”的上下文类型。
- 原始笔记正文默认不勾选。
- 清空历史和关闭阅读记忆需要明确影响范围。

日志要求：

- 不打印完整 prompt。
- 不打印原始笔记正文。
- 不打印 Provider 原始响应全文。
- 不打印 API Key、数据库路径、本地文件路径。

## 清理策略

### 清空对话历史

删除：

- `ai_assistant_threads`
- `ai_assistant_messages`

不删除：

- `ai_outputs`
- `ai_feedback_records`
- `reading_item_states`
- `reading_memory_items`

### 清空 AI 输出缓存

现有“清理 AI 输出缓存”只删除 `ai_outputs` 的语义应保持不变。

是否删除 `reading_memory_items` 需要单独设置项或确认，不应隐式删除。

### 清空本地缓存

全量清理本地缓存时，可以删除：

- `ai_outputs`
- `ai_feedback_records`
- `ai_assistant_threads`
- `ai_assistant_messages`
- `reading_memory_items`

但删除前需要在设置文案中说明会清理 AI 对话历史和阅读记忆。

## 测试计划

### Rust 单元测试

- 上下文构建不包含 API Key、数据库路径、原始 WeRead 响应。
- `BookDetail` scope 只包含当前书和已生成摘要。
- `ReadingStats` scope 不包含笔记正文。
- `CandidateShelf` scope 最多包含 8 本候选。
- 原始笔记只有 `RawBookNotes` 开启时才进入输入。
- Prompt 输出规范化失败时返回可控错误。
- 对话消息保存和读取按 thread 隔离。
- 清空对话历史不删除 `ai_outputs`。

### TypeScript 单元测试

- `reading-api.ts` 正确调用新增命令。
- Web Preview 下助手不可调用 Provider。
- 上下文标签根据 scope 正确生成。
- 快捷问题根据 scope 正确变化。

### 组件测试

- 未配置 AI 时显示设置入口，不展示假回答。
- 发送中显示 pending 状态。
- Provider 失败后展示失败消息和重试入口。
- 上下文标签能展示来源类型和数量。
- 关闭个性化上下文后不展示阅读记忆标签。

### E2E 测试

- 从书籍详情打开助手，能看到当前书上下文标签。
- 在统计页提问，回答依据只显示统计和画像。
- 在候选书架提问下一本，优先使用本地候选。
- 未配置 AI Provider 时引导设置。
- 清空对话历史后线程列表为空，正式 AI 资产仍可查看。

## 分期实施

### 阶段 1：P0 数据和命令

1. 新增 SQLite 表：`ai_assistant_threads`、`ai_assistant_messages`、`ai_assistant_preferences`。
2. 新增 Rust 类型、Repository 和 commands。
3. 新增 `ReadingAssistantContextBuilder`。
4. 新增 `ask_reading_assistant` 调用链。
5. 补权限注册和命令测试。

### 阶段 2：P0 前端面板

1. 新增前端类型和 `reading-api.ts` 封装。
2. 新增全局入口和 `ReadingAssistantPanel`。
3. 接入书籍详情、统计页、候选书架和 AI 资产页场景入口。
4. 增加上下文标签、快捷问题、隐私开关。
5. 支持本地线程列表和清空历史。

### 阶段 3：P1 阅读资产摘要库

1. 新增 `reading_memory_items`。
2. 生成单本复盘、阅读指南、选书决策后写入摘要库。
3. 助手可按 `bookId`、`itemType`、`tags` 读取摘要。
4. UI 展示阅读记忆来源。

### 阶段 4：P2 本地检索增强

1. 评估是否引入本地向量索引。
2. 只索引摘要资产和用户授权的笔记摘要。
3. 增加索引重建、清除和来源追踪。
4. 增加跨书观点对比和语义召回测试。

## 暂不实现

- 不实现完整向量库。
- 不实现后台自动索引。
- 不实现整本书全文问答。
- 不实现联网书单搜索。
- 不把公开点评默认纳入个人阅读记忆。
- 不把聊天消息混入正式 AI 资产库。
- 不做复杂 Agent 编排。

## 验收标准

P0 完成后：

- 用户能从主要页面打开 AI 阅读对话助手。
- 对话助手能显示当前使用的上下文类型。
- 助手回答能说明依据和数据边界。
- 书籍详情、统计页、候选书架和 AI 资产页都有场景化入口。
- 未配置 AI Provider 时引导设置，不展示假回答。
- 原始笔记正文默认不进入输入。
- 关闭个性化上下文后，输入不包含阅读画像、候选和阅读记忆。
- 对话历史保存在本机，用户可以清空。
- 清空对话历史不删除正式 AI 资产。
- 聊天结果不会静默覆盖单本复盘、阅读指南或选书决策。

## 工程原则落地

- KISS：P0 只做动态结构化上下文和对话线程，不上向量库。
- YAGNI：不提前实现全文问答、跨书 Agent 和后台索引。
- DRY：复用现有 AI Provider 设置、响应格式兼容、缓存读取和错误处理。
- SOLID：上下文构建、Prompt 构建、Provider 调用、持久化和 UI 展示分层。
