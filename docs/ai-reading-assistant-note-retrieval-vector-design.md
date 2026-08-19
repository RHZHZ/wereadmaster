# AI 阅读助手笔记检索、全量归纳与向量演进设计

## 1. 文档信息

- 状态：设计稿
- 适用范围：AI 阅读助手中的微信读书划线、想法/点评检索与归纳
- 关联文档：
  - [AI 阅读对话助手设计文档](./ai-reading-dialog-assistant-design.md)
  - [AI 阅读助手分类书目查询设计](./ai-reading-assistant-category-books-query-design.md)
  - [AI 阅读助手输出渲染与流式输出设计决策](./ai-reading-assistant-output-rendering-streaming-decision.md)
- 本文里程碑使用 `M0-M3`，避免与既有阅读助手发布阶段 `P0-P6` 混淆。

## 2. 背景与问题

当前 AI 阅读助手在用户允许使用原始笔记后，会调用：

```rust
const MAX_READING_ASSISTANT_RAW_NOTES: usize = 20;
const MAX_READING_ASSISTANT_RAW_NOTE_CHARS: usize = 300;
```

当前实现将当前书的划线和想法串联后直接截取前 20 条：

```rust
let items = highlights
    .chain(thoughts)
    .take(MAX_READING_ASSISTANT_RAW_NOTES)
    .collect::<Vec<_>>();
```

这能限制单次 Provider 输入，但存在以下产品与技术问题：

1. **固定 20 条只是输入预算，却容易被理解为产品能力上限。**
   用户看到“原始笔记片段 · 20”，无法判断本地共有多少条、为什么选择这 20 条、是否覆盖了自己的问题。

2. **选择不是按问题相关性完成。**
   当前实现没有使用用户问题检索笔记，只按数据集合顺序截断。

3. **划线与想法存在顺序偏置。**
   由于先 `highlights` 后 `thoughts`，当划线超过 20 条时，本次上下文可能完全不包含想法；这与用户想法通常更具个人价值的产品目标相冲突。

4. **普通问答、主题检索和全量归纳共用同一条路径。**
   “解释这条笔记”“找出与宽恕有关的笔记”“归纳全书 592 条笔记”是三种不同任务，不能都通过固定 Top-20 完成。

5. **“所有”“全部”等完整性请求缺少可验证合同。**
   模型不能根据 Top-K 样本声称已经覆盖全部笔记。

6. **正式书籍复盘也仍有输入预算。**
   历史正式复盘曾最多取 80 条划线和 80 条想法；截至 2026-08-18，普通复盘预算已统一为最多 80 条划线和 20 条想法（总计最多 100 条）。无论采用哪种预算，都不能自动等同于“已逐条覆盖全书全部笔记”；需要完整处理时必须走固定快照和分批任务。

因此，本设计不把上限从 20 简单提高到几百条，而是将笔记能力拆为：

```text
精确统计 → 确定性 SQLite 查询
定向查找 → 词法/语义检索 + 分页
普通问答 → 动态 Top-K + 总字符预算
全量归纳 → 分批处理 + 汇总 + 正式资产
```

后期引入向量时，只替换或增强“召回器”，不破坏上层任务路由、数据合同和 UI。

## 3. 设计结论

### 3.1 核心结论

1. 保留有限输入预算，但将其定义为**单次问答召回预算**，不再定义为“最多可用笔记数”。
2. 先建立统一的检索文档层和词法检索，再引入 embedding 与向量索引。
3. 后期向量采用**混合检索**，不以向量替代 SQLite 事实查询或词法精确匹配。
4. “全部笔记归纳”必须进入可追踪的批处理任务，不能通过扩大 Top-K 冒充。
5. 所有回答都应区分：
   - 本地可用数量；
   - 检索命中数量；
   - 本次注入数量；
   - 是否完整覆盖。
6. 对话继续作为解释层；全量归纳结果保存为正式 AI 资产，供后续对话引用。

### 3.2 推荐的向量落地策略

不建议第一版向量能力直接引入复杂原生向量数据库。

推荐分两步：

- **M3A：SQLite 保存 embedding，Rust 在过滤后的候选集合上进行余弦相似度扫描。**
  - 适合个人阅读库几千到数万条笔记。
  - 部署简单，不增加桌面端原生扩展加载问题。
  - 先用真实数据验证召回质量和性能。
- **M3B：达到明确阈值后再切换 sqlite-vec 或 HNSW。**
  - 触发条件建议为可索引文档超过 50,000，或向量召回 p95 超过 200ms。
  - 通过稳定的 `VectorIndex` 接口替换实现，上层合同不变。

该选择优先保证跨 Windows、Android 和未来平台的可部署性，而不是过早追求大规模向量数据库能力。

## 4. 目标与非目标

### 4.1 目标

- 普通问答按问题召回有限但相关、类型多样、来源可追溯的笔记。
- 用户能够看到“本次用了多少 / 本地共有多少”。
- 支持按主题检索全部本地匹配项，并分页查看原文。
- 支持全书全部笔记的分批归纳，覆盖率可验证。
- 为后期跨书语义检索和向量索引预留稳定数据模型。
- 笔记新增、修改、删除后支持增量更新词法和向量索引。
- 向量不可用时自动降级到词法检索，不阻断普通问答。
- 保持原始笔记默认关闭、本地优先、用户显式触发的隐私原则。

### 4.2 非目标

- 不把向量检索用于精确计数、阅读状态、分类或书目事实查询。
- 不默认向远程 embedding Provider 上传全部笔记。
- 不默认索引本地书全文。
- 不允许模型凭语义相似度声称“找到了所有结果”。
- 不将聊天回答自动覆盖正式书籍复盘。
- 不在第一阶段建设通用 RAG 平台或复杂 Agent 编排。
- 不承诺仅凭向量相似度完成法律、医学等高风险事实判断。

## 5. 用户任务分类

### 5.1 精确统计

示例：

- “这本书有多少条笔记？”
- “有多少条划线和想法？”
- “你这次用了多少条？”

处理：

- 直接查询 SQLite。
- 不调用 AI Provider 即可生成结构化结果。
- 分别返回 `availableCount`、`highlightCount`、`thoughtCount`。

### 5.2 精确或关键词查找

示例：

- “找出提到‘宽恕’的笔记。”
- “哪条划线出现了‘童年’？”
- “列出第六章里我的想法。”

处理：

- 使用结构化过滤 + 词法检索。
- 返回确定的匹配总数和分页结果。
- 模型只负责解释、归纳或生成查询扩展，不负责伪造匹配数量。

### 5.3 语义主题查找

示例：

- “哪些笔记反映了我对责任和自由的矛盾？”
- “找出与消费主义焦虑有关、但没有直接出现这些词的划线。”

处理：

- M0-M2 使用词法检索、有限同义词扩展和章节信号。
- M3 使用词法 + 向量混合检索。
- UI 明确标记“相关结果”，不标记为“全部结果”。

### 5.4 普通问答

示例：

- “我为什么会关注这些笔记？”
- “这些笔记背后有什么反复问题？”

处理：

- 先生成检索计划。
- 动态召回 10-60 条笔记，受总字符预算限制。
- 优先保证问题相关性、划线/想法多样性和章节覆盖。

### 5.5 全量归纳

示例：

- “归纳全部 488 条划线的核心观点。”
- “通读我在这本书里的 592 条笔记并生成完整复盘。”
- “覆盖所有章节，找出反复出现的主题。”

处理：

- 创建全量归纳任务。
- 对任务启动时的笔记快照进行分批处理。
- 每批产出结构化中间摘要和来源引用。
- 最终合并为正式书籍复盘资产。
- 完成条件必须满足 `processedCount == snapshotTotalCount`；否则标记为部分完成，不得声称全量覆盖。

## 6. 产品交互设计

### 6.1 上下文标签

当前：

```text
原始笔记片段 · 20
```

建议改为：

```text
原始笔记 · 已调用 20 / 本地 592
相关检索
```

空间不足时显示：

```text
原始笔记 20/592
```

点击标签打开“本次依据”抽屉，展示：

- 本地可用：592 条；
- 检索命中：47 条；
- 本次注入：20 条；
- 划线/想法：14 / 6；
- 覆盖章节：8；
- 检索策略：词法、混合或全量批处理；
- 是否完整覆盖：否；
- 截断原因：Top-K 或字符预算；
- 索引状态与模型版本（启用向量后）。

### 6.2 回答依据

普通回答的依据说明建议采用：

```text
基于当前书本地 592 条笔记中检索到的 47 条相关结果，本次调用 20 条；不是全量归纳。
```

全量归纳完成后采用：

```text
基于任务快照中的 592 / 592 条笔记生成，共处理 14 个批次；结果已保存为正式书籍复盘。
```

禁止以下模糊表达：

```text
基于你的全部笔记……
```

除非后端已验证本次任务完整覆盖。

### 6.3 主题检索结果卡片

增加 `noteSearch` 结构化 action，卡片显示：

- 查询主题；
- 匹配总数；
- 当前展示数量；
- 检索策略；
- 划线/想法筛选；
- 章节筛选；
- “查看全部匹配笔记”；
- “基于这些结果归纳”；
- “换成语义检索”（M3 且索引可用时）。

“所有相关笔记”的产品语义必须拆分：

- **词面全部匹配**：可以确定性声明全部；
- **语义相关结果**：只能声明按当前阈值召回的结果，不承诺语义上的绝对完整。

### 6.4 全量归纳任务卡片

状态：

```text
queued
→ snapshotting
→ batching
→ summarizing
→ merging
→ completed
```

异常终态：

```text
failed | cancelled | partial
```

卡片显示：

- 处理进度：`320 / 592`；
- 已完成批次：`8 / 14`；
- 当前阶段；
- 预计剩余批次数，不展示不可靠的时间承诺；
- 取消；
- 失败批次重试；
- 完成后打开正式复盘。

取消后：

- 保留任务记录和已完成批次，便于继续；
- 不把半截合并结果写成正式资产；
- 不把取消记录注入普通对话历史上下文；
- 用户可选择“继续任务”或“删除任务及中间结果”。

### 6.5 设置

新增“笔记检索”设置区：

- 原始笔记片段：沿用现有开关，默认关闭；
- 语义检索：默认关闭，M3 提供；
- embedding 执行方式：
  - 本地模型；
  - OpenAI-compatible embedding Provider；
- 当前索引：文档数、待更新数、模型、维度、更新时间；
- 立即建立/更新索引；
- 删除语义索引；
- 远程 embedding 隐私说明。

“允许原始笔记用于问答”和“允许建立语义索引”必须是两个独立授权：

- 前者控制每次生成回答时是否发送召回片段；
- 后者控制是否对笔记计算并保存 embedding；
- 使用远程 embedding 时必须单独确认笔记正文会发送到所选 Provider。

## 7. 总体架构

```text
User Message
    │
    ▼
ReadingAssistantIntentRouter
    ├─ NoteCountQuery ───────────────► StructuredSqlRetriever
    ├─ NoteLookup ───────────────────► RetrievalPlanner
    ├─ NoteSemanticSearch ───────────► RetrievalPlanner
    ├─ FullNotesSynthesis ───────────► NoteSynthesisJobService
    └─ General ──────────────────────► RetrievalPlanner
                                           │
                                           ▼
                                  NoteRetrievalService
                                  ├─ MetadataFilter
                                  ├─ LexicalRetriever
                                  ├─ VectorRetriever (M3)
                                  ├─ HybridRanker (M3)
                                  └─ DiversityReranker
                                           │
                                           ▼
                                  ContextBudgetAllocator
                                           │
                                           ▼
                                  PromptBuilder / Provider
                                           │
                                           ▼
                                  Answer + RetrievalTrace
```

全量归纳独立链路：

```text
NoteSynthesisJobService
    ├─ create immutable source snapshot
    ├─ group by chapter and note type
    ├─ build bounded batches
    ├─ summarize batches
    ├─ merge themes and exceptions
    ├─ verify coverage
    └─ persist formal ai_output
```

### 7.1 职责边界

- `IntentRouter`：判断任务类型，不读取大量笔记。
- `RetrievalPlanner`：将用户问题转换为过滤条件、查询词和预算。
- `NoteCorpusRepository`：维护统一、可追溯的检索文档。
- `LexicalRetriever`：精确词、章节和关键词召回。
- `VectorRetriever`：语义召回，不处理精确计数。
- `HybridRanker`：融合各路分数。
- `DiversityReranker`：防止结果被单一章节或单一类型垄断。
- `ContextBudgetAllocator`：按字符/token 预算选择最终注入项。
- `NoteSynthesisJobService`：处理全量任务、恢复、取消和正式资产落库。
- `PromptBuilder`：只消费检索结果，不直接查询数据库。

不再让 `build_reading_assistant_context()` 同时承担任务识别、笔记读取、截断和 Prompt 决策。

## 8. 检索计划

### 8.1 数据结构

```rust
pub enum NoteRetrievalMode {
    None,
    Recent,
    Lexical,
    Semantic,
    Hybrid,
    FullScan,
}

pub struct NoteRetrievalPlan {
    pub mode: NoteRetrievalMode,
    pub book_ids: Vec<String>,
    pub query_text: String,
    pub expanded_terms: Vec<String>,
    pub note_types: Vec<NoteType>,
    pub chapter_uids: Vec<i64>,
    pub candidate_limit: usize,
    pub context_item_limit: usize,
    pub max_total_chars: usize,
    pub max_item_chars: usize,
    pub require_exhaustive_lexical_match: bool,
    pub require_full_synthesis: bool,
}
```

### 8.2 默认预算

建议初始值：

```rust
const DEFAULT_NOTE_CONTEXT_TOP_K: usize = 20;
const MAX_NOTE_CONTEXT_TOP_K: usize = 60;
const DEFAULT_NOTE_CONTEXT_MAX_CHARS: usize = 12_000;
const MAX_NOTE_CONTEXT_MAX_CHARS: usize = 24_000;
const MAX_NOTE_CONTEXT_ITEM_CHARS: usize = 500;
const DEFAULT_NOTE_RETRIEVAL_CANDIDATES: usize = 120;
```

预算规则：

| 任务 | 候选召回 | 最终注入 | 总字符预算 |
| --- | ---: | ---: | ---: |
| 简单解释 | 40 | 10-20 | 8,000-12,000 |
| 单主题归纳 | 120 | 30-60 | 16,000-24,000 |
| 双主题对比 | 每主题 80 | 每主题 15-30 | 20,000-24,000 |
| 精确查找 | 全部匹配，分页 | 当前页或摘要所需 | 不直接全量注入 |
| 全量归纳 | 全部进入批次 | 单批 30-50 | 每批独立预算 |

最终限制使用字符/token 双预算中的较小者；不能只按条数截断。

### 8.3 类型与章节多样性

默认重排规则：

- 用户想法/点评在同等相关度下高于普通划线；
- 当两类笔记都存在且相关时，Top-20 至少预留 4 条想法；
- 单一章节默认不超过最终结果的 40%，除非用户明确限定该章节；
- 近重复文本只保留最高分项；
- 用户明确指定“只看划线”或“只看想法”时不做类型配额；
- 相关性明显不足的项目不能为了满足配额强行注入。

### 8.4 排序

M1-M2 词法阶段：

```text
lexicalScore
+ exactPhraseBonus
+ chapterMatchBonus
+ thoughtTypeBonus
+ userStarBonus
+ moderateRecencyBonus
- duplicatePenalty
- chapterConcentrationPenalty
```

M3 混合阶段：

```text
hybridScore =
    lexicalWeight * normalizedLexicalScore
  + vectorWeight  * normalizedVectorScore
  + metadataWeight * metadataScore
```

首版建议使用 Reciprocal Rank Fusion（RRF）融合词法与向量排名，避免不同检索器分数标度不一致：

```text
RRF(d) = Σ 1 / (k + rank_i(d))
```

建议初始 `k = 60`，具体权重通过离线评估集调整，不写死为产品规则。

## 9. 统一检索文档模型

### 9.1 为什么需要统一文档层

当前 `highlights` 和 `thoughts` 分表，字段和主键不同。后期如果直接分别做 FTS 和 embedding，会产生重复索引、重复增量逻辑和不一致的引用格式。

建议增加规范化检索语料表，将源数据映射为统一文档，但不取代源表。

### 9.2 数据表

```sql
CREATE TABLE IF NOT EXISTS retrieval_documents (
    id TEXT PRIMARY KEY NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN (
        'highlight',
        'thought',
        'ai_asset_summary',
        'local_reader_note'
    )),
    source_id TEXT NOT NULL,
    book_id TEXT,
    chapter_uid INTEGER,
    chapter_title TEXT,
    title TEXT,
    content TEXT NOT NULL,
    normalized_content TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source_updated_at TEXT NOT NULL,
    indexed_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_retrieval_documents_book_type
    ON retrieval_documents(book_id, source_type, deleted_at);

CREATE INDEX IF NOT EXISTS idx_retrieval_documents_hash
    ON retrieval_documents(content_hash);
```

文档 ID：

```text
note:highlight:{bookmark_id}
note:thought:{review_id}
```

`content` 建议包含用于理解的最小组合：

```text
书名 + 章节标题 + 笔记正文 + 想法摘要（如有）
```

禁止放入：

- API Key；
- 微信读书凭据；
- 原始 WeRead JSON；
- 数据库路径；
- 本地文件路径；
- 不属于用户可见阅读内容的内部字段。

### 9.3 同步策略

每次微信读书笔记同步完成后：

1. 对新增或变化的划线/想法计算 `content_hash`；
2. upsert `retrieval_documents`；
3. 将变化文档加入词法索引更新队列；
4. 如果已启用语义索引，将变化文档加入 embedding 队列；
5. 源笔记删除后将文档标记 `deleted_at`，并删除对应词法和向量项；
6. 不变文档不重复计算 embedding。

索引失败不得回滚原始笔记同步；索引是可重建的派生数据。

## 10. M1：词法检索设计

### 10.1 实现选择

优先使用 SQLite FTS5，但必须在启动时检测当前 bundled SQLite 是否支持所需 tokenizer。

中文检索不能只依赖默认 `unicode61` 的自然分词。建议采用以下顺序：

1. 应用层生成规范化中文 bigram、拉丁词和数字 token；
2. 将 token 流写入 FTS5 索引列；
3. 原始短语使用规范化 `LIKE` 作为精确包含补充；
4. 如果 FTS5 不可用，则降级为当前书范围内的 `LIKE` 查询和内存排序。

示例：

```text
“宽恕与希望”
→ 宽恕 恕与 与希 希望 宽恕 希望
```

建议表：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_documents_fts USING fts5(
    document_id UNINDEXED,
    title_tokens,
    chapter_tokens,
    content_tokens,
    tokenize = 'unicode61'
);
```

FTS 表是派生索引，可以全部重建，不进入核心数据备份。

### 10.2 精确查询与语义查询边界

- “包含‘宽恕’的所有笔记”：精确词面匹配，可返回完整匹配数。
- “与宽恕有关的笔记”：词法扩展或后期向量召回，只能返回相关结果。
- 查询中出现引号时，优先视为精确短语。
- 章节、人名、书名等结构化信息优先走字段过滤。

### 10.3 分页

完整匹配结果必须分页，不把全部正文注入模型：

```rust
pub struct NoteSearchPageRequest {
    pub query_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
}
```

默认每页 20 条，最大 100 条。`cursor` 应基于稳定排序键，不使用易漂移的纯页码。

## 11. M3：向量与混合检索设计

### 11.1 向量适用范围

适合：

- 抽象主题；
- 同义表达；
- 跨书相似观点；
- 用户没有提供准确关键词的概念召回。

不适合：

- 数量统计；
- 精确短语是否出现；
- 阅读状态；
- 分类字段；
- “列出所有命中项”的完整性证明。

### 11.2 embedding Provider 抽象

```rust
#[async_trait]
pub trait EmbeddingProvider {
    fn provider_id(&self) -> &str;
    fn model_id(&self) -> &str;
    fn dimensions(&self) -> usize;
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError>;
}
```

支持方向：

- `LocalEmbeddingProvider`：后期优先，原文不离开设备；
- `OpenAiCompatibleEmbeddingProvider`：复用 trusted layer 和安全凭据管理，但使用独立 embedding 模型配置；
- 生成模型和 embedding 模型不能假设相同，也不能复用同一个 model 字段。

### 11.3 向量索引配置

```sql
CREATE TABLE IF NOT EXISTS retrieval_index_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    provider_kind TEXT NOT NULL,
    model_id TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    distance_metric TEXT NOT NULL,
    normalization_version TEXT NOT NULL,
    chunking_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_embeddings (
    profile_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_blob BLOB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(profile_id, document_id),
    FOREIGN KEY(document_id) REFERENCES retrieval_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retrieval_embeddings_profile
    ON retrieval_embeddings(profile_id);
```

约束：

- `vector_blob` 使用 little-endian `f32` 数组；
- 保存维度并在读取时严格校验；
- cosine 模式下入库前归一化；
- 模型、维度、文本规范化版本或切块版本变化时创建新 profile；
- 新 profile 完成前继续使用旧 profile，避免重建期间语义检索完全不可用；
- 切换成功后再清理旧 profile。

### 11.4 VectorIndex 抽象

```rust
pub trait VectorIndex {
    fn upsert(&mut self, items: &[VectorItem]) -> Result<(), VectorIndexError>;
    fn delete(&mut self, document_ids: &[String]) -> Result<(), VectorIndexError>;
    fn search(
        &self,
        query: &[f32],
        filter: &VectorFilter,
        limit: usize,
    ) -> Result<Vec<VectorHit>, VectorIndexError>;
}
```

M3A 实现：

- 先通过 `book_id/source_type/deleted_at` 在 SQLite 中缩小候选集合；
- Rust 读取对应向量并做 SIMD 可优化的余弦点积；
- 个人库规模下优先验证正确性。

M3B 候选：

- sqlite-vec；
- HNSW sidecar index；
- 其他可静态打包、跨目标平台验证通过的实现。

升级到 M3B 前必须完成：

- Windows 安装包验证；
- Android 构建验证；
- 数据库迁移和索引重建验证；
- 崩溃恢复；
- 索引版本兼容；
- 删除和隐私清理验证。

### 11.5 混合检索流程

```text
query
  ├─ normalize + keyword extraction
  ├─ lexical search Top-80
  ├─ vector search Top-80
  ├─ RRF merge
  ├─ metadata boosts
  ├─ duplicate removal
  ├─ chapter/type diversity rerank
  └─ context budget allocation Top-10..60
```

降级规则：

- 没有向量授权：词法检索；
- 索引未完成：词法检索，并显示“语义索引构建中”；
- embedding Provider 失败：词法检索，不阻断回答；
- 查询 embedding 维度不匹配：禁用当前 profile 并要求重建；
- 词法与向量均无结果：返回无匹配，不注入随机近期笔记冒充相关结果。

## 12. 全量归纳设计

### 12.1 快照

任务启动时创建不可变来源快照：

```sql
CREATE TABLE IF NOT EXISTS note_synthesis_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL,
    status TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    total_count INTEGER NOT NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    batch_count INTEGER NOT NULL,
    completed_batch_count INTEGER NOT NULL DEFAULT 0,
    prompt_version TEXT NOT NULL,
    provider_model TEXT,
    result_ai_output_id TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_synthesis_job_items (
    job_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    batch_index INTEGER NOT NULL,
    PRIMARY KEY(job_id, document_id)
);

CREATE TABLE IF NOT EXISTS note_synthesis_batches (
    job_id TEXT NOT NULL,
    batch_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    output_json TEXT,
    input_hash TEXT NOT NULL,
    error_message TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(job_id, batch_index)
);
```

任务执行期间新增或修改的笔记不加入当前快照。完成后提示：

```text
任务启动后新增 3 条笔记，本次结果覆盖任务快照 592/592 条；可增量更新复盘。
```

### 12.2 分批策略

- 优先按章节分组；
- 超长章节再按 30-50 条或 token 预算切分；
- 想法与其 `range_text`/附近划线尽量放在同批；
- 每批保留稳定 `documentId`；
- 不在批次之间重复统计同一文档；
- 空文本、重复内容和无法解析项计入审计，但不发送给 Provider，并在最终覆盖报告中列明。

### 12.3 批次输出合同

```ts
type NoteSynthesisBatchOutput = {
  themes: Array<{
    title: string;
    summary: string;
    sourceDocumentIds: string[];
  }>;
  userConcerns: Array<{
    summary: string;
    sourceDocumentIds: string[];
  }>;
  tensions: Array<{
    summary: string;
    sourceDocumentIds: string[];
  }>;
  representativeNotes: Array<{
    documentId: string;
    reason: string;
  }>;
  weakSignals: Array<{
    summary: string;
    sourceDocumentIds: string[];
  }>;
};
```

### 12.4 最终合并

合并器需要：

- 合并同义主题；
- 统计每个主题覆盖的来源数和章节数；
- 保留反例、冲突和弱信号；
- 区分书中观点与用户自己的想法；
- 每个主要结论保存来源 `documentId`；
- 不将只出现一次的弱信号写成全书主线；
- 生成覆盖报告。

只有满足以下条件才标记 `completed`：

```text
所有快照项都有明确处理结果
AND 所有必需批次成功
AND 最终合并输出通过 schema 校验
AND processed_count == total_count
```

否则状态为 `partial` 或 `failed`。

### 12.5 与正式 AI 资产的关系

- 批次中间结果不写入 `ai_outputs`；
- 最终成功结果写入正式书籍复盘资产；
- `input_hash` 必须包含来源快照 hash、Prompt 版本和批处理版本；
- 对话消息只保存任务 action、状态和最终资产引用；
- 后续助手优先使用正式全量复盘摘要，不重复发送所有原始笔记。

## 13. 数据合同

### 13.1 扩展 usedContext

保持现有字段兼容，新增字段全部可选：

```ts
export type ReadingAssistantUsedContext = {
  contextType: ReadingAssistantContextOption;
  label: string;
  sourceRefs: string[];
  itemCount: number;              // 本次实际注入数
  availableItemCount?: number;    // 本地可用数
  matchedItemCount?: number;      // 当前查询命中数
  retrievalStrategy?:
    | "recent"
    | "lexical"
    | "semantic"
    | "hybrid"
    | "fullSynthesis";
  coverage?: "sampled" | "exhaustiveMatch" | "fullSnapshot";
  truncated?: boolean;
  indexProfileId?: string;
};
```

旧历史缺少新增字段时继续正常显示。

### 13.2 noteSearch action

```ts
export type ReadingAssistantNoteSearchOutput = {
  queryId: string;
  query: string;
  strategy: "lexical" | "semantic" | "hybrid";
  coverage: "exhaustiveMatch" | "rankedRelevant";
  totalMatched: number;
  returnedCount: number;
  hasMore: boolean;
  nextCursor?: string;
  items: ReadingAssistantNoteSearchItem[];
};

export type ReadingAssistantNoteSearchItem = {
  documentId: string;
  sourceType: "highlight" | "thought";
  bookId: string;
  bookTitle?: string;
  chapterUid?: number;
  chapterTitle?: string;
  excerpt: string;
  createdAt?: string;
  score?: number;
  matchReason?: string;
};
```

### 13.3 noteSynthesis action

```ts
export type ReadingAssistantNoteSynthesisOutput = {
  jobId: string;
  bookId: string;
  status:
    | "queued"
    | "snapshotting"
    | "batching"
    | "summarizing"
    | "merging"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";
  totalCount: number;
  processedCount: number;
  batchCount: number;
  completedBatchCount: number;
  resultAiOutputId?: string;
  message: string;
};
```

`ReadingAssistantActionOutput` 增加：

```ts
| { type: "noteSearch"; payload: ReadingAssistantNoteSearchOutput }
| { type: "noteSynthesis"; payload: ReadingAssistantNoteSynthesisOutput }
```

## 14. Tauri 命令建议

```rust
search_reading_notes(request) -> NoteSearchPage
get_reading_note_search_page(request) -> NoteSearchPage
start_note_synthesis(request) -> NoteSynthesisJob
get_note_synthesis_job(job_id) -> Option<NoteSynthesisJob>
cancel_note_synthesis_job(job_id) -> NoteSynthesisJob
retry_note_synthesis_batches(request) -> NoteSynthesisJob
get_retrieval_index_status() -> RetrievalIndexStatus
build_retrieval_index(request) -> RetrievalIndexJob
delete_retrieval_index(profile_id) -> ()
```

要求：

- 所有命令经过 Rust trusted layer；
- 前端不读取 embedding API Key；
- 任务 ID、游标和文档 ID 都要规范化校验；
- 搜索正文和错误日志不得记录完整原始笔记；
- 删除索引不删除源笔记；
- 构建索引不阻塞普通页面读取。

## 15. Prompt 设计

普通问答 payload 增加：

```json
{
  "noteRetrieval": {
    "strategy": "hybrid",
    "availableCount": 592,
    "matchedCount": 47,
    "includedCount": 20,
    "coverage": "sampled",
    "truncated": true,
    "items": []
  }
}
```

System Prompt 增加硬约束：

```text
当 noteRetrieval.coverage 为 sampled 时，不得声称已覆盖全部笔记。
当用户要求“全部/所有/完整归纳”且当前不是 fullSnapshot 时，必须说明当前覆盖不足，并返回或引导 noteSynthesis 动作。
笔记匹配数量只使用 payload 提供的确定性数字，不自行估算。
回答中的关键归纳应引用 sourceRef/documentId；不得编造不存在的笔记。
```

全量批次和最终合并使用独立 Prompt 版本，不复用普通聊天 Prompt：

```text
reading-note-batch-summary-v1
reading-note-synthesis-merge-v1
```

## 16. 隐私、安全与备份

### 16.1 隐私分级

- 原始笔记：敏感本地内容；
- embedding：可推断原文语义的派生敏感数据；
- 批次摘要：敏感派生内容；
- 检索 trace：可能暴露阅读主题，按敏感元数据处理。

### 16.2 远程 embedding

启用前必须明确告知：

- 哪个 Provider；
- 哪个 embedding 模型；
- 将发送哪些内容；
- 是否一次性全量发送；
- 预计文档数；
- 可随时取消和删除本地索引。

远程 embedding 不得因为用户已经配置聊天模型而自动启用。

### 16.3 日志

日志允许记录：

- job ID；
- document ID；
- 数量；
- 耗时；
- Provider 错误码；
- 模型和索引版本。

日志禁止记录：

- 完整笔记正文；
- embedding 向量；
- API Key；
- 微信凭据；
- 数据库和本地文件绝对路径；
- 完整 Prompt payload。

### 16.4 备份

建议：

- `retrieval_documents` 可由源表重建，但包含规范化正文；随 SQLite 核心备份时需在备份说明中披露；
- FTS 索引和 embedding 默认不进入跨设备备份，恢复后可重建；
- 全量归纳最终正式资产进入现有 AI 资产备份；
- 未完成任务和批次摘要是否备份由后续备份版本明确，首版可不备份并提示任务需重启。

## 17. 一致性、取消与失败恢复

### 17.1 普通问答

- 用户消息、检索 trace 和最终助手消息应使用一致的 request ID；
- 取消流式生成后，不将半截回答保存为 answered；
- 取消属于 `cancelled`，不应伪装成 Provider 失败；
- `cancelled/failed` 消息不进入后续对话上下文；
- 可保留最小失败审计，但 UI 历史默认不展示半截正文。

### 17.2 编辑重生成

当前编辑最后一条用户消息会先删除旧尾部再请求 Provider。后续实现检索任务时建议改为：

1. 创建新分支请求；
2. 完成检索和生成；
3. 成功后事务性替换旧尾部；
4. 失败或取消时保留旧回答。

避免长检索或全量任务失败后丢失原有可用回答。

### 17.3 索引任务

- 每批 embedding upsert 后提交进度；
- 应用重启后从未完成批次继续；
- Provider 限流使用有上限的指数退避；
- 单文档失败不阻断整个索引，最终状态可为 `partial`；
- 删除或修改文档优先使旧向量失效，避免召回过期内容。

## 18. 迁移与兼容

### 18.1 向后兼容

- 保留 `rawBookNotes` 上下文类型；
- `ReadingAssistantUsedContext` 新字段均为可选；
- 旧历史继续显示“原始笔记片段 · N”，无覆盖数据时不显示分母；
- 新 action 使用判别联合，旧前端遇到未知 action 时只展示文本回答；
- 向量关闭时所有核心功能仍可使用。

### 18.2 数据迁移

- 新表全部 `CREATE TABLE IF NOT EXISTS`；
- 首次升级不自动远程计算 embedding；
- `retrieval_documents` 可在本地后台分批建立，但原始笔记授权关闭时不得用于 Provider 回答；
- FTS/向量 schema 版本写入 profile；
- 任何索引损坏都通过删除派生索引并重建恢复，不修改源表。

## 19. 测试与评估

### 19.1 单元测试

- 488 条划线 + 95 条想法时，Top-20 不再全部被划线占满；
- 用户限定只看划线时不注入想法；
- 章节过滤正确；
- 字符预算比条数预算先达到时正确截断；
- 重复笔记去重；
- “全部/所有”意图不会走 sampled 普通回答；
- `processedCount != totalCount` 时不能完成全量任务；
- embedding 维度不匹配时拒绝查询；
- 模型版本变化时旧索引不被错误复用；
- 删除笔记后词法和向量结果都不再召回。

### 19.2 检索评估集

建立脱敏的本地测试语料和人工标注查询，至少覆盖：

- 精确短语；
- 两字中文词；
- 人名、书名和章节名；
- 同义表达；
- 抽象主题；
- 跨章节主题；
- 仅想法相关；
- 无结果；
- 高重复划线。

指标：

- Lexical Recall@20；
- Hybrid Recall@20；
- MRR@10；
- nDCG@20；
- 想法类型覆盖率；
- 章节多样性；
- 无关注入率；
- 人工“答案依据充分”通过率。

向量上线门槛不是“能返回结果”，而是：

- Hybrid Recall@20 相比词法基线有可重复提升；
- 精确查询不退化；
- 无关召回率在可接受范围；
- 来源引用正确率 100%。

### 19.3 性能目标

个人库建议初始目标：

- 单书词法检索 p95 < 100ms；
- 全库词法检索 p95 < 200ms；
- M3A 过滤后向量扫描 p95 < 200ms；
- 混合检索与重排 p95 < 350ms，不含远程查询 embedding；
- 索引任务不阻塞 UI 主线程；
- 10,000 条笔记增量同步只重建变化项。

### 19.4 E2E

- 标签显示“已调用 / 本地总数”；
- 依据抽屉展示策略、命中和截断状态；
- 查看全部词面匹配并分页；
- 语义索引未完成时降级到词法；
- 远程 embedding 首次启用需要确认；
- 全量任务可取消、恢复、失败批次重试；
- 完成后跳转正式复盘；
- 删除索引后源笔记仍存在；
- 移动端任务卡片和检索结果无横向溢出。

## 20. 分阶段实施计划

### M0：修复语义与顺序偏置

目标：不引入新索引，先让当前行为诚实、可理解。

- 将常量改名为单次召回预算语义；
- 统计并返回本地可用笔记总数；
- UI 显示“已调用 N / 本地 M”；
- 修复 `highlights.chain(thoughts).take(20)` 导致的类型偏置；
- 增加 sampled/full coverage 标记；
- 识别“全部/所有/全量归纳”，禁止作完整性承诺；
- 增加精确笔记数量本地 action。

验收：截图中的场景能明确显示本地 592 条、本次 20 条，并说明不是全量归纳。

### M1：统一语料与词法检索

目标：从“固定前 20 条”升级为“问题相关的动态 Top-K”。

- 建立 `retrieval_documents`；
- 建立中文可用的 FTS/token 流；
- 增加 `RetrievalPlanner`、`LexicalRetriever` 和 `DiversityReranker`；
- 增加总字符预算；
- 增加 `noteSearch` action；
- 支持全部词面匹配和分页；
- 增量同步索引。

验收：主题关键词查询能够稳定找到本书不同章节和不同类型的相关笔记。

### M2：全量归纳任务

目标：真实覆盖全部笔记，不依赖单次上下文窗口。

- 建立任务、快照和批次表；
- 按章节和预算分批；
- 支持取消、继续和重试；
- 保存来源引用和覆盖报告；
- 最终结果进入正式书籍复盘资产；
- 对已有普通复盘明确标记其输入覆盖预算，避免与全量模式混淆。

验收：592 条任务只有在处理 592/592 条后才显示“全量完成”。

### M3：向量与混合检索

目标：提升抽象主题和同义表达召回。

- 增加独立 embedding 配置和授权；
- 建立 index profile 与 embedding 表；
- 实现本地或 OpenAI-compatible embedding Provider；
- 实现 M3A Rust 过滤后向量扫描；
- 通过 RRF 与词法结果融合；
- 建立检索评估集和上线门槛；
- 达到规模或性能阈值后评估 M3B sqlite-vec/HNSW。

验收：混合检索在标注集上明显优于词法基线，同时不降低精确查询正确性。

## 21. 发布门禁

以下任一项不满足，不发布对应能力：

- sampled 结果仍可能声称“全部覆盖”；
- `available/matched/included` 三类数量存在混用；
- 想法长期被划线顺序挤出；
- 原始笔记关闭后仍进入 Prompt 或 embedding；
- 远程 embedding 未经单独确认；
- 删除源笔记后仍可从索引召回；
- 全量任务在部分批次失败时仍写入正式完成资产；
- 向量模型切换后错误复用旧维度索引；
- Provider 失败导致普通词法检索不可用；
- 日志包含笔记正文、向量或凭据。

## 22. 最终产品定义

AI 阅读助手的笔记能力不是“把尽可能多的笔记塞进一次 Prompt”，而是：

```text
用确定性查询回答事实，
用混合检索找到相关材料，
用有限上下文完成普通问答，
用可追踪批处理完成全量归纳，
并让用户始终知道本次到底使用了什么、覆盖了多少。
```

后期向量能力应作为召回增强层接入，而不是替代结构化数据、词法检索、覆盖率审计和正式资产流程。
