# 微信书单接入改造规划

## 背景

微信读书 `/shelf/sync` 原始回包中除了 `books[]`、`albums[]` 和 `mp` 外，还包含 `archive[]` 书单信息：

- `archive[].name`：书单名称。
- `archive[].bookIds`：书单内的 `bookId` 列表。

当前项目已经将书架条目同步到 `shelf_entries`，并在前端书架页展示类型、分类、搜索等筛选能力。但 `archive[]` 只保存在原始 `raw_cache` 中，没有进入类型化响应、数据库读取模型或页面筛选逻辑，因此业务层无法稳定使用微信书单信息。

本轮改造目标是把微信书单作为“微信书架的只读组织维度”接入现有书架页，先解决查看和筛选，不扩展成独立书单管理系统。

## 目标

1. 保留并返回 `/shelf/sync` 中的 `archive[]` 书单信息。
2. 在重启应用后仍可从本地缓存读取书单信息。
3. 在微信书架页内新增书单筛选能力。
4. 明确展示书单内可匹配书架条目数和缺失条目数。
5. 保持当前书架总数口径不变：`books + albums + mp` 仍是可见书架条目来源。

## 非目标

- 不新增独立“书单”路由。
- 不支持创建、重命名、删除、排序或编辑微信书单。
- 不同步任何书单变更回微信读书。
- 不根据 `archive[].bookIds` 自动补拉未出现在 `books[]` 的书籍详情。
- 不把书单纳入书架总数统计。
- 不把书单作为 AI 分析、批量导出或阅读路线的独立输入源。
- 不重做现有书架卡片、详情页和候选书架流程。

## 数据口径

微信书单是书架条目的组织维度，不是书架条目本身。

```text
书架可见条目 = books[] + albums[] + mp
微信书单 = archive[]
```

书单中可能出现当前书架条目列表无法匹配的 `bookId`，例如：

- 该书不在当前 `books[]` 中。
- 该书是服务端内部状态项。
- 该书已从书架移除但仍残留在书单中。
- 该书属于当前项目暂不解析的条目类型。

首版只展示匹配结果，不制造占位书籍，也不改变总数统计。

## 数据模型

后端新增记录类型：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfArchiveRecord {
    pub id: String,
    pub name: String,
    pub book_ids: Vec<String>,
    pub matched_entry_count: usize,
    pub missing_book_count: usize,
    pub raw_json: String,
}
```

前端新增类型：

```ts
export type ShelfArchive = {
  id: string;
  name: string;
  bookIds: string[];
  matchedEntryCount: number;
  missingBookCount: number;
  raw?: unknown;
};
```

`BookshelfSnapshot` 扩展为：

```ts
export type BookshelfSnapshot = {
  entries: ShelfEntry[];
  archives: ShelfArchive[];
  summary: BookshelfSummary;
};
```

## ID 规则

书单可能重名，因此不能直接把 `name` 作为唯一 ID。

推荐首版使用同步返回顺序生成稳定会话内 ID：

```text
archive:{index}:{normalizedName}
```

规则：

- `index` 使用 `archive[]` 中的原始顺序。
- `normalizedName` 只用于调试和可读性，不用于展示。
- 展示名始终使用 `archive.name`。
- 同名书单通过不同 `index` 区分。

如果后续上游返回稳定书单 ID，再优先使用上游 ID，并保留兼容映射。

## 后端改造

### 1. Mapper 接入 archive

修改 `src-tauri/src/mappers/shelf.rs`：

- `BookshelfSnapshot` 增加 `archives: Vec<ShelfArchiveRecord>`。
- `map_shelf_response` 读取 `value.archive`。
- 只解析数组结构，非数组时返回空列表。
- 每个书单提取 `name` 和 `bookIds`。
- `bookIds` 只保留非空字符串或可转为字符串的数字。
- 基于当前 `entries` 计算 `matchedEntryCount` 和 `missingBookCount`。

匹配规则：

- 只匹配 `entry.type === "book"` 的条目。
- `albums[]` 使用 `albumId`，不和书单 `bookIds` 混算。
- `mp` 不参与书单匹配。

验收：

- 有 `archive[]` 时响应包含书单列表。
- 没有 `archive[]` 时响应包含空数组。
- 同名书单不会 ID 冲突。
- 书单内重复 `bookId` 不重复计入匹配数量。

### 2. 持久化 shelf_archives

新增表：

```sql
CREATE TABLE IF NOT EXISTS shelf_archives (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    book_ids_json TEXT NOT NULL,
    matched_entry_count INTEGER NOT NULL DEFAULT 0,
    missing_book_count INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

服务层新增：

- `replace_shelf_archives(connection, archives, updated_at)`。
- `read_shelf_archives(connection)`。

`sync_shelf` 同步成功后在同一事务中替换：

1. `shelf_entries`
2. `shelf_archives`
3. `raw_cache`
4. `sync_state`

`get_bookshelf` 从 SQLite 同时读取 `shelf_entries` 和 `shelf_archives`。

验收：

- 离线打开应用仍能看到上次同步的书单。
- 同步失败不清空已有书单。
- 同步成功后旧书单被完整替换。

### 3. 原始缓存保留

继续写入 `raw_cache(section="shelf", key="latest")`。

`raw_cache` 是调试和兜底来源，但页面和业务逻辑不直接依赖它读取书单，避免前端重复解析上游原始结构。

## 前端 API 改造

修改 `src/lib/types.ts`：

- 新增 `ShelfArchive`。
- `BookshelfSnapshot` 增加 `archives`。

修改 `src/lib/reading-api.ts`：

- `BookshelfResponseRecord.snapshot` 增加 `archives?: ShelfArchiveRecord[]`。
- 新增 `mapShelfArchive`。
- `mapBookshelfResponse` 返回 `archives`。
- Web preview 构造响应时补 `archives: []`，保持兼容。

验收：

- 老数据没有 `archives` 字段时前端不报错。
- 所有调用 `getBookshelf` 和 `syncShelf` 的页面保持可用。
- 单测覆盖空数组、正常书单、异常字段和重复 `bookId`。

## 页面展示

首版放在当前微信书架页，不新增路由。

### 信息架构

推荐结构：

```text
书架标题 / 同步按钮
统计摘要：全部条目、电子书、有声书、文章收藏、微信书单

筛选区
类型：全部 | 电子书 | 有声书 | 文章收藏
分类：全部分类 | 文学 | 计算机 | ...
书单：全部书单 | 未归入书单 | 长期主义 24 | 技术栈 12 | ...

搜索框
书架网格
```

说明：

- 类型是主筛选。
- 分类来自 `entry.category` 的父分类聚合。
- 书单来自微信 `archive[]`。
- 搜索继续在当前 `类型 + 分类 + 书单` 范围内过滤。
- 书单筛选不影响分类选项来源，避免筛选项互相闪烁。

### 书单筛选规则

新增状态：

```ts
const [archiveFilter, setArchiveFilter] = useState("all");
```

取值：

- `all`：不按书单过滤。
- `unarchived`：只展示不属于任何微信书单的电子书条目。
- `archive.id`：只展示该书单中能匹配到的电子书条目。

过滤顺序建议保持简单：

```text
entries
  -> type filter
  -> category filter
  -> archive filter
  -> query filter
```

特殊规则：

- 选中具体书单时，只匹配 `book` 条目。
- 如果当前类型为 `album` 或 `mp`，书单筛选应自动回到 `all` 或禁用。
- `未归入书单` 只对 `book` 条目有意义。
- 如果没有任何书单，不展示书单筛选行。

### 书单摘要

页面顶部统计增加：

```text
微信书单 12 个
```

选中具体书单后，在筛选区下方显示轻量说明：

```text
书单：长期主义，包含 24 本，当前书架可匹配 21 本。
```

如果存在缺失：

```text
有 3 本暂未出现在当前书架同步结果中，已暂不展示。
```

该提示不提供“自动补全”按钮。

### 卡片展示

首版不强制在每张卡片展示所属书单，避免卡片信息密度失控。

可选轻量增强：

- 鼠标悬停或详情区展示前 1 个所属书单。
- 多个书单时显示 `+N`。

该增强不作为首版必需项。

## 空态

需要覆盖：

- 没有任何微信书单：隐藏书单筛选。
- 某书单无匹配条目：提示“该书单当前没有可匹配的书架条目”。
- `未归入书单` 无结果：提示“当前电子书都已归入微信书单”。
- 搜索无结果：沿用现有搜索空态，但说明当前仍受书单筛选影响。

## 测试计划

### Rust 单测

覆盖 `src-tauri/src/mappers/shelf.rs`：

- `map_shelf_response` 能解析 `archive[]`。
- `archive[].bookIds` 支持字符串和数字。
- 空名称书单被过滤或使用兜底名。
- 重复 `bookId` 不重复计算。
- `matchedEntryCount` 和 `missingBookCount` 正确。
- 没有 `archive[]` 时返回空数组。

覆盖 `src-tauri/src/services/shelf.rs`：

- `replace_shelf_archives` 能完整替换数据。
- `read_shelf_archives` 能按 `sort_order` 读取。
- 同步持久化同时写入 entries 和 archives。

### TypeScript 单测

覆盖 `src/lib/reading-api.test.ts`：

- `mapBookshelfResponse` 能映射 `archives`。
- 缺少 `archives` 字段时返回空数组。
- `rawJson` 可解析为 `raw`。

覆盖 `src/pages/bookshelf-filter.ts`：

- 按书单过滤只返回匹配书籍。
- `unarchived` 只返回未归入书单的电子书。
- 类型、分类、书单、搜索组合过滤稳定。

### 页面回归

覆盖：

- 有书单、有缺失、有同名书单。
- 无书单。
- 选择 `电子书 -> 书单 -> 搜索`。
- 切换到 `有声书` 或 `文章收藏` 后书单筛选状态处理。
- 暗色主题和窄屏布局。

建议命令：

```bash
npm test -- --run
npm run build
```

如修改 Rust 服务层，再补充：

```bash
cd src-tauri
cargo test
```

## 实施步骤

### 1. 后端类型和 mapper

- 增加 `ShelfArchiveRecord`。
- 扩展 `BookshelfSnapshot`。
- 实现 `map_archive_entries`。
- 补 mapper 单测。

完成后，`sync_shelf` 的即时响应已经能带出书单，但 `get_bookshelf` 离线读取仍暂不完整。

### 2. 后端持久化

- 新增 `shelf_archives` 表。
- 新增替换和读取函数。
- `sync_shelf` 同事务写入。
- `get_bookshelf` 同步读取。
- 补服务层单测。

完成后，书单具备本地缓存能力。

### 3. 前端 API

- 扩展类型定义。
- 扩展 `reading-api` mapper。
- Web preview 兼容空书单。
- 补 TS 单测。

完成后，页面可以稳定读取 `snapshot.archives`。

### 4. 书架页筛选

- 在 `BookshelfPage` 增加 `archiveFilter`。
- 在 `bookshelf-filter.ts` 增加书单过滤辅助函数。
- 新增书单筛选行和选中书单说明。
- 处理类型切换后的无效书单状态。

完成后，用户能在微信书架页按微信书单筛选。

### 5. 视觉和回归

- 控制筛选区高度，避免类型、分类、书单三行占满首屏。
- 窄屏下书单行允许横向滚动或折叠。
- 暗色主题补齐新样式。
- 运行单测、构建和页面截图回归。

## 风险和边界

### 书单与条目不完全匹配

`archive[].bookIds` 不保证都能在 `books[]` 中找到。首版用 `missingBookCount` 明确展示，不补数据。

### 书单数量过多

如果用户有很多书单，完整展开会挤占首屏。首版复用分类筛选的“预览 + 更多”模式，或使用横向滚动。

### 同名书单

用 `index` 参与 ID，展示时仍显示原始名称。必要时在调试信息或 title 中补序号，不在主 UI 中制造噪音。

### 旧缓存兼容

旧版本数据库没有 `shelf_archives`。建表必须使用 `CREATE TABLE IF NOT EXISTS`，读取失败不能影响书架主体展示。

## 验收标准

1. 同步书架后，响应中包含 `snapshot.archives`。
2. 重启应用后，`get_bookshelf` 仍能返回上次同步的书单。
3. 微信书架页能看到书单数量。
4. 有书单时，用户可以按具体书单筛选书架条目。
5. 有缺失条目时，页面显示缺失数量但不生成占位卡片。
6. 没有书单时，页面不出现空的书单筛选行。
7. 原有类型、分类、搜索筛选行为不回退。
8. 书架总数、电子书数、有声书数、文章收藏数不因书单接入发生变化。

## 原则说明

- KISS：书单首版只做只读信息和筛选。
- YAGNI：不提前实现独立路由、编辑、同步回写和 AI 分析。
- DRY：复用现有书架筛选、空态和同步状态模式。
- SOLID：mapper、持久化、API 映射和页面展示各自负责单一层面的变化。
