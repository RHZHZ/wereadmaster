# 统计页与阅读报告页数据展示改造方案

## 当前落地进度（2026-05-24）

已完成：

- 时间锚点前进禁止进入未来周期，统计页和阅读报告页都已接入统一判定。
- `useReadingStatsPage`、`useReadingReviewPage` 已落地，页面状态和异步加载逻辑已从 page 文件抽离。
- 周期导航已统一收口到 `ReadingStatsPeriodNavigator`。
- 作者偏好与分类偏好已统一为 `PreferenceRankList`。
- 趋势图已按周期切换图形：周 / 月使用柱状图，年 / 总计使用折线图。
- 统计摘要卡已加入轻量 `sparkline`，优先复用当前缓存里的同周期样本；样本不足时不强行展示。
- 月度趋势卡已加入 `ReadingHeatmap`，用于回答“这个月具体是哪几天在读”。
- 趋势组件已补上高峰点显式标记，并在有 `compare` 时展示“较上一周期 +x% / -x%”的趋势提示。
- 阅读报告页时间轴已改为“阶段卡片内联 AI 对照”，并对额外节奏结论保留补充提示区。
- `StatisticsPage.tsx` 已拆出 `Hero / Summary / LocalInsights / Preferences / Footnote` 区块组件。
- `ReadingReviewPage.tsx` 已拆出 `Hero / Metrics / Timeline / Profile / Preference / Focus / Actions / Meta` 区块组件。
- 阅读报告页阶段解释已从“纯关键词命中”升级为“阶段 tone + 位置词 + 顺序近邻”的映射策略。
- 阅读报告页已接入 `阅读人格 MBTI`：本地规则先生成 `ReadingPersona`，AI 只允许补充 `summary / suggestion`，不能覆盖人格代码、证据和统计事实。
- 阅读报告页人格卡已从 CSS 兜底角色切换到 Image2 离线生成的 `4 组固定人物 PNG + 16 个类型道具 PNG`，并通过 `src/lib/persona-visuals.ts` 扩展到 16 型映射。
- 统计页 Hero 已将 `生成月报海报` 泛化为 `生成阅读报告`；周 / 月 / 年复用首版报告预览弹窗、本地 Canvas PNG 导出和同一套阅读人格视觉语言，总计暂不进入首版报告生成范围。
- 首页总览区已从旧“近期画像”切到轻量 `阅读人格` 缩略卡，复用 `buildReadingPersona + resolvedPersona` 口径。
- 统计复盘 Markdown 导出已接入 `resolvedPersona`：`complete` 输出 `阅读人格`，`provisional` 输出 `阅读倾向（临时）`，`insufficient` 不输出人格区块。
- 真实本地缓存已验证存在“未来周 + 零数据”的历史脏缓存场景；前端“取最新统计”与摘要 `sparkline` 已改为优先忽略未来周期，避免周度首页被未来空周误带空。
- Web 预览已支持只读统计回退：`getReadingStats / syncReadingStats / getLatestReadingStatsReview / getCredentialStatus / getAiSettingsState` 会在非 Tauri 环境优先读取 `/.codex-temp/reading-preview-data.json`。
- 已新增导出脚本 `npm run export:reading-preview-data`，可把本机 `reading-cache.sqlite3` 中的统计缓存和 `reading-stats-review` 复盘缓存导出到 `.codex-temp/reading-preview-data.json`，供 `127.0.0.1:4173` 直接预览。
- Web 预览已扩展到总览基础数据：`getBookshelf / syncShelf / listReadingItemStates / getNotebookOverview` 也会在非 Tauri 环境读取同一份预览 JSON，不再只剩统计页有数据。
- 预览导出结构已升级为 `schemaVersion: 2`，除统计缓存外，还会一并导出 `shelf_entries / notebook_books / reading_item_states` 与 `shelf / notes / stats` 的 `sync_state`，供总览页、候选队列和笔记总览复用。
- 阅读报告与长期复盘 PNG 导出已统一走应用导出目录；Web 预览 / 普通浏览器环境保留浏览器下载兜底。

仍待推进：

- 如果后端后续返回结构化节奏标签，可把当前前端评分映射替换为显式标签直连，进一步降低歧义。
- 如果后续要把“月度 / 年度 / 周度复盘”也在 Web 预览里完整演示，需要补更多对应周期的 AI 缓存，而不是继续依赖总计唯一一条 `reading-stats-review`。
- 阅读报告生成弹窗需要继续向导化：统一 `生成报告图` 入口，但把周报 / 月报 / 年报 / 长期复盘的时间选择和预览操作隔离，避免同屏控件过密。
- 单本笔记详情、书籍详情和更多写操作仍然主要依赖桌面端命令；当前 Web 预览定位仍是“读缓存、看结构、验布局”的只读链路。
- 内置浏览器联调时无法验证真实下载事件，因为 Codex IAB 当前不支持下载能力；这部分需要靠单测和桌面端 / 常规浏览器手工回归补齐。

## 背景

当前统计页和阅读报告页已经具备这些基础能力：

- 支持 `总计 → 年度 → 月度` 历史下钻。
- 支持前后切换历史周期，且时间锚点不会进入未来周期。
- 统计输入已经稳定收敛到结构化字段：`buckets`、`longestItems`、`categories`、`readDays`、`totalReadTimeSeconds`、`dayAverageReadTimeSeconds`、`compare`。

当前问题不在“有没有更多图表”，而在“同一页是否把问题讲清楚”：

- 时间变化和结构偏好混用了相近视觉，用户不容易一眼区分“走势”和“构成”。
- 周 / 月 / 年 / 总计几种周期的主图过于接近，没有体现不同分析目标。
- 作者偏好当前更像装饰性云图，视觉上轻松，但不利于精确比较。
- 统计页和阅读报告页都在展示数据，但“查数”和“解释”两类任务还没有彻底分开。

这次改造的目标不是继续堆图，而是把两页分别收口成：

- 统计页：回答“这期读了多少、和上期比怎样、主要读了什么”。
- 阅读报告页：回答“这期为什么会这样、重点该复盘什么、下一步做什么”。

## 当前数据边界

当前前端可稳定使用的数据模型定义在：

- `src/lib/types.ts`
- `src/lib/reading-api.ts`

现阶段可直接支撑的展示能力：

- `buckets`：趋势图、阶段变化、高峰分桶、月度热力图基础数据。
- `longestItems`：长读书目、作者聚合偏好、重点内容。
- `categories`：分类偏好、偏好地图、分类排行。
- `readDays`、`totalReadTimeSeconds`、`dayAverageReadTimeSeconds`、`compare`：摘要卡和周期比较。

现阶段不建议直接规划到首版的数据展示：

- 偏好版权方。
- 小时段阅读习惯。
- 更细的跨分类交叉分析。
- 依赖后端新增字段的大型多维图表。

原因很简单：当前 payload 并没有稳定提供这些聚合结果，先画图只会把前端推向猜数据。

## 设计原则

### 1. 一个图只回答一个问题

- 趋势图回答“什么时候高、什么时候低、变化是否持续”。
- 偏好图回答“时间主要花在什么方向”。
- 排行图回答“哪几本书或哪几位作者最值得关注”。

如果一张图不能回答独立问题，就不进入页面。

### 2. 先保证可读，再考虑图形丰富度

- 同一页尽量控制在 3-4 种图形语言内。
- 不为了“更像 BI”增加饼图、雷达图、复杂气泡图。
- 优先使用用户更容易读懂的柱状、折线、横向排行条和热力图。

### 3. 按周期切换图形，而不是所有周期共用一个主图

- 周 / 月更适合看离散分桶。
- 年 / 总计更适合看走势。
- 不同周期应该使用不同默认图形，而不是只换标题。

### 4. 统计页和阅读报告页职责分离

- 统计页偏“查数”和“比较”。
- 阅读报告页偏“解释”和“行动”。
- 两页允许复用数据，但不应做成两个长得差不多的面板。

## 图表策略总览

| 问题 | 周度 | 月度 | 年度 | 总计 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 这段时间阅读量怎么变化 | 柱状图 | 柱状图 | 折线图 | 折线图 | 周 / 月看离散日分桶，年 / 总计看连续趋势 |
| 我具体在哪几天读了 / 断了 | 不单独展示 | 热力图 | 不展示 | 不展示 | 热力图只在月度有高价值 |
| 我主要把时间投向哪里 | 横向排行条 | 横向排行条 | 横向排行条 | 横向排行条 | 分类和作者统一为可比较列表 |
| 哪些内容最值得复盘 | 长读书目排行 | 长读书目排行 | 长读书目排行 | 长读书目排行 | 保留现有排行卡片 |
| 本期为什么会形成这个结果 | 阶段条 + 解释 | 阶段条 + 解释 | 阶段条 + 解释 | 阶段条 + 解释 | 放在阅读报告页，而不是统计页 |

## 图表 tooltip / hover 交互规范

图表读数的下一步问题通常不是“这是什么图”，而是“这个点的精确值是多少”。因此 tooltip 建议作为增强能力加入，但必须遵守一个前提：

- 页面主信息不能依赖 tooltip 才能读懂。

换句话说，tooltip 负责补精确值，不负责承载页面主结论。

### 适用范围

第一批建议只给以下图表加 tooltip：

- 趋势柱状图。
- 折线趋势图。
- 月度热力图。
- 阅读报告页的偏好地图。

暂不建议优先加入 tooltip 的区域：

- 长读书目排行。
- 作者排行条。
- 分类排行条。
- 摘要卡内的小 sparkline。

原因：

- 列表型模块本身已经直接展示主要信息，tooltip 收益较低。
- 趋势图、热力图和偏好地图更容易出现“用户想知道精确值，但主图只表达相对关系”的情况。

### 统一原则

#### 1. 不做 hover-only

tooltip 必须同时支持：

- `hover`
- `focus`
- `tap / click`

桌面端用户会使用鼠标，但统计页和阅读报告页也必须兼容键盘与触屏。

#### 2. Tooltip 只放精确信息，不放长解释

tooltip 建议只回答以下问题：

- 当前点对应哪个时间或哪项分类。
- 当前值是多少。
- 是否属于高峰或高强度点。
- 可选占比信息。

不建议在 tooltip 内部重复页面长文案或 AI 解释。

#### 3. 图形联动比浮层本身更重要

tooltip 出现时，当前图元应同步高亮：

- 柱子高亮。
- 折线点高亮。
- 热力格高亮。
- 偏好块高亮。

如果只弹出一个小浮层，而图本体没有明确反馈，交互价值会明显下降。

### 各图的 tooltip 内容建议

#### 趋势柱状图 / 折线图

建议显示：

- 时间标签。
- 阅读时长。
- 如果是高峰，显示 `本周期高峰`。
- 可选：占有效分桶比例。

示例：

- `2026-04-17`
- `阅读 2小时11分钟`
- `本周期高峰`
- `占有效分桶 56%`

#### 月度热力图

建议显示：

- 日期。
- 阅读时长。
- 强度等级，例如 `低 / 中 / 高 / 峰值`。

示例：

- `2026-05-18`
- `阅读 48 分钟`
- `中等活跃`

#### 偏好地图

建议显示：

- 分类名。
- 阅读时长。
- 占当前分类投入比例。
- 可选：阅读本数。

示例：

- `历史`
- `投入 6小时20分钟`
- `占分类投入 28%`
- `涉及 4 本`

### 交互行为建议

建议全站统一成同一套行为：

- 鼠标进入显示。
- 键盘聚焦显示。
- 触屏点击显示。
- 同时只显示一个 tooltip。
- 点击其他图元时切换 tooltip 目标。
- 滚动时关闭 tooltip。
- 失焦或鼠标离开短暂延迟后关闭。

第一版不需要做复杂的 tooltip pin 模式，但应保留点击触发的交互基础。

### 无障碍要求

这一层建议在首版就带上：

- 所有可触发 tooltip 的图元都应可 `tab` 聚焦。
- 每个图元应有明确 `aria-label`。
- tooltip 不能成为唯一信息来源。
- 高峰或高强度状态不能只依赖颜色表达。

### 组件级落点

建议优先改造这些组件：

- `src/components/BarTrend.tsx`
- `src/components/LineTrend.tsx`
- `src/components/ReadingHeatmap.tsx`
- `src/features/reading-review/components/ReviewPreferenceSection.tsx` 中的 `PreferenceMap`

建议新增轻量公共能力：

- `src/components/chart-tooltip/ChartTooltip.tsx`
- `src/components/chart-tooltip/useChartTooltip.ts`
- `src/components/reading-trend-tooltip.ts`

职责划分：

- `ChartTooltip`
  - 只负责渲染浮层内容。
- `useChartTooltip`
  - 负责当前激活图元、定位和 `hover / focus / tap` 行为。
- 各图表组件
  - 只负责提供锚点和 tooltip 内容。

### 实现优先级

第一阶段：

- 给 `BarTrend` 加 tooltip。
- 给 `LineTrend` 加 tooltip。

第二阶段：

- 给 `ReadingHeatmap` 加 tooltip。

第三阶段：

- 给阅读报告页 `PreferenceMap` 加 tooltip。

暂不进入当前范围：

- 给排行列表统一加 tooltip。
- 给摘要卡内的 `MetricSparkline` 加 tooltip。
- 做复杂的多图联动或跨模块联动。

## 时间锚点交互改造

图表之外，当前统计页和阅读报告页还有一个高频交互问题：

- 用户只能通过 `上一段 / 下一段` 箭头逐段切换时间。
- 想跳到更早的年份或月份时，交互成本过高。
- `年度 / 按年查看` 和下方 `按月查看` 容易被理解成文案冲突。
- `月度` 顶部 tab 与年度模式下的月份 chips 在认知上存在重复表达。

这次时间导航改造的目标不是增加一个重型日期筛选器，而是把时间导航拆成三种职责：

- 切换粒度：`周度 / 月度 / 年度 / 总计`
- 相邻浏览：`上一段 / 下一段`
- 快速定位：`跳转到某年 / 某月 / 某周`

### 交互原则

#### 1. 不新开页面

时间切换属于当前报表上下文操作，不应该跳到新的时间选择页面。

推荐方式：

- 保持在当前统计页或阅读报告页内完成。
- 在时间锚点区增加 `跳转` 按钮。
- 点击后打开轻量弹层或抽屉，而不是新页面。

#### 2. 箭头保留，但降级为相邻浏览

箭头仍然有价值，但它只适合短距离切换。

- `上一段 / 下一段` 负责看相邻周期。
- 长距离定位由 `跳转` 负责。
- 下方 chips 只负责当前上下文里的快捷入口，不再承担全部时间导航职责。

#### 3. 顶部 tab 只表达“模式”，不表达“下钻动作”

顶部 tab 的职责是切换统计粒度，不是指导用户继续下钻。

推荐副标题：

- 周度：`自然周`
- 月度：`自然月`
- 年度：`自然年`
- 总计：`全部历史`

不再使用：

- 年度：`按年查看`
- 月度：`按月查看`

因为这些表述会与下方下钻区形成语义重叠。

### 时间锚点区结构

推荐把时间锚点区固定为三段：

- 左侧：当前时间锚点标题
- 中间：`跳转`
- 右侧：`上一段 / 下一段`

下方快捷区只在需要时出现，用于表达当前层级下的快捷定位，不与顶部 tab 重复。

### 各模式建议交互

#### `overall`

当前含义：

- 长期资产总览

快捷区：

- `历史年份`

跳转器：

- 显示年份列表或年份网格
- 点击某一年后进入该年的 `annually`

#### `annually`

当前含义：

- 查看某一整年

快捷区：

- `本年各月`
- 这里的月份区是“该年内月份下钻”，不是另一个重复的 `按月查看` 页面。
- 不要再用 `按月查看` 这种会和月度模式撞词的文案。

跳转器：

- 顶部年份切换
- 下方 12 个月宫格
- 点击月份后进入 `monthly`

#### `monthly`

当前含义：

- 查看某一具体月份

快捷区：

- 第一版默认不显示

原因：

- `月度` 顶部 tab 已经表达了当前粒度。
- 再展示一排同层级月份 chips，容易与年度页的下钻入口混淆。

跳转器：

- 显示年份切换和月份宫格
- 点击月份后直接跳到目标月份

#### `weekly`

当前含义：

- 查看某一周

快捷区：

- 第一版默认不显示

跳转器：

- 先选年份
- 再选月份
- 再列出该月所有周一锚点

第一版不做完整日历月视图，避免复杂度过高。

### 文案收口

快捷区标题建议改为：

- `overall`：`历史年份`
- `annually`：`本年各月`

跳转器标题建议按模式切换：

- `overall`：`选择年份`
- `annually`：`选择月份`
- `monthly`：`跳到月份`
- `weekly`：`跳到周`

### 状态设计

页面层继续保留现有：

- `period`
- `activePeriod`

建议新增页面层状态：

- `isJumpPickerOpen`

跳转器内部维护临时状态：

- `selectedYear`
- `selectedMonth`
- `selectedWeekBaseTime`

这些中间状态不应抬升到统计页主状态，避免让页面逻辑变得臃肿。

### 规则复用

这部分不需要改后端，直接复用现有 period 规则：

- `buildReadingStatsPeriod(...)`
- `canShiftReadingStatsPeriod(...)`
- `shiftReadingStatsPeriod(...)`

新增 helper 只负责“可跳转选项生成”，不重新定义时间合法性。

### 选项范围策略

当前系统没有稳定的“最早阅读年份”字段，因此第一版不强依赖远端或数据库补充。

推荐策略：

- 默认显示 `当前年` 往前若干年，例如 10 年。
- 如果本地缓存中出现更早年份，则自动向前扩展。
- 所有未来年 / 月 / 周都禁用或不展示。

### 验收标准

- 用户从当前年份跳到更早年份时，不需要连续点击多个箭头。
- 用户从年度视角进入某个月时，不需要先切 tab 再逐段翻动。
- 顶部 tab 与下方快捷区不再语义撞车。
- 统计页和阅读报告页的时间导航行为保持一致。
- 所有未来时间仍然不可选。

## 统计页改造

统计页的目标是让用户快速完成三件事：

- 确认本周期总量。
- 判断是否比上一周期更高或更低。
- 找到主要投入方向和代表内容。

建议改成四层结构。

### 第一层：核心指标层

保留 4 张摘要卡：

- 总时长。
- 阅读天数。
- 日均时长。
- 环比变化。

建议增强：

- 每张卡右上角增加一个轻量 `sparkline`，只展示最近 6 个同周期点。
- 空态时区分“未同步”与“该周期无数据”，不要统一显示为“暂无”。

### 第二层：时间趋势层

现有 `ReadingTrend` 组件继续保留，但改造成按周期自动切换图形的趋势组件：

- `weekly`：7 天柱状图。
- `monthly`：按天柱状图。
- `annually`：12 个月折线图。
- `overall`：按年折线图。

趋势图旁边保留简短文字摘要：

- 合计阅读时长。
- 高峰分桶。
- 平均每个有效分桶。

建议继续加强：

- 在高峰点加显式标记。
- 对 `compare` 不为空的周期，在图旁增加一句“较上一周期 +x% / -x%”。

### 第三层：结构偏好层

这一层建议统一为“可比较的排行条”，不要继续混用作者云和分类条。

作者偏好：

- 由当前的 `AuthorPreferences` 改为横向排行条。
- 每行显示：作者名、阅读时长、占比、涉及书目数。

分类偏好：

- 沿用当前分类列表思路，但改成与作者偏好同一组件和同一视觉语言。
- 每行显示：分类名、阅读时长、占比、可选阅读本数。

统一约束：

- 最多显示 6-8 项。
- 列表超出时使用卡片内滚动，而不是把整页撑高。

### 第四层：代表内容层

保留现有长读书目排行作为“代表内容”层，不建议改成更复杂的图。

原因：

- `longestItems` 本身就是天然的排行语义。
- 这里的关键是“值不值得看”，不是“视觉是否更复杂”。

建议增强：

- 在总计模式下强化“长期长读书目”文案。
- 在非总计模式下补一条“本周期重点内容投入”摘要。

## 阅读报告页改造

阅读报告页不是第二个统计页。它的重点应是“解释本期节奏和偏好，并给出可执行下一步”。

建议改成四层结构。

### 第一层：结论层

保留当前封面 Hero 和核心指标，但收口表达目标：

- 这期读了多少。
- 最高峰在哪一段。
- 主要偏好是什么。
- 当前周期更接近什么阅读节奏。
- AI 给出的本期主结论是什么。

这一层不适合再堆多个图。

建议在这一层加入 `AI 本期结论`：

- 展示 `overview`。
- 摘出 2-3 条最关键洞察，优先来自 `rhythmInsights` 和 `preferenceInsights`。
- 每条洞察都应能在下方统计图或排行中找到证据。
- 不把 AI 结论写成“最终评价”，而是写成“基于统计信号的观察”。

### 第二层：阅读人格层

阅读人格分析适合加入，建议采用大众更容易理解的 `MBTI-like` 表达，但必须定义为“阅读风格隐喻”和“统计信号画像”，不是心理测试、真实 MBTI 判定或价值判断。

推荐定位：

- 让用户一眼理解自己这一周期的阅读状态。
- 给月报海报提供更有传播感的标签。
- 帮助阅读报告从“数据解释”变成“个人画像”。

第一版建议采用“三层表达”：

- MBTI-like 代码，例如 `INFJ 型读者`。
- 阅读人格名称，例如 `历史共情者`、`知识建筑师`、`故事漫游者`、`观点辩手`。
- 一句解释，说明这个标签来自哪些统计信号。
- 2-3 个证据点，例如高投入分类、阅读节奏、代表书目。
- 1 条温和建议，例如下周期继续保持或补齐短板。

前台文案建议使用：

- 主标题：`阅读人格 MBTI`
- 主结果：`INFJ 型读者 · 历史共情者`
- 辅助说明：`基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。`

#### 四维映射建议

这里可以借用 MBTI 字母的熟悉度，但每个字母都重新限定为阅读行为维度：

| 维度 | 阅读含义 | 倾向依据 |
| --- | --- | --- |
| `E / I` | 探索广度 / 主题深度 | 分类分散度、作者分散度、长读书目集中度 |
| `S / N` | 实用经验 / 概念想象 | 工具、财经、管理等实用类占比 vs 历史、文学、哲学、科幻等抽象叙事类占比 |
| `T / F` | 分析取向 / 共鸣取向 | 技术、商业、制度、方法类占比 vs 人物、传记、文学、社会观察类占比 |
| `J / P` | 稳定推进 / 即兴探索 | 阅读天数、分桶稳定性、完成或长读集中度、候选切换信号 |

#### 首版判定规则

首版建议不做模型打分器，而是使用可解释的本地规则。每个维度只回答一个问题，最终再合成为四字母代码。

前置派生指标建议：

- `topCategoryShare`
  - `categories[0].readTimeSeconds / categories.totalReadTimeSeconds`
- `top3CategoryShare`
  - `top3 categories readTimeSeconds / categories.totalReadTimeSeconds`
- `authorConcentration`
  - 从 `longestItems` 按 `author` 聚合后，取 Top 1 作者时长 / `longestItems.totalReadTimeSeconds`
- `topItemShare`
  - `longestItems[0].readTimeSeconds / longestItems.totalReadTimeSeconds`
- `activeBucketCount`
  - `buckets` 中 `readTimeSeconds > 0` 的数量
- `stableBucketShare`
  - `buckets` 中高于 `有效分桶平均值 * 0.6` 的分桶数量 / `activeBucketCount`

分类语义建议维护为前端常量，不交给 AI 决定：

- `S/T` 倾向分类：`经济理财`、`管理`、`职场`、`工具`、`计算机`、`科技`
- `N/F` 倾向分类：`历史`、`文学`、`小说`、`传记`、`哲学`、`社会学`、`艺术`
- 允许一个分类同时影响两个维度，但权重必须写死在本地映射表中。

各维度首版规则建议：

| 维度 | 判定规则 | 回退规则 |
| --- | --- | --- |
| `E / I` | `top3CategoryShare >= 0.72` 或 `authorConcentration >= 0.45` 或 `topItemShare >= 0.35` 判 `I`；否则判 `E` | `longestItems` 缺失时只看 `top3CategoryShare` |
| `S / N` | `N 倾向分类时长 >= S 倾向分类时长 * 1.15` 判 `N`；`S 倾向分类时长 >= N 倾向分类时长 * 1.15` 判 `S` | 两侧接近时，按第一大分类落点决定 |
| `T / F` | `T 倾向分类时长 >= F 倾向分类时长 * 1.15` 判 `T`；`F 倾向分类时长 >= T 倾向分类时长 * 1.15` 判 `F` | 两侧接近时，优先看 `longestItems` 中人物/叙事类书目数量 |
| `J / P` | `readDays >= 8` 且 `stableBucketShare >= 0.45` 判 `J`；`readDays <= 4` 或 `activeBucketCount <= 2` 判 `P` | 中间区间按 `compare` 是否波动过大和 `topItemShare` 是否集中补判 |

平票处理建议：

- 当两个方向差值都在 `15%` 以内时，不要硬解释成“强烈倾向”。
- UI 文案使用 `略偏 N`、`略偏 F` 这类表达。
- `dimensions` 中增加 `strength: strong | medium | light`，供前端控制强调程度。

落地原则：

- 人格代码优先由本地规则计算，保证同一份统计得到稳定结果。
- AI 只负责改写名称、总结和建议，不能改写事实证据。
- 数据不足时可显示 `临时阅读倾向`，不强行给完整四字母类型。
- 总计、年度、月度可以生成不同人格；月度人格更像“本月阅读状态”，总计人格更像“长期阅读气质”。

#### 类型命名建议

首版可以预置 16 个名称，避免 AI 每次自由发明导致口径漂移：

| 类型 | 阅读人格名 |
| --- | --- |
| `INTJ` | 知识建筑师 |
| `INTP` | 概念拆解者 |
| `ENTJ` | 系统规划者 |
| `ENTP` | 观点辩手 |
| `INFJ` | 历史共情者 |
| `INFP` | 故事漫游者 |
| `ENFJ` | 意义连接者 |
| `ENFP` | 灵感采集者 |
| `ISTJ` | 秩序型读者 |
| `ISFJ` | 温故守护者 |
| `ESTJ` | 实用管理者 |
| `ESFJ` | 生活观察者 |
| `ISTP` | 技能实验者 |
| `ISFP` | 审美沉浸者 |
| `ESTP` | 行动派读者 |
| `ESFP` | 情绪体验家 |

#### 人格视觉策略

阅读人格适合有个性化配色，但不建议为 16 种类型各做一套完整主题。第一版建议使用 `4 组气质色板 + 16 个类型微差异`：

| 分组 | 覆盖类型 | 视觉方向 | 适用语义 |
| --- | --- | --- | --- |
| `NT` | `INTJ`、`INTP`、`ENTJ`、`ENTP` | 冷静蓝绿、石墨、银灰 | 分析、结构、观点、系统 |
| `NF` | `INFJ`、`INFP`、`ENFJ`、`ENFP` | 温暖酒红、玫瑰棕、纸白 | 共鸣、故事、意义、灵感 |
| `SJ` | `ISTJ`、`ISFJ`、`ESTJ`、`ESFJ` | 松绿、米白、细金线 | 秩序、沉淀、生活、管理 |
| `SP` | `ISTP`、`ISFP`、`ESTP`、`ESFP` | 琥珀、橄榄、深墨 | 行动、审美、体验、现场感 |

页面表现建议：

- 阅读人格卡使用对应分组的低饱和背景和强调色。
- 四维字母使用同一组 accent，不为每个字母单独上强烈颜色。
- 证据标签使用浅色描边或轻底色，避免像等级徽章。
- 月报海报沿用同一 `paletteGroup`，保证应用内报告和导出图片视觉一致。
- 16 个类型的差异优先体现在名称、小图标、纹理或细节点缀，不改变整页主视觉。

数据结构建议：

```json
{
  "readingPersona": {
    "code": "INFJ",
    "paletteGroup": "NF",
    "accentTone": "rose"
  }
}
```

边界：

- 配色只表达阅读报告氛围，不表达人格优劣、能力等级或阅读品味高低。
- 不让 `T`、`J` 等类型看起来更“高级”，也不让 `F`、`P` 等类型看起来更“软弱”或“不稳定”。
- 统计页整体主题仍保持产品主视觉，人格色只在卡片、海报和少量强调元素中使用。

#### 人格画像角色策略

阅读人格可以配套一个低多边形 / 纸雕感角色插画，用作报告页人格卡背景和月报海报视觉锚点。这个角色不是头像生成器，而是“阅读风格角色资产”。

建议第一版采用固定资产映射：

- 每个 `personaCode` 对应一个稳定视觉映射。
- 第一版已按 `paletteGroup` 落地 4 个 Image2 固定基础角色：`NT / NF / SJ / SP`。
- 16 型差异已落地为 `personaCode -> 专属道具 PNG + 道具语义 + 人格文案 + 强调色`。
- 角色由前端根据本地人格结果选择，不让 AI 每次重新生成。
- 海报导出使用静态角色图，报告页内可以叠加轻互动。

视觉方向：

- 使用统一的低多边形、纸雕或柔和 3D 插画风格。
- 角色可以持有书、便签、望远镜、地图、工具箱等阅读隐喻道具。
- 背景保持低对比，不抢正文和证据列表。
- 不出现真实人物肖像，不暗示性别、年龄、职业或社会身份。

互动建议：

- 人格卡进入视口时，角色轻微浮动或淡入。
- 鼠标悬停角色时，显示 `为什么是这个画像` 的证据摘要。
- 悬停四维字母时，角色附近点亮对应维度短说明。
- 点击或聚焦角色时，展开完整证据；触屏端用点击，不依赖 hover-only。
- 导出海报时禁用动画，只保留当前静态姿态。

技术边界：

- 第一版不做实时 3D，不做可换装系统，不做逐次 AI 生图。
- 角色图片应作为本地静态资源进入构建，避免导出时依赖网络。
- 如果后续使用 image2 生成素材，只用于离线生产固定资产，不在用户生成海报时调用。
- 所有角色资产必须可回退：缺图时显示人格色块、纹理和类型徽章。

当前落点：

- `src/assets/personas/base/persona-base-nt.png`
- `src/assets/personas/base/persona-base-nf.png`
- `src/assets/personas/base/persona-base-sj.png`
- `src/assets/personas/base/persona-base-sp.png`
- `src/assets/personas/props/persona-prop-*.png`
  - 维护 16 个 `personaCode` 专属道具资产。
- `src/lib/persona-visuals.ts`
  - 维护 `16 personaCode -> 4 paletteGroup base asset + 16 prop asset + propLabel + typeLabel` 映射。
- `src/components/PersonaIllustration.tsx`
  - 复盘页和月报预览共享同一个 `人物 + 道具` 插画渲染组件。
- `src/features/reading-stats/monthly-report-poster.ts`
  - Canvas 导出改为加载同一套人物和道具 PNG，不再手绘 CSS 兜底角色。

建议后续扩展映射：

```json
{
  "personaVisuals": {
    "INFJ": {
      "baseAsset": "persona-base-nf.png",
      "propAsset": "persona-prop-infj.png",
      "prop": "archive-map"
    }
  }
}
```

#### 低数据降级策略

人格模块不能在低数据周期里强行给结论。建议分三档：

| 状态 | 条件 | 展示策略 |
| --- | --- | --- |
| `complete` | `totalReadTimeSeconds >= 4h`、`readDays >= 4`、`activeBucketCount >= 3`、`categories >= 2` | 展示完整四字母人格、名称、四维解释、证据和建议 |
| `provisional` | `totalReadTimeSeconds >= 90min`、`readDays >= 2`，且四维里至少有 2 维可稳定判定 | 展示 `临时阅读倾向`，可保留四字母代码，但弱化主标题，说明样本较少 |
| `insufficient` | 不满足以上条件 | 不展示人格代码，只展示“画像生成条件不足”和补足建议 |

降级文案建议：

- `complete`
  - `你的阅读人格：INFJ 型读者`
- `provisional`
  - `本月阅读倾向：INFJ 型读者（临时）`
- `insufficient`
  - `本期阅读样本较少，继续阅读后再生成阅读人格`

降级行为建议：

- `provisional` 状态下保留 `paletteGroup`，但降低视觉饱和度，不做完整海报主标题。
- `insufficient` 状态下海报导出不显示人格模块，避免伪结论进入分享链路。
- 总计模式优先更容易达到 `complete`；月度模式更容易进入 `provisional`。

边界：

- 不使用“人格优劣”“自律程度”“知识水平”这类评价性词汇。
- 不直接断言“你是 INFJ”，只能写成 `INFJ 型读者` 或 `你的阅读风格接近 INFJ 型读者`。
- 不解释真实 MBTI 的心理学定义，不输出心理诊断、性格定论或人生建议。
- 不根据少量数据过度归因。
- 数据不足时显示“画像生成条件不足”，不强行贴标签。
- 标签必须能从 `categories`、`buckets`、`longestItems`、`readDays`、`totalReadTimeSeconds` 推导。

#### 阅读人格示例

```json
{
  "readingPersona": {
    "code": "INFJ",
    "label": "历史共情者",
    "paletteGroup": "NF",
    "accentTone": "rose",
    "displayTitle": "INFJ 型读者 · 历史共情者",
    "description": "这一周期的阅读明显集中在历史、人物和时代议题，并且长读书目占比较高，更像是在围绕一条主线持续推进。",
    "dimensions": [
      { "key": "I", "label": "主题深度", "basis": "分类和长读书目更集中" },
      { "key": "N", "label": "概念想象", "basis": "历史和思想性内容占比较高" },
      { "key": "F", "label": "共鸣取向", "basis": "人物与时代命运相关内容更突出" },
      { "key": "J", "label": "稳定推进", "basis": "阅读分桶相对稳定" }
    ],
    "evidence": ["历史类投入最高", "长读书目集中", "阅读峰值出现在月中"],
    "suggestion": "下个周期可以保留一本文学或社科短书，避免主题过窄。"
  }
}
```

实现建议：

- 前端先用本地规则生成兜底人格，保证无 AI 时也能展示。
- AI 可以改写标签和描述，但不能改变证据事实。
- 海报只展示 `label` 和一句短描述；完整报告页展示证据和建议。
- 页面显式说明 `MBTI-like` 只是阅读风格隐喻，不代表真实心理人格。

#### 前后端字段契约

建议把 `readingPersona` 拆成“本地规则必填字段”和“AI 补充字段”，避免 AI 失败时整块不可用。

本地规则必填字段：

```json
{
  "readingPersona": {
    "status": "complete",
    "code": "INFJ",
    "label": "历史共情者",
    "displayTitle": "INFJ 型读者 · 历史共情者",
    "paletteGroup": "NF",
    "accentTone": "rose",
    "basisNotice": "基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。",
    "dimensions": [
      {
        "axis": "energy",
        "key": "I",
        "label": "主题深度",
        "strength": "strong",
        "basis": "分类和长读书目更集中"
      }
    ],
    "evidence": ["历史类投入最高", "长读书目集中"],
    "confidence": 0.78
  }
}
```

字段约束建议：

| 字段 | 来源 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | 本地规则 | 是 | `complete / provisional / insufficient` |
| `code` | 本地规则 | `complete/provisional` 时必填 | 四字母人格代码 |
| `label` | 本地映射表 | `complete/provisional` 时必填 | 16 类型中文名 |
| `displayTitle` | 前端拼装或本地规则 | `complete/provisional` 时必填 | 例如 `INFJ 型读者 · 历史共情者` |
| `paletteGroup` | 本地映射表 | 否 | `NT / NF / SJ / SP` |
| `accentTone` | 本地映射表 | 否 | `bluegreen / rose / moss / amber` 这类预置值 |
| `basisNotice` | 常量 | 是 | 明确不是心理测试 |
| `dimensions` | 本地规则 | 是 | 四维解释数组 |
| `evidence` | 本地规则 | 是 | 2-4 条短证据 |
| `confidence` | 本地规则 | 否 | 0-1 之间，用于 UI 弱化 |
| `summary` | AI 补充 | 否 | 1-2 句短总结 |
| `suggestion` | AI 补充 | 否 | 1 条温和建议 |

工程约束：

- 前端渲染只依赖本地规则必填字段；`summary` 和 `suggestion` 缺失时必须正常展示。
- `insufficient` 状态下 `code`、`label`、`paletteGroup`、`accentTone` 可为空。
- 所有字段名统一使用英文 camelCase，不再额外引入第二套海报专用人格结构。

#### 规则样例与验收样本

首版至少准备 4 组固定样例，保证规则结果符合直觉：

| 样例 | 统计特征 | 期望结果 |
| --- | --- | --- |
| 历史深读型 | 历史类占比高、长读书目集中、阅读天数稳定 | `INFJ` 或 `INTJ`，且 `I/N` 明确 |
| 工具实用型 | 财经、管理、计算机类占比高，节奏稳定 | `ISTJ`、`ESTJ`、`INTJ` 中的实用取向类型，且 `S/T/J` 明确 |
| 广泛探索型 | 分类分散、峰值跳跃明显、长读书目不集中 | `ENFP`、`ENTP`、`ESFP` 等偏探索类型，且 `E/P` 明确 |
| 低数据型 | 阅读时长低、天数少、分类单一 | `provisional` 或 `insufficient`，不输出强结论 |

验收建议：

- 同一份结构化统计多次计算，`readingPersona.code` 必须稳定一致。
- 低数据样本不能生成带强烈判断语气的完整人格卡。
- 月度切到总计时，人格允许变化，但必须能用证据解释为什么变化。
- AI 缺失或超时时，完整人格卡仍能用本地字段正常渲染。

#### 从现有阅读习惯画像迁移

当前代码里已经存在一版本地 `ReadingHabitProfile`，不要推倒重来。建议采用兼容迁移：

- 第一阶段保留 `ReadingHabitProfile`，新增 `ReadingPersona`，两者并行存在。
- `ReadingPersona` 作为阅读报告页和后续月报海报的新主结构。
- `ReadingHabitProfile` 作为过渡结构保留，避免影响仍引用旧字段的辅助逻辑或历史测试。
- 总览页现已切到轻量 `ReadingPersona` 缩略卡；后续主要剩月报海报和其他导出面复用。

建议映射关系：

| 旧结构 | 新结构 | 迁移策略 |
| --- | --- | --- |
| `primaryLabel` | `label / displayTitle` | 不直接复用文案，改为 16 类型命名体系 |
| `secondaryLabels` | `dimensions[]` | 从“兼有倾向”改成四维解释 |
| `description` | `summary` 或 `本地 description` | 可保留旧文案做低风险兜底 |
| `evidence` | `evidence` | 可直接复用一部分证据构造逻辑 |
| `basisNotice` | `basisNotice` | 保留“非固定人格、仅本地统计”边界语义 |

兼容原则：

- 首版不要同时替换总览页和阅读报告页的全部画像逻辑。
- 页面标题可以先从 `阅读习惯画像` 改为 `阅读人格 MBTI`，但空态和边界说明继续沿用现有风格。
- 旧 `buildReadingHabitProfile(...)` 不要立刻删除；至少保留到 `ReadingPersona` 完成一轮真实数据验证后。

#### 人格模块施工清单

建议按“领域规则 → 页面状态 → 展示组件 → AI 接口 → 海报复用”的顺序推进。

推荐改动文件：

| 文件 | 施工内容 |
| --- | --- |
| `src/reading-persona.config.json` | 统一维护 `basisNotice`、16 型定义、分类词表和人格阈值，作为前后端单一来源 |
| `src/reading-persona.fixtures.json` | 维护跨语言共享人格样例，作为前端与 Rust 的一致性回归夹具 |
| `src/lib/business-rules.ts` | 新增 `ReadingPersona` 类型、四维判定 helper、降级规则、16 类型映射、配色映射 |
| `src/lib/business-rules.test.ts` | 增加 4 组固定样例和低数据降级测试 |
| `src/lib/types.ts` | 为统计复盘结果补 `readingPersona` 类型定义 |
| `src/lib/reading-api.ts` | 解析 `readingPersona.summary / suggestion`，但不覆盖本地规则字段 |
| `src/lib/reading-api.test.ts` | 增加 `readingPersona` 解析兼容测试 |
| `src/features/reading-review/hooks/useReadingReviewPage.ts` | 计算并暴露 `readingPersona`，保留旧 `habitProfile` 直到迁移完成 |
| `src/features/reading-review/components/ReviewProfileSection.tsx` | 从旧画像卡升级为人格卡，支持 `complete / provisional / insufficient` 三态 |
| `src/pages/DashboardPage.tsx` | 已切换为首页轻量阅读人格缩略卡，复用本地人格 + AI patch 合并口径，不再展示旧近期画像 |
| `src/features/reading-stats/components/MonthlyReportPoster*.tsx` | 复用 `paletteGroup / accentTone / displayTitle`，避免海报再做一套人格逻辑 |
| `src-tauri/src/services/ai.rs` | 升级统计复盘 prompt 到 `reading-stats-review-v2`，仅消费本地规则生成的人格输入；Rust 侧读取共享配置并构造一致的人格输入 |

推荐阶段：

1. 本地规则层完成
   - 先在 `business-rules.ts` 算出稳定 `readingPersona`
   - 不接 AI，不改海报
2. 阅读报告页接入
   - 先替换 `ReviewProfileSection`
   - 走本地规则渲染，验证视觉和降级状态
3. 统计 AI 复盘接入
   - 只补 `summary / suggestion`
   - 验证 AI 失败时页面仍可用
4. 月报海报接入
   - 复用现成人格字段
   - 不额外再算一次人格

#### 测试与回归矩阵

人格模块是“规则 + 解释 + 展示”三层叠加，建议同步准备测试矩阵。

单元测试：

- `src/reading-persona.fixtures.json`
  - 固定 `stable / historical / emerging / insufficient` 共享人格样例
  - 前端与 Rust 都必须消费同一批夹具，不允许各自维护不同期望
- `src/lib/business-rules.test.ts`
  - 对共享夹具逐条断言 `status / code / label / paletteGroup / accentTone / dimensionKeys / confidence`
  - 低数据型正确落到 `provisional` 或 `insufficient`
- `src/lib/reading-api.test.ts`
  - `readingPersona` 缺失时能兼容旧缓存
  - `readingPersona` 只有本地字段、没有 AI 文案时能正常解析
  - `status = insufficient` 时不强依赖 `code / label`
- `src-tauri/src/services/ai.rs`
  - Rust 侧对共享夹具逐条断言 `personaStatus / personaCode / personaDimensions / personaEvidence / personaConfidence`
  - `build_reading_stats_review_input(...)` 生成的人格输入必须与前端共享样例保持一致

组件测试：

- `ReviewProfileSection`
  - `complete`：显示人格标题、四维解释、证据和提示
  - `provisional`：显示“临时阅读倾向”弱化态
  - `insufficient`：显示空态引导，不展示四字母代码

集成测试：

- `useReadingReviewPage`
  - 有统计、无 AI 缓存时仍能返回本地人格
  - 有 AI 缓存时只补充文案，不覆盖本地判定字段
  - 切换周期时人格会随 `mode + baseTime` 正确刷新

手工回归：

- 月度、年度、总计三种模式分别检查人格卡是否符合直觉
- 点击同步统计后，人格卡和图表是否同步更新
- 切到未来时间被禁用后，人格状态是否不会错误保留旧值
- Web 只读预览下，旧缓存没有 `readingPersona` 时页面是否正常降级

#### 人格卡状态与交互矩阵

首版建议把人格卡视为“信息卡片”，而不是新入口。不要再让它承担跳转、筛选或展开复杂交互。

页面内状态矩阵建议：

| 状态 | 主标题 | 辅助标识 | 展示内容 | 视觉强度 |
| --- | --- | --- | --- | --- |
| `complete` | `INFJ 型读者 · 历史共情者` | `阅读人格 MBTI` + `仅本地统计` | 四维解释、2-4 条证据、AI 总结、温和建议 | 正常 |
| `provisional` | `INFJ 型读者（临时）` | `临时阅读倾向` | 四维解释可缩减为 2 维、证据 1-2 条、弱化建议 | 降饱和、降对比 |
| `insufficient` | `本期样本较少` | `继续阅读后生成` | 空态说明、补足建议 | 中性空态 |

交互约束建议：

- 首版不把人格卡做成可点击大卡，避免用户误以为能进入独立人格页。
- `dimensions` 不做复杂折叠；每个维度直接显示短标签和一句依据。
- `evidence` 直接内联展示，不依赖 hover 才能读懂。
- 若补 tooltip，只用于解释 `strength` 或补精确占比，不能把主结论藏进 tooltip。
- `basisNotice` 在卡片底部常驻显示，不折叠到二级入口里。

不同页面建议：

- 阅读报告页：
  - 使用完整人格卡，是主展示场景。
- 统计页：
  - 第一版不强行放同款完整人格卡，避免和阅读报告页重复；如需预告，只放轻量摘要或跳转提示。
- 总览页：
  - 已切到轻量人格缩略卡，只展示标题、摘要、2 个维度和 2 条证据，不复刻阅读报告页完整四维卡。
- 月报海报：
  - 只复用 `displayTitle / paletteGroup / accentTone / summary`，不复刻完整四维解释。

文案建议：

- `complete`
  - `你的阅读人格：INFJ 型读者 · 历史共情者`
- `provisional`
  - `本月阅读倾向：INFJ 型读者（临时）`
- `insufficient`
  - `本期阅读样本较少，继续阅读后再生成阅读人格`

#### 海报与导出展示规则

人格展示不应只停留在页面内，月报海报和统计复盘导出也必须遵循同一口径。

月报海报规则：

- `complete`
  - 展示 `displayTitle`
  - 展示 1 句 `summary`
  - 使用对应 `paletteGroup / accentTone`
- `provisional`
  - 主标题改为 `本月阅读倾向`
  - `displayTitle` 后追加 `（临时）`
  - 降低人格区域视觉占比，不作为海报最大标题
- `insufficient`
  - 不展示人格模块
  - 用月度总结、代表书目或关键词顶替该区域

统计复盘 Markdown 导出规则建议：

- 当 `status = complete` 时，新增 `## 阅读人格` 区块
- 当 `status = provisional` 时，新增 `## 阅读倾向（临时）` 区块
- 当 `status = insufficient` 时，不新增人格区块，只在说明中保留样本不足提示

Markdown 区块建议结构：

```md
## 阅读人格

- 类型：INFJ 型读者 · 历史共情者
- 状态：complete
- 说明：基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。

### 四维解释

- I / 主题深度：分类和长读书目更集中
- N / 概念想象：历史和思想性内容占比较高
- F / 共鸣取向：人物与时代命运相关内容更突出
- J / 稳定推进：阅读分桶相对稳定

### 证据

- 历史类投入最高
- 长读书目集中
```

导出约束：

- Markdown 导出使用最终合并后的人格对象，不直接信任 AI 原始返回。
- 导出里不写 `confidence` 原始小数，避免给人伪精确感；如有需要可转成 `倾向较明确 / 倾向较弱`。
- PNG 海报里不展示 `basisNotice` 全文，但页面和 Markdown 必须保留。
- 旧缓存没有 `readingPersona` 时，导出流程允许回退为“无人格区块”的兼容导出，不阻断导出。

#### 最终合并流程

实现时建议明确区分三层对象：

1. `localPersona`
   - 本地规则生成
   - 包含 `status / code / label / displayTitle / paletteGroup / accentTone / dimensions / evidence / confidence / basisNotice`
2. `aiPersonaPatch`
   - AI 返回的人格补充字段
   - 只允许 `summary / suggestion`
3. `resolvedPersona`
   - 页面、海报、Markdown 导出统一消费的最终对象

推荐流程：

```ts
const localPersona = buildReadingPersona(stats);
const aiPersonaPatch = normalizeReadingPersonaPatch(reviewOutput?.readingPersona);

const resolvedPersona =
  localPersona.status === "insufficient"
    ? {
        ...localPersona,
        summary: aiPersonaPatch?.summary,
        suggestion: undefined
      }
    : {
        ...localPersona,
        summary: aiPersonaPatch?.summary ?? localPersona.summary,
        suggestion: aiPersonaPatch?.suggestion ?? localPersona.suggestion
      };
```

合并规则：

- 本地字段永远优先，不允许 AI 覆盖。
- `summary` 缺失时允许页面只展示本地人格，不视为错误。
- `suggestion` 缺失时不补默认鸡汤文案，宁可不显示。
- `insufficient` 状态下即便 AI 返回了 `summary`，也只能当作“样本不足说明”，不能拼出完整人格标题。
- 任何字段校验失败时，整块回退到 `localPersona`，不要部分混用不合法 AI 字段。

建议新增轻量 helper：

- `buildReadingPersona(stats)`
- `normalizeReadingPersonaPatch(value)`
- `resolveReadingPersona(localPersona, aiPersonaPatch)`

这样可以让：

- 阅读报告页
- 月报海报
- Markdown 导出
- Web 只读预览

都共用同一套合并逻辑，而不是在各处重复写条件分支。

#### 缓存与接口兼容策略

当前统计复盘结果结构里还没有 `readingPersona`，首版接入时必须保证旧缓存、Web 预览导出和历史 Markdown 都不被破坏。

兼容原则：

- `readingPersona` 在 `ReadingStatsAiReview` 中应为可选字段，不改成强制必填。
- 读取旧缓存时，如果没有 `readingPersona`：
  - 页面层使用 `buildReadingPersona(stats)` 现场补齐本地人格
  - AI 复盘正文仍继续显示
  - 不因为缺字段而判定缓存失效
- Web 只读预览的导出 JSON 不要求立刻补历史 `readingPersona`，前端应继续能从 `statsRows` 现算。

类型改造建议：

- `src/lib/types.ts`
  - 为 `ReadingStatsAiReview` 增加可选 `readingPersona?: ReadingPersonaPatch`
- `src-tauri/src/services/ai.rs`
  - 为 `ReadingStatsAiReview` 增加可选 `reading_persona: Option<ReadingPersonaPatch>`
- `src/lib/reading-api.ts`
  - 解析时把 `readingPersona` 当作可选 patch，不直接当最终人格对象
- `src-tauri/src/export/markdown.rs`
  - 导出时优先消费 `resolvedPersona`，不要直接信任缓存内的 AI patch

缓存策略建议：

- 不因为接入 `readingPersona` 而升级 `input_hash` 计算口径。
- 只有当 prompt version 从 `reading-stats-review-v1` 升到 `reading-stats-review-v2` 时，才自然形成新缓存键。
- 页面展示层允许：
  - 旧缓存正文 + 新本地人格
  - 新缓存正文 + 新本地人格 + AI 人格补充文案

这意味着首版上线后会存在一段混合期，但这是可接受的，前提是展示层始终以 `resolvedPersona` 为准。

#### 共享配置与维护约束

为避免前端和 Rust 在人格规则上再次漂移，建议把“定义、词表、阈值、夹具”视为单一来源资产：

- `src/reading-persona.config.json`
  - 统一维护 `basisNotice`
  - 统一维护 16 型 `label / paletteGroup / accentTone`
  - 统一维护 `practical / conceptual / analytical / resonant` 词表
  - 统一维护人格阈值，例如 `stableBucketMultiplier / axisBiasMultiplier / status / energy / lifestyle / strength / evidence`
- `src/reading-persona.fixtures.json`
  - 统一维护代表性人格样例和预期输出
  - 前端 `buildReadingPersona(...)` 与 Rust `build_reading_stats_review_input(...)` 都必须以此为对齐基准

维护规则建议：

- 修改人格标签、词表、配色或阈值时，只改 `src/reading-persona.config.json`，不允许再改回散落常量。
- 新增或调整人格判定逻辑时，必须同步更新 `src/reading-persona.fixtures.json` 中的共享样例。
- 任何影响人格输出的改动，都必须同时跑：
  - 前端人格规则测试
  - Rust 共享夹具测试
  - 统计复盘输入构建测试
- 文档或诊断输出不暴露内部调参细节，但工程实现必须保留“共享配置 + 共享夹具”这一约束。

#### 代码级接口草案

为减少实现时的二义性，建议先把类型草案固定下来。

TypeScript 建议：

```ts
export type ReadingPersonaStatus = "complete" | "provisional" | "insufficient";
export type ReadingPersonaPaletteGroup = "NT" | "NF" | "SJ" | "SP";
export type ReadingPersonaAccentTone = "bluegreen" | "rose" | "moss" | "amber";
export type ReadingPersonaAxis = "energy" | "information" | "decision" | "lifestyle";
export type ReadingPersonaStrength = "strong" | "medium" | "light";

export type ReadingPersonaDimension = {
  axis: ReadingPersonaAxis;
  key: "E" | "I" | "S" | "N" | "T" | "F" | "J" | "P";
  label: string;
  strength: ReadingPersonaStrength;
  basis: string;
};

export type ReadingPersona = {
  status: ReadingPersonaStatus;
  code?: string;
  label?: string;
  displayTitle?: string;
  paletteGroup?: ReadingPersonaPaletteGroup;
  accentTone?: ReadingPersonaAccentTone;
  basisNotice: string;
  dimensions: ReadingPersonaDimension[];
  evidence: string[];
  confidence?: number;
  summary?: string;
  suggestion?: string;
};

export type ReadingPersonaPatch = {
  summary?: string;
  suggestion?: string;
};
```

Rust 建议：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPersonaPatch {
    pub summary: Option<String>,
    pub suggestion: Option<String>,
}
```

约束建议：

- `ReadingPersona` 是展示层最终对象，只在前端或共享 helper 中存在。
- `ReadingPersonaPatch` 是 AI 输出 patch，只进入缓存和 API 边界。
- Rust 不需要持久化完整 `ReadingPersona`，避免本地规则和缓存结构重复。

实现落点建议：

- `src/lib/types.ts`
  - 增加 `ReadingPersona` 与 `ReadingPersonaPatch`
- `src/lib/business-rules.ts`
  - 返回 `ReadingPersona`
- `src/lib/reading-api.ts`
  - 只解析 `ReadingPersonaPatch`
- `src/features/reading-review/hooks/useReadingReviewPage.ts`
  - 合并成 `resolvedPersona`

#### 灰度上线与回滚策略

建议不要把“本地人格规则、阅读报告卡片、AI prompt v2、海报接入”一次性同时上线。更稳的方式是分 3 步。

阶段 A：本地人格只读接入

- 只在阅读报告页接入 `localPersona`
- 不改 Rust prompt version
- 不改导出
- 验证真实数据下的人格判定是否符合直觉

阶段 B：AI 人格补充接入

- 升级到 `reading-stats-review-v2`
- 只新增 `readingPersona.summary / suggestion`
- 验证 AI 补文案不会覆盖本地规则

阶段 C：海报与导出接入

- Markdown 导出增加人格区块
- 月报海报消费 `resolvedPersona`
- 验证 `provisional / insufficient` 的导出降级

回滚策略建议：

- 若本地规则有明显误判：
  - 保留旧 `ReadingHabitProfile` 卡片作为紧急 fallback
  - 先关闭 `ReadingPersona` 展示，不影响统计复盘正文
- 若 AI 人格文案质量不稳定：
  - 只停用 `readingPersona.summary / suggestion`
  - 继续保留本地人格卡
- 若海报或 Markdown 导出兼容性有问题：
  - 先撤掉人格区块
  - 主体复盘和数据导出仍继续可用

验收口径建议：

- 任一子阶段回滚时，不应影响：
  - 统计同步
  - 旧复盘缓存读取
  - 阅读报告正文
  - 原有 Markdown 导出主体结构

#### 诊断与观测建议

人格模块首版上线后，最有价值的不是新增更多 UI，而是尽快知道真实数据下是否稳定。

建议纳入诊断导出或内部调试信息的字段：

- 当前统计复盘 `promptVersion`
- 当前统计复盘 `responseFormat`
- 当前人格 `status`
- 当前人格 `code`
- 当前人格 `paletteGroup`
- 当前人格 `confidence` 分档
- 是否存在 `readingPersonaPatch.summary`
- 是否存在 `readingPersonaPatch.suggestion`
- 人格来源说明：
  - `local-only`
  - `local+ai-patch`
  - `local-fallback-from-legacy-cache`

展示建议：

- 普通页面不展示这些技术字段。
- 设置页 `导出诊断信息` 可以在 `AI / 统计复盘` 小节中追加一小段人格状态摘要。
- Markdown 诊断中只写分档结果，不写原始阈值和内部调参细节，避免把调参实现暴露成产品承诺。

异常排查建议：

- 若用户反馈“这个人格不对”，优先检查：
  - 当前周期是否为 `provisional`
  - 本地规则输出的 `dimensions` 是否符合统计特征
  - AI patch 是否只补了 `summary / suggestion`
  - 是否误读了旧缓存而没有走本地重算

#### 统一文案口径

人格模块一旦进入阅读报告页、海报和导出，就很容易出现同一含义多套说法。首版建议把核心文案口径固定下来。

推荐用语：

- 模块名：
  - `阅读人格 MBTI`
- 主标题：
  - `INFJ 型读者 · 历史共情者`
- 状态标题：
  - `你的阅读人格`
  - `本月阅读倾向`
  - `本期样本较少`
- 边界说明：
  - `基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。`
- 低数据提示：
  - `本期阅读样本较少，继续阅读后再生成阅读人格。`

禁止用语：

- `你就是 INFJ`
- `你的真实 MBTI`
- `性格测试结果`
- `人格类型认证`
- `高阶读者 / 低阶读者`
- `更高级 / 更理性 / 更自律`
- `本月/今年/当前周期`
  - 这里指历史周期页面和导出中，统一改用绝对时间，例如 `2024 年`、`2026 年 5 月`

页面口径建议：

- 阅读报告页：
  - 用 `阅读人格 MBTI`
- 统计页轻量预告：
  - 用 `阅读人格摘要` 或 `去阅读报告查看人格`
- 总览页旧画像保留阶段：
  - 不混用 `阅读习惯画像` 和 `阅读人格 MBTI` 在同一区域并列出现
- Markdown 导出：
  - 区块标题用 `阅读人格` 或 `阅读倾向（临时）`

维度文案建议：

- `E`：探索广度
- `I`：主题深度
- `S`：实用经验
- `N`：概念想象
- `T`：分析取向
- `F`：共鸣取向
- `J`：稳定推进
- `P`：即兴探索

文案风格建议：

- 解释要像“阅读观察”，不要像“人格判词”。
- 多用 `更接近`、`更像`、`这一周期`、`倾向于`。
- 少用 `就是`、`天生`、`注定`、`典型地属于`。

#### 完成定义

为了避免“功能已经能跑，但还不能交付”的模糊状态，建议把人格模块的完成定义写成一张清单。

领域规则完成：

- `buildReadingPersona(stats)` 能稳定返回 `complete / provisional / insufficient`
- 4 组固定样例测试通过
- 同一份输入多次计算结果一致

页面展示完成：

- 阅读报告页能展示三态人格卡
- `complete` 状态展示四维解释、证据和边界说明
- `provisional` 状态正确弱化
- `insufficient` 状态不展示四字母标题

AI 接口完成：

- `reading-stats-review-v2` 可选返回 `readingPersona.summary / suggestion`
- AI patch 不会覆盖本地人格字段
- schema fallback 为 `json_object` 时仍能解析人格 patch

兼容完成：

- `reading-stats-review-v1` 旧缓存可正常读取
- Web 只读预览无 `readingPersona` 时可现场补本地人格
- 历史 Markdown 导出不因人格缺失而失败

导出完成：

- Markdown 导出能按状态输出 `阅读人格 / 阅读倾向（临时） / 无人格区块`
- 月报海报能按状态显示或省略人格区块
- 导出和页面消费同一个 `resolvedPersona`

测试完成：

- 单元测试覆盖规则、patch 解析、合并 helper
- 组件测试覆盖三态人格卡
- 至少一轮真实缓存手工回归通过

发布完成：

- 阶段 A 本地人格只读接入验证通过
- 阶段 B AI patch 接入验证通过
- 阶段 C 海报与导出接入验证通过
- 任一阶段回滚方案已验证不影响原有统计复盘主流程

### 第三层：解释层

保留两块主内容：

- 时间轴。
- 偏好地图。

时间轴：

- 保留当前横向阶段条，不改成折线。
- 它表达的是“阶段变化”，不是“精确连续趋势”。
- 应加强 AI 解释和阶段条的对应关系，而不是换图种。

偏好地图：

- `PreferenceMap` 保留在阅读报告页。
- 但布局应更规整，避免过于随机的视觉噪音。
- 它更适合承担“阅读画像感”，不建议在统计页复用同样风格。

### 第四层：行动层

继续保留：

- 重点书目。
- AI 重点解释。
- 下一步行动。

这一层的重点是把数据和复盘收束成动作，不额外引入新图。

## 为什么现在需要做页面结构重构

当前统计页和阅读报告页的问题已经不只是“图表种类是否合适”，而是页面文件本身承担了过多职责：

- 页面入口同时负责数据加载、同步、切换周期、空态和错误态。
- 页面文件内部继续定义多个子组件，导致“页面组装”和“组件实现”混在一起。
- 页面文件底部还保留了大量纯函数和领域 helper，展示层与领域逻辑没有分开。
- 后续如果继续加入排行条、折线、热力图和更细的解释文案，页面体量会继续膨胀。

因此这里建议做的是“中度结构重构”，而不是推倒重来：

- 需要重构统计页和阅读报告页的分层方式。
- 不需要在这一轮改路由结构。
- 不需要为了重构先引入全局状态管理。
- 不需要先改后端统计模型。

一句话总结：先把页面职责拆清，再做图表升级，后续迭代会明显更稳。

## 页面结构重构目标

目标不是让目录更漂亮，而是让后续新增图表和解释能力时不再继续向 page 文件底部堆函数。

建议统一成四层结构：

### 1. 页面入口层

职责：

- 只负责页面装配和区块顺序。
- 不再承载大段展示组件实现细节。

### 2. 页面状态层

职责：

- 负责加载缓存、同步、切换周期、导出、错误态和状态派生。
- 对页面暴露纯净状态和动作，不让 JSX 直接混入过多异步细节。

### 3. 领域 helper 层

职责：

- 负责偏好聚合、阶段切分、本地解读、趋势摘要和格式化。
- 和 UI 组件解耦，可单测覆盖。

### 4. 展示组件层

职责：

- 只负责渲染。
- props 尽量纯净，不直接依赖页面内部状态机。

## 推荐页面分层

### 统计页建议分层

建议把统计页拆成这些区块组件：

- `StatsHeroSection`
- `StatsPeriodNavigator`
- `StatsSummarySection`
- `StatsTrendSection`
- `StatsPreferenceSection`
- `StatsRankSection`
- `StatsFootnote`

建议目录：

```text
src/features/reading-stats/
  components/
    StatsHeroSection.tsx
    StatsPeriodNavigator.tsx
    StatsSummarySection.tsx
    StatsTrendSection.tsx
    StatsPreferenceSection.tsx
    StatsRankSection.tsx
    StatsFootnote.tsx
  hooks/
    useReadingStatsPage.ts
  lib/
    stats-insights.ts
    stats-preferences.ts
    stats-formatters.ts
```

页面入口 `StatisticsPage.tsx` 最终应主要负责：

- 调用 `useReadingStatsPage`
- 拼装区块顺序
- 传递 props

不再继续在同文件里定义作者偏好、分类偏好和本地解读实现细节。

### 阅读报告页建议分层

建议把阅读报告页拆成这些区块组件：

- `ReviewHeroSection`
- `ReviewPeriodNavigator`
- `ReviewMetricSection`
- `ReviewTimelineSection`
- `ReviewProfileSection`
- `ReviewPreferenceSection`
- `ReviewFocusBooksSection`
- `ReviewActionsSection`
- `ReviewMetaSection`

建议目录：

```text
src/features/reading-review/
  components/
    ReviewHeroSection.tsx
    ReviewPeriodNavigator.tsx
    ReviewMetricSection.tsx
    ReviewTimelineSection.tsx
    ReviewProfileSection.tsx
    ReviewPreferenceSection.tsx
    ReviewFocusBooksSection.tsx
    ReviewActionsSection.tsx
    ReviewMetaSection.tsx
  hooks/
    useReadingReviewPage.ts
  lib/
    review-timeline.ts
    review-profile.ts
    review-formatters.ts
```

页面入口 `ReadingReviewPage.tsx` 最终应主要负责：

- 调用 `useReadingReviewPage`
- 按顺序组织 Hero、结论、解释、行动、元信息
- 保持页面语义清晰，不再混入大量子组件实现

## 组件改造清单

### 保留并改造

- `src/components/ReadingTrend.tsx`
  - 从“纯柱状图组件”改造成“按周期切换柱状 / 折线”的趋势组件入口。
- `src/components/ReadingRank.tsx`
  - 继续作为长读书目排行组件，不强行图表化。
- `src/components/ReadingStatsPeriodNavigator.tsx`
  - 增加 `跳转` 按钮，收口快捷区职责与文案。
- `src/pages/ReadingReviewPage.tsx` 中的 `ReviewTimeline`
  - 保留横向阶段条表达。
- `src/pages/ReadingReviewPage.tsx` 中的 `PreferenceMap`
  - 保留，但重整布局和尺寸规则。

### 拆分新增

- `StatsPeriodNavigator.tsx` / `ReviewPeriodNavigator.tsx`
  - 承接时间锚点区和前后切换逻辑的展示层。
- `BarTrend.tsx`
  - 承接现有 `ReadingTrend` 的柱状图主体。
- `LineTrend.tsx`
  - 用于 `annually` / `overall` 趋势模式。
- `PreferenceRankList.tsx`
  - 作者偏好和分类偏好的统一排行组件。
- `MetricSparkline.tsx`
  - 摘要卡用的小趋势线。
- `ReadingHeatmap.tsx`
  - 仅用于月度模式。
- `ChartTooltip.tsx`
  - 负责图表 tooltip 的统一渲染。
- `useChartTooltip.ts`
  - 负责当前激活图元、定位和 `hover / focus / tap` 状态。
- `ReadingStatsPeriodJumpPicker.tsx`
  - 负责年份 / 月份 / 周的快速跳转。
- `reading-stats-period-options.ts`
  - 负责合法时间选项生成与未来时间禁用。
- `useReadingStatsPage.ts`
  - 承接统计页的数据加载、周期切换、同步和状态派生。
- `useReadingReviewPage.ts`
  - 承接阅读报告页的缓存读取、生成、导出、同步和状态派生。

## 时间导航文件级施工清单

### 需要改动的现有文件

- `src/components/ReadingStatsPeriodNavigator.tsx`
  - 增加 `跳转` 按钮。
  - 调整快捷区显示规则和文案。
- `src/pages/StatisticsPage.tsx`
  - 接入 `isJumpPickerOpen`。
  - 接入 `ReadingStatsPeriodJumpPicker`。
  - 选中目标 period 后更新 `setPeriod(...)`。
- `src/pages/ReadingReviewPage.tsx`
  - 与统计页保持同样接入方式。
- `src/pages/reading-stats-period.ts`
  - 保持现有“禁止未来”规则；只在必要时补少量共享 helper。

### 建议新增的文件

- `src/components/ReadingStatsPeriodJumpPicker.tsx`
  - 根据 `mode` 渲染年份 / 月份 / 周选择器。
- `src/pages/reading-stats-period-options.ts`
  - 负责生成合法年份 / 月份 / 周列表。
- `src/pages/reading-stats-period-options.test.ts`
  - 覆盖年份、月份、周的选项生成和未来禁用规则。

### 建议的状态边界

- 页面层状态：
  - `period`
  - `activePeriod`
  - `isJumpPickerOpen`
- 跳转器内部状态：
  - `selectedYear`
  - `selectedMonth`
  - `selectedWeekBaseTime`

### 推荐 props 方向

- `ReadingStatsPeriodNavigator`
  - 增加 `onOpenJumpPicker`
- `ReadingStatsPeriodJumpPicker`
  - 建议接收 `open`
  - 建议接收 `activePeriod`
  - 建议接收 `cache`
  - 建议接收 `onClose`
  - 建议接收 `onSelectPeriod`

## 推荐实施顺序

### 阶段零：先拆纯函数、页面状态和时间导航骨架

目标：先降页面复杂度，再继续加图表。

范围：

- 抽离偏好聚合、本地解读、阶段切分和格式化 helper。
- 引入 `useReadingStatsPage` 和 `useReadingReviewPage`。
- 把周期导航、摘要区和脚注区先抽成展示组件。
- 调整顶部 tab 副标题和快捷区文案。
- 给时间锚点区接入 `跳转` 按钮与弹层骨架。

原因：

- 这是后续所有图表升级的基础。
- 不改业务行为时风险最低。
- 有助于把回归范围控制在结构层，而不是功能层。

### 阶段一：统一结构偏好

目标：最小代价提升“可比较性”。

范围：

- 提取 `PreferenceRankList`。
- 把作者云替换成排行条。
- 把分类列表与作者偏好统一成同一视觉和交互。

原因：

- 不改后端。
- 不影响时间趋势逻辑。
- 收益立刻可见。

### 阶段二：趋势组件模式化

目标：让不同周期的主图真正服务不同问题。

范围：

- 把 `ReadingTrend` 拆成 `BarTrend + LineTrend`。
- `weekly / monthly` 保留柱状。
- `annually / overall` 切为折线。

### 阶段三：增强解释能力

目标：用户不只看到图，还知道图在说什么。

范围：

- 摘要卡加 `MetricSparkline`。
- 趋势图增加高峰点标记和环比摘要。
- 复盘页时间轴与 AI 节奏解释做更明确对应。

### 阶段三点五：补齐图表 tooltip 交互

目标：让趋势图、热力图和偏好地图既能快速扫读，也能拿到精确值。

当前进展（2026-05-24）：

- 已完成 `BarTrend` 和 `LineTrend` 的第一批 tooltip 接入。
- 已完成 `ReadingHeatmap` 和阅读报告 `PreferenceMap` 的第二批 tooltip 接入。
- 已落地统一的 `ChartTooltip + useChartTooltip` 轻量实现。
- 已支持 `hover / focus / tap` 共用同一套状态逻辑，点击外部或滚动时关闭。
- 已补趋势图当前图元高亮、`aria-describedby` 与 `aria-pressed`。
- 已补热力图格子和偏好气泡的高亮态与无障碍属性。
- 已通过组件测试、构建和临时预览页交互验证。

范围：

- `BarTrend` 和 `LineTrend` 增加统一 tooltip（已完成）。
- `ReadingHeatmap` 增加可聚焦和可点击的 tooltip（已完成）。
- `PreferenceMap` 增加分类精确值 tooltip（已完成）。
- 统一 `hover / focus / tap` 行为和无障碍要求（本轮已覆盖趋势图 / 热力图 / 偏好图）。

### 阶段四：月度热力图

目标：让月度查看真正支持“任意月份到底哪几天在读”的问题。

范围：

- 新增 `ReadingHeatmap`。
- 仅在 `monthly` 模式显示。
- 不扩展到年度和总计。

### 阶段五：补齐月度和周度快速跳转

目标：让所有粒度都具备“相邻浏览 + 快速定位”双通道。

范围：

- `overall` 和 `annually` 的年份 / 月份跳转完善交互细节。
- `monthly` 增加年月快速定位。
- `weekly` 增加按月列出周的快速跳转。
- 保持未来时间禁用规则不变。

### 阶段六：月度报告海报

目标：把统计页从“查看数据”延伸到“分享成果”，让用户可以把某个月的阅读表现生成一张适合社交媒体传播的图片。

当前进展（2026-05-24）：

- `weekly / monthly / annually` 模式 Hero 已接入 `生成阅读报告` 操作入口，`overall` 暂不展示。
- 已新增 `MonthlyReportPoster` 与 `MonthlyReportPosterDialog`，使用固定比例海报预览，不走页面截图导出。
- 已新增 `monthly-report-poster.ts`，本地根据统计数据派生标题、摘要、关键词、指标、重点书目和分类偏好，并复用 `src/lib/persona-visuals.ts` 的人格视觉映射。
- 已落地本地 Canvas PNG 导出，不新增第三方截图依赖。
- 可见文案已从“月报 / 本月”泛化为“阅读报告 / 本期”，避免周报、年报复用模板时出现周期错位。
- 本轮泛化已通过单测和构建；真实下载事件需在桌面端或常规浏览器补手工回归，因为当前 IAB 不支持 download 事件。

当前判断：

- 现有统计页 Hero 适合做应用内报告封面，但不适合直接作为社交媒体海报。
- 海报应是独立模板组件，而不是把统计页截图导出。
- 第一版只把首个高完成度模板泛化到周 / 月 / 年，不扩展到总计海报或自由编辑器。
- 现有月报海报可以视为 `PeriodReport` 的第一张模板，但不是唯一形态；后续周报和年报应复用同一份报告契约，而不是重新开一套入口。

#### 入口位置

推荐入口放在具体周期统计上下文内：

- `weekly / monthly / annually` 模式下，在 Hero 操作区增加 `生成阅读报告`。
- `overall` 暂不显示主入口，避免用户误以为长期总计报告已经完成内容设计。
- 年报和周报先复用统一报告壳，后续再按粒度增加差异化模板页。

#### 产品形态

第一版建议采用：

- 点击 `生成阅读报告` 后打开预览弹窗或抽屉。
- 预览区域展示固定比例海报，优先支持 `3:4` 或 `9:16`。
- 用户确认后导出 PNG。
- 不做拖拽编辑、不做自由改字、不做复杂模板市场。

原因：

- 统计数据必须准确，不能让用户在自由编辑中破坏关键数值。
- 第一版核心是验证“用户愿不愿意分享”，不是做设计工具。
- 固定模板更容易保证中文排版、长书名和移动端尺寸稳定。

#### 视觉标准

海报不能直接复用当前统计页横幅。它需要更适合社交传播的视觉重心：

- 顶部显示明确月份，例如 `2026 年 5 月阅读报告`。
- 中部放 1 句强总结，成为用户分享时的主表达。
- 核心数字使用大字号，优先展示 `总时长 / 阅读天数 / 代表方向`。
- 下方展示代表书目、分类偏好和作者偏好，控制在 3-5 项。
- 底部保留 `由 wxreadmaster 生成`，后续可扩展二维码或应用签名。

建议第一版只保留 1 个高质量模板：

- 背景可复用 `report-card-bg` 的阅读氛围，但需要重新裁切和遮罩。
- 文字、数字和书目由前端渲染，不写进背景图片。
- 颜色应延续应用的墨绿、纸白和金色点缀，但需要提高海报对比度。

#### 内容结构

海报建议包含：

- 月份标题。
- 一句 AI 月度标题或总结。
- 阅读人格标签。
- 阅读人格角色静态插画。
- 3 个核心指标。
- 本月代表书目 3 本。
- 分类偏好 Top 3。
- 作者偏好 Top 3。
- 本月关键词 3-5 个。
- 产品署名。

字段边界：

- 真实数字、书名、作者、分类和时长必须来自本地结构化统计。
- AI 只生成表达性文案，不负责生成事实数据。
- 文案缺失时前端必须能回退到本地规则生成，不阻塞海报导出。

#### AI 分工

不建议使用图片生成模型生成整张海报。

推荐分工：

- 文本模型生成结构化月报文案。
- 前端模板负责排版、图形、导出和最终图片。
- 图片生成能力只作为后续增强，用于生成非关键背景纹理或氛围图。

建议新增 AI 输出字段：

```json
{
  "headline": "这个月，你把最多时间交给了历史与现实观察。",
  "summary": "阅读重心集中在历史脉络、人物命运和现实秩序。",
  "keywords": ["历史", "人物", "社会观察"],
  "readingPersona": {
    "code": "INFJ",
    "label": "历史共情者",
    "paletteGroup": "NF",
    "accentTone": "rose",
    "description": "围绕历史脉络持续推进，并把较多时间投入到少数重点书目。"
  },
  "shareCaption": "这个月读得最深的是历史，也更想把阅读变成长期复盘。"
}
```

约束：

- AI 输出必须是顶层 JSON 对象。
- 只允许生成短文案和阅读人格表达，不允许生成书名、作者、时长、百分比等事实字段。
- 阅读人格必须基于输入统计信号，不能扩展到心理性格、能力评价或价值判断。
- 人格配色只允许使用预置 `paletteGroup` 和 `accentTone`，不能让 AI 自由生成色值。
- 所有字段都需要前端兜底，避免 AI 失败导致整个分享链路不可用。

#### 技术落点

当前已落地：

- `src/features/reading-stats/components/MonthlyReportPoster.tsx`
- `src/features/reading-stats/components/MonthlyReportPosterDialog.tsx`
- `src/features/reading-stats/monthly-report-poster.ts`
- `src/components/PersonaIllustration.tsx`
- `src/lib/persona-visuals.ts`
- `src/assets/personas/base/`
- `src/assets/personas/props/`

建议职责：

- `MonthlyReportPoster`
  - 只负责固定尺寸海报渲染。
- `MonthlyReportPosterDialog`
  - 负责预览、关闭、导出按钮和状态提示。
- `monthly-report-poster.ts`
  - 负责从 `ReadingStats` 派生海报数据和本地兜底文案，并在 Canvas 导出时加载固定人格插画。
- `PersonaIllustration`
  - 负责页面内统一渲染本地人格人物和道具插画。
- `persona-visuals.ts`
  - 负责把 `personaCode / paletteGroup` 映射到本地角色资产、道具资产、道具语义和兜底视觉。

导出方式：

- 第一版已采用 Canvas 模板导出 PNG，避免新增 DOM 截图依赖。
- Canvas 导出必须加载同一套人物和道具插画资产，保持预览与导出视觉一致。
- 桌面端 PNG 写入设置页配置的应用导出目录，文件名由后端清洗并自动避让重名；Web 预览继续使用浏览器下载。
- 不为了首版引入重型设计器或图表库。

#### 验收标准

- 只有周 / 月 / 年具体周期出现 `生成阅读报告` 入口。
- 海报预览不依赖页面截图，比例固定且适合社交媒体分享。
- 海报中的数字、书名、作者和分类全部来自本地统计数据。
- AI 文案失败时仍可生成基础海报。
- 阅读人格标签来自本地规则或 AI 改写，但证据必须来自真实统计。
- 阅读人格角色来自本地固定资产，缺失时有色块和徽章兜底。
- 长书名不会撑破版面，最多显示 3 本代表书。
- 导出的 PNG 与预览视觉一致。
- 不上传用户书单、统计详情或图片到第三方图片生成服务。

### 阶段七：PeriodReport 统一化（周 / 月 / 年报告）

目标：把“月报海报”升级为统一的 `PeriodReport`，支持 `weekly / monthly / annually` 三种周期，并保持一个入口、一份数据契约、多个展示模板。

当前判断：

- `PeriodReport` 不是再造一个新页面，而是把“报告生成、报告预览、报告导出”收口到同一套模型。
- 报告生成不要求用户先在统计页手动切到对应年份或月份，默认使用当前周期，但允许在弹窗里直接改选。
- AI 分析应并入报告正文和海报文案，不单独开一个重复的“AI 统计”入口。
- 事实数据始终由本地统计提供，AI 只负责短文本、标题、摘要和行动建议。

当前落地进度：

- `buildPeriodReportData` 已返回 `reportType / periodAnchor / rangeLabel / dataCompleteness / labels`，现有海报数据不再只是月报私有结构。
- 统计页生成阅读报告时会读取同周期已缓存的 `reading-stats-review-v2`，只把 AI 人格摘要和行动建议作为文案增强；读取失败或没有缓存时继续使用本地模板。
- `dataCompleteness` 已区分 `cached / empty / future_blocked`，其中未来周期优先拦截，避免被误判为空数据。
- 统计响应已新增 `source: cache | synced | empty`，前端据此把“本地没有该周期缓存”标为 `unsynced`，把“同步后仍无阅读数据”标为 `empty`。
- 阅读报告弹窗已内置两步流程：第一步选择 `周报 / 月报 / 年报` 和目标时间，第二步点击 `生成报告预览` 后才读取数据并展示预览。
- 选择阶段只维护草稿周期，不实时刷新海报预览，避免用户一边选时间一边看到下方内容跳动。
- 报告弹窗复用统计页的年 / 月 / 周选项生成逻辑，未来月份和未来周不可选。
- 弹窗内选择到未缓存周期时支持直接同步目标周期，成功后刷新同一弹窗预览，不需要退出弹窗再回到统计页操作。
- 报告预览保持 `竖版海报 / 轮播报告 / 16:9 报告` 三种导出形态，目标周期和预览形态相互独立。

#### 统一模型

建议把报告对象收敛成：

```ts
type PeriodReport = {
  reportType: "weekly" | "monthly" | "annually";
  periodAnchor: string;
  rangeLabel: string;
  dataCompleteness: "cached" | "empty" | "unsynced" | "future_blocked";
  labels: {
    headline?: string;
    summary?: string;
    keywords?: string[];
    shareCaption?: string;
    suggestions?: string[];
  };
};
```

字段说明：

- `reportType`：报告粒度。
- `periodAnchor`：周 / 月 / 年的时间锚点。
- `rangeLabel`：给用户看的绝对时间标题，例如 `2026 年第 21 周`、`2026 年 5 月`、`2026 年`。
- `dataCompleteness`：区分 `已缓存 / 无数据 / 未同步 / 禁止未来`，不要把这些状态混成一个空态。
- `labels`：只放表达性文案，不放书名、作者、时长、占比这类事实字段。

#### 入口与选择器

- 入口仍放在统计页和阅读报告页的 Hero / 工具区。
- 点击 `生成阅读报告` 后在当前页面打开弹窗或抽屉，不新开页面。
- 弹窗第一步只选 `周报 / 月报 / 年报` 和对应时间，不展示海报预览。
- 点击 `生成报告预览` 后进入第二步，再加载目标周期统计并展示导出预览。
- `weekly`：先选年份，再选月份，再选周。
- `monthly`：先选年份，再选月份。
- `annually`：只选年份。
- 默认定位当前统计周期，但不要求用户先手动跳到那一年或那一月。
- 所有未来周期禁用。
- 如果目标周期没有本地缓存，弹窗内直接提供 `同步目标周期`，同步成功后原地生成预览。
- 如果目标周期同步后仍没有阅读数据，继续展示空态，不把它伪装成可分享报告。

#### 布局建议

- 弹窗上半区负责类型切换和时间选择，下半区负责实时预览。
- 预览区优先展示标题、主结论、关键指标和 3-5 个代表书目，不把页面拆成很多“章节按钮”。
- 长文本采用限制行数 + 卡片内滚动，不把整页撑高。
- 预览和导出必须共享同一套 layout token，避免 DOM 预览和 Canvas 导出分叉。

#### AI 提示词

- 输入建议显式带上 `periodKind / periodTitle / rangeLabel / dataCompleteness / compareState`。
- 同时带入 `topBooks / topAuthors / topCategories / longestItems / readDays / totalReadTimeSeconds`。
- AI 只输出 `headline / summary / keywords / shareCaption / suggestions`。
- 事实字段不允许 AI 自己重算或改写。
- 如果 AI 返回无效 JSON、缺少 `message.content`，或者输出字段不完整，前端必须回退到本地模板。
- 如果后续周 / 月 / 年模板差异继续扩大，再考虑把这一条独立成 `period-report-v1`，不要硬塞进现有月报文案逻辑。

#### 与现有月报海报的关系

- `monthly` 海报保留为首个高完成度模板。
- `weekly` 和 `annually` 先复用同一报告壳，再按粒度调整信息密度。
- 年报不应只是“更长的月报”，它应该突出年度总览 + 月度分布 + 代表书目。
- 周报不追求图表更多，而是追求节奏更清楚、行动更明确。

#### 验收标准

- 用户不需要先手动切到目标年份或月份，也能直接生成对应报告。
- 年报里的 `本年各月` 是下钻明细，不和月报标题撞词。
- 报告预览和导出共享同一排版参数。
- `dataCompleteness` 每一种状态都有明确反馈，不会把“无数据”和“未来时间”混成一类。
- AI 失败时仍能导出基础版报告。
- 报告页、统计页和海报页都使用同一份 `PeriodReport` 数据契约。

### 阶段八：总计复盘（长期阅读资产报告）

目标：为 `overall` 总计统计增加独立的长期复盘能力，回答“长期以来我是怎样的读者”，而不是把总计简单塞进周 / 月 / 年报告模板。

#### 产品定位

总计复盘不叫“总计海报”，建议命名为：

- `长期阅读复盘`
- `阅读资产报告`
- `长期阅读画像`

它和周 / 月 / 年报告的区别：

- 周报回答“这一周节奏如何，下一步怎么调整”。
- 月报回答“这个月投入和偏好有什么结构”。
- 年报回答“这一年的阶段分布和代表书目是什么”。
- 总计复盘回答“长期积累中形成了什么稳定偏好、代表书目和阅读人格”。

因此总计复盘应强调长期结构、稳定性和变化轨迹，不应强调“本期”“下期”。

#### 入口设计

- 只在统计页 `总计` 模式下显示入口，按钮文案建议为 `生成长期复盘` 或 `生成阅读资产报告`。
- 不进入周 / 月 / 年时间选择器，因为 `overall` 没有具体时间锚点。
- 仍复用报告弹窗的两步心智：
  - 第一步：确认报告范围为 `全部历史`，说明会读取长期统计缓存。
  - 第二步：生成长期复盘预览和导出。
- 如果总计缓存不存在，弹窗内提供 `同步总计统计`。
- 如果总计同步后仍没有阅读数据，展示空态，不生成伪报告。

#### 数据契约

不要把 `PeriodReport.reportType` 直接扩成 `overall` 后继续复用所有月报字段。建议新增上层联合类型：

```ts
type ReadingReport =
  | PeriodReport
  | LifetimeReadingReport;

type LifetimeReadingReport = {
  reportType: "overall";
  periodAnchor: "全部历史";
  rangeLabel: "长期阅读资产";
  dataCompleteness: "cached" | "empty" | "unsynced";
  labels: {
    headline?: string;
    summary?: string;
    keywords?: string[];
    shareCaption?: string;
    suggestions?: string[];
  };
  lifetime: {
    peakYear?: string;
    stableThemes: string[];
    representativeBooks: string[];
    authorSignals: string[];
    categorySignals: string[];
  };
};
```

设计原则：

- `labels` 仍只放表达性文案。
- `lifetime` 放长期复盘所需的事实摘要，但仍由本地统计派生。
- AI 只能改写 `labels` 和行动建议，不能发明峰值年份、书名、作者或分类。

#### 内容模块

首版建议做 5 个模块：

- `长期画像`：长期阅读人格、主标题、简短解释。
- `资产总览`：累计时长、阅读天数、长期代表分类、长读书目数量。
- `稳定偏好`：长期 Top 分类、Top 作者信号、长期关键词。
- `代表书目`：长期投入最高的 3-5 本书。
- `下一阶段策略`：基于长期结构给 2-3 条行动建议。

后续可扩展但首版不必做：

- 年份峰谷对比。
- 长期偏好漂移曲线。
- 作者网络图。
- 版权方偏好。

#### 展示模板

总计复盘不建议默认使用竖版单张海报作为主模板，原因是长期信息密度更高。

首版模板建议：

- `16:9 阅读资产报告`：主推，适合展示长期结构和多项指标。
- `轮播长期复盘`：可选，适合社交媒体多页分享。
- `竖版封面海报`：只作为封面，不承载完整长期分析。

导出按钮建议：

- 有数据时：`下载资产报告 PNG`、`下载轮播页`。
- 无缓存时：`同步总计统计`。
- AI 文案失败时：仍生成基础版长期复盘。

#### AI 提示词

总计复盘应使用独立 prompt，不复用周 / 月 / 年的“本期复盘”文案。

输入建议包含：

- `reportKind: "overall"`
- `rangeLabel: "全部历史"`
- `totalReadTimeSeconds`
- `readDays`
- `longestItems`
- `topCategories`
- `topAuthors`（如果本地可从书目聚合）
- `peakYear`（如果已有总计 buckets）
- `readingPersona`

输出只允许：

- `headline`
- `summary`
- `keywords`
- `shareCaption`
- `suggestions`
- `readingPersona` 文案补丁

禁止：

- AI 自己推断书名、作者、年份、时长、百分比。
- 把长期画像写成心理测试、能力评估或社交排名。
- 用“你一直以来都是……”这类过度确定表达，建议用“从已有统计看”“长期信号更接近”。

#### 实施顺序

1. 在统计页总计模式增加入口文案，不复用周 / 月 / 年按钮文案。
2. 抽象报告弹窗入口，使其支持 `period` 和 `lifetime` 两类报告目标。
3. 新增 `buildLifetimeReadingReportData(stats, options)`，先只依赖现有 `overall` stats 字段。
4. 新增总计复盘预览模板，优先做 16:9，轮播和竖版封面后置。
5. 接入总计缓存读取和 `syncReadingStats("overall", 0)`。
6. 接入 AI 文案增强，失败时回退本地模板。
7. 补总计复盘单测，覆盖空数据、未同步、AI 失败、本地模板生成。

当前施工状态：

- 已新增 `LifetimeReadingReportData` 与 `buildLifetimeReadingReportData`，事实字段来自本地 `overall` stats。
- 已新增长期复盘 16:9 预览与 PNG 导出，首版不引入竖版/轮播，避免过早扩模板。
- 统计页 `overall` 模式入口已改为 `生成长期复盘`，弹窗第一步只确认 `全部历史`，不出现周 / 月 / 年选择器。
- 弹窗内已支持 `syncReadingStats("overall", 0)`，总计未缓存时可原地同步。
- 已接入已有 AI 复盘缓存作为文案增强；AI 缺失或失败时仍回退本地长期复盘文案。
- 已补长期复盘单测，覆盖数据派生、空态、AI 文案增强和 PNG 导出文件名。

#### 导出二次排版加固计划

背景：长期复盘预览已经使用三栏 16:9 报告结构，但 PNG 导出由 Canvas 手绘生成。导出端已从早期四卡片模板改为接近预览的三栏结构后，仍暴露出长期数据天然文本更长的问题：书名、作者、策略建议、摘要和峰值标签都比月报更容易越界或产生硬截断。

当前生成图主要问题：

- 右下 `长期阅读策略` 卡片使用固定高度和固定行距，长建议句容易贴底、被截断或看起来像未排完。
- 右下策略卡在解决溢出后又暴露信息密度不足：只剩一句结论和少量行动，看起来不像长期复盘的观点区。
- 左栏摘要直接使用完整复盘句，限制 3 行后可能停在半截年份或半截短语，读起来不像有意省略。
- 年度折线峰值标签固定向右绘制，峰值在中右侧时容易压住折线、垂线或点位。
- donut 中心只按单行截断，`影视原著` 这类分类可能退化成 `影视`，语义变窄。
- 书名、作者信号、策略行动项各自截断，缺少统一的 Canvas 文本安全策略。

改造目标：

- 不重做视觉方向，不引入 DOM 截图或第三方截图依赖。
- 继续保持 `LifetimeReadingReportWide` 预览和 Canvas PNG 导出同一信息架构。
- 优先保证导出 PNG 在长文本、长书名、长作者和长建议下不破版。
- 所有事实仍来自 `LifetimeReadingReportData`，AI 只提供文案增强，不参与重新计算。

施工顺序建议：

1. 策略卡安全排版
   - 将 `drawWideAdviceCard` 拆成标题、摘要、行动项三个明确区域。
   - 摘要最多 2 行，行动项最多 2 行，超出统一省略。
   - 根据卡片高度计算每条行动项的可用 y 坐标，底部保留安全内边距。
   - 如果建议数量超过可用高度，只展示前 2-3 条，不让文本贴到底线。
   - 第二轮改为 `主线 / 节奏 / 副线 / 书目 / 作者 / 行动` 六条结构化策略项，避免右下角只有浅层建议。
   - 策略项由 `buildLifetimeReportStrategyItems(data)` 统一派生，React 预览和 Canvas 导出共享同一组观点。
2. 左栏摘要导出版短句
   - 新增 `compactLifetimeSummaryForCanvas(data)`。
   - 导出摘要优先输出累计时长、阅读天数、峰值年份、主分类这几个短事实。
   - 避免直接截断完整自然句，防止出现 `在 2024` 这类半截句。
3. 折线峰值标签避让
   - 根据 `peakPoint.x` 判断靠左、居中、靠右。
   - 靠右时标签向左绘制，靠上时增加垂直偏移。
   - 峰值标签宽度固定，文本仍走省略逻辑。
4. 分类与长文本统一截断
   - donut 中心支持最多 2 行，长分类优先按语义分段显示。
   - 书名、作者信号、策略行动项统一使用同一套 `drawCanvasTextLimited` / `truncateCanvasText`。
   - 书名保留主标题优先，括号内容允许提前省略。
5. 测试与回归
   - 增加长书名、长作者、长策略句测试样本。
   - 单测断言导出流程不抛错，且长文本会进入省略分支。
   - 保留现有长期复盘数据派生和 PNG 导出测试。

验收标准：

- 右下策略卡不出现文字越界、贴底或底边裁切。
- 右下策略卡至少包含主线、节奏、副线、书目、作者和行动六类观点，不退化成单纯 CTA。
- 左栏摘要是完整短句，不出现半截年份、半截标点或半截语义。
- 年度折线峰值标签不压住折线、点位或垂线。
- `影视原著`、长书名、长作者在导出图里能优雅省略，不造成布局破坏。
- 预览和导出仍保持同一三栏信息结构：封面画像、年度走势与分类偏好、书目作者与策略。
- `npm run build`、`lifetime-reading-report.test.ts`、`monthly-report-poster.test.ts`、`reading-stats-period.test.ts` 通过。

#### 验收标准

- `overall` 模式下有明确的 `生成长期复盘` 入口。
- 用户不会在总计复盘里看到周 / 月 / 年时间选择器。
- 没有总计缓存时，弹窗内可同步总计统计。
- 总计复盘不会出现“本期”“下期”“本月”“本年”这类周期报告文案。
- 所有事实数据来自本地统计，不由 AI 重算或发明。
- AI 失败时仍可生成基础版长期复盘。
- 竖版封面、16:9 报告、轮播报告如共存，必须共享同一份 `LifetimeReadingReport` 数据。

### 阶段九：报告生成向导（统一入口，类型隔离）

背景：统计页和复盘页已能打开阅读报告生成弹窗，周报 / 月报 / 年报共用 `PeriodReportPosterDialog`，总计走 `LifetimeReadingReportDialog`。但现有弹窗把报告类型、时间选择、预览类型、同步和下载操作同时暴露在一个界面里，尤其在周报场景会出现年份、月份、具体周、预览类型和下载按钮同时挤在一起的问题。用户需要先理解控件关系，才能知道下一步该点哪里。

#### 产品判断

- 入口可以统一，流程必须隔离。
- `周报 / 月报 / 年报 / 长期复盘` 是四种不同任务，不应在同一个选择面板里同时展示全部控件。
- 当前复盘页按钮区已经承载 `生成复盘 / 重新生成 / 同步统计 / 导出 Markdown / 生成报告图`，继续堆按钮会破坏主次层级。
- 更好的方案是把 `生成报告图` 变成分步向导：先选报告类型，再选时间，最后预览和导出。

#### 目标体验

点击 `生成报告图` 后进入轻量向导：

1. `选择报告类型`
   - `周报`：用于短周期节奏回看。
   - `月报`：用于月度分享和主题复盘。
   - `年报`：用于年度结构和代表书目总结。
   - `长期复盘`：用于全部历史阅读资产报告。
2. `选择时间`
   - 只渲染当前报告类型需要的时间控件。
   - `周报`：年份 → 月份 → 具体周。
   - `月报`：年份 → 月份。
   - `年报`：年份。
   - `长期复盘`：不显示时间网格，只确认 `全部历史`。
3. `预览与导出`
   - 周 / 月 / 年进入周期报告预览。
   - 长期复盘进入长期资产报告预览。
   - 预览页再展示可用导出方式，不在第一步提前暴露全部格式。

#### 信息架构

建议新增一个统一入口组件：

- `ReportGenerationWizardDialog`
  - 管理 `step: "type" | "time" | "preview"`。
  - 管理 `draftKind: "weekly" | "monthly" | "annually" | "overall"`。
  - 管理 `draftPeriod: ReadingStatsPeriod`。
  - 根据 `draftKind` 渲染不同的时间选择子组件。
  - 根据 `draftKind` 调用 PeriodReport 或 LifetimeReport 预览组件。

建议拆出的子组件：

- `ReportKindSelector`
  - 只展示四种报告类型卡片。
  - 默认选中来自当前页面周期：周 / 月 / 年 / 总计。
- `ReportTimeSelector`
  - 内部按 `draftKind` 分支，不让无关控件出现在页面里。
  - 周报选择器可以复用已有年 / 月 / 周数据，但需要分区收窄。
- `ReportPreviewStage`
  - 周 / 月 / 年复用现有 `PeriodReportPoster / PeriodReportCardSet / PeriodReportWidePrototype`。
  - 总计复用现有 `LifetimeReadingReportWide`。

#### 按钮策略

向导底部按钮随步骤变化：

- 类型选择页：`取消`、`下一步`。
- 时间选择页：`上一步`、`生成预览`。
- 预览页：`重新选择时间`、`下载当前格式`、`更多格式`。

预览页的格式切换建议：

- 周 / 月 / 年：保留 `竖版海报 / 轮播报告 / 16:9 报告`。
- 长期复盘：首版只保留 `16:9 报告`，不要出现竖版和轮播占位。
- `导出 Markdown` 不放进报告图向导，继续留在复盘页操作区，避免“文档导出”和“图片分享”混淆。

#### 页面入口策略

统计页：

- 当前 `生成阅读报告 / 生成长期复盘` 可统一改为 `生成报告图`。
- 打开向导后默认选中当前统计周期对应的报告类型。
- 如果当前是总计，默认选 `长期复盘`。

复盘页：

- 保留 `生成复盘 / 重新生成` 作为 AI 正文主流程。
- 保留 `同步统计 / 导出 Markdown` 作为数据与文档辅助流程。
- `生成报告图` 打开同一个向导，默认选中当前复盘周期。
- 如果当前复盘已有 AI 分析缓存，报告图优先融合该 AI 文案；没有缓存时仍用本地统计生成基础版。

#### 状态与数据原则

- 向导内的时间选择只维护草稿周期，不立即切换统计页或复盘页主页面周期。
- 点击 `生成预览` 后才读取对应周期统计缓存；没有缓存时显示 `同步该周期统计`。
- 未来周期不可选或不可生成，必须沿用 `isFutureReadingStatsPeriod` 判断。
- AI 复盘缓存只作为文案增强，不参与事实计算。
- `PeriodReport` 和 `LifetimeReadingReport` 继续共享现有数据派生函数，不新增一套并行事实模型。

#### 施工顺序

1. 新增 `ReportGenerationWizardDialog`，承接现有 PeriodReport 与 LifetimeReport 逻辑。
2. 把 `MonthlyReportPosterDialog` 的 `select / preview` 状态迁移到向导内部，保持现有预览组件和下载函数不变。
3. 将周 / 月 / 年时间选择拆成独立 UI 分支，移除同屏混排。
4. 把长期复盘作为 `overall` 分支接入同一向导，但预览仍复用 `LifetimeReadingReportWide` 与现有导出函数。
5. 统计页和复盘页都改为打开向导，删除重复的弹窗接线代码。
6. 保留原组件一轮兼容，完成回归后再移除旧的直接弹窗入口。
7. 补单测覆盖：
   - 默认报告类型来自当前周期。
   - 月报不出现周选择。
   - 年报不出现月份和周选择。
   - 长期复盘不出现时间选择网格。
   - 未来周期不能生成预览。

当前施工状态：

- 已将向导实现迁入 `ReportGenerationWizardDialog`，`MonthlyReportPosterDialog` 与 `PeriodReportPosterDialog` 仅保留为兼容导出，避免继续误导为月报专用弹窗。
- 已在向导内落地三步结构：`选择类型 → 选择时间 / 范围 → 生成预览`。
- 周报 / 月报 / 年报 / 总计复盘第一屏已隔离成报告类型卡片，时间选择不再和类型切换同屏混排。
- 第二步只渲染当前报告类型需要的时间控件：周报显示年 / 月 / 周，月报显示年 / 月，年报只显示年份。
- 年份 / 月份点击会同步更新草稿周期，用户不需要再额外点击一次才让“生成预览”跟随选择。
- 已抽出 `report-generation-period-selection` 纯函数并补单测，覆盖总计锚点、未来月份回退、周报非未来周选择。
- `buildReadingStatsJumpWeekOptions(now)` 已修正为使用传入的 `now` 计算当前周，避免测试或指定时间场景下未来周误判。
- 总计复盘已作为 `overall` 分支接入同一向导，第二步只确认 `全部历史 · 长期阅读资产`，不显示年份 / 月份 / 周网格。
- 现有 `PeriodReportPoster / PeriodReportCardSet / PeriodReportWidePrototype` 预览和 Canvas 下载路径保持不变。
- 长期复盘预览复用 `LifetimeReadingReportWide`，下载仍走 `downloadLifetimeReadingReportWide`。
- `StatisticsPage` 和 `ReadingReviewPage` 已统一渲染 `ReportGenerationWizardDialog`，不再按 `overall` 分流到两个弹窗。
- 已补 `ReportGenerationWizardDialog.test.tsx`，覆盖第一屏类型隔离和长期复盘入口。

#### 验收标准

- 点击 `生成报告图` 后第一屏只看到报告类型选择，不出现年份 / 月份 / 周混杂控件。
- 选择 `周报` 时，时间选择明确按 `年份 → 月份 → 具体周` 展示。
- 选择 `月报` 时，不显示周选择。
- 选择 `年报` 时，不显示月份和周选择。
- 选择 `长期复盘` 时，只确认 `全部历史`，不显示周期选择。
- 预览页只展示当前报告类型可用的导出格式。
- 统计页和复盘页打开的是同一个向导组件，默认周期不同但交互一致。
- 现有 `npm run build`、报告导出单测、周期选择单测继续通过。

## 验收标准

- `StatisticsPage.tsx` 和 `ReadingReviewPage.tsx` 主要承担页面组装职责，不再继续堆积大量组件实现和 helper。
- 页面状态控制和展示层分开，新增图表时不需要继续向 page 文件底部追加纯函数。
- 统计页首屏能在不滚动的情况下看完总量、对比和主趋势。
- 周 / 月 / 年 / 总计四种模式的主图形态明确不同，不只是文案不同。
- 用户从历史年份或历史月份之间切换时，不需要连续点击多个箭头。
- 作者偏好和分类偏好都能做精确比较，而不依赖装饰性视觉。
- 趋势图、热力图和偏好地图支持 `hover / focus / tap` 的精确值读取，不把关键信息藏在 hover-only 行为里。
- 阅读报告页继续保持“解释 + 行动”为主，不退化成第二个统计看板。
- 阅读人格分析必须有统计证据支撑，不能变成心理测试或泛化评价。
- 月度热力图只在月度模式出现，不制造跨周期视觉噪音。
- 任一页面内的长列表都使用卡片内滚动，不把整页高度无限拉长。
- 月度报告海报作为独立模板生成，不通过统计页截图导出。
- `weekly / monthly / annually` 报告入口不要求用户先切到目标周期。
- 海报分享链路在 AI 文案失败时仍可用。

## 明确不做

这次改造不进入以下范围：

- 饼图、环图、雷达图。
- 多词云并存。
- 复杂气泡图。
- 依赖后端新增聚合字段的偏好版权方图。
- 为了画图而引入重型图表库。
- 在这一轮顺手改路由层级或引入全局状态管理。
- 第一版月报海报编辑器。
- 使用图片生成模型生成整张含文字和事实数据的海报。
- 用户生成海报时实时调用图片生成模型生成人格角色。
- 让人格角色表现真实年龄、性别、职业、阶层或外貌评价。
- 把阅读人格包装成心理测试、能力评分或社交排名。

当前数据量和交互复杂度都不需要这些投入。优先把“问题讲清楚”做到位，比增加图表种类更重要。
