# AI 阅读助手分类书目查询设计

## 背景

用户在 AI 阅读助手中提出“我读过哪些理财类书籍”时，期望得到的是具体书名列表，而不是分类统计摘要。

当前回答只能给出类似“你读过 34 本经济理财类书籍，总投入 90 小时 38 分钟”的聚合结论，并提示本地缓存没有保存具体书名列表。这说明系统已经读取到 `reading_stats.preferCategory` 的分类聚合，但没有建立“分类 -> 本地可验证书目”的查询能力。

这个问题不应通过向量数据库解决。它是结构化事实查询，核心字段是书名、作者、分类、阅读状态、阅读进度和统计口径，应优先使用 SQLite 中已有结构化数据。

## 问题定义

当前缺口分为三层：

1. 意图识别过粗。
   `ReadingStats` scope 下的问题容易被归入统计聚合，而“读过哪些 X 类书”实际是分类书目查询。

2. 上下文只提供聚合信号。
   `latestStatsSignals.categories` 能说明某分类读了多少本、投入多长时间，但不能列出每本书。

3. 本地书目明细未被组织成可查询能力。
   `shelf_entries`、`book_details`、`book_progress`、`reading_item_states` 中存在可用字段，但当前没有按分类聚合并返回可验证书单的 action。

## 目标

新增一个窄范围能力：分类书目查询。

目标行为：

- 用户问“我读过哪些理财类书籍”时，返回本地可验证的理财/经济理财类书目。
- 同时说明统计口径：例如统计缓存显示“经济理财 34 本”，本地明细当前可列出 N 本。
- 当统计总数和本地可列明细不一致时，不编造缺失书名，明确说明缓存边界。
- 对“理财类”“经济理财类”“财经类”等近义表达做有限规则归一。
- 保持本地结构化查询，不调用 AI Provider，不引入向量数据库。

## 非目标

本设计不做：

- 不引入向量数据库。
- 不做跨笔记语义检索。
- 不基于书籍简介或笔记语义猜测分类。
- 不用模型补全缺失书名。
- 不抓取微信读书远端明细。
- 不修改微信读书数据。
- 不做完整自然语言 SQL 引擎。
- 不把所有统计问答都改成本地规则。

## 为什么不需要向量数据库

“读过哪些理财类书籍”是确定性结构化查询：

- 分类来自 `category` 或统计分类字段。
- 读过/读完来自 `is_finished`、`book_progress`、阅读时长或书架状态。
- 输出需要书名和作者。
- 结果需要可解释、可复核。

向量数据库适合语义相似召回，例如“找和消费主义焦虑有关的划线”“哪些笔记谈到长期主义”。它不适合替代事实查询，尤其不适合回答计数、分类、完成状态这类需要精确字段的任务。

本阶段如果需要文本检索，优先考虑 SQLite FTS；只有跨书笔记语义检索成为核心需求时，再评估 embedding 和向量索引。

## 用户场景

### 场景 1：按分类列出已读书

用户问题：

```text
我读过哪些理财类书籍
```

期望回答：

```text
统计缓存显示“经济理财”分类累计 34 本；当前本地可验证到以下 8 本：
1. 《富爸爸穷爸爸》 - 罗伯特·清崎
2. 《小狗钱钱》 - 博多·舍费尔
...

其余书目只存在于统计聚合中，当前本地明细缓存不足，无法可靠列出。
```

### 场景 2：按分类列出读完书

用户问题：

```text
我读完了哪些经济类书
```

期望回答只列 `is_finished = true` 或进度完成的可验证书目，并说明过滤条件。

### 场景 3：分类不存在或本地无明细

用户问题：

```text
我读过哪些哲学类书
```

如果统计缓存没有该分类，且本地明细也没有匹配：

```text
当前本地缓存没有找到“哲学”分类下的已读书目。可以先同步书架和阅读统计；如果你希望按关键词查找书名或笔记，可以改问“书名里包含哲学的书有哪些”。
```

## 意图设计

新增 intent：

```rust
ReadingAssistantIntent::CategoryBooksQuery
```

触发条件：

- 包含书目查询动词：
  - `哪些`
  - `哪几本`
  - `列出`
  - `书单`
  - `读过哪些`
  - `看过哪些`
  - `读完哪些`
- 包含分类表达：
  - `理财`
  - `经济`
  - `经济理财`
  - `财经`
  - `历史`
  - `文学`
  - `心理`
  - `管理`
  - `科技`
  - `计算机`
  - 后续可扩展
- 排除明显的新书推荐意图：
  - `推荐`
  - `找新书`
  - `加入候选`
  - `没读过`

优先级：

1. 微信读书可用性搜索。
2. 分类书目查询。
3. 统计聚合。
4. 新书推荐。
5. 普通问答。

原因：

- “读过哪些 X 类书”虽然包含统计语义，但用户要的是明细。
- 分类书目查询应优先于总计统计聚合。

## 分类归一

首版使用小型规则表，不引入模型判断。

示例：

```rust
struct CategoryQuery {
    label: String,
    aliases: Vec<&'static str>,
}
```

初始映射：

| 用户表达 | 归一分类候选 |
| --- | --- |
| 理财、财务、财富 | 经济理财、理财、财经 |
| 经济、经济类 | 经济理财、经济、财经 |
| 心理、心理学 | 心理、心理学 |
| 历史 | 历史 |
| 文学、小说 | 文学、小说 |
| 管理、商业 | 管理、商业 |
| 科技、技术 | 科技、计算机、互联网 |

匹配策略：

- 优先精确匹配 `category`。
- 再做包含匹配。
- 再使用别名归一。
- 不用 embedding 做分类相似度。

## 数据来源

### 1. 统计聚合

来源：

- `reading_stats.raw_json`
- `preferCategory`

用途：

- 读取统计分类名称。
- 读取统计口径下的 `readingCount`。
- 读取分类阅读时长。
- 给用户说明“统计缓存显示多少本”。

限制：

- 不含完整书名列表。
- 不作为明细来源。

### 2. 本地书架

来源：

- `shelf_entries`

字段：

- `id`
- `title`
- `author`
- `category`
- `is_finished`
- `last_read_at`
- `updated_at`

用途：

- 提供本地可验证书名。
- 判断是否书架内图书。
- 判断是否已读完。

### 3. 书籍详情

来源：

- `book_details`

字段：

- `book_id`
- `title`
- `author`
- `category`

用途：

- 补齐分类和作者。
- 补齐书架条目的明细。

### 4. 阅读进度

来源：

- `book_progress`

字段：

- `book_id`
- `progress_percent`
- `finish_time`
- `record_reading_time_seconds`

用途：

- 判断“读过”和“读完”。
- 排序时优先展示读完或阅读投入较高的书。

### 5. 本地阅读状态

来源：

- `reading_item_states`

字段：

- `item_id`
- `item_type`
- `status`
- `title`
- `author`
- `category`

用途：

- 补充候选、本地状态和分类。
- 首版默认不把 `candidate` 计入“读过”，除非用户问“候选里有哪些理财书”。

## 查询语义

### “读过”

满足任一条件可视为读过：

- `shelf_entries.type = 'book'` 且存在书架记录。
- `book_progress.progress_percent > 0`。
- `book_progress.record_reading_time_seconds > 0`。
- `shelf_entries.last_read_at IS NOT NULL`。

首版不要求读完。

### “读完”

满足任一条件可视为读完：

- `shelf_entries.is_finished = 1`。
- `book_progress.progress_percent >= 100`。
- `book_progress.finish_time > 0`。

### “在读”

满足：

- 已读过。
- 未读完。

## 后端结构

### 新增输出类型

```rust
pub struct ReadingAssistantCategoryBooksOutput {
    pub category_label: String,
    pub matched_category_titles: Vec<String>,
    pub query_status: String,
    pub total_stat_count: Option<i64>,
    pub total_stat_reading_time_text: Option<String>,
    pub listed_count: usize,
    pub message: String,
    pub books: Vec<ReadingAssistantCategoryBookItem>,
}

pub struct ReadingAssistantCategoryBookItem {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub category: Option<String>,
    pub progress_percent: Option<i64>,
    pub is_finished: bool,
    pub reading_time_text: Option<String>,
    pub source: String,
}
```

### 扩展 action

```rust
pub enum ReadingAssistantActionOutput {
    WereadSearch(...),
    StatsAggregate(...),
    BookReview(...),
    CategoryBooks(ReadingAssistantCategoryBooksOutput),
}
```

### 新增入口

```rust
fn answer_reading_assistant_category_books_query(...)
    -> Result<ReadingAssistantAnswer, AiServiceError>
```

该入口：

1. 解析分类查询。
2. 从统计缓存读取聚合口径。
3. 从本地表查询可验证书目。
4. 构造固定回答和结构化 action。
5. 不调用 AI Provider。
6. 可保存进聊天历史。

## SQL 设计

首版可用多表查询后在 Rust 中合并去重，避免复杂 SQL 过早固化。

候选来源：

```sql
SELECT
  shelf.id AS book_id,
  shelf.title,
  shelf.author,
  shelf.category,
  shelf.is_finished,
  shelf.last_read_at,
  progress.progress_percent,
  progress.finish_time,
  progress.record_reading_time_seconds,
  detail.category AS detail_category,
  detail.author AS detail_author
FROM shelf_entries shelf
LEFT JOIN book_progress progress ON progress.book_id = shelf.id
LEFT JOIN book_details detail ON detail.book_id = shelf.id
WHERE shelf.type = 'book'
```

合并规则：

- `title` 以 `shelf.title` 为主。
- `author` 以 `shelf.author` 为主，缺失时使用 `detail.author`。
- `category` 优先 `shelf.category`，缺失时使用 `detail.category`。
- `book_id` 去重。

排序：

1. 已读完优先。
2. 阅读时长高优先。
3. 最近阅读时间高优先。
4. 标题升序。

数量限制：

- 首版最多返回 50 本。
- UI 默认展示前 12 本，提供展开。

## 回答策略

### 完整匹配

当统计计数和本地列出数量一致或接近：

```text
我在本地可验证书目中找到 N 本“经济理财”相关书籍：
...
```

### 聚合多于明细

当 `total_stat_count > listed_count`：

```text
统计缓存显示“经济理财”分类累计 34 本；当前本地明细可验证到 8 本。下面只列出可验证书目，不补写缺失书名。
```

### 无统计但有本地明细

```text
当前统计缓存没有对应分类聚合，但本地书架可验证到 N 本相关书籍：
...
```

### 无匹配

```text
当前本地缓存没有找到“理财”相关的已读书目。可以先同步书架和阅读统计，或换用更具体的分类关键词。
```

## 前端设计

在 `ReadingAssistantPanel` 中新增 action 渲染：

```tsx
if (message.action.type === "categoryBooks") {
  return <CategoryBooksAction payload={message.action.payload} />;
}
```

展示结构：

- 顶部说明：
  - 分类名。
  - 统计总数。
  - 本地可列数量。
- 书目列表：
  - 书名。
  - 作者。
  - 分类。
  - 进度或已读完状态。
- 操作：
  - 打开书籍详情。
  - 可选：只看已读完。

首版不做复杂筛选器。若列表超过 12 本，使用“展开全部”。

## 历史记录

分类书目查询应保存为普通助手消息，并保存结构化 `action`。

历史回放要求：

- 不重新查询数据库。
- 直接展示当时回答和当时的 action payload。
- 如果用户想获取最新列表，需要重新提问。

## 测试计划

### Rust 单测

新增测试：

- `reading_assistant_intent_detects_category_books_query`
- `category_books_query_lists_books_from_shelf_and_details`
- `category_books_query_uses_stats_count_without_inventing_missing_books`
- `category_books_query_filters_finished_books`
- `category_books_query_returns_empty_state_when_no_match`
- `category_books_query_does_not_trigger_for_new_book_recommendation`

### 前端单测

新增测试：

- action 类型解析。
- 分类书单 action 渲染。
- 展开列表。
- 打开书籍详情回调。

### e2e

新增覆盖：

- 在阅读统计页输入“我读过哪些理财类书籍”。
- 断言回答包含具体书名。
- 断言不出现“无法一一列举”这类错误兜底。
- 断言没有调用 Provider mock。

## 分阶段实施

### P0：本地规则查询

- 新增 intent。
- 新增后端 action。
- 查询本地书架和书籍详情。
- 前端渲染结构化书单。
- 不调用 AI Provider。

### P1：分类覆盖增强

- 增加更多分类别名。
- 支持“候选里有哪些 X 类书”。
- 支持“在读的 X 类书”。
- 支持“读完的 X 类书”。

### P2：文本检索增强

如果用户需要“书名/作者/笔记包含某关键词”的检索，可引入 SQLite FTS。

### P3：语义检索评估

只有当跨书笔记语义召回成为核心需求时，评估本地 embedding 和向量索引。

## 风险与边界

### 分类字段不一致

微信读书、书架、详情和统计里的分类可能不完全一致。

处理方式：

- 输出 `matched_category_titles`。
- 明确说明匹配口径。
- 不把模糊匹配伪装成精确分类。

### 统计总数和本地明细不一致

统计可能显示 34 本，但本地只能列出 N 本。

处理方式：

- 统计总数和本地可列数量分开展示。
- 不编造缺失书名。
- 建议用户同步书架、详情或统计。

### 用户表达过泛

例如“我读过哪些书”没有分类。

处理方式：

- 不进入分类书目查询。
- 可走统计聚合或普通问答。

## 验收标准

- “我读过哪些理财类书籍”返回具体本地可验证书目。
- 回答中区分统计总数和本地可列明细数。
- 本地没有明细时不编造书名。
- 不引入向量数据库。
- 不调用 AI Provider。
- 历史回放能恢复结构化书单 action。
- 现有统计聚合、微信读书搜索、新书推荐、复盘路由不回归。
