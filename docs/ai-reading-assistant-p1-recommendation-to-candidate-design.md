# AI 阅读助手 P1：推荐新书加入候选书架设计文档

## 背景

P1 需求已经确定为“AI 推荐新书 -> 用户确认 -> 加入本地候选书架”的最小闭环。

当前基础能力：

- AI 阅读助手已支持 `newBookRecommendation` 意图。
- 推荐新书时已有 `recommendationPolicy` 和 `bookExclusionList`。
- 前端已有阅读助手面板和快捷问题。
- 本地候选书架复用 `reading_item_states`：
  - `itemType = "candidate"`
  - `status = "toRead"`
- 前端已有 `listReadingItemStates`、`getReadingItemState`、`upsertReadingItemState`、`removeReadingItemState`。

因此 P1 设计应优先复用现有阅读状态 API，不新增基础读写命令，不新增数据库表。

## 设计目标

- AI 新书推荐结果可结构化展示。
- 用户可以对单本推荐执行“加入候选”。
- 加入前必须确认。
- 加入后写入本地候选书架。
- 已存在候选不重复写入。
- 非新书推荐场景不受影响。

## 非目标

本设计不做：

- 不自动写入候选书架。
- 不搜索微信读书确认书籍是否存在。
- 不写回微信读书远端书架。
- 不新增书目数据库。
- 不做向量知识库。
- 不要求历史会话回放时恢复可操作推荐卡片。

## 总体方案

P1 采用三段式设计：

```text
AI 结构化推荐
  -> 前端推荐卡片
  -> 用户确认加入本地候选
```

核心原则：

- 后端负责让 AI 输出结构化推荐。
- 前端负责展示、确认、去重和写入本地候选。
- 本地候选书架继续由 `reading_item_states` 承载。
- 如果 AI 输出结构化推荐失败，则降级展示普通文本回答。

## 数据模型设计

### 后端输出结构

新增推荐书结构：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingAssistantRecommendedBook {
    pub title: String,
    pub author: String,
    pub reason: String,
    pub fit: String,
    pub risk: String,
}
```

调整 `ReadingAssistantGeneratedOutput`：

```rust
struct ReadingAssistantGeneratedOutput {
    answer: String,
    suggestions: Vec<String>,
    basis_notice: String,
    recommended_books: Vec<ReadingAssistantRecommendedBook>,
}
```

调整 `ReadingAssistantAnswer`：

```rust
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
    pub recommended_books: Vec<ReadingAssistantRecommendedBook>,
}
```

### JSON Schema

现有 schema 只允许：

```json
{
  "answer": "...",
  "suggestions": [],
  "basisNotice": "..."
}
```

P1 调整为始终包含 `recommendedBooks` 数组。

推荐 schema：

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["answer", "suggestions", "basisNotice", "recommendedBooks"],
  "properties": {
    "answer": { "type": "string" },
    "suggestions": {
      "type": "array",
      "items": { "type": "string" }
    },
    "basisNotice": { "type": "string" },
    "recommendedBooks": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "author", "reason", "fit", "risk"],
        "properties": {
          "title": { "type": "string" },
          "author": { "type": "string" },
          "reason": { "type": "string" },
          "fit": { "type": "string" },
          "risk": { "type": "string" }
        }
      }
    }
  }
}
```

设计决策：

- 非新书推荐场景也返回 `recommendedBooks: []`。
- `author` 使用必填字符串；未知作者返回空字符串，避免可选字段和严格 schema 兼容问题。
- `maxItems` 控制为 5，匹配 P0 的 3-5 本推荐约束。

## Prompt 设计

当 `intent == newBookRecommendation` 时：

- `answer` 用 1-3 句总结推荐依据。
- `recommendedBooks` 放具体书籍。
- 每本必须包含书名、作者、推荐理由、适合点、风险/取舍。
- 必须避开 `bookExclusionList`。
- 不得声称已加入候选书架。
- 不得声称已确认微信读书可用。

非新书推荐时：

- `recommendedBooks` 必须返回空数组。

推荐追加到 `outputContract`：

```json
{
  "recommendedBooks": "新书推荐场景返回 3-5 本；非新书推荐场景返回空数组。"
}
```

## 后端解析设计

### 归一化规则

`normalize_reading_assistant_output` 需要读取：

- `recommendedBooks`
- `recommended_books`
- `books`
- `recommendations`

归一化要求：

- 标题为空的项丢弃。
- `reason`、`fit`、`risk` 为空时用保守默认文案。
- 每个字段截断，避免过长卡片撑爆 UI。
- 最多保留 5 本。

建议限制：

```rust
const MAX_READING_ASSISTANT_RECOMMENDED_BOOKS: usize = 5;
const MAX_READING_ASSISTANT_RECOMMENDED_FIELD_CHARS: usize = 300;
```

### 降级策略

如果模型没有返回 `recommendedBooks`：

- 非新书推荐：正常返回空数组。
- 新书推荐：仍展示 `answer`，但不展示加入候选按钮。

这样避免前端从自然语言中解析书名。

## 前端类型设计

新增类型：

```ts
export type ReadingAssistantRecommendedBook = {
  title: string;
  author: string;
  reason: string;
  fit: string;
  risk: string;
};
```

调整：

```ts
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
  recommendedBooks: ReadingAssistantRecommendedBook[];
};
```

本地消息扩展：

```ts
type LocalAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "answered" | "failed";
  usedContext: ReadingAssistantUsedContext[];
  recommendedBooks: ReadingAssistantRecommendedBook[];
};
```

历史回放时如果后端暂不持久化 `recommendedBooks`，则使用空数组。

## 前端组件设计

### 组件拆分

P1 可先保持 `ReadingAssistantPanel.tsx` 单文件，但建议拆局部渲染函数：

```ts
function renderRecommendedBooks(message: LocalAssistantMessage) {}
function renderRecommendedBookCard(book: ReadingAssistantRecommendedBook) {}
```

如果组件继续膨胀，再拆出：

- `ReadingAssistantRecommendedBooks`
- `ReadingAssistantRecommendedBookCard`

### 推荐卡片结构

```text
书名
作者

推荐理由：...
适合你：...
风险/取舍：...

[加入候选]
```

状态：

```ts
type RecommendedBookCandidateState =
  | "available"
  | "confirming"
  | "adding"
  | "added"
  | "exists"
  | "failed";
```

P1 可以不显式存 `confirming`，使用浏览器确认弹窗或现有确认交互。

## 加入候选设计

### 去重规则

前端进入对话时或点击加入时读取本地状态：

```ts
const states = await listReadingItemStates();
```

去重匹配：

```text
normalize(title) + normalize(author)
```

命中以下状态视为已存在：

- `itemType === "candidate"`
- `status === "toRead"`
- 标题一致且作者一致

作者为空时：

- 只用标题匹配，但状态文案要更保守。

### itemId 生成

不要直接把完整标题和作者拼进 itemId，避免过长和特殊字符问题。

建议前端实现稳定短 hash：

```ts
function buildAiRecommendedCandidateId(book: ReadingAssistantRecommendedBook): string {
  const key = `${normalizeBookKey(book.title)}|${normalizeBookKey(book.author)}`;
  return `ai-rec-${stableHash(key)}`;
}
```

要求：

- 稳定。
- 长度小于 128。
- 不包含本地路径、prompt、用户隐私。

### 写入结构

```ts
await upsertReadingItemState({
  itemId,
  itemType: "candidate",
  status: "toRead",
  title: book.title,
  author: book.author || undefined,
  note: buildAiRecommendationCandidateNote(book)
});
```

备注：

```text
来自 AI 阅读助手推荐：{reason}
适合点：{fit}
风险：{risk}
```

备注需要截断，例如 300-500 字。

## 确认交互

P1 可以先使用原生确认弹窗，保持实现简单。

确认文案：

```text
加入本地候选书架？

《{title}》会保存到本地候选书架，用于后续选书决策和阅读路线。
这不会写入微信读书，也不代表已确认微信读书可用。
```

后续 P1c 或 P2 可替换为应用内确认弹窗。

## 状态流

### 可加入

```text
available
  -> 点击加入
  -> 用户确认
  -> adding
  -> added
```

### 已存在

```text
available
  -> 点击加入
  -> 本地匹配已存在
  -> exists
```

### 失败

```text
available
  -> 点击加入
  -> adding
  -> failed
  -> 用户可重试
```

## 历史会话策略

P1 默认不要求历史会话恢复可操作卡片。

原因：

- 当前 `ai_assistant_messages` 只持久化文本内容和 usedContext。
- 为推荐卡片持久化增加消息 metadata 会引入数据库迁移。
- P1 的核心价值是“推荐后立即加入候选”。

策略：

- 当前会话内展示可操作卡片。
- 历史回放只显示文本回答。
- 如果用户需要再次操作，可以重新发起推荐。

P1c 可选增强：

- 给 `ai_assistant_messages` 增加 `metadata_json`。
- 持久化 `recommendedBooks`。
- 历史回放恢复卡片和加入状态。

## 错误处理

### AI 没有返回结构化推荐

表现：

- 显示普通回答。
- 不显示推荐卡片。
- 不显示加入候选按钮。

### 写入候选失败

表现：

- 卡片按钮恢复可重试。
- 显示简短错误。
- 不影响当前对话消息。

### 已存在候选

表现：

- 按钮显示 `已在候选`。
- 不重复写入。

## 样式设计

推荐卡片应低密度、可扫读，不做大块营销卡。

建议：

```css
.reading-assistant-recommendation-list {
  display: grid;
  gap: 8px;
}

.reading-assistant-recommendation-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
}
```

按钮：

- 默认：`加入候选`
- 加入中：`加入中`
- 已加入：`已加入`
- 已存在：`已在候选`
- 失败：`重试`

## 测试计划

### Rust 单元测试

新增或更新：

- `reading_assistant_json_schema_requires_recommended_books`
- `reading_assistant_new_book_payload_requires_recommended_books`
- `normalize_reading_assistant_output_reads_recommended_books`
- `normalize_reading_assistant_output_limits_recommended_books`
- `normalize_reading_assistant_output_defaults_empty_recommended_books`

### TypeScript 单元测试

新增或更新：

- `reading-api` 映射 `recommendedBooks`。
- 缺失 `recommendedBooks` 时默认空数组。
- 推荐书字段截断或兜底。

### 组件测试

新增：

- 推荐卡片渲染书名、作者、理由、适合点、风险。
- 点击加入候选调用 `upsertReadingItemState`。
- 已存在候选不重复写入。
- 写入失败显示失败状态。

### 回归验证

- `npx tsc --noEmit --pretty false`
- `npx vitest run`
- `cargo test --manifest-path src-tauri/Cargo.toml reading_assistant`
- `npm run build`

## 实施顺序

### 第一步：后端结构化推荐

文件：

- `src-tauri/src/services/ai.rs`

任务：

- 增加 `ReadingAssistantRecommendedBook`。
- 调整 schema，要求 `recommendedBooks`。
- 调整 prompt/outputContract。
- 调整 normalize。
- 调整 `ReadingAssistantAnswer`。
- 补 Rust 测试。

### 第二步：前端类型和 API

文件：

- `src/lib/types.ts`
- `src/lib/reading-api.ts`
- `src/lib/reading-api.test.ts`

任务：

- 增加 `ReadingAssistantRecommendedBook` 类型。
- 映射 `recommendedBooks`。
- 缺失时默认空数组。

### 第三步：推荐卡片 UI

文件：

- `src/components/ReadingAssistantPanel.tsx`
- `src/styles.css`

任务：

- 扩展本地消息结构。
- 渲染推荐卡片。
- 当前会话内保存 recommendedBooks。

### 第四步：加入候选

文件：

- `src/components/ReadingAssistantPanel.tsx`
- `src/lib/reading-api.ts` 如需新增轻量 helper

任务：

- 点击加入候选。
- 本地去重。
- 确认弹窗。
- 调用 `upsertReadingItemState`。
- 更新卡片状态。

## 关键边界

### 不解析自然语言书名

P1 不从 `answer` 中用正则提取书名。

原因：

- 容易误判。
- 不利于多语言和复杂书名。
- 结构化 schema 已能解决。

### 不把候选写入交给 AI

AI 只负责推荐。

候选写入由前端在用户确认后调用本地 API。

### 不把搜索确认塞进 P1

微信读书搜索确认是 P2。

P1 只保存本地候选，并明确“未确认微信读书可用”。

## 验收标准

- 新书推荐场景能返回 `recommendedBooks`。
- 推荐卡片能展示结构化字段。
- 用户确认后可加入本地候选书架。
- 已存在候选不会重复加入。
- 普通对话不展示推荐卡片。
- 缺失结构化推荐时能降级为普通文本。
- 候选书架页面能看到新加入的候选。
- 构建和相关测试通过。

## 结论

P1 采用“后端结构化推荐 + 前端确认写入本地候选”的轻量闭环。

这个方案复用现有候选书架和阅读状态能力，不新增数据库表，不做远端搜索确认，也不让 AI 自动写入。它能显著缩短用户从“收到推荐”到“沉淀候选”的路径，同时保持 P0 已建立的安全边界。
