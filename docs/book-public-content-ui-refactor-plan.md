# 书籍详情页公开内容 UI 改造方案

## 结论

当前“热门划线”和“公开点评”的数据逻辑是清晰的，但视觉表达偏原始。

截图里的主要问题不是功能缺失，而是阅读层级不足：公开内容以接近裸列表的方式铺开，章节、作者、人数、星级和正文之间缺少明确主次；长点评横向行宽过大，连续阅读压力明显。对于书籍详情页来说，这两块内容应该像“外部读者视角补充”，而不是像调试列表或数据 dump。

这次改造建议保持现有业务行为不变，只做轻量结构增强和 CSS-first 视觉升级：

- 不改变热门划线、公开点评、共读想法的加载逻辑。
- 不改变最多展示 5 条的限制。
- 不新增后端字段。
- 不把公开内容合并进个人笔记。
- 不重做书籍详情页整体布局。

第一阶段目标是让公开内容更像可阅读的内容卡片：层级清楚、行宽舒适、来源边界明确、按钮权重合理。

## 当前问题

1. 列表像裸文本

- 当前列表主要依赖横线分隔。
- 每条内容没有足够的卡片边界或引用形态。
- 视觉上更像接口返回内容直接铺出来，缺少产品完成度。

2. 信息层级偏弱

- 热门划线里的“章节名”和“多少人划过”与正文之间区分不明显。
- 公开点评里的“作者、星级、章节、时间”都挤在同一行，缺少稳定的 meta 体系。
- 用户扫读时不容易先抓住“是谁 / 哪章 / 热度 / 评价强度”。

3. 长文本行宽过长

- 公开点评可能是长段落。
- 在宽屏下正文横跨整块面板，单行字符数过多。
- 中文长段落需要更稳定的 `max-width` 和更松的行高，否则阅读疲劳明显。

4. 刷新按钮权重过高

- “刷新划线”“刷新点评”是辅助动作。
- 当前绿色实心按钮视觉很强，容易抢过内容本身。
- 页面主任务是阅读内容，而不是刷新。

5. 公开来源边界还可以更明确

- 组件已经有“来自微信读书公开内容”的说明。
- 但说明只存在于标题区，列表项自身没有形成稳定边界。
- 用户需要持续感知：这些内容不属于个人笔记，也不会写入个人数据。

6. 共读想法内嵌层级不够稳

- 共读想法是热门划线的从属内容。
- 当前使用左边线表达从属关系是对的，但整体区域仍偏弱。
- 展开后应该明显属于当前划线卡片，而不是变成另一段散列表。

## 改造目标

1. 提升可读性

- 正文使用舒适行宽和行高。
- 长点评不再横跨整屏。
- 热门划线要像引用句子，公开点评要像读者评论。

2. 强化层级

- meta 信息负责扫读。
- 正文负责阅读。
- 操作按钮负责辅助探索。
- 共读想法作为热门划线的子内容。

3. 降低刷新按钮干扰

- 保留按钮可见性。
- 降低按钮在面板里的视觉权重。
- 加载中状态和禁用状态仍清晰。

4. 明确公开内容边界

- 标题说明保留。
- 列表项用视觉语言表达“外部公开内容”。
- 不与个人笔记、个人划线产生混淆。

5. 保持最小改动

- 优先调整 `src/styles.css`。
- 只在样式无法精确控制正文和 meta 时，给 JSX 增加少量语义 class。
- 不改变组件数据结构和状态流。

## 推荐视觉方向

采用“纸面阅读卡片”风格，延续当前应用的纸色背景、绿色品牌色和 8px 圆角。

```text
[面板标题 / 来源说明]                         [刷新]

[热门划线卡片]
  第一章  ·  88 人划过
  ┃ 值得反复划线的句子。
  [查看共读想法]

  [共读想法子区]
    读者乙  ·  2026-07-12
    这段确实是全书关键。

[公开点评卡片]
  读者甲  ·  五星  ·  第一章  ·  2026-07-12
  值得继续读的一本书。
```

关键原则：

- 面板仍是页面级区块，不新增复杂导航。
- 列表项是轻量卡片，不使用过重阴影。
- 热门划线正文可以带引用感，公开点评正文保持普通段落。
- meta 使用小字号、低饱和颜色、可换行 chip。
- 内容卡片不做嵌套卡片堆叠，共读想法只作为从属子区。

## 具体改造建议

### 1. 面板头部

当前：

- 标题和说明可读。
- 刷新按钮视觉偏强。

建议：

- 保留 `section-kicker`、标题和说明。
- 面板头部保持左右布局。
- 刷新按钮可以继续使用 `secondary-action`，但在公开内容面板中局部降权。

目标：

- 按钮高度控制在 `36px` 到 `40px`。
- 按钮字号控制在 `13px` 到 `14px`。
- 背景可从实心渐变降为浅色描边，或保留实心但缩小尺寸。
- 桌面端可以收紧按钮高度，移动端触控高度应保持约 `44px`。
- 移动端按钮允许换到下一行，避免挤压标题。

### 2. 列表容器

当前：

- `.public-content-list` 和 `.public-review-list` 是简单 grid。
- 每条 item 主要靠 `border-top` 分隔。

建议：

- 列表保持 grid，但 item 改为轻量卡片。
- 去掉首项特殊边框逻辑，统一使用卡片边界。
- 使用浅纸色背景、细边框和非常轻的阴影。
- 卡片只表达内容分组，不做厚重浮层，避免把阅读列表改成卡片堆叠。

目标样式方向：

```css
.public-content-item,
.public-review-item {
  border: 1px solid rgba(36, 49, 58, 0.10);
  border-radius: 8px;
  padding: 14px 16px;
  background: rgba(255, 253, 248, 0.78);
  box-shadow: 0 8px 18px rgba(36, 49, 58, 0.04);
}
```

### 3. 热门划线正文

当前：

- 划线正文是普通 `<p>`。
- 和公开点评正文共享规则。

建议：

- 给热门划线正文增加专用类，例如 `.best-bookmark-quote`。
- 使用左边线或淡色引用背景突出“被共同划过的句子”。
- 行宽不需要太窄，但应该避免无限扩展。

目标：

- `max-width: 88ch`。
- `line-height: 1.85`。
- 左边线使用 `rgba(202, 163, 93, 0.58)` 或品牌绿的低透明度。
- 背景保持克制，不做大面积高亮。

### 4. 公开点评正文

当前：

- 长点评直接跨满面板。
- 连续多行时阅读压力较大。

建议：

- 给公开点评正文增加专用类，例如 `.public-review-body`。
- 控制最大行宽，保持自然换行。
- 保留 `white-space: pre-wrap`，兼容用户原始换行。

目标：

- `max-width: 78ch` 到 `82ch`。
- `line-height: 1.85` 到 `1.95`。
- 字号保持 15px 到 16px，不需要缩小。
- 段落颜色使用 `var(--ink)`，不降低正文可读性。

### 5. Meta 信息

当前：

- `.public-content-meta` 和 `.public-review-meta` 只是普通 flex 行。
- meta 内的 `span` 没有视觉分组。

建议：

- 保持 flex wrap。
- `strong` 作为主 meta，例如章节名或作者名。
- 其他 meta 使用浅色 chip 或低权重内联标签。
- 第一版优先用 `.public-content-meta span` 和 `.public-review-meta span` 统一处理，不必急于新增专用 chip class。

目标：

- meta 字号 `12px` 到 `13px`。
- chip padding `4px 8px`。
- chip 背景使用 `rgba(47, 111, 94, 0.08)` 或中性浅灰。
- 图标尺寸保持 `14px`，颜色跟随文本。

### 6. 共读想法子区

当前：

- `.read-reviews-inline` 使用左边线表达从属关系。
- 整体区域偏薄。

建议：

- 保留左边线。
- 增加浅背景和内边距。
- heading 中保留“共读想法 / 不属于你的个人笔记”。
- 子列表不要再做重卡片，避免卡片套卡片。

目标：

- 子区背景：`rgba(47, 111, 94, 0.055)`。
- 左边线：`rgba(47, 111, 94, 0.36)`。
- padding：`12px 14px`。
- border-radius：`8px`。
- 子项之间用 gap，不再加粗分隔线。

### 7. 空状态和错误状态

当前：

- 空状态和状态提示已经有图标、标题和说明。

建议：

- 保持现有结构。
- 与新卡片视觉统一，适当增强背景和边框。
- 错误状态继续使用暖红色，不扩大视觉面积。

目标：

- 不新增空状态文案。
- 不改错误格式化逻辑。
- 保证加载中、空状态、错误态在暗色主题下可读。
- `upgrade_required` 仍交给 `SkillUpgradeNotice` 渲染，不能因为公开内容新样式破坏升级提示布局。

## 组件落点

### `BestBookmarksPanel`

文件：`src/components/BestBookmarksPanel.tsx`

建议小幅调整 JSX：

- 热门划线正文增加 `className="best-bookmark-quote"`。
- 共读想法正文可增加 `className="read-review-body"`。
- 第一版不建议给人数 `span` 增加专用 class，除非统一 meta 规则无法满足视觉差异。

不建议修改：

- `formatBookmarkCount`
- `formatBestBookmarksError`
- `formatReadReviewsError`
- `slice(0, 5)` 限制
- `canLoadReadReviews` 判断
- `readReviewsByBookmarkId` 数据结构
- `SkillUpgradeNotice` 的升级提示分支

### `PublicReviewsPanel`

文件：`src/components/PublicReviewsPanel.tsx`

建议小幅调整 JSX：

- 公开点评正文增加 `className="public-review-body"`。
- 星级、章节、时间可复用统一 chip 样式。

不建议修改：

- `formatPublicReviewStars`
- `formatPublicReviewError`
- `slice(0, 5)` 限制
- `onRefresh` 行为
- `PublicReview` 类型
- `SkillUpgradeNotice` 的升级提示分支

### 样式

文件：`src/styles.css`

样式组织建议：

- `.public-content-panel` 作为公开内容基础面板。
- `.public-reviews-panel` 只承载公开点评差异，避免重复维护两套面板样式。
- `.public-content-item` 作为列表项基础卡片。
- `.public-review-item`、`.best-bookmark-item` 只表达各自正文差异。

重点选择器：

- `.public-content-panel`
- `.public-reviews-panel`
- `.public-content-panel .panel-heading`
- `.public-reviews-panel .panel-heading`
- `.public-content-list`
- `.public-review-list`
- `.public-content-item`
- `.public-review-item`
- `.public-content-meta`
- `.public-review-meta`
- `.best-bookmark-quote`
- `.public-review-body`
- `.read-reviews-toggle`
- `.read-reviews-inline`
- `.read-reviews-inline-heading`
- `.read-reviews-inline p`
- `.public-content-empty`
- `.public-content-status`

## 建议实施顺序

1. 给热门划线正文、公开点评正文、共读想法正文补充语义 class。
2. 将公开内容列表项从分割线样式改为轻量卡片样式。
3. 增强 meta 的字体、颜色、间距和 chip 形态。
4. 为热门划线正文增加引用式视觉。
5. 为公开点评正文增加最大行宽和舒适行高。
6. 调整共读想法子区，使其明确从属于当前热门划线。
7. 降低公开内容面板内刷新按钮的尺寸或权重。
8. 补充暗色主题样式，保证卡片、meta、错误态可读。
9. 检查移动端布局，确保按钮、meta 和长文本不溢出。
10. 跑组件测试和一次桌面/移动视觉截图。

## 验收标准

- 热门划线不再像裸文本列表，句子有清晰引用感。
- 公开点评长文本行宽受控，宽屏下不横跨整屏。
- 作者、章节、人数、星级、时间等 meta 信息可快速扫读。
- 刷新按钮仍可见，但不抢过内容本身。
- 共读想法展开后明显属于对应热门划线。
- 空状态、加载中、错误态没有视觉回退。
- 暗色主题下卡片边界、文字和图标对比度足够。
- 移动端不出现文字溢出、按钮重叠或横向页面溢出。
- 热门划线、公开点评、共读想法的现有加载行为不变。
- 现有组件测试通过。

## 不做范围

- 不新增公开内容筛选。
- 不新增分页或“查看更多”。
- 不合并公开点评和热门划线。
- 不将公开内容写入个人笔记。
- 不修改微信读书 API 映射。
- 不修改 `BestBookmarksResult`、`PublicReviewsResult`、`ReadReviewsResult` 类型。
- 不重构书籍详情页整体信息架构。
- 不引入新的 UI 组件库或图标库。

## 风险和注意事项

- 卡片边界过重会让页面显得碎，需要控制阴影和边框强度。
- chip 太多会造成 meta 行拥挤，必须允许换行。
- 公开点评行宽过窄会浪费桌面空间，建议不要低于 `72ch`。
- 刷新按钮降权过度可能降低可发现性，需要保留明确图标和文字。
- 共读想法作为内嵌子区，不应再做成独立重卡片，避免形成卡片嵌套卡片。
- 暗色主题不能只依赖浅色透明背景，需要单独检查对比度。
- 如果基础样式和点评样式同时改同一属性，后续维护容易漂移，应优先收敛到公共选择器。

## 工程原则映射

KISS：

- 先用 CSS 和少量 class 解决明确的层级与可读性问题。
- 不引入新的状态、组件库或复杂布局系统。

YAGNI：

- 不提前做分页、筛选、折叠策略或公开内容聚合。
- 只服务当前截图中暴露的 UI 问题。

DRY：

- 热门划线、公开点评和共读想法共用公开内容的 meta、状态、列表基础样式。
- 差异只通过少量语义类表达，例如 quote body 和 review body。

SOLID：

- `BestBookmarksPanel` 继续负责热门划线和共读想法。
- `PublicReviewsPanel` 继续负责公开点评。
- 样式层负责视觉表达，不把视觉状态写进数据逻辑。

## 推荐落地标准

第一版建议采用最小改动：

- 改 `src/components/BestBookmarksPanel.tsx`：只补正文 class。
- 改 `src/components/PublicReviewsPanel.tsx`：只补正文 class。
- 改 `src/styles.css`：集中完成卡片、meta、正文、共读想法和暗色主题样式。
- 跑 `npm test -- src/components/BestBookmarksPanel.test.tsx src/components/PublicReviewsPanel.test.tsx`。
- 用桌面宽屏和移动窄屏各截一张图做视觉验收。

这样可以在不碰业务逻辑的前提下，把页面从“公开内容裸列表”提升到“可阅读的公共读者视角面板”。
