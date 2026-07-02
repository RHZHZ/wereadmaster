# 微信读书 Skill 1.0.4 Tauri 应用适配改造计划

## 背景

本地 `weread` Skill 已从 `1.0.3` 升级到 `1.0.4`。新版主要收紧了网关请求契约、深度链接展示规则、搜索 scope 语义、相似推荐分页参数和错误兜底文案。

当前 Tauri 应用已经具备较完整的微信读书网关层、本地缓存、笔记/书架/统计/发现页能力，但运行时代码仍存在少量旧契约残留，需要先完成最小适配，再考虑体验和架构优化。

## 改造目标

1. 确保应用所有微信读书网关请求上报 `skill_version=1.0.4`。
2. 对齐新版 Skill 的请求参数规则：业务参数平铺、相似推荐显式分页、搜索显式 scope。
3. 对齐新版 `deepLink` 规则：优先使用接口返回值，不再把手动拼接链接当作接口数据。
4. 将 `upgrade_info` 从后端错误识别补齐为前端可理解、可重试的升级提示闭环。
5. 保持现有本地缓存、导出、AI 复盘和移动端能力不被破坏。
6. 用小步改造和聚焦测试降低风险，避免顺手重构大文件。

## 当前发现

### 1. 运行时版本未升级

文件：`src-tauri/src/config.rs`

当前值仍为：

```rust
pub const WEREAD_SKILL_VERSION: &str = "1.0.3";
```

这会导致应用真实请求继续上报旧版本，即使本地 Skill 文档已经替换为 `1.0.4`。

### 2. README 示例仍是旧版本

文件：`README.md`

示例请求仍展示：

```json
{ "api_name": "/shelf/sync", "skill_version": "1.0.3" }
```

需要同步到 `1.0.4`，避免用户按旧文档排查问题。

### 3. upgrade_info 缺少前端闭环

相关文件：

- `src-tauri/src/services/weread_gateway.rs`
- `src-tauri/src/errors.rs`
- `src/lib/reading-api.ts`
- 触发微信读书同步/搜索/详情/笔记请求的页面

后端已经能识别 `upgrade_info` 并转换为 `UpgradeRequired`，但产品体验上不应把它混入普通“同步失败”。用户需要看到：

- 微信读书 Skill 需要升级；
- 服务端返回的升级说明；
- 当前应用使用的 Skill 版本；
- 升级后重试当前操作的入口。

### 4. deepLink 仍存在手动拼接兜底

相关文件：

- `src-tauri/src/services/book.rs`
- `src/lib/reading-api.ts`

当前应用会手动拼接：

```text
weread://reading?bId={bookId}
weread://reading?bId={bookId}&chapterUid={chapterUid}
```

新版 Skill 要求展示层优先使用接口返回的 `deepLink`；没有 `deepLink` 时不自行拼接。

注意：应用内部“打开微信读书客户端”的命令可以保留手动构造链接，但不应把该链接作为接口字段兜底返回给前端展示。

### 5. `/book/similar` 参数仍可省略

文件：`src-tauri/src/services/discovery.rs`

新版 Skill 明确 `/book/similar` 必须显式传入：

- `count`
- `maxIdx`

当前 `build_similar_params` 仍复用可选分页逻辑，允许两者为空。首次请求应默认传 `count=12`、`maxIdx=0`。

### 6. 搜索 scope 需要按意图显式化

当前服务层默认 `scope=0`，适合发现页综合搜索；但新版要求 Agent/调用方基于意图显式选择 scope。

本应用需要区分：

- 找书/书籍搜索：`scope=10`
- 综合发现搜索：`scope=0`

同时结果处理不能按 `results[].scope == 10` 过滤电子书，因为新版说明电子书分组可能返回 `scope=17`。

### 7. 发现页结果类型未透传 deepLink

相关文件：

- `src-tauri/src/mappers/discovery.rs`
- `src/lib/types.ts`
- `src/lib/reading-api.ts`

新版搜索、推荐、相似推荐的书籍信息可能携带 `deepLink`。当前 `DiscoveryBookRecord` / `SearchResult` / `Recommendation` 未建模该字段，前端无法直接展示接口返回链接。

### 8. 阅读概况最近 5 本限制的影响边界

新版 `profile.md` 将阅读概况工作流收紧为“只对最近 5 本电子书调用 `/book/getprogress`”，目的是避免大书架场景下批量请求过多。

当前 Tauri 应用没有独立的 `profile` 服务，也没有对整本书架批量调用 `/book/getprogress`：

- 书架同步只调用 `/shelf/sync`，并从 `readUpdateTime` 映射最近阅读时间。
- 总览页使用书架缓存、笔记概览、阅读统计和本地状态组合展示，不依赖全量逐书进度请求。
- 单本详情页在用户打开具体书籍时按需调用 `/book/info`、`/book/getprogress`、`/book/chapterinfo`。

因此，“最近 5 本电子书进度”不会破坏当前原有设计。它只应约束未来可能新增的“阅读概况聚合接口/概况页”，不应限制单本详情页的按需查询能力。

设计边界：

- 概况聚合：最多查最近 5 本 `books[]` 电子书进度。
- 单本详情：用户打开哪本书，就允许按需查询该书完整详情和进度。
- 书架总览：继续使用 `/shelf/sync` 的 `readUpdateTime`、`isFinished`、条目类型和本地缓存。
- 有声书/专辑：不调用 `/book/getprogress`，直接使用 `albums[]` 字段展示。
- 旧缓存：如本地已有较旧书籍进度缓存，可以展示为缓存数据，但不要为了概况刷新而批量补齐。

### 9. 相似推荐从搜索降级改为真实接口优先

当前前端 `DiscoveryPage` 已经具备“先调相似推荐，失败后再降级为书名搜索”的流程。旧版之所以容易看起来只能降级搜索，主要风险在后端请求参数：`/book/similar` 首次请求没有显式传 `maxIdx=0`，而新版 Skill 明确 `count` 和 `maxIdx` 都必须传。

新版 Skill 下可以真正实现相似推荐，前提是：

- 运行时上报 `skill_version=1.0.4`。
- `/book/similar` 首次请求归一化为 `count=12,maxIdx=0`。
- 翻页请求继续携带上一页最后一条 `idx` 作为 `maxIdx`，并带上 `sessionId`。
- 后端 mapper 继续读取 `booksimilar.books[].book.bookInfo`，并将 `books[].idx` 映射为下一页游标。
- 前端只在真实相似接口失败或返回不可展示结果时，才降级为书名搜索。

产品取舍：

- 相似推荐成功时，页面应明确展示“相似推荐”来源。
- 降级搜索只作为兜底，文案应说明“相似推荐接口暂时不可用，已改用书名搜索兜底”。
- 不要把搜索兜底结果混称为相似推荐，避免误导用户。

## 改造范围

### 本次建议纳入

1. Skill 版本常量升级。
2. README 示例升级。
3. `upgrade_info` 前端提示闭环。
4. `/book/similar` 默认显式分页参数。
5. 书籍详情先移除 `weread://` 展示兜底；发现页 `deepLink` 透传作为后续小步跟进。
6. 增加契约测试，包含版本一致性校验。
7. 明确阅读概况最多只查最近 5 本电子书，不改变单本详情按需查询。

### 本次不纳入

1. 大规模拆分 `src/lib/reading-api.ts`。
2. 重做发现页 UI。
3. 改造 AI 复盘、阅读指南、导出流程。
4. 删除旧版 `weread/weread-api.md`。
5. 自动下载或安装 Skill 更新包。
6. 为 `deepLink` 增加数据库表字段或执行数据迁移。

这些内容可以作为后续独立迭代，避免一次改动过大。

## 前端对齐与取舍

### 必须对齐

#### 1. 升级错误不能再只是普通错误字符串

当前前端普遍通过 `getCommandErrorMessage(error)` 把 Tauri command 错误压成字符串，再放进页面错误区域或 toast。这个策略对普通网络、认证、存储错误足够简单，但对新版 Skill 的 `upgrade_info` 不够。

取舍：

- 保留 `getCommandErrorMessage` 作为普通错误文案工具。
- 新增轻量错误分类工具，例如 `getCommandErrorInfo(error)`，返回 `{ code, message, detail }`。
- 当 `code === "upgrade_required"` 时，各微信读书数据入口展示专门的升级提示，而不是普通失败文案。

优先覆盖页面：

- 书架/总览同步入口。
- 发现页搜索、推荐、相似推荐。
- 书籍详情。
- 笔记页和统计页。

不需要覆盖：

- 纯本地图书、本地阅读器、本地 AI 操作，除非底层依赖微信读书请求。

#### 2. 书籍详情页停止展示伪造 deepLink

当前 `src/lib/reading-api.ts` 的 `mapBookDetailResponse` 在没有 `response.deepLink` 时会拼接 `weread://reading?bId=...`。这与新版 Skill 的展示契约冲突。

取舍：

- `BookDetailResponse.deepLink` 短期仍保留 `string` 类型，避免扩大前端改动。
- 未返回 `deepLink` 时返回空字符串。
- 详情页“在微信读书中打开”按钮继续走 `open_book_link` 命令，这是本地打开能力，不等同于接口返回链接展示。

这样既遵守新版“展示不伪造 deepLink”，又保留原有客户端打开体验。

#### 3. 发现页相似推荐参数需要后端兜底，前端保持显式

当前 `DiscoveryPage` 调 `getSimilarBooks` 时已经显式传 `count=12`，首次 `maxIdx` 为空。新版要求实际请求必须显式传 `maxIdx=0`，更适合在后端服务层归一化。

取舍：

- 前端继续传业务意图：首次相似推荐无需关心 `maxIdx=0` 细节。
- 后端 `build_similar_params` 负责把首次请求归一为 `count=12,maxIdx=0`。
- 缓存 key 使用归一化后的参数。

#### 4. 搜索结果不要暗示全量

新版要求搜索结果是分页片段，不应使用“共有/总共/一共”等完整结果措辞。当前 `SearchResults` 的默认标题是“`${books.length} 条可浏览结果`”，这个表述基本安全；如果后续引入 `scopeCount` 展示，文案要避免“总数”语义。

取舍：

- 保留当前“可浏览结果”。
- 分组 pill 可以继续展示 `currentCount/scopeCount`，但页面主标题不说“共找到”。
- 空结果文案可以按新版 Skill 调整为更明确的换关键词建议。

### 建议对齐

#### 1. 发现页 deepLink 透传到卡片，但不新增主要按钮

搜索、推荐、相似推荐可能返回 `deepLink`。前端目前 `SearchResult` 没有该字段，卡片也没有“打开阅读”入口。

取舍：

- 类型和 mapper 先透传 `deepLink?: string`。
- 卡片仍以“打开详情”“找相似”“保存候选”为主。
- 如展示直接打开入口，建议作为次级图标按钮或详情页入口，不要挤占发现页主操作。

理由：

- 发现页当前产品职责是“扩展候选书”，不是阅读器启动器。
- 直接打开微信读书可能打断候选整理流程。

#### 2. 搜索 scope 现有交互基本可保留

`DiscoveryPage` 已有 scope tabs，并通过 `chooseSearchScope` 做“智能范围”。这与新版显式 scope 要求方向一致。

需要微调：

- 用户点击“电子书”时明确传 `scope=10`。
- 主题词默认 `scope=0` 可以保留，因为发现页是综合搜索场景。
- 从“候选书添加/找书选择”进入发现页时，如果意图是找书，应默认 `scope=10`。
- 不要在前端按 `group.scope === 10` 过滤结果。

#### 3. 笔记想法原文字段可以保守展示

新版 `notes.md` 补充了 `abstract`、`range`、`chapterUid`、`chapterIdx`。前端已有 `Thought.abstractText`、`range`、`chapterUid`、`deepLink` 类型，说明基础已经接近。

取舍：

- 不需要重做笔记页布局。
- 如果想法有 `abstractText`，在详情/导出中优先展示“原文 + 想法”。
- 列表页可以保持简洁，避免每条想法都展开原文导致密度过高。

### 暂不对齐

#### 1. 不把阅读概况最近 5 本限制强加到总览页

总览页当前使用 `lastReadAt`、笔记概览、统计和本地状态，不批量查进度。因此不需要为了新版 `profile.md` 重做首页数据模型。

#### 2. 不把发现页改成微信读书完整搜索客户端

新版 Skill 支持更多 scope 和字段，但本应用的发现页职责是个人阅读扩展和候选管理。前端不应为了“完整复刻微信读书搜索”增加过多 tab、筛选和结果解释。

#### 3. 不把所有错误都升级为复杂错误对象 UI

结构化错误只需要为 `upgrade_required`、认证失败、网络失败这类可操作错误服务。普通表单校验和本地状态错误继续使用字符串即可。

## 新版解锁的推荐实现

### 推荐实现

本节的“推荐实现”表示新版接口已经足够明确、产品上有价值，不等于全部纳入首轮适配。首轮仍以 P0/P1 契约修正为主；涉及新页面模块、新网关枚举或多接口组合的能力，必须后置为独立迭代。

#### 1. 真实相似推荐

旧版本受 `/book/similar` 参数约束不清影响，容易失败后降级为书名搜索。新版明确必须显式传 `count` 和 `maxIdx`，因此可以把真实相似推荐作为发现页一等能力。

落地方式：

- 后端首次请求固定补齐 `count=12,maxIdx=0`。
- 前端保留失败后搜索兜底，但成功时明确展示“相似推荐”。
- 结果来源不可混淆：搜索兜底不标记为相似推荐。

#### 2. 书籍公开点评区

当前后端已有 `get_public_reviews` command 和 mapper，新版 `review.md` 明确了双层 `review` 结构与评分换算规则，适合在书籍详情页增加“读者点评”模块。

适合场景：

- 用户打开一本书详情后，查看其他读者公开点评。
- 找相似/保存候选前，辅助判断是否值得继续读。

实现取舍：

- 初版只展示推荐点评/最新点评，分页可后置。
- 明确标注这是公开点评，不混入个人笔记。
- 星级按 `20=一星 ... 100=五星` 转换。

#### 3. 笔记原文与想法的关系展示

新版 `notes.md` 补充了 `abstract`、`range`、`chapterUid`、`chapterIdx`。当前应用已经有 `Thought.abstractText` 和相关展示/导出基础，适合进一步收敛为稳定能力。

落地方式：

- 想法有 `abstractText` 时展示“原文 + 想法”。
- 导出 Markdown 优先保留原文与想法的关联。
- AI 复盘输入优先使用这组结构，减少把“评论”和“被评论原文”混在一起的歧义。

注意：

- 列表页不要默认展开所有原文，避免信息密度过高。
- 详情/导出/分享卡可以完整展示。

#### 4. 接口 deepLink 驱动的原文回跳

新版要求使用接口返回 `deepLink`，这使得“打开书籍、章节、划线、想法对应位置”更可靠。

推荐落地：

- 书籍详情：使用接口返回 `deepLink` 展示跳转入口。
- 笔记详情：划线/想法有 `deepLink` 时展示“打开原文”。
- Markdown 导出：优先使用回包 `deepLink`，没有则不手动拼接。

当前代码提醒：

- `src-tauri/src/export/markdown.rs` 仍有手动拼接 `weread://bestbookmark?...` 的逻辑，后续应改为优先使用记录里的 `deep_link`。

#### 5. 热门划线与共读想法（后置独立迭代）

新版 `notes.md` 明确了 `/book/bestbookmarks`、`/book/underlines`、`/book/readreviews`、`/review/single` 的字段和参数关系，这类能力过去不适合贸然做，因为划线范围、章节 UID、评论分页和单条想法详情契约不够稳定。现在可以作为书籍详情页的增强模块。

这不是本轮适配的必要项。它需要新增网关枚举、数据类型、缓存策略和前端组件，建议放在公开点评基础模块稳定之后再做。

适合场景：

- 用户打开一本书详情后，先看全书热门划线，快速了解公共关注点。
- 进入某个章节时，按 `chapterUid` 查看该章热门划线或划线热度。
- 对某条热门划线继续查看读者想法，形成“原文片段 + 共读观点”的辅助阅读材料。
- 对单条想法进入详情，查看评论和点赞，但只在用户显式打开时请求。

实现取舍：

- 初版只做“热门划线”模块，不默认拉取每条划线下的想法，避免一次打开书籍详情触发过多请求。
- `/book/readreviews` 只针对用户点开的 1 条或少量划线请求，`count` 控制在较小值。
- `/review/single` 作为详情弹层或抽屉，不进入同步主流程。
- 共读内容必须与个人笔记分区展示，不能混入个人笔记统计或 AI 个人偏好证据。

当前差距：

- `WereadApi` 还没有 `BestBookmarks`、`Underlines`、`ReadReviews`、`ReviewSingle` 这几类网关枚举。
- 前端还没有热门划线/共读想法的数据类型和展示组件。

#### 6. 公开点评筛选与分页（二阶段增强）

文档已经把 `/review/list` 的 `reviewListType`、`maxIdx`、`synckey`、好友点评摘要和双层 `review.review` 结构说明清楚。当前后端已有 `get_public_reviews` 能力，但前端还没有把它做成完整的书籍详情模块。

这不是第二个独立点评模块，而是前面“书籍公开点评区”的二阶段增强。初版点评区只展示一组可读点评；筛选和分页在验证用户确实需要后再补。

推荐落地：

- 书籍详情页增加“读者点评”区域。
- 初始加载 `reviewListType=1` 推荐点评或 `reviewListType=0` 全部点评，数量控制在 5-10 条。
- 提供“推荐/最新/差评/一般”筛选。
- “加载更多”使用上一页最后一条 `idx` 作为 `maxIdx`，同时携带 `synckey`。
- 展示好友点评摘要时只作为社交信号，不混入个人笔记。

这比“只显示评分和简介”更有选书价值，且比完整复刻微信读书点评页更轻。

### 可选实现

#### 1. 搜索 scope 的专业入口

发现页已经有 scope tabs，新版进一步明确了 scope 选择规则。可以把“找书、找作者、找听书、全文搜索、找书单”做成更清晰的入口。

取舍：

- 保留当前 tabs，不做复杂筛选器。
- 针对“添加候选书”默认 `scope=10`。
- 针对主题探索默认 `scope=0`。

建议优先做：

- 作者搜索：`scope=6`，适合从作者进入候选扩展。
- 有声书/专辑搜索：`scope=14`，适合与书架里的 `albums[]` 口径对齐。
- 书单搜索：`scope=13`，适合作为主题探索的补充来源。

暂缓做：

- 全文搜索：`scope=12`，容易让用户误以为应用能读取整本书正文。
- 公众号/文章搜索：`scope=2/4`，与当前“书籍候选/复盘”主线关系较弱。
- 网文专门入口：`scope=16`，除非后续明确要支持网络小说管理。

#### 2. 书架概况卡片

新版 `profile.md` 明确概况组合方式，可以做一个轻量“微信读书概况”卡片：

- 书架总数：电子书、有声书、文章收藏入口拆分。
- 最近 5 本电子书进度。
- 笔记概况：有笔记书籍数、总笔记数。

取舍：

- 只做概况，不替代现有总览页。
- 最近进度最多查 5 本。
- 不对有声书/专辑查电子书进度。

#### 3. 公开点评辅助选书

在候选书架或选书决策页，可以把公开点评摘要作为“外部信号”之一。

取舍：

- 不直接喂给 AI 作为个人偏好证据，除非明确标注是公开点评。
- 不与用户个人笔记混合统计。

#### 4. 当前章节定位增强

新版 `book.md` 把 `/book/getprogress` 的 `chapterUid`、`chapterOffset`、`progress` 语义和 `/book/chapterinfo` 的章节结构说清楚。当前应用已经能获取详情、目录和进度，可以进一步做轻量体验增强：

- 目录中高亮当前阅读章节。
- 详情页展示“当前读到第几章/哪个章节名”。
- 阅读路线或单本阅读指南优先引用当前章节名，而不是只写百分比。

取舍：

- 不做后台章节追踪。
- 不生成逐章任务清单。
- 只在用户打开详情或生成路线时使用已有详情数据。

### 暂不推荐实现

#### 1. 全量书架实时进度同步

即使新版明确了概况工作流，也不建议对全部书架逐本调用 `/book/getprogress`。大书架下请求量不可控，且与本地优先缓存策略冲突。

#### 2. 把发现页做成完整微信读书客户端

新版搜索能力更明确，但本应用的发现页目标仍是候选和个人阅读扩展。不要为了覆盖所有 scope 结果类型引入过重 UI。

#### 3. 长期保存 deepLink 作为核心数据

`deepLink` 适合当作当前接口返回的跳转能力，不适合作为候选书、AI 资产或本地书籍关联的长期主键。

#### 4. 书签正文导出

新版 `notes.md` 仍然明确：`/user/notebooks` 里的 `bookmarkCount` 只是数量，当前 `/book/bookmarklist` 已过滤书签，不能导出书签内容。旧版本不能实现的“书签正文导出”，新版依旧不能真正实现。

#### 5. 任意日期精确统计

新版 `readdata.md` 说明 `/readdata/detail` 只支持固定自然周期，不支持任意起止日期。可以做自然周/月/年/总计，也可以用多个固定周期近似组合，但不要把“2024-01-31 至今”这类区间包装成精确接口能力。

#### 6. 文章收藏具体内容同步

新版 `shelf.md` 明确 `mp` 只是文章收藏入口对象，不包含具体文章内容。可以把它计入书架条目和私密口径，但不应做“文章收藏列表同步”。

## 实现注意事项

### 1. 测试夹具同步更新

`src/pages/BookDetailPage.test.tsx` 当前测试夹具仍构造 `weread://reading?bId=...`。实现详情页停止伪造 `deepLink` 时，需要同步测试：

- 有 `deepLink` 的用例：验证接口返回链接能被保留。
- 无 `deepLink` 的用例：验证前端不生成伪造链接。
- 本地打开动作：验证“在微信读书中打开”仍可触发 `open_book_link` 路径。

### 2. open_book_link 不等同于 deepLink 展示

`open_book_link` 可以继续在本地构造 `weread://` 并交给系统打开，这是桌面应用能力；新版限制的是“展示接口数据时不要伪造 `deepLink`”。

实现时不要误删 `open_book_link`，也不要把它返回的链接写入搜索结果、推荐结果或书籍详情的 `deepLink` 展示字段。

### 3. 候选书不持久化 deepLink

候选书架的职责是本地待读/选书决策，不是微信读书直达入口。`ReadingItemState` 暂不扩展 `deepLink` 字段。

取舍：

- 保存候选时保留书名、作者、封面、分类等稳定信息。
- 不保存 `deepLink`，避免将可能变化的服务端链接长期持久化。
- 用户需要打开微信读书时，进入详情页重新读取当前接口数据或使用本地 `open_book_link` 动作。

### 4. 设置页同步状态也要识别 upgrade_required

`upgrade_required` 可能被写入 `syncState.errorCode/errorMessage`。设置页“各模块最近同步情况”不应只显示普通失败。

建议展示：

- 状态：`Skill 需升级`
- 说明：使用 `errorMessage`
- 操作：引导用户完成 Skill 更新后回到对应页面重试

这属于展示文案调整，不需要新增数据库字段。

### 5. Web Preview 数据保持兼容

`src/lib/reading-api.ts` 有 Web 预览分支，预览数据可能没有 `deepLink`。因此：

- `deepLink` 必须保持可选或空字符串兼容。
- 没有 `deepLink` 时不能报错。
- Web 预览模式不应尝试执行 `open_book_link`。

### 6. 发现页只透传 deepLink，不急于展示主按钮

发现页可以先完成类型和 mapper 透传，是否展示直达入口再按产品节奏决定。

建议保留当前主操作：

- 打开详情
- 找相似
- 保存候选

如果后续展示 `deepLink`，使用次级图标按钮或详情页入口，不要把“直接打开微信读书”变成发现页主路径。

### 7. 公开点评和共读想法优先使用纯文本

`/review/list` 等接口可能返回 `htmlContent`。前端初版应优先展示纯文本 `content`，不要直接使用 `dangerouslySetInnerHTML` 渲染回包 HTML。

如果后续确实需要富文本效果，需要先引入明确的白名单清洗策略，并补覆盖链接、图片、内联样式和脚本事件属性的测试。

## 实施方案

### 阶段一：最小运行时适配

改动：

1. 将 `WEREAD_SKILL_VERSION` 从 `1.0.3` 改为 `1.0.4`。
2. 将 README 中示例版本改为 `1.0.4`。
3. 补测试断言网关 payload 使用当前常量。
4. 补版本一致性测试：读取 `weread/SKILL.md` frontmatter 的 `version`，断言等于 `WEREAD_SKILL_VERSION`。

验收：

- `WereadGateway::build_payload` 生成的请求体包含 `skill_version: "1.0.4"`。
- README 与 `weread/SKILL.md` 版本一致。
- Rust 侧常量与本地 Skill 文档版本一致，后续升级不会静默漂移。

### 阶段二：upgrade_info 前端闭环

改动：

1. 确认 `UpgradeRequired` 通过 Tauri command 错误响应保留稳定错误码和 message。
2. 在前端统一错误归一化中识别升级错误，不将其视为普通网络失败或认证失败。
3. 在触发微信读书请求的入口展示明确提示：需要升级 Skill、服务端提示内容、升级后可重试。
4. 保留当前操作上下文，用户完成升级后可点击重试，而不是重新进入页面。

验收：

- 模拟后端返回 `upgrade_info` 时，前端显示升级提示而不是普通同步失败。
- 提示文案包含服务端 message。
- 用户可以在升级后重试当前动作。

### 阶段三：相似推荐参数适配

改动：

1. 为相似推荐定义局部默认值：
   - `DEFAULT_SIMILAR_COUNT = 12`
   - `DEFAULT_SIMILAR_MAX_IDX = 0`
2. `build_similar_params` 无论调用方是否传值，都输出 `count` 和 `maxIdx`。
3. 缓存 key 使用归一化后的分页参数，避免 `None` 与默认值形成两个语义相同的缓存 key。
4. 保持前端现有“真实相似推荐优先，失败后书名搜索兜底”的流程，但根据接口结果区分来源文案。

验收：

- 首次相似推荐请求 payload 包含 `bookId`、`count=12`、`maxIdx=0`。
- 翻页请求继续携带归一化后的 `count`、`maxIdx`、`sessionId`。
- 相似接口成功时不触发书名搜索降级。
- 相似接口失败时，搜索兜底结果不被标记为真实相似推荐。

### 阶段四：deepLink 最小契约适配

改动：

1. 后端 book mapper 增加 `deep_link` 字段读取。
2. `BookDetailResponse` 使用接口返回的 `deepLink`；没有则返回空字符串，短期保持前端类型稳定，不直接改成 `Option<String>`。
3. 前端 `mapBookDetailResponse` 不再自行构造 `weread://` 展示兜底。
4. 暂不改数据库 schema；`deepLink` 只从接口响应和 raw cache 映射到前端。

设计边界：

- 展示链接：只使用接口返回的 `deepLink`。
- 打开客户端：`open_book_link` 可继续作为独立命令，内部按当前平台打开构造出的链接。
- 数据持久化：本轮不新增结构化字段，避免引入迁移风险。

验收：

- 接口返回 `deepLink` 时，书籍详情可展示打开入口。
- 接口未返回 `deepLink` 时，前端不展示伪造链接。
- `open_book_link` 仍能用于“继续阅读”之类的主动打开动作。

### 阶段五：发现页 deepLink 与搜索 scope 收敛

改动：

1. `DiscoveryBookRecord` 增加可选 `deep_link` 字段，从 `bookInfo.deepLink` 读取。
2. 前端 `SearchResult` 增加 `deepLink?: string`，搜索/推荐/相似推荐卡片按可选字段展示打开入口。
3. 明确发现页不同入口的 scope：
   - 普通发现搜索默认 `scope=0`
   - 书籍选择/添加候选书场景默认 `scope=10`
4. 定位所有 `searchBooks` 调用方，逐个标注调用意图，避免隐式依赖服务层默认值。
5. 保留后端对 scope 的白名单校验。
6. 结果映射继续按回包中的 `books` 展示，不按 `results[].scope` 强过滤。

验收：

- 搜索/推荐/相似推荐在接口返回 `deepLink` 时能展示打开入口。
- 找书入口不会因为回包 `scope=17` 丢失电子书分组。
- 综合搜索仍可展示电子书、作者、书单等分组。

### 阶段六：阅读概况边界固化

改动：

1. 如果后续新增阅读概况聚合服务，只从 `books[]` 中按 `readUpdateTime` 降序取最近 5 本电子书。
2. 对这 5 本逐个调用 `/book/getprogress`，不对 `albums[]`、`mp` 或全量书架调用。
3. 优先复用已有本地缓存作为补充展示，但不能为了概况页批量刷新所有进度。
4. 保持单本详情页原有按需查询路径，不受最近 5 本限制影响。

验收：

- 大书架用户打开总览/概况不会触发 N 本书的进度请求。
- 最近 5 本以外的书仍可在用户打开详情时获取最新进度。
- 概况页不会对有声书/专辑调用电子书进度接口。

## 前端改造执行文档

### 改造原则

前端本轮只对齐新版 Skill 1.0.4 的契约变化，不做发现页重设计、不新增完整点评页、不扩展热门划线模块。所有改动应围绕“错误可识别、链接不伪造、字段可透传、搜索意图明确”四件事展开。

本轮目标：

1. 让 `upgrade_required` 成为前端可识别、可展示、可重试的状态。
2. 书籍详情不再把手动拼接的 `weread://` 当作接口 `deepLink` 展示字段。
3. 搜索、推荐、相似推荐结果可以透传接口返回的 `deepLink`，但不把直达阅读做成发现页主操作。
4. 搜索入口继续保持显式 scope，避免新版 Skill 明确禁止的隐式默认和错误过滤。
5. 不引入新的大型前端状态管理或页面级重构。

### 当前前端现状

已具备基础：

- 发现页已有 scope tabs 和 `chooseSearchScope()`。
- 相似推荐流程已是“真实 `/book/similar` 优先，失败后书名搜索兜底”。
- 章节目录已有当前章节高亮能力。
- 笔记/想法类型已有 `deepLink?: string`，且想法原文 `abstractText` 已可展示。
- 书架数量口径已包含电子书、有声书和文章收藏。

仍需改造：

- `getCommandErrorMessage()` 只返回字符串，无法让页面判断 `upgrade_required`。
- `mapBookDetailResponse()` 仍在没有接口 `deepLink` 时拼接 `weread://reading?bId=...`。
- `SearchResult` / `Recommendation` 类型没有 `deepLink` 字段，`mapDiscoveryBook()` 也没有透传。
- `BookDetailPage.test.tsx` 测试夹具仍把伪造 `weread://reading` 当作详情 `deepLink`。
- 微信读书请求入口分散使用普通错误文案，缺少统一升级提示组件或轻量展示规范。

### 本轮前端改动清单

#### 1. 新增结构化错误归一化

建议文件：

- `src/lib/reading-api.ts`
- 如组件变多，可后续拆到 `src/lib/command-errors.ts`，本轮不强制拆文件。

新增轻量类型：

```ts
export type CommandErrorInfo = {
  code?: string;
  message: string;
  detail?: string;
};
```

新增函数：

```ts
export function getCommandErrorInfo(error: unknown): CommandErrorInfo
export function isUpgradeRequiredError(error: unknown): boolean
```

行为要求：

- 如果 Tauri 错误对象包含 `code`，必须保留。
- `code === "upgrade_required"` 时，`message/detail` 使用后端传来的升级说明。
- `getCommandErrorMessage()` 保持兼容，内部可复用 `getCommandErrorInfo()`。
- 不把所有本地表单错误都改造成复杂对象，只覆盖 command error。

页面使用建议：

- 微信读书远端请求入口用 `getCommandErrorInfo()`。
- 纯本地操作继续用 `getCommandErrorMessage()`。

#### 2. 增加 Skill 升级提示展示

建议实现一个轻量组件或页面内 helper：

- 组件名可用 `SkillUpgradeNotice`。
- 放置位置可在 `src/components`，也可以先在页面局部实现，避免过度抽象。

展示内容：

- 标题：`微信读书 Skill 需要升级`
- 正文：使用 `message`，如有 `detail` 则展示诊断信息。
- 操作：保留当前页面已有“重试/刷新/同步”按钮，不新增自动下载逻辑。

优先覆盖页面：

- `DashboardPage.tsx` / `BookshelfPage.tsx`：书架初始化、同步书架、总览月度统计预取。
- `DiscoveryPage.tsx`：搜索、推荐、相似推荐。
- `BookDetailPage.tsx`：详情、进度、目录加载。
- `BookNotesPage.tsx` / `NotesPage.tsx`：笔记概览、单本笔记、导出前同步。
- `BookAiSummaryPage.tsx`：单本 AI 复盘在缓存缺失或生成时可能间接读取笔记。
- `StatisticsPage.tsx` / `ReadingReviewPage.tsx`：阅读统计同步。
- `ReadingHubPage.tsx`：书籍复盘页里的笔记概览读取。
- `SettingsPage.tsx`：同步状态展示；API Key 保存/校验仍按普通设置错误展示。

实现取舍：

- 不需要一次替换全站所有 `getCommandErrorMessage()`。
- P0 先覆盖微信读书远端请求最常见入口。
- 本地 AI、文件导入、本地阅读器错误不用显示 Skill 升级提示。

已落地范围：

- `CommandErrorInfo` / `getCommandErrorInfo()` 已接入主同步错误、发现页、书籍详情、笔记中心、单本笔记、统计页、阅读复盘页和 Reading Hub 的微信读书数据入口。
- `SkillUpgradeNotice` 已用于书架、发现、详情、笔记、单本 AI 复盘、统计、复盘和 Reading Hub 等页面；Dashboard 使用轻量内联文案，避免在卡片内嵌套卡片。
- 设置页同步状态行会识别 `syncState.errorCode === "upgrade_required"` 并显示“Skill 需升级”。
- 本地 AI、文件导入、本地阅读器、设置页本地备份/更新器等非微信读书 Skill 错误继续使用普通字符串错误。
- `vite.config.ts` 已显式声明项目根目录并标准化多入口 HTML 路径，避免 Windows 下 `website/index.html` 被 Vite/Rollup 解析为跨目录相对输出名。

#### 3. 书籍详情停止伪造 deepLink

改动点：

- `src/lib/reading-api.ts`
- `src/lib/types.ts`
- `src/pages/BookDetailPage.test.tsx`

要求：

- `mapBookDetailResponse()` 改为：
  - 有 `response.deepLink`：保留该值。
  - 无 `response.deepLink`：返回空字符串或可选字段，不拼接 `weread://`。
- `BookDetailResponse.deepLink` 短期可以继续保持 `string`，用空字符串兼容旧组件。
- “在微信读书中打开”按钮继续走 `openBookInWeread()` / `open_book_in_weread`，这是桌面本地打开能力，不属于展示字段伪造。

测试要求：

- 有接口 `deepLink` 时，详情响应保留接口链接。
- 无接口 `deepLink` 时，不生成 `weread://reading?bId=...`。
- 本地打开按钮仍能触发打开命令。

#### 4. 发现页结果透传 deepLink

改动点：

- `src/lib/types.ts`
- `src/lib/reading-api.ts`
- 后端 mapper 对应字段已在阶段五覆盖。

要求：

- `SearchResult` 增加 `deepLink?: string`。
- `mapDiscoveryBook()` 映射 `record.deepLink`。
- 搜索、推荐、相似推荐共用该字段。

UI 取舍：

- 本轮只完成类型和数据透传。
- 不把“打开微信读书”做成卡片主按钮。
- 若要展示，可作为详情页入口或次级图标按钮，后置决定。

测试要求：

- `mapDiscoveryBook()` 能透传 `deepLink`。
- 没有 `deepLink` 的结果保持兼容，不报错、不展示空链接。

#### 5. 搜索 scope 入口校准

现状可保留：

- `SearchScope` 已包含 `0 | 2 | 4 | 6 | 10 | 12 | 13 | 14 | 16`。
- `DiscoveryPage` 已有 scope tabs。
- `chooseSearchScope()` 已根据关键词识别找书、有声书等意图。

本轮只做校准：

- 找书/添加候选场景默认 `scope=10`。
- 泛主题探索默认 `scope=0`。
- 不按 `results[].scope === 10` 过滤电子书。
- 页面文案继续用“可浏览结果”，不要写“共找到/总共”。

暂不做：

- 作者、有声书、书单入口的完整产品化。
- 全文搜索结果解释。
- 公众号/文章搜索面板。

#### 6. 相似推荐前端保持现有策略

当前策略可保留：

- 先调用 `getSimilarBooks()`。
- 失败后首次请求才降级为书名搜索。
- 显示“相似推荐接口暂时不可用，已改用书名搜索兜底”。

需要注意：

- 后端补齐 `count=12,maxIdx=0` 后，前端不需要强行知道首次 `maxIdx=0` 细节。
- 相似推荐成功时继续展示“相似推荐”。
- 搜索兜底结果不能标记为真实相似推荐。

### 前端不纳入本轮的增强

以下能力已被新版 Skill 解锁或明确，但不进入 P0-P2：

1. 书籍详情公开点评模块。
2. 公开点评筛选分页。
3. 热门划线与共读想法。
4. 单条想法详情、评论和点赞查看。
5. 作者、有声书、书单等搜索垂直入口产品化。
6. 发现页 direct open 主按钮。
7. `reading-api.ts` 大拆分。

这些能力均需要独立交互设计、状态管理和测试，不应夹在契约适配里完成。

## 后续增强计划备注

### P3：书籍详情增强

范围：

- 公开点评基础模块。
- 当前章节定位增强。

公开点评基础模块：

- 复用后端已有 `get_public_reviews`。
- 初版只展示 5-10 条推荐或全部点评。
- 使用纯文本 `content`，不直接渲染 `htmlContent`。
- 明确标注“公开点评”，不混入个人笔记。
- 星级按 `20=一星 ... 100=五星` 转换。

当前章节定位增强：

- 详情页展示当前阅读章节名。
- 目录继续高亮当前章节。
- 阅读路线/单本指南可以引用当前章节名，但不生成逐章任务清单。

暂不做：

- 点评筛选分页。
- 点评富文本渲染。
- 评论区完整互动。

### P4：发现和共读增强

范围：

- 公开点评筛选分页。
- 热门划线与共读想法。
- 作者/有声书/书单等搜索垂直入口。

公开点评筛选分页：

- 增加“推荐/最新/差评/一般”筛选。
- 翻页使用上一页最后一条 `idx` 作为 `maxIdx`，同时携带 `synckey`。
- 保持每页小批量加载。

热门划线与共读想法：

- 新增网关枚举：`BestBookmarks`、`Underlines`、`ReadReviews`、`ReviewSingle`。
- 书籍详情先展示全书热门划线。
- 用户点击某条划线后再请求 `/book/readreviews`。
- 单条想法详情只在用户显式打开时调用 `/review/single`。
- 共读内容不进入个人笔记统计，不作为 AI 个人偏好证据。

搜索垂直入口：

- 作者搜索：`scope=6`。
- 有声书/专辑搜索：`scope=14`。
- 书单搜索：`scope=13`。
- 全文搜索、公众号、文章入口继续暂缓。

### P5：前端结构整理

目标：

- 拆分 `reading-api.ts`。
- 把命令调用、映射、错误归一化、Web 预览兜底分离。

建议方向：

- `command-errors.ts`：错误归一化。
- `weread-discovery-api.ts`：搜索、推荐、相似、公开点评。
- `weread-book-api.ts`：书籍详情、进度、章节。
- `weread-notes-api.ts`：笔记、想法、导出。
- `weread-stats-api.ts`：阅读统计。

约束：

- 只有当 P0-P4 稳定后再拆。
- 拆分时必须保持 public API 兼容或同步修改调用方。
- 不借拆分机会改 UI 行为。

## 测试计划

### Rust 单元测试

建议覆盖：

1. `WEREAD_SKILL_VERSION` 为 `1.0.4`。
2. `weread/SKILL.md` frontmatter 版本与 `WEREAD_SKILL_VERSION` 一致。
3. `upgrade_info` 被转换为稳定的升级错误。
4. `build_similar_params(None, None)` 输出 `count=12`、`maxIdx=0`。
5. discovery mapper 能读取 `bookInfo.deepLink`。
6. book mapper 能读取 `book.deepLink`。
7. 未返回 `deepLink` 时不会生成伪链接。
8. 若新增概况聚合逻辑，最近进度请求最多 5 本，且只包含 `books[]` 电子书。
9. `/book/similar` 首次请求不会因为缺少 `maxIdx` 降级为搜索。

命令：

```powershell
cargo test --lib
```

### 前端单元测试

建议覆盖：

1. `mapDiscoveryBook` 透传 `deepLink`。
2. `mapBookDetailResponse` 不再用 `weread://reading?bId=...` 兜底。
3. 升级错误展示为 Skill 升级提示，而不是普通失败 toast。
4. 搜索分组不依赖 `scope=10` 过滤。

当前已补充：

- `BookshelfPage.test.tsx` 覆盖 `upgrade_required` 同步错误显示专门 Skill 升级提示。

命令：

```powershell
npm test
```

### 构建验证

命令：

```powershell
npm run build
```

## 风险与应对

### 风险一：部分旧接口不返回 deepLink

应对：

- 展示层允许没有打开链接。
- 保留 `open_book_link` 作为用户主动打开书籍的本地能力。

### 风险二：缓存中旧数据没有 deepLink

应对：

- 前端字段保持可选。
- 缓存命中旧数据时不展示打开入口，不触发错误。

### 风险三：相似推荐默认分页改变缓存 key

应对：

- 使用归一化后的 `count/maxIdx` 生成缓存 key。
- 默认值与新版 Skill 文档保持一致。

### 风险四：升级错误被现有通用错误处理吞掉

应对：

- 为升级错误保留稳定错误码。
- 前端错误归一化先判断升级错误，再走普通网络/认证/网关错误分支。

## 优先级

1. P0：版本常量、README、版本一致性测试、`upgrade_info` 前端闭环、相似推荐默认参数。
2. P1：书籍详情 `deepLink` 最小契约适配，先停止展示伪造链接。
3. P2：发现页 `deepLink` 透传与搜索入口 scope 意图收敛。
4. P3：书籍详情公开点评基础模块、当前章节定位增强。
5. P4：公开点评筛选分页、热门划线与共读想法、作者/有声书/书单等搜索垂直入口。
6. P5：拆分 `reading-api.ts`，作为后续独立架构迭代。

## 工程原则

- KISS：先做契约适配，不做大规模架构重排；`deepLink` 先停止伪造，再逐步透传。
- YAGNI：不引入自动升级系统，不新增远程下载逻辑。
- DRY：本轮至少通过测试保证 Skill 文档版本和运行时常量一致，避免文档和运行时分叉。
- SOLID：后续拆分 `reading-api.ts` 时按领域职责拆，而不是按函数数量机械拆。
