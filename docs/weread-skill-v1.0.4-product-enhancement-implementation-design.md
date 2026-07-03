# 微信读书 Skill 1.0.4 产品增强实施设计文档

## 目标

在已完成 Skill 1.0.4 契约适配和需求取舍分析后，按小步迭代方式落地产品增强。首轮只做能直接提升现有工作流、且不会扩大调用量的能力：

1. 书籍详情展示当前章节定位。
2. 书籍详情增加轻量公开点评模块。
3. Dashboard 增加或增强轻量阅读概况，且最多只查最近 5 本电子书进度。

本设计文档用于指导实现，不替代已有需求分析文档。原则是 KISS、YAGNI、DRY：先补已有链路缺口，不做大规模重构，不提前实现 P4/P5。

## 范围

### 本轮纳入

- P3.1 当前章节定位。
- P3.2 公开点评基础模块。
- P3.3 微信读书概况卡片的轻量方案设计。
- P4/P5 后续增强备注和接口预留边界。

### 本轮不纳入

- 热门划线、共读想法、`/book/underlines`。
- 公开点评筛选分页和无限滚动。
- 全量书架逐本进度同步。
- 完整垂直搜索页或微信读书社区页复刻。
- 将公开内容默认送入 AI。
- 拆分整个 `reading-api.ts`。

## 当前系统基线

### 已有能力

- 书籍详情页已加载 `detail`、`progress`、`chapters`。
- `ChapterList` 已按 `progress.chapterUid` 高亮当前章节。
- 后端已有 `get_public_reviews` command、service 和 mapper。
- `DiscoveryPage` 已有真实相似推荐优先、失败后搜索兜底的流程。
- 前端已有 `SkillUpgradeNotice` 和 `getCommandErrorInfo()` 处理 `upgrade_required`。
- Dashboard 已有书架、笔记、本地队列、推荐书籍和阅读统计缓存展示。

### 主要缺口

- `BookHeader` 只展示百分比，没有展示当前章节名。
- 前端没有 `getPublicReviews()` API、类型和展示组件。
- Dashboard 没有独立的“最近 5 本电子书进度”概况闭环。
- 公开内容的失败隔离、缓存边界和 AI 边界需要在实现中固化。

## 信息架构

### BookDetailPage

首轮增强后结构：

1. 返回入口。
2. 加载、升级、错误提示。
3. `BookHeader`：基本信息、进度、当前章节、操作按钮。
4. 本地版本提示。
5. 本地整理状态和动作区。
6. 书籍简介和元信息。
7. 章节目录。
8. 公开点评基础模块。

公开点评放在目录之后，理由：

- 不打断用户先看个人进度和目录。
- 明确它是外部信号，而不是个人阅读资产。
- 模块失败时不会影响上方主详情。

### DashboardPage

轻量概况不新增完整 Profile 页面，只作为现有首页信息的补充：

1. 核心指标继续展示书架总数、公开/私密、最近同步。
2. 概况卡片展示最近阅读和笔记概览。
3. 最近进度只展示最多 5 本电子书。
4. 用户主动刷新时才补进度，页面打开优先使用已有缓存。

### DiscoveryPage

本轮只保持已有相似推荐来源语义：

- 相似推荐成功：显示“相似推荐”。
- 相似推荐失败并搜索兜底：显示“已改用书名搜索兜底”。
- 不新增复杂推荐解释和多源混排。

## P3.1 当前章节定位设计

### 用户体验

在书籍详情头部进度区域增加当前章节文案：

- 有章节匹配：`当前章节：{chapter.title}`
- 有章节 UID 但目录未匹配：不显示章节名，只保留百分比。
- 未开始或无 `chapterUid`：不显示章节名。
- 已读完：可显示完成状态，不强行显示当前章节。

### 数据来源

- `BookDetailResponse.progress.chapterUid`
- `BookDetailResponse.progress.chapterOffset`
- `BookDetailResponse.chapters[]`

不新增后端接口，不新增网络请求。

### 前端实现

建议新增一个小 helper，避免组件里写隐式查找逻辑：

文件建议：

- `src/lib/book-progress.ts`

函数建议：

```ts
export function findCurrentChapter(
  chapters: Chapter[],
  progress: Pick<ReadingProgress, "chapterUid">
): Chapter | undefined
```

如果当前只在 `BookDetailPage` 使用，也可以先放页面内局部函数；若要写单元测试，抽到 `src/lib/book-progress.ts` 更清晰。

组件改动：

- `BookDetailPage` 计算 `currentChapter`。
- `BookHeader` 增加可选 prop：

```ts
currentChapter?: Chapter;
```

- `BookHeader` 在 `progress-block` 旁展示当前章节。

设计取舍：

- 不在 `ReadingProgress` 类型上增加 `currentChapterTitle`，避免把派生 UI 字段写入领域类型。
- 不修改后端 mapper。
- 不改变 `ChapterList` 高亮逻辑。

### 验收

- 章节匹配时详情头部展示章节名。
- 章节目录仍高亮当前章节。
- 无章节、无 `chapterUid`、章节不匹配时不报错。
- 不新增任何接口调用。

### 测试

- `findCurrentChapter()`：匹配、缺失、目录为空。
- `BookDetailPage` 或 `BookHeader` 渲染：展示当前章节名，不匹配时隐藏。

## P3.2 公开点评基础模块设计

### 用户体验

模块标题：`公开点评`

副文案：`来自微信读书公开内容，不计入个人笔记。`

首版展示：

- 3 到 5 条点评。
- 点评者昵称，没有昵称时显示 `微信读书用户`。
- 星级，有稳定评分时展示。
- 点评正文纯文本。
- 章节名，有值时展示。
- 时间，有值时转为日期。

状态：

- 加载态：模块内 skeleton 或轻量 loading。
- 空态：`暂无可展示公开点评。`
- 错误态：模块内显示错误和重试按钮。
- 升级态：模块内使用 `SkillUpgradeNotice` 或等价专门提示。

交互：

- 初版自动加载首屏。
- 提供“刷新”按钮。
- 不做筛选、不做加载更多。

### 数据来源

后端已有：

- `get_public_reviews(book_id, review_list_type, count, max_idx, synckey)`
- `PublicReviewsResponse`
- `PublicReviewsRecord`
- `PublicReviewRecord`

首版请求参数：

```ts
{
  bookId,
  reviewListType: 0,
  count: 5
}
```

不传 `maxIdx`、`synckey`，分页后置。

### 前端类型

建议在 `src/lib/types.ts` 增加：

```ts
export type PublicReviewAuthor = {
  userVid?: string;
  name?: string;
  avatar?: string;
};

export type PublicReviewBook = {
  bookId?: string;
  title?: string;
  author?: string;
};

export type PublicReview = {
  idx?: number;
  reviewId: string;
  content: string;
  star?: number;
  starLevel?: number;
  isFinish?: boolean;
  createTime?: number;
  chapterName?: string;
  author?: PublicReviewAuthor;
  book?: PublicReviewBook;
};

export type PublicReviewsResult = {
  bookId: string;
  reviewListType: number;
  totalCount?: number;
  recentTotalCount?: number;
  hasMore: boolean;
  has5Star: boolean;
  has1Star: boolean;
  hasRecent: boolean;
  friendCommentCount?: number;
  friendUniqueCount?: number;
  synckey?: number;
  nextMaxIdx?: number;
  reviews: PublicReview[];
};
```

不在前端公开 `htmlContent`。后端可以继续保留字段，但前端类型首版不使用，避免误渲染 HTML。

### 前端 API

在 `src/lib/reading-api.ts` 增加：

```ts
export async function getPublicReviews({
  bookId,
  reviewListType = 0,
  count = 5,
  maxIdx,
  synckey
}: {
  bookId: string;
  reviewListType?: number;
  count?: number;
  maxIdx?: number;
  synckey?: number;
}): Promise<PublicReviewsResponse>
```

内部调用 Tauri command：

```ts
invoke<PublicReviewsResponseRecord>("get_public_reviews", {
  bookId,
  reviewListType,
  count,
  maxIdx,
  synckey
})
```

注意 Tauri 参数使用 camelCase，Rust command 参数 `review_list_type` 会按 Tauri 规则映射。

### 组件设计

建议新增组件：

- `src/components/PublicReviewsPanel.tsx`

组件职责：

- 展示公开点评列表。
- 展示模块级加载、空、错误、升级状态。
- 接收 `onRefresh`，不直接决定业务入口。

建议 props：

```ts
type PublicReviewsPanelProps = {
  result?: PublicReviewsResult;
  isLoading: boolean;
  error?: CommandErrorInfo;
  onRefresh: () => void;
};
```

数据加载放在 `BookDetailPage` 内：

- `BookDetailPage` 已经处理本地状态加载，继续在页面内维护 `publicReviews`、`isLoadingPublicReviews`、`publicReviewsError`。
- 仅当 `shelfEntry.type === "book"` 且 `detailResponse.detail.bookId` 存在时加载。
- `detailResponse` 切换时重新加载。

设计取舍：

- 不把公开点评塞进 `BookDetailResponse`，因为它不是详情主链路。
- 不让 `PublicReviewsPanel` 自己调用 API，保持组件可测试。
- 不新增全局状态。

### 格式化

新增或局部实现：

```ts
function formatPublicReviewStars(starLevel?: number): string | undefined
```

规则：

- 优先使用后端 `starLevel`。
- `1-5` 显示为 `一星` 到 `五星` 或视觉星标。
- 无评分不显示评分占位。

不要复用个人想法 `star` 逻辑，因为公开点评评分来自百分制转换。

### 错误处理

- `getCommandErrorInfo(error)` 归一化错误。
- `error.code === "upgrade_required"` 时显示升级提示。
- 普通错误显示 `公开点评暂时不可用` 和重试按钮。
- 错误不向上抛到 `BookDetailPage` 页面级错误。

### 隐私和边界

- 只展示昵称，不展示 `userVid`。
- 头像首版可不展示；如展示，失败不影响内容。
- 不写入个人笔记、不进入导出、不进入 AI。
- 不使用 `htmlContent`。

### 后端设计

首版不需要新增后端 command。已有后端能力满足：

- 参数校验。
- 网关调用。
- raw cache。
- mapper。
- `upgrade_required` 透传。

后端可选小修：

- 如果前端首版只展示纯文本，后端 `html_content` 字段可保留，不需要移除。
- 如发现缓存 key 对 `count=None` 和默认值有歧义，可在后续统一归一化，但不阻塞 P3.2。

### 验收

- 详情页显示公开点评模块。
- 首屏最多展示 5 条。
- 公开点评失败不影响书籍详情、进度、目录。
- 升级错误不被展示为普通失败。
- 不渲染 HTML。
- 不把公开点评并入个人笔记统计或导出。

### 测试

前端：

- `getPublicReviews()` mapper：字段映射、空列表、评分、作者、章节名。
- `PublicReviewsPanel`：正常态、空态、错误态、升级态。
- `BookDetailPage`：加载公开点评失败时主详情仍存在。

后端：

- 现有 `build_public_reviews_params` 测试保留。
- 如新增字段或修改 mapper，补充双层 `review.review` 映射测试。

## P3.3 微信读书概况卡片设计

### 用户体验

目标是轻量提醒用户“最近在读什么、哪些内容可以整理”，不是重做 Dashboard。

建议卡片标题：`微信读书概况`

内容：

- 可见书架条目数，拆分电子书、有声书、文章收藏。
- 有笔记书籍数和总笔记数。
- 最近 5 本电子书进度列表。
- 入口按钮：`查看书架`、`整理笔记` 或 `刷新概况`。

### 数据来源

已有：

- `BookshelfResponse.snapshot.summary`
- `BookshelfResponse.snapshot.entries`
- `NotebookOverviewResponse.summary`
- `NotebookOverviewResponse.books`

新增进度数据有两种方案：

#### 方案 A：前端组合现有单本详情接口

流程：

1. 从 `shelfEntries` 过滤 `type === "book"` 且有 `lastReadAt`。
2. 按 `lastReadAt` 降序取 5 本。
3. 用户点击“刷新概况”时，对这 5 本调用 `getBookDetail(bookId)`。
4. 只使用其中的 `progress`。

优点：

- 不新增后端接口。
- 复用现有详情链路。

缺点：

- `getBookDetail` 同时获取详情、进度、目录，概况只需要进度，存在额外开销。

#### 方案 B：新增后端聚合接口

新增 command：

- `get_reading_overview()`

服务层负责：

- 从书架缓存取最近 5 本电子书。
- 只对这 5 本调用 `/book/getprogress`。
- 合并笔记概览。

优点：

- 调用边界集中在后端。
- 更容易测试“最多 5 本”。

缺点：

- 新增 command、类型、capabilities、测试，改动面更大。

### 推荐方案

首版推荐方案 A，但必须采用手动刷新：

- 页面打开只展示已有书架和笔记缓存。
- 最近 5 本进度如果当前没有缓存，不自动补齐。
- 用户点击“刷新概况”才拉进度。

理由：

- 符合 KISS 和 YAGNI。
- 不新增后端接口。
- 避免 Dashboard 成为隐性批量同步入口。

如果后续用户确实依赖概况卡片，再升级为方案 B。

### 前端实现

建议新增局部组件或 Dashboard 内部组件：

- `WereadOverviewCard`

props：

```ts
type WereadOverviewCardProps = {
  summary?: BookshelfSummary;
  recentBooks: ShelfEntry[];
  notesSummary?: NotebookOverviewResponse["summary"];
  progressByBookId: Record<string, ReadingProgress>;
  isRefreshing: boolean;
  error?: CommandErrorInfo;
  onRefreshProgress: () => void;
  onOpenBookshelf: () => void;
  onOpenNotes: () => void;
  onOpenShelfEntry: (entry: ShelfEntry) => void;
};
```

本轮可先放在 `DashboardPage.tsx` 内部，避免过早拆文件。若组件超过 150 行再拆到单独文件。

### 调用预算

- 只处理 `ShelfEntry.type === "book"`。
- 最多 5 本。
- 不处理 `album` 和 `mp`。
- 不为没有 `lastReadAt` 的书补进度。
- 每次刷新最多 5 个并发请求；如担心网关压力，可串行或小并发。

### 错误处理

- 某一本进度失败，不让整个 Dashboard 失败。
- 可展示 `部分进度暂时不可用`。
- 如果错误为 `upgrade_required`，展示升级提示或在卡片内展示升级文案。

### 验收

- 大书架打开 Dashboard 不触发 N 本进度请求。
- 刷新概况最多请求 5 本电子书。
- 有声书和文章收藏不调用电子书进度接口。
- 无凭据时展示设置引导。
- 进度请求失败不影响 Dashboard 其他区域。

### 测试

- 最近 5 本筛选：按 `lastReadAt` 降序，只取电子书。
- 刷新逻辑：最多 5 次 `getBookDetail`。
- 错误隔离：单本失败仍展示其他书。

## P4 后续增强备注

### 热门划线

触发条件：

- 公开点评基础模块稳定。
- 详情页信息层级没有过载。

接口：

- `/book/bestbookmarks`

不接：

- `/book/underlines`，除非未来做正文热度标签。

首版设计：

- 用户展开“共读信号”后加载。
- 全书热门划线最多 5 条。
- 不自动加载每条划线的共读想法。

### 共读想法

触发条件：

- 热门划线已实现。

接口：

- `/book/readreviews`

设计：

- 点击某条热门划线后加载。
- 每次 3 到 5 条。
- 失败只影响当前展开项。

### 公开点评筛选分页

触发条件：

- 用户有明确查看更多公开点评需求。

设计：

- 增加 `reviewListType` 筛选。
- 增加“加载更多”。
- 每页不超过 10 条。
- 使用 `maxIdx` 和 `synckey`。

## P5 技术整理备注

P5 不作为当前功能需求。只有当 P3/P4 稳定后，再考虑拆分 `reading-api.ts`。

建议拆分方向：

- `command-errors.ts`
- `weread-book-api.ts`
- `weread-discovery-api.ts`
- `weread-notes-api.ts`
- `weread-stats-api.ts`

触发标准：

- 单文件维护成本已经影响实现。
- 相关领域类型稳定。
- 测试覆盖足够。

不允许借 P5 拆分顺手改 UI 行为。

## 数据和状态边界

### 个人资产

包括：

- 书架。
- 个人笔记。
- 阅读统计。
- 本地候选和整理状态。
- AI 复盘。

这些内容可以进入统计、导出和 AI。

### 公开内容

包括：

- 公开点评。
- 热门划线。
- 共读想法。

这些内容首版只展示，不进入：

- 个人笔记统计。
- Markdown 笔记导出。
- 本地候选持久化字段。
- AI 默认输入。

未来若要让 AI 使用公开内容，必须增加显式选择和来源标注。

## 缓存设计

### 首轮

- 当前章节定位不新增缓存。
- 公开点评复用后端 `raw_cache`，前端只保留当前页面状态。
- 概况卡片首版优先用已有缓存；手动刷新结果放在 Dashboard 页面状态。

### 后续

公开内容可考虑独立 namespace：

- `public_reviews:{bookId}:default`
- `best_bookmarks:{bookId}:all`
- `read_reviews:{bookId}:{chapterUid}:{range}`

后续如增加 TTL，先在服务层定义，不在组件里散落判断。

## 错误处理

统一规则：

- 页面主链路错误：详情主信息、书架、统计失败时使用页面级错误。
- 公开模块错误：只在模块内显示。
- `upgrade_required`：必须使用专门升级提示。
- 无凭据：引导设置，不伪装成接口失败。
- Web Preview：模块不可用时显示空态或预览不可用，不调用 Tauri command。

## 可访问性和视觉约束

- 公开点评模块使用清晰标题和副文案，避免与个人笔记混淆。
- 列表项正文限制行数，提供自然截断，不做富文本。
- 按钮文案明确：`刷新点评`、`查看书架`、`整理笔记`。
- 不在卡片里嵌套卡片。
- 移动端保持单列，点评文本不得溢出按钮或容器。

## 实施顺序

### Step 1：当前章节定位

改动：

- 增加当前章节 helper。
- `BookHeader` 增加 `currentChapter` 展示。
- 补测试。

验证：

- `npx tsc --noEmit`
- 相关前端测试。

### Step 2：公开点评前端 API 和类型

改动：

- `src/lib/types.ts` 增加公开点评类型。
- `src/lib/reading-api.ts` 增加 record、mapper、`getPublicReviews()`。
- 补 mapper 测试。

验证：

- `npx tsc --noEmit`
- `npm test -- reading-api`

### Step 3：公开点评模块 UI

改动：

- 新增 `PublicReviewsPanel`。
- `BookDetailPage` 接入加载逻辑。
- 补渲染测试。

验证：

- `npm test`
- 手动检查详情页加载、空态、错误态。

### Step 4：概况卡片轻量实现

改动：

- Dashboard 增加最近 5 本电子书筛选 helper。
- 增加概况卡片。
- 刷新按钮按需加载最多 5 本进度。

验证：

- 单元测试最近 5 本限制。
- `npm test`

### Step 5：构建和回归

命令：

```powershell
npx tsc --noEmit
npm test
cargo test --lib
npm run build
```

## 验收清单

- 当前章节名在详情头部展示。
- 目录当前章节仍高亮。
- 公开点评首屏最多 5 条。
- 公开点评失败不影响详情页主内容。
- 公开点评不渲染 HTML。
- 公开点评不进入个人笔记、导出和 AI。
- Dashboard 不自动批量刷新全书架进度。
- 概况刷新最多查最近 5 本电子书。
- 有声书和文章收藏不调用 `/book/getprogress`。
- 新增接口保留 `upgrade_required` 专门提示。

## 风险和应对

### 风险一：详情页信息过载

应对：

- P3 只自动加载公开点评一个外部模块。
- 热门划线后置或折叠加载。

### 风险二：公开点评内容质量不稳定

应对：

- 空态和错误态独立。
- 不让公开点评影响个人整理状态。

### 风险三：概况卡片触发过量调用

应对：

- 页面打开不自动补全进度。
- 手动刷新最多 5 本电子书。

### 风险四：Web Preview 回归

应对：

- 新增 API 在无 Tauri 环境下明确降级。
- 公开模块缺失不影响主页面渲染。

## 最终取舍

本设计优先补齐现有工作流里的低成本缺口。首轮实现不追求“接口覆盖率”，只追求用户在详情页和首页能更快做决定：

- 读到哪里。
- 其他读者大致怎么看。
- 最近哪些书和笔记值得继续处理。

其余公开信号和结构整理均后置，等 P3 数据和交互稳定后再推进。

