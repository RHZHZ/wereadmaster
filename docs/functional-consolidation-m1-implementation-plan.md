# M1 实施说明 —— 功能收敛第一里程碑(PR\-1 \~ PR\-7)

> **status: current** · 2026-08-04
> **实施状态**：PR-1 至 PR-7 对应的三维迁移、patch API、页面写入迁移、决策缓存、真实笔记门禁、selectors、glossary 与 P0-D 已完成；v1.0.17 正在执行正式发布门禁与资产验收。本文保留原实施规格与历史锚点。
> 上游:docs/functional\-consolidation\-blueprint.md(第 5、6 节);问题编号沿用 docs 分析报告(B1、C2……)。
> M1 出口条件:蓝图 5.1.7 / 5.2.4 / 5.3.4 验收全过;`npm test`、`cargo test --lib`、`npm run e2e` 全绿。
> 本文所有行号与符号名以 2026\-07\-26 工作区为锚点,已逐一与源码核对。

## 0 切片总览与依赖

| PR | 主题 | 主要触碰 | 依赖 |
| --- | --- | --- | --- |
| PR\-1 | 数据库三维化迁移 \+ patch 命令 | db.rs、services/reading\_state.rs、commands/reading\_state.rs、lib.rs | — |
| PR\-2 | 前端类型 / API / selectors 两条唯一规则 | types.ts、reading\-api.ts、新 reading\-selectors.ts | PR\-1 |
| PR\-3 | 九个写入点改造 \+ 详情页控件重组 \+ 三页接 selectors | 详见 §3 表 | PR\-2 |
| PR\-4 | 选书决策因子真接入(prompt v2 / hash v2) | services/ai.rs、commands/ai.rs、reading\-api.ts、candidate\-books.ts、book\-decision\-context.ts、两决策页 | PR\-1(读真实状态) |
| PR\-5 | noteCount 三态 \+ 决策缓存语义收紧 | App.tsx、BookAiSummaryPage、services/ai.rs、两决策页 | 可与 PR\-3 并行 |
| PR\-6 | 词典 glossary \+ 检查脚本 \+ 文案替换 \+ e2e testid | glossary.ts(新)、check\-glossary.mjs(新)、全局文案、tests/e2e | PR\-3/4/5 合并后 |
| PR\-7 | P0\-D 四项小修 | SettingsPage、ReadingAssistantPanel、MinePage、阶段区间 | 随时 |

建议顺序:PR\-1 → PR\-2 → PR\-3,PR\-4/PR\-5 在 PR\-2 合并后并行,PR\-6 收尾(文案稳定后一次替换),PR\-7 任意空档。

## 1 PR\-1 数据库三维化迁移 \+ patch 命令

### 1\.1 现状锚点

- 表定义:db.rs:448\-459,`reading_item_states` 10 列,`item_id` 主键。
- 迁移机制:**无版本号**。每次启动 `initialize_schema`(db.rs:208)幂等执行:`CREATE TABLE IF NOT EXISTS` \+ `add_column_if_missing`(db.rs:721\-739,PRAGMA table\_info 探测)\+ 复杂重建走 `ensure_*` 函数(事务 \+ 失败 ROLLBACK 模式,参照 db.rs:561\-719 的 local\_books 重建)。**沿用此惯例,不引入版本号。**
- 服务:services/reading\_state.rs —— `VALID_STATUSES`/`VALID_ITEM_TYPES` 常量(:7\-8)、`normalize_required/choice/optional` 帮助函数(:226\-260)、纯函数接 `&Connection` 便于内存库测试(:269\-348 现有测试)。
- 命令:commands/reading\_state.rs 4 条,`AppCommandError` 包装。

### 1\.2 迁移:`ensure_reading_item_dimensions(connection)`

在 `initialize_schema` 末尾(db.rs:467\-468 一带)追加调用。三步,全部幂等:

**第一步,加列**(不带 DEFAULT,以 NULL 作"未回填"哨兵):

```rust
add_column_if_missing(connection, "reading_item_states", "item_kind", "TEXT")?;
add_column_if_missing(connection, "reading_item_states", "is_candidate", "INTEGER")?;
add_column_if_missing(connection, "reading_item_states", "candidate_source", "TEXT")?;
add_column_if_missing(connection, "reading_item_states", "life_status", "TEXT")?;
add_column_if_missing(connection, "reading_item_states", "finished_source", "TEXT")?;
add_column_if_missing(connection, "reading_item_states", "organize_status", "TEXT")?;
add_column_if_missing(connection, "reading_item_states", "user_note", "TEXT")?;
add_column_if_missing(connection, "reading_item_states", "source_meta", "TEXT")?;
```

**第二步,备份表**(回滚依据,存在即跳过):

```sql
CREATE TABLE IF NOT EXISTS reading_item_states_backup_v1 AS
SELECT * FROM reading_item_states WHERE 0;
INSERT INTO reading_item_states_backup_v1
SELECT * FROM reading_item_states
WHERE (SELECT COUNT(*) FROM reading_item_states_backup_v1) = 0
  AND life_status IS NULL;
```

**第三步,backfill**\:`SELECT * WHERE life_status IS NULL` 后在 Rust 循环内逐行计算并 UPDATE(单事务;行数为个位数千级,无性能顾虑;note 的文本解析在 SQL 里做不干净)。规则即蓝图 5.1.6 表,要点:

```rust
let is_light = item_type == "album" || item_type == "mp";
let is_cand_row = item_type == "candidate" && status == "toRead";
item_kind      = if item_type == "candidate" { "book" } else { item_type };
is_candidate   = (is_cand_row || (is_light && status == "toRead")) as i64;
life_status    = if is_cand_row { "want" } else { "none" };
organize_status = match status { "reviewing" => "to_organize",
                                 "organized" => "organized", _ => "none" };
candidate_source = /* light → "light";
   item_id 以 "ai-rec-" 开头,或 note 含"来自 AI 阅读助手推荐"且不含
   "已通过微信读书搜索确认" → "ai_unconfirmed";
   note 含"已通过微信读书搜索确认" → "ai_confirmed";
   其余 candidate → "weread";非候选 → NULL */
// note 拆分:
//   "发现页保存的本地候选"      → source_meta.savedFrom = "discovery"
//   "书籍详情页保存的本地候选"  → savedFrom = "detail"
//   "书架有声书保存的本地候选" / "书架文章收藏…" → savedFrom = "shelf"
//   "用户已确认吸收本书复盘"    → 丢弃(信息已由 organize_status 承载)
//   含 AI 推荐标记的            → source_meta.aiReason = 去标记后的剩余文本
//   其余自由文本                → user_note = note
```

幂等性:`WHERE life_status IS NULL` 保证重复启动零行可改;跑两遍结果一致列入测试。旧列 `item_type`/`status`/`note` 本版**保留不删**(回滚与核对用),M2 后另行清理。

### 1\.3 新命令:`patch_reading_item_state`

services/reading\_state.rs 新增(沿用现有 normalize 惯例):

```rust
const VALID_LIFE_STATUSES: &[&str] =
    &["none", "want", "reading", "paused", "finished", "dropped"];
const VALID_ORGANIZE_STATUSES: &[&str] = &["none", "to_organize", "organized"];
const VALID_CANDIDATE_SOURCES: &[&str] =
    &["weread", "ai_unconfirmed", "ai_confirmed", "light"];
const VALID_FINISHED_SOURCES: &[&str] = &["weread_auto", "manual"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItemPatch {
    pub is_candidate: Option<bool>,
    pub candidate_source: Option<String>,
    pub life_status: Option<String>,
    pub finished_source: Option<String>,
    pub organize_status: Option<String>,
    pub user_note: Option<String>,
    pub clear_user_note: Option<bool>,   // true 时清空(避免双层 Option)
    pub source_meta: Option<String>,     // JSON 字符串,整体替换
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItemMeta {             // 记录不存在时用于创建
    pub item_kind: String,               // book|album|mp|localBook
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub category: Option<String>,
}

#[tauri::command]
pub fn patch_reading_item_state(
    app: AppHandle,
    item_id: String,
    patch: ReadingItemPatch,
    meta: Option<ReadingItemMeta>,
) -> Result<ReadingItemState, AppCommandError>
```

行为:读现有行 → 不存在且有 meta 则以维度默认值(is\_candidate\=0、life\_status\=none、organize\_status\=none)INSERT → 仅 SET patch 中出现的字段 → 刷 `updated_at`。不存在且无 meta 报 `InvalidPayload`。**只做维度级更新,永不整行覆盖**(B1 的根治点)。

配套变更:`ReadingItemState` struct 增 8 个新字段(serde camelCase;读取时 `COALESCE` NULL → "none"/0);`map_state_row` 同步;`lib.rs` 注册新命令;`upsert_reading_item_state` 保留到 PR\-3 完成、前端无调用后,在 PR\-3 内删除注册。旧字段 `item_type`/`status` 本版继续输出,前端停止依赖。

**微信自动读完挂点**\:书籍进度写入缓存处(services/book.rs 的 detail/progress 同步路径)追加 `maybe_mark_weread_finished(connection, book_id)`\:当 `progress==100 && finish_time 存在` 且当前 `finished_source != 'manual'` 且 `life_status NOT IN ('dropped')` 时,置 `life_status='finished', finished_source='weread_auto'`。手动值永不被自动覆盖。

### 1\.4 cargo 测试清单(tests 模块,沿用内存库模式)

- patch 在无记录 \+ meta 时创建,默认维度正确
- 只 patch organize\_status,不改 is\_candidate / user\_note(B1 回归)
- 只 patch is\_candidate\=false \+ life\_status\=dropped,行保留
- clear\_user\_note 清空、user\_note 设值互不干扰
- 非法枚举(life\_status\="done" 等)被拒
- backfill:candidate/toRead → want \+ is\_candidate\=1;reviewing → to\_organize;organized;album/toRead → light 候选;`ai-rec-` 前缀 → ai\_unconfirmed;确认标记 → ai\_confirmed;自由 note → user\_note;系统 note → source\_meta.savedFrom;**跑两遍结果一致**
- maybe\_mark\_weread\_finished:自动置 finished;manual 不被覆盖;dropped 不被覆盖
- 备份表只灌一次

## 2 PR\-2 前端类型 / API / selectors

### 2\.1 types.ts(现 :746\-772 一带)

```ts
export type LifeStatus = "none" | "want" | "reading" | "paused" | "finished" | "dropped";
export type OrganizeStatus = "none" | "to_organize" | "organized";  // 与存储值一致
export type CandidateSource = "weread" | "ai_unconfirmed" | "ai_confirmed" | "light";
export type ReadingItemKind = ShelfEntryType | "localBook";

export type ReadingItemSourceMeta = {
  savedFrom?: "discovery" | "detail" | "assistant" | "shelf" | "localImport";
  aiReason?: string;
  confirmedAt?: string;
};

export type ReadingItem = {
  itemId: string;
  itemKind: ReadingItemKind;
  isCandidate: boolean;
  candidateSource?: CandidateSource;
  lifeStatus: LifeStatus;
  finishedSource?: "weread_auto" | "manual";
  organizeStatus: OrganizeStatus;
  userNote?: string;
  sourceMeta?: ReadingItemSourceMeta;
  title?: string; author?: string; cover?: string; category?: string;
  createdAt: string; updatedAt: string;
};

export type ReadingItemPatch = { /* 与 Rust ReadingItemPatch 对应 */ };
export type ReadingItemMeta  = { /* 与 Rust ReadingItemMeta 对应 */ };
```

旧 `ReadingItemState / ReadingItemStateInput / ReadingItemStatus / ReadingItemStateType` 在 PR\-3 结束时删除;过渡期 `export type ReadingItemState = ReadingItem` 别名可减小 diff。

### 2\.2 reading\-api.ts(现 :673\-684、:1528\-1563、:2956\-2974)

- `ReadingItemStateRecord` 增新字段;`mapReadingItem` 防御式映射(未知枚举回退 "none"/undefined,沿用 normalize\* 惯例)。
- 新增 `patchReadingItemState(itemId, patch, meta?)` → invoke `patch_reading_item_state`。
- `listReadingItemStates/getReadingItemState` 保名(命令名不变),返回 `ReadingItem`。
- `upsertReadingItemState` 删除(PR\-3 内,所有调用点改完后)。
- Web 预览:`normalizeWebPreviewReadingItemStateRecord`(:2348)与 `buildWebPreviewReadingItemStates`(:2489)按新字段升级,预览数据 JSON 同步补字段。

### 2\.3 新文件 src/lib/reading\-selectors.ts(M1 只落两条唯一规则)

```ts
export type OrganizeCandidate = {
  book: NotebookBook; source: "manual" | "suggested"; reason: string;
};

export function getOrganizeQueue(args: {
  items: ReadingItem[];
  notebooks: NotebookBook[];              // 有笔记的书(来自 listNotebookBooks 缓存)
  reviewedBookIds: Set<string>;           // 已有 book_review 资产
  limit?: number;                         // 默认 3
}): OrganizeCandidate[]
// 规则:organizeStatus==="to_organize"(manual,恒在前)
//   ∪ 可导出笔记>0 && !reviewedBookIds.has(id) && organizeStatus!=="organized"(suggested)
// 排序:manual 优先 → 想法数 desc → 总笔记数 desc → lastReadAt desc

export function getCandidateQueue(items: ReadingItem[], limit?: number): ReadingItem[]
// isCandidate===true(含 candidateSource==="light"),updatedAt desc
```

vitest 用例:manual 恒排在 suggested 前;已生成复盘的书被排除(修 B4:Dashboard 现行规则不排除);organized 排除;light 候选包含(修 B5);limit 截断;来源徽章字段透传。

## 3 PR\-3 九个写入点改造 \+ 详情页控件 \+ 三页接线

### 3\.1 写入点改造表(逐点)

| \# | 位置 | 现调用 | 新调用 |
| --- | --- | --- | --- |
| 1 | DiscoveryPage.tsx:398\-406 保存候选 | upsert candidate\+toRead\+note 文案 | `patch(itemId, {isCandidate:true, candidateSource:"weread", sourceMeta:{savedFrom:"discovery"}}, meta)` |
| 2 | BookDetailPage.tsx:311\-320 加入候选 | upsert 覆盖整行 | `patch(itemId, {isCandidate:true, candidateSource:"weread", sourceMeta:{savedFrom:"detail"}}, meta)` —— 不碰 organize/life |
| 3 | BookDetailPage.tsx:268\-297 标记待整理/已整理 | upsert itemType\=shelfEntry.type(覆盖候选身份) | `patch(itemId, {organizeStatus:"to_organize"或"organized"}, meta)` |
| 4 | BookDetailPage.tsx:332\-352 清除状态 | remove 整条记录 | `patch(itemId, {organizeStatus:"none"})`;"删除记录"移入溢出菜单保留 remove |
| 5 | BookAiSummaryPage.tsx:377\-404 标记已整理 | upsert 覆盖 note 为固定文案 | `patch(bookId, {organizeStatus:"organized"})` —— user\_note 不再被碰 |
| 6 | BookshelfPage.tsx:268\-288 有声书/文章保存候选 | upsert itemType\=album/mp;book 静默 return(:269\-271) | `patch(id, {isCandidate:true, candidateSource:"light", sourceMeta:{savedFrom:"shelf"}}, meta)`;book 类型开放同一菜单(candidateSource:"weread") |
| 7\-9 | ReadingAssistantPanel.tsx:1033\-1040 / 1122\-1131 / 1164\-1173 AI 加候选 | upsert candidate\+note\=AI 理由 | `patch(id, {isCandidate:true, candidateSource:"ai_unconfirmed"或"ai_confirmed", sourceMeta:{savedFrom:"assistant", aiReason}}, meta)` |
| 新 | BookDetailPage / CandidateBookshelfPage 生命周期控件 | 无 | `patch(id, {lifeStatus, finishedSource:"manual"})` |

配套读取侧:candidate\-books.ts 的 `isSavedCandidateState/isUnconfirmedAiCandidate/getCandidateSourceLabel/getCandidateSourceTone`(:46\-51、:200\-238)改读 `isCandidate/candidateSource`,删除魔法字符串常量(:42\-44);`buildConfirmedCandidateReplacementNote` 改写 `candidateSource:"ai_confirmed"` \+ `sourceMeta.confirmedAt`,不再拼接 note(修 B6)。Dashboard 候选条目 meta 硬编码"发现页保存"(DashboardPage.tsx:1091)改读 sourceMeta.savedFrom 映射文案。

### 3\.2 详情页"本地整理"区重组(BookDetailPage.tsx:662\-790 一带)

- 三组控件:候选开关(isCandidate)/ 生命周期分段(想读·在读·暂缓·读完·放弃;finished 徽章区分"微信同步/手动")/ 整理状态(待整理·已整理)。`localBookStatusOptions`(:83\-86)删除。
- 主 CTA 联动规则:lifeStatus\=finished 且有笔记 → 主按钮"生成书籍复盘";reading → "查看笔记";want/candidate → "去微信读书打开";读完禁用卡(:666\-670、:759\-760)删除,原位即主 CTA(修 B7)。
- "找相似"只保留动作网格一处(BookHeader 内 :494\-502 的重复项移除,B7 附带)。

### 3\.3 候选书架与三页接线

- CandidateBookshelfPage:卡片菜单增"开始读"(lifeStatus\=reading)、"暂缓"(默认项:isCandidate\=false \+ lifeStatus\=dropped)、"删除记录"(二级确认);排序切换"最近添加(默认)/书名"替换固定 localeCompare(:119,修 B8 队列侧)。
- DashboardPage(:968\-1098)、ReadingHubPage(:2200\-2222)、NotesPage(:1183\-1205)三套本地规则删除,统一调 `getOrganizeQueue/getCandidateQueue`(修 B4)。
- 验收即蓝图 5.1.7 全表,另加:替换候选书源(resolveCandidateReplacement,candidate\-books.ts:174\-198)在新模型下 blocked 分支行为不变。

## 4 PR\-4 选书决策因子真接入(C2)

### 4\.1 机制锚点

services/ai.rs:`build_book_decision_input(...)` 构造 payload → `stable_hash_json(&payload)` 得到 inputHash；feature 为 `book-decision`，T5 已将 `BOOK_DECISION_PROMPT_VERSION` 升级为 `book-decision-v2`。**因子、窗口和结构化上下文进入 payload 后，hash 自动覆盖，无需另做 hash v2 算法。**

### 4\.2 变更

- `BookDecisionCandidateInput` 增 `local_life_status/local_organize_status`(前端 buildBookDecisionCandidates,candidate\-books.ts:69\-77,不再硬编码 `localStatus:"toRead"`,改传真实值;`slice(0,8)` 保留为上限保护,配合 PR\-3 的"最近添加"排序,"前 8 本"语义修复)。
- 命令与服务签名扩展(commands/ai.rs:506\-527、services/ai.rs:3371/3466,export 两条 :3506\-3530 同步):

```rust
pub async fn summarize_book_decision(
    app: AppHandle,
    candidates: Vec<BookDecisionCandidateInput>,
    goal: Option<String>,
    regenerate: Option<bool>,
    reference_factors: Option<Vec<String>>,          // 白名单校验
    recent_reading_window_days: Option<u32>,         // None = auto(90)
    recent_reading_context: Option<RecentReadingContext>,
) -> ...

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentReadingContext {
    pub finished_titles: Vec<String>,        // ≤5
    pub active_categories: Vec<CategoryMinutes>, // ≤5 {name, minutes}
    pub average_daily_minutes: u32,
}
```

- `build_book_decision_input` 把三者写入 payload(factors 排序去重后写入,保证 hash 稳定);prompt 升级 `book-decision-v2`\:系统提示词增两段——"用户声明的参考维度(逐条回应其影响)"与"近期阅读背景(仅作倾向参考)";`normalize_book_decision_output` 的 rationale 校验不变。版本号 bump 使 v1 缓存自然失效,不迁移。
- 前端:`summarizeBookDecision/getLatestBookDecision/exportBookDecision*`(reading\-api.ts:1404\-1448)签名扩展;`buildRecentReadingContext(statsCache, windowDays)` 放 src/pages/book\-decision\-context.ts(该文件已存在,正是干这个的位置);CandidateBookshelfPage:464\-471 与 BookDecisionPage:228\-239 两处调用传全参。
- BookDecisionPage 结果页:"基于 X 本候选和 N 个参考因子"(:305)改为渲染因子 chips \+ 窗口标签,数据来自资产 payload 回读,所见即所传。

### 4\.3 验收

蓝图 5.2.4 前两条,另加:cargo 测试断言 payload 含 factors/window/context;同因子不同窗口 → 不同 inputHash;e2e:改因子重新生成,结果页因子 chips 变化。

## 5 PR\-5 noteCount 三态 \+ 决策缓存语义(C3、B10)

### 5\.1 伪造清除

- App.tsx **两处** `noteCount: 1, totalNoteCount: 1`(:1266\-1276、:1293\-1304)删除;连同 ReadingHubPage.tsx:361\-372 的零值拼装、App.tsx:1228\-1238 进笔记页的零值拼装,统一改传新轻量类型:

```ts
export type BookAiSummaryEntry = {
  bookId: string; title: string; author?: string; cover?: string;
  readingProgress?: number;
  noteCount?: number; totalNoteCount?: number;   // undefined = 未知
};
```

- BookAiSummaryPage 三态:`notesInfo: "unknown" | "loading" | { exportableCount, totalCount }`;unknown 入场即拉真实笔记;`exportableCount === 0` → 生成按钮禁用 \+ 空态引导("先同步笔记,或在阅读器里写想法");`canGenerate` 的 `?? 1` 兜底(:148、:272、:323)删除;`sourceStatsFromSource`(:1331\-1341)仅在真实数据就绪后渲染,加载中显示占位。

### 5\.2 决策缓存语义收紧

services/ai.rs 两处 `latest_cached_output` 兜底删除:

- `get_latest_book_decision`(:3489\-3501)删除第二分支 → hash 不匹配返回 `Ok(None)`;
- `summarize_book_decision` 非 regenerate 路径(:3395\-3406)删除同款兜底 → 缓存未命中直接生成。**生成失败时的缓存兜底(:3430\-3441)保留**(那是降级容错,语义不同)。

前端:BookDecisionPage 警告分支(:462\-473)删除;结果页加"生成于 {generatedAt}"徽章 \+ "重新生成"次按钮;CandidateBookshelfPage:464\-471 保持"先查后生成"写法不变(get\_latest 语义已收紧,自然正确)。

## 6 PR\-6 词典落地(A3、G1)

### 6\.1 词典单一事实源

规范词、动作词和旧称迁移映射统一维护在 `src/lib/glossary-data.json`；`src/lib/glossary.ts` 提供 TypeScript 类型化门面，`scripts/check-glossary.mjs` 读取同一 JSON，面向维护者的说明见 [`docs/GLOSSARY.md`](./GLOSSARY.md)。本文不复制第二份词表。

### 6\.2 scripts/check\-glossary.mjs

Node 脚本:遍历 `src/**/*.{ts,tsx}` 与 `docs/*.md`,对 BANNED\_TERMS 逐词扫描;白名单:`docs/release-notes-*.json`、`docs/*promo*`、`docs/wechat-update-*`、分析报告与本文(历史文档豁免);命中输出 `文件:行:词 → 建议`,exit 1。接入 package.json:`"test": "vitest run && node scripts/check-glossary.mjs"`。

### 6\.3 替换范围与 e2e 策略

- 替换点集中在:App.tsx 导航项/顶栏标题/返回文案(:188\-231、:555\-557、:1791\-1801、:1863\-1869)、ReadingHubPage tab 与卡片文案、StatisticsPage/ReadingReviewPage 按钮(:339/:370)、BookAiSummaryPage/BookDecisionPage/ReadingRoutePage 头部按钮、user\-guide.md。
- **顺序**\:同一 PR 内先给受影响元素加 `data-testid` 并把 tests/e2e/app\-smoke.spec.ts 中对应文案断言改为 testid \+ `import { TERMS }`,再改文案。避免 383KB e2e 全面崩。
- docs 治理:给现行计划文档补 `> status:` 头;被本蓝图取代的口径(roadmap 动作条数、workbench 首屏规格、outcomes 成果分类)标 `superseded-by: functional-consolidation-blueprint.md`。

## 7 PR\-7 P0\-D 四项小修

1. **F2** SettingsPage:aiProviderProbe 结果面板(:1390\-1433,现在 account 分支内)整块移至 ai 分支"测试兼容性"按钮(:1702)下方;验收:在 AI 设置内点探测能看到四项结果。
2. **C4** ReadingAssistantPanel:175 `aiAssetSummary: "阅读记忆"` 改 `"资产摘要"`;验收:上下文芯片无重名。
3. **A7** MinePage:66 `noteCount` 改取真实笔记数(或该统计格改为"书架书籍"并删除重复格);"代理与网络诊断"(:155\-160)文案改"账户与同步设置"或指向真实诊断区。
4. **B11** 阶段边界固定为：69% 为“深入推进”；70%、95%、99% 为“收束整理”；100% 或 `finished=true` 为“完成归档”。后端 `readingStage` 计算、边界测试和现行文档必须保持一致。

## 8 回滚与发布

- **回滚**\:PR\-1 迁移保留旧列 \+ `reading_item_states_backup_v1` 备份表;回滚脚本 \= 从备份表恢复三列旧值(item\_type/status/note 未被修改,实际只需删新列或忽略)。前端回退到旧版本即可运行(旧列仍在)。
- **发布**\:桌面与 Android 同版本发布(前后端同包);Web 只读预览数据同步升级;发布说明要点:详情页状态控件升级为三组、决策向导第三步真实生效(旧决策缓存会失效一次)、若干按钮改名(附新旧对照表,取自 glossary)。
- **不做**\:本里程碑不动 AI 资产命令形态、不动本地阅读器存储、不动导航结构(均在 M2/M3/M4)。
