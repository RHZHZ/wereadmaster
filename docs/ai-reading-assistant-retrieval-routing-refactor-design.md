# AI 阅读助手检索路由与跨书发现改造设计

## 1. 文档信息

- 状态：P1、P1.5、P2、P3、P4 已实施（2026-08-17）；P1.6 书名/标题前缀阅读记录查询待实施
- 适用范围：AI 阅读助手全局问答、单书问答、分类与书名书目查询、笔记词法检索、语义索引与结果依据 UI
- 问题触发：用户在全局阅读助手询问“根据现有记录梳理读过的经济理财类书籍”时，回答只能引用分类统计，无法列出书名；即使已建立语义索引，也没有参与本次回答。
- 关联实现：
  - `src-tauri/src/services/ai.rs`
  - `src-tauri/src/services/retrieval.rs`
  - `src-tauri/src/services/vector_retrieval.rs`
  - `src/components/ReadingAssistantPanel.tsx`
  - `src/components/SemanticIndexSettingsCard.tsx`
- 关联文档：
  - [AI 阅读助手笔记检索、全量归纳与向量演进设计](./ai-reading-assistant-note-retrieval-vector-design.md)
  - [AI 阅读助手分类书目查询设计](./ai-reading-assistant-category-books-query-design.md)
  - [AI 阅读助手书名、标题前缀与作者阅读记录查询改造设计](./ai-reading-assistant-book-title-series-query-refactor-design.md)

## 2. 现状与根因

### 2.1 截图中的请求实际走向

当前全局入口的默认上下文是：

```text
阅读统计 + 阅读画像 + 阅读记忆 + 最近对话
```

不包含原始笔记，也不携带全书架的书目清单。用户使用“梳理”而非“哪些 / 列出 / 书单”等明确列举词时，不会命中现有的分类书目意图；同时问题没有出现“笔记、划线、想法、摘录”等笔记信号，也不会命中单书笔记检索意图。因此请求作为普通全局问答进入 Provider。

```text
全局提问
  -> General
  -> 阅读统计、画像、记忆
  -> Provider 生成回答
  -> 没有书名上下文，只能返回分类总数和缺失说明
```

截图里的“阅读统计 +1、阅读画像 +1、阅读记忆 +2”正是这个链路的可见证据；没有“原始笔记”或“混合检索”依据，不应把它解释为向量召回失败。

### 2.2 已存在能力与实际调用范围

| 能力 | 当前适用范围 | 当前限制 |
| --- | --- | --- |
| 分类书目查询 | 明确的分类列举语句 | 只读书架、书籍详情、阅读进度和本地状态的 `category` 字段；统计汇总不能反推具体书名 |
| 词法笔记检索 | 指定一本书的笔记查询 | 要求问题带笔记信号且能定位 `bookId` |
| 混合检索 | 显式单书 `noteSearch` 路径 | 只支持单个 `bookId`，需存在状态为 `ready` 的索引且查询 embedding 可用 |
| 普通单书聊天 | 允许原始笔记的书籍详情/笔记页 | 当前上下文构造器直接调用词法检索，未复用混合检索 |
| 全局聊天 | 阅读统计、画像、记忆、历史 | 不支持跨书笔记检索，也不提供书目分类的结构化候选 |

### 2.3 需要修复的边界断层

1. **意图表达断层**：用户的“梳理已读经济理财书籍”属于结构化书目请求，但现有分类解析对“梳理”覆盖不足，落入普通聊天。
2. **数据粒度断层**：阅读统计仅保存“经济理财读过 34 本”等聚合事实；它不能安全地还原出 34 本书名。书名和分类仍分散在书架、详情、进度和本地状态中。
3. **检索作用域断层**：向量索引只存划线与想法文档，并按 `bookId` 查询；全局助手没有跨书检索请求模型。
4. **调用链断层**：普通单书聊天的原始笔记上下文只调用词法搜索，没有复用已实现的 `search_notes_with_semantic_fallback`。
5. **可观测性断层**：回答 UI 只能显示“使用了哪些上下文”，但没有清楚说明“为何没有用向量”“命中多少”“是否回退到词法”。

## 3. 设计原则

1. **书名、分类、已读状态是结构化事实，不由向量结果裁定。** 向量可发现候选笔记，不能从主题相似度推断一本书已读或属于某分类。
2. **统计总数与逐本清单分开表达。** 当总数为 34、可确认书目为 0 时，应标记为“统计已同步，逐本分类未覆盖”，不得由模型补造书名。
3. **所有笔记检索都通过同一检索门面。** 单书、跨书、聊天上下文与独立笔记搜索共用策略选择、降级逻辑和诊断信息。
4. **向量仅增强主题召回。** 精确短语、全量匹配、计数、分页续查和书目事实仍优先使用 SQLite 结构化/词法路径。
5. **跨书原始笔记仍需显式授权。** 全局语义检索不会绕过 `allowRawBookNotes`，且默认只将查询文本发送给 Embedding Provider。

## 4. 目标与非目标

### 4.1 目标

- “梳理读过的经济理财类书籍”稳定进入书目查询，并能列出本地可确认书名。
- 书目元数据不足时，返回可验证的部分结果、缺口数量和下一步同步建议。
- 支持“从我的笔记里找跨书的经济理财主题”等跨书混合检索。
- 单书普通问答在满足授权和索引条件时使用相同的混合检索逻辑。
- 回答依据能够展示检索范围、策略、命中数、注入数、索引状态与回退原因。

### 4.2 非目标

- 不用笔记向量自动生成或覆盖书籍分类。
- 不由聚合阅读统计推导不存在的书名。
- 不把跨书 Top-K 语义结果宣称为“全部经济理财书”。
- 不将本次改造扩展为书籍全文 embedding 或通用知识图谱。

## 5. 目标路由模型

### 5.1 请求分类

```text
用户问题
  -> BookCatalogQuery：书名、分类、已读状态、进度、书单
  -> NoteSearchQuery：明确要求笔记/划线/想法/摘录的查找或主题发现
  -> NoteSynthesisRequest：单书全量归纳
  -> General：解释、建议、开放问答
```

`BookCatalogQuery` 的触发词应覆盖“梳理、归类、盘点、汇总、列出、有哪些、书单、书目”，但必须再区分两种产物：

- `CatalogList`：用户只要求确认书名、分类、阅读状态或清单，走确定性本地查询；
- `CatalogAnalysis`：用户要求解释、比较、反思或影响分析，先获得已确认书目，再将该书目作为结构化上下文交给 Provider。

不能只因同时出现阅读状态与书籍/分类实体就压过 `General`。例如“梳理我读过的理财书如何影响投资观”属于 `CatalogAnalysis`，不能退化成只返回书名列表。

`NoteSearchQuery` 需要明确笔记信号。没有笔记信号的“读过哪些书”绝不能误路由到向量索引。

### 5.2 书目查询

```text
BookCatalogQuery(category = 经济理财, readState = finished)
  -> 本地书目投影查询
  -> 书架 / 书籍详情 / 阅读进度 / 阅读状态合并去重
  -> 返回书名、作者、分类、完成状态、来源、覆盖诊断
```

第一期不新建向量表；建立一个纯查询层 `read_book_catalog`，统一现有表的字段优先级和去重键。返回结果至少包含：

```ts
type BookCatalogQueryResult = {
  categoryLabel: string;
  status: "found" | "partial" | "empty";
  aggregateCount?: number;
  confirmedCount: number;
  unconfirmedCount?: number;
  books: Array<{
    bookId: string;
    title: string;
    author?: string;
    category?: string;
    readStatus: "finished" | "started" | "unknown";
    source: "shelf" | "detail" | "progress" | "localState";
  }>;
  diagnostics: {
    catalogCoverage: "complete" | "partial" | "unavailable";
    missingReason?: "bookMetadataNotSynced" | "categoryMissing";
  };
};
```

若统计显示 `aggregateCount > confirmedCount`，UI 必须保留两者，并展示“仅列出可确认书目；同步书架和书籍详情后可补齐”的操作，不把它写成泛泛的上下文缺失。

阅读状态必须按可验证证据统一计算：

| 用户表达 | 目标状态 | 可接受证据 |
| --- | --- | --- |
| `读完`、`已读完`、`完成` | `finished` | 书架完成标记，或阅读进度 `progressPercent >= 100`，或存在 `finishTime` |
| `读过`、`看过`、`读了`、`阅读过` | `finished` 或 `started`，按请求显式返回分组 | 先按 `finished` 确认；没有完成证据但有进度、阅读时长或最近阅读记录时只能归为 `started` |
| 未包含阅读状态 | 不过滤 | 返回 `finished`、`started`、`unknown` 标签 |

分类也必须按多来源合并，而不是“书架字段非空即遮蔽详情字段”：保留书架、详情、本地状态各自的分类来源，任一来源匹配即可成为候选；冲突时在结果中保留规范化分类和来源集合。书名相同但 `bookId` 不同的记录先按稳定书目键去重，再保留所有来源引用。

### 5.3 跨书笔记检索

增加显式作用域，而不是用空 `bookId` 表示全局：

```ts
type NoteRetrievalScope =
  | { kind: "book"; bookId: string }
  | { kind: "library"; bookIds?: string[] };
```

跨书搜索只服务“笔记主题发现”，例如“根据我的笔记找出与消费主义焦虑有关的内容”。流程如下：

```text
NoteSearchQuery(scope = library)
  -> 结构化筛选（笔记类型、书籍范围）
  -> FTS5 词法候选
  -> ready 向量索引时获取查询 embedding
  -> 余弦排序 + RRF 融合
  -> 返回带书名、章节、笔记类型的 Top-K
```

结果必须标记为“相关笔记候选”，提供 `matchedItemCount`、`includedItemCount` 和 `coverage = sampled`。跨书模式不能回答“读过哪些经济理财书”，只能作为“哪些笔记涉及经济理财主题”的补充入口。

`NoteRetrievalScope::Library` 必须贯穿全部检索步骤，而不只是向量 SQL：

- 可用笔记数量与书籍范围过滤；
- `read_book_documents` 等候选读取；
- FTS5 候选查询与词法回退；
- 向量候选、RRF 融合和多样性重排；
- 分页游标的排序键、稳定文档标识和跨页 ranking 快照；
- 命中项补充 `bookId`、书名和章节来源。

实现应收敛为 `search_notes_with_scope`，由单书与跨书入口共用，禁止只删除 `search_ready_profile` 中的 `book_id = ?` 条件后分别维护两套词法和分页逻辑。

### 5.4 单书聊天上下文

将当前同步的 `read_assistant_retrieved_book_notes_context` 改为在异步请求阶段调用统一检索门面：

```rust
retrieve_note_context(scope, plan, preferences)
  -> search_notes_with_semantic_fallback(...)
  -> RetrievalDiagnostic + selected notes
```

这样普通单书问答、结构化 `noteSearch` action 和聊天上下文都得到相同的：

- `hybrid`、`lexical`、`hybridFallback` 策略选择；
- Provider/模型漂移、索引未完成、查询 embedding 失败时的降级；
- 词法精确匹配优先规则；
- 命中数、注入数与来源引用。

不要在持有 SQLite 连接时发起网络 embedding 请求；应先读取计划和索引元数据、释放连接、异步生成 query embedding，再重新打开连接读取候选。

## 6. 检索诊断与 UI

### 6.1 统一诊断合同

```ts
type RetrievalDiagnostic = {
  scope: "book" | "library";
  strategy:
    | "structured"
    | "recent"
    | "lexical"
    | "likeFallback"
    | "hybrid"
    | "hybridFallback"
    | "notRequested";
  availableItemCount?: number;
  matchedItemCount?: number;
  includedItemCount?: number;
  coverage?: "exhaustiveMatch" | "sampled";
  indexStatus?:
    | "ready"
    | "missing"
    | "building"
    | "failed"
    | "cancelled"
    | "superseded";
  reason?:
    | "structuredCatalogQuery"
    | "noNoteIntent"
    | "globalScopeNoNoteSearch"
    | "indexUnavailable"
    | "providerSettingsChanged"
    | "embeddingQueryFailed";
};
```

`ReadingAssistantUsedContext` 与结构化 action 都应携带该对象；同一回答只显示一次高优先级诊断，避免上下文标签重复堆叠。

### 6.2 回答依据文案

| 场景 | 文案 |
| --- | --- |
| 书目清单完整 | `基于本机书架、书籍详情和阅读进度确认的 12 本经济理财书。` |
| 书目清单部分 | `阅读统计显示 34 本经济理财书；当前本机仅能确认其中 12 本，未确认部分不会补造书名。` |
| 单书混合检索 | `在《书名》本地 86 条笔记中命中 19 条，本次引用 12 条；使用混合检索。` |
| 跨书混合检索 | `在本机 24 本有笔记的书中检索到 31 条相关笔记，本次展示 20 条；不是分类书目清单。` |
| 不使用向量 | `本次是结构化书目查询，不使用笔记语义索引。` |
| 向量回退 | `语义索引当前不可用，已使用本地词法检索。` |

### 6.3 设置页与助手联动

语义索引设置卡保留 Provider、模型和构建进度，但应增加只读状态说明：

- `ready`：单书/跨书主题笔记检索可尝试混合召回；
- `building`、`failed`、`cancelled`、`superseded`：助手将自动词法回退；
- 无索引：结构化书目查询不受影响。

聊天消息上的依据标签应显示本次实际策略，不用“已构建索引”替代本次查询证据。

## 7. 数据与迁移

1. 不变更既有 `retrieval_documents` 中划线和想法的语义索引语义。
2. 新增书目查询服务层，第一期直接聚合 `shelf_entries`、`book_details`、`book_progress`、`reading_item_states`，避免复制一份易失效的书目表。
3. 若后续查询频率证明有必要，再引入可重建的 `book_catalog_projection`；其内容来源必须是上述表，不能来自模型推断。
4. 跨书笔记搜索复用现有向量表，但通过显式 `NoteRetrievalScope::Library` 改造词法、向量、排序与分页全链路；命中项需要补充书名，优先从文档元数据读取，缺失时关联书籍表。
5. 笔记或书目同步完成后，分别更新可重建的检索文档和书目投影；不要让阅读统计聚合成为书目明细的唯一来源。
6. 远程语义索引构建授权与聊天原始笔记授权必须分别保存和展示：前者允许将笔记正文发送给 Embedding Provider 以建索引，后者允许将命中正文注入聊天 Provider；任一授权都不自动授予另一项权限。

## 8. 实施阶段

### P1：修复结构化书目路由

- 扩展 `parse_reading_assistant_category_books_query` 的表达覆盖。
- 将“梳理读过的经济理财类书籍”加入回归测试。
- 定义 `finished`、`started`、`unknown` 的证据和“读过”的返回语义。
- 合并书架、详情、进度和本地状态中的多来源分类，覆盖分类冲突与跨来源去重。
- 返回聚合总数、可确认书目数、差额和明确同步建议。
- 不引入向量依赖。

### P1.5：书目分析上下文

- 将 `CatalogList` 与 `CatalogAnalysis` 分开路由。
- `CatalogAnalysis` 只把 P1 已确认书目、分类和阅读状态传给 Provider，不注入原始笔记。
- 当无可确认书目时，返回数据缺口与同步建议，不让 Provider 根据统计总数猜测书名。

### P2：统一单书笔记检索门面

- 抽出异步 `retrieve_note_context`。
- 让普通单书聊天与 `noteSearch` 共用 `search_notes_with_semantic_fallback`。
- 保留词法精确查询、分页游标和错误回退合同。

### P3：跨书主题笔记发现

- 引入 `NoteRetrievalScope` 和库级 query。
- 将 `availableCount`、FTS、词法回退、向量候选、RRF 和游标统一至 `search_notes_with_scope`。
- 为结果补充书名来源与跨书筛选。
- 增加“按笔记找主题”的明确 UI 入口或意图提示，避免与书目清单混淆。

### P4：诊断与验收 UI

- 在聊天消息依据中展示实际检索策略和计数。
- 设置页展示索引是否会影响主题检索，但不把它描述为书目查询前置条件。
- 对无索引、索引构建中、Provider 漂移、Embedding 查询失败进行可见回退说明。

## 9. 测试与验收

### 9.1 后端测试

- “梳理读过的经济理财类书籍”命中 `BookCatalogQuery`。
- 聚合统计为 34、可确认书目为 12 时返回 `partial`，不生成额外书名。
- `读过`、`读完`、`在读`分别返回约定的 `finished`、`started` 状态，不把有阅读进度的书误报为已读完。
- 书架和详情分类冲突时，匹配来源可追溯；重复书籍按稳定书目键合并。
- 全局普通问题不误启用原始笔记或向量查询。
- 单书主题问答在 ready profile 时使用 `hybrid`；精确短语仍使用 `lexical`。
- 查询 embedding 失败、设置漂移、无 ready profile 时回退为 `hybridFallback` 或 `lexical`，并返回诊断原因。
- 跨书主题检索返回正确的 `bookId`、书名、章节和笔记类型，不跨越用户指定书籍范围。
- 跨书混合检索的第二页与第一页使用同一排序快照，不重复或遗漏命中项。

### 9.2 前端测试

- 分类书目 action 显示“统计总数 / 可确认书目 / 未确认差额”。
- 全局普通回答显示 `notRequested`，不会暗示向量失效。
- 单书和跨书主题结果展示策略、命中数、展示数及范围说明。
- `hybridFallback` 显示本地词法回退，而非失败空态。
- 移动端依据标签不挤压操作按钮，书目卡的书名、作者和状态不溢出。

### 9.3 验收场景

1. 书架与详情完整时，询问“梳理读过的经济理财类书籍”列出可验证书名。
2. 只有统计聚合时，回答列出总数并明确逐本数据未同步，不伪造书名。
3. 询问“从我的笔记中找跨书的经济理财主题”时，在 ready 索引下显示混合检索结果和涉及书籍。
4. 关闭聊天原始笔记授权或没有 ready 索引时，主题检索说明范围和词法回退；关闭远程索引授权时不允许创建或重建 embedding 索引。
5. 精确查询“包含‘复利’的笔记”仍返回可分页的词法匹配，不被语义召回改变完整性语义。

## 10. 风险与取舍

- 分类元数据本身不完整时，无法可靠补齐逐本书名；这是数据同步问题，不应以向量或大模型猜测掩盖。
- 跨书 embedding 查询会向已授权 Provider 发送用户查询文本；远程索引构建阶段会按独立授权将笔记正文发送给 Embedding Provider，聊天阶段是否将命中正文发送给聊天 Provider 由另一项独立授权决定。
- 全库余弦扫描适合个人库当前规模；达到既有文档定义的性能阈值后再评估 `sqlite-vec` 或 HNSW。
- 将同步上下文构造改为异步检索需要谨慎调整调用边界，避免聊天流式、取消和 SQLite 连接生命周期回归。

## 11. 实施记录

### 2026-08-17：P1 结构化书目路由

- 已覆盖“梳理、归类、盘点、汇总”等书目清单表达，并让包含影响、比较或偏好等分析诉求的问题保留在普通问答路径。
- 已按“读完”与“读过”的不同证据规则过滤结果：前者只返回已完成书籍，后者还可返回存在实际阅读记录但未完成的书籍。
- 已合并书架、书籍详情、阅读进度和本地状态候选；分类匹配不再由单一来源遮蔽，阅读完成度与时间证据取更强值。
- 前端已把有阅读证据但未完成的书标为“有阅读记录”，避免误称“已读完”。
- 已增加后端与前端回归测试。P1 只负责结构化书目事实，不使用向量索引；跨书主题检索由 P3 负责。

### 2026-08-17：P1.5 书目分析上下文

- 已将包含影响、启发、比较、原因或偏好等分析诉求的分类书目问题路由到 `CatalogAnalysis`，而非普通全局问答。
- 有可确认书目时，Provider 仅接收书名、作者、分类、阅读状态和统计覆盖边界；不接收原始笔记、书籍详情、阅读记忆或历史对话。
- 书目为空或关闭个性化上下文时，直接返回本地数据缺口说明，不调用 Provider，也不根据统计总数推测书名或分析结论。
- 分析回答保留分类书目卡片，并以“分类书目”显示实际依据；跨书主题发现和检索诊断分别由 P3、P4 实施。

### 2026-08-17：P2 单书笔记检索门面

- 已增加异步 `retrieve_note_context`：先确保本地检索候选可用并关闭 SQLite 连接，再复用 `search_notes_with_semantic_fallback` 执行词法或混合检索。
- 普通单书聊天与显式笔记检索共用同一混合检索、精确短语优先和 `HybridFallback` 降级路径；原始笔记正文仅在聊天原始笔记授权开启时注入聊天 Provider。
- 检索异常仍保留原有本地均衡抽样兜底，并在上下文标识 `retrievalMode = unavailable`；不会在持有 SQLite 连接时进行 Embedding 网络请求。
- 本轮生产编译、格式、TypeScript 与术语验证通过；Rust 库测试已通过。

### 2026-08-17：P3 跨书主题笔记发现

- 已增加 `LibraryNoteSearchQuery` 意图：仅当问题同时包含笔记记录信号和跨书范围信号时触发；“我读过哪些书”仍走结构化书目查询。
- 全局助手已复用库级词法、向量、RRF、分页和游标快照链路，返回 `scope=library`、涉及书籍数、命中笔记的 `bookId` 与书名；未开启原始笔记授权时仍只返回元数据。
- 前端已同步跨书结果契约和翻页请求，卡片显示“我的笔记 / 涉及 N 本书”，每条结果显示所属书名；旧单书请求仍可省略 `scope`，按 `book` 兼容解析。
- 已补充跨书意图、结果映射和 UI 回归测试；检索结果统一携带范围、命中、注入和覆盖边界。

### 2026-08-17：P4 检索诊断可见性

- 笔记检索 action 和原始笔记上下文统一携带结构化 `RetrievalDiagnostic`，包含范围、策略、可用数、命中数、注入数、覆盖、索引状态和回退原因；卡片将其转换为用户可读的实际策略说明。
- 已区分 `indexUnavailable`、`providerSettingsChanged`、`embeddingQueryFailed` 三类主要回退原因；旧历史消息中的字符串诊断仍由前端兼容展示。
- 语义索引设置页明确：索引构建中、Provider 配置漂移或向量查询失败不会阻断本地词法检索，语义索引不是书目查询或本地笔记查询的前置条件。
- 普通回答的 `basisNotice` 已在完成消息中展示，与结构化 action 依据分开，避免把“索引已构建”误当作本次查询实际使用的证据。
- 已补充结构化诊断和诊断文案的前后端回归覆盖；更细粒度的远程 Provider 错误码遥测仍由后续性能与可观测性工作单独评估，不改变当前回退合同。
