# 复盘页阅读时间轴热力图改造方案

> 状态：已被新方案取代。
>
> 本文档保留为过程记录。新的结论是：阅读报告页时间轴不应以热力图作为主图，而应按周度、月度、年度、总计切换不同图表。后续实施请以 `docs/reading-review-timeline-visualization-refactor-plan.md` 为准。

## 结论

复盘页的“阅读时间轴 / 按阶段看阅读变化”建议在月度模式下改为热力图主视图。

当前条形列表能表达每个分桶的时长，但当月度分桶较多时会拉长页面，用户需要逐行扫读才能判断阅读节奏。热力图更适合表达“哪几天读了、哪几天断了、哪天最高峰”，也能和统计页已有视觉语言保持一致。

本次改造不建议全模式替换：

- 月度模式：改为热力图。
- 周度模式：保留当前条形列表。
- 年度 / 总览模式：保留当前条形列表，后续如需要再设计跨月热力图。

## 当前问题

1. 信息密度偏低

- 当前每日阅读数据以横向条形卡片呈现。
- 每个日期占据较大垂直空间，16 个分桶已经接近一屏。
- 用户很难快速看出连续阅读、断档和高峰。

2. 视觉表达与语义不完全匹配

- “阅读时间轴”强调节奏变化。
- 条形列表更像排行榜或明细列表。
- 热力图更适合表达时间分布和投入强度。

3. 与统计页存在重复表达

- 统计页已有 `ReadingHeatmap` 组件。
- 复盘页当前又单独实现了一套时间分布列表。
- 两处都基于 `ReadingTimeBucket[]`，存在复用空间。

4. 长列表影响复盘页主线

- 复盘页下方还需要承载阶段总结、AI 对照和代表主题。
- 时间轴列表过长会稀释后续总结内容的可见性。

## 改造目标

1. 月度节奏一眼可读

- 展示本月每日阅读热度。
- 明确高峰日。
- 保留有效阅读天数或分桶数量。
- 通过 tooltip 查看具体时长。

2. 不破坏现有周期逻辑

- 周度、年度、总览先保持原条形列表。
- 避免把单月热力图错误用于跨月数据。

3. 复用现有能力

- 优先复用 `ReadingHeatmap`。
- 不复制一套新的热力图逻辑。
- 仅在必要时给组件增加轻量配置。

4. 保持复盘页结构稳定

- 外层 `ReviewPanelHeading` 继续负责复盘页标题。
- 热力图只替换当前 `ReviewTimeline` 的主体展示。
- 阶段总结和 AI 对照继续保留。

## 建议布局

月度模式：

```text
[阅读时间轴]                         [16 个分桶]
按阶段看阅读变化

[热力图]
  一 二 三 四 五 六 日
  [日期格子按热度着色]

低 [0][1][2][3][4] 高
高峰日：2月5日，阅读 52分钟

[阶段总结]
[AI 对照]
[代表主题]
```

周度 / 年度 / 总览模式：

```text
[阅读时间轴]                         [N 个分桶]
按阶段看阅读变化

[现有条形列表]

[阶段总结]
[AI 对照]
[代表主题]
```

## 组件落点

### `ReadingHeatmap`

位置：

- `src/components/ReadingHeatmap.tsx`

建议增加轻量配置，避免复盘页和统计页标题重复。

可选接口：

```ts
type ReadingHeatmapProps = {
  buckets: ReadingTimeBucket[];
  headingMode?: "default" | "compact" | "hidden";
};
```

推荐行为：

- `default`：保持统计页现有表现。
- `compact`：用于复盘页，标题更轻，或只展示高峰提示和图例。
- `hidden`：完全隐藏组件内部标题，由外层面板接管。

如果实现时希望更简单，可以先只增加：

```ts
showHeading?: boolean;
```

### `ReviewTimelineSection`

位置：

- `src/features/reading-review/components/ReviewTimelineSection.tsx`

建议在 `ReviewTimelineSection` 内做模式分支：

```tsx
{mode === "monthly" ? (
  <ReadingHeatmap buckets={buckets} showHeading={false} />
) : (
  <ReviewTimeline mode={mode} buckets={buckets} />
)}
```

保留：

- `ReviewPanelHeading`
- `ReviewTimeSegments`
- 空状态逻辑
- 分桶 badge

### `styles.css`

位置：

- `src/styles.css`

原则：

- 只补复盘页内热力图的间距和宽度适配。
- 不修改统计页热力图的默认样式。
- 不改全局滚动条。
- 不改其他页面纸感样式。

可增加类似：

```css
.review-timeline-panel .reading-heatmap {
  margin-top: 14px;
}
```

实际命名以现有样式结构为准。

## 数据规则

1. 月度模式使用热力图

- 输入仍为 `buckets: ReadingTimeBucket[]`。
- 热力图组件内部继续按 `startTime` 推导月份。
- 同一天多个 bucket 继续聚合。

2. 非月度模式保留条形列表

- `weekly` 数据少，条形列表足够直接。
- `annually` 和 `overall` 可能跨月，不适合直接套现有单月热力图。

3. 空状态保持一致

- 如果有效分桶为 0，继续显示 `ReviewEmptyBlock`。
- 不让热力图显示一整块空白日历误导用户。

## 实施步骤

1. 调整 `ReadingHeatmap` 接口

- 增加 `showHeading` 或 `headingMode`。
- 默认值保持统计页现有表现。
- 确保 tooltip、图例、热度等级不变。

2. 替换月度复盘展示

- 在 `ReviewTimelineSection` 中引入 `ReadingHeatmap`。
- 仅当 `mode === "monthly"` 时使用热力图。
- 其他模式仍调用 `ReviewTimeline`。

3. 调整局部样式

- 只针对 `.review-timeline-panel .reading-heatmap` 做间距适配。
- 检查移动端是否溢出。
- 保持复盘页卡片节奏，不新增装饰性样式。

4. 验证

- 月度复盘显示热力图。
- 周度、年度、总览仍显示条形列表。
- 统计页热力图无视觉回归。
- tooltip 可 hover / focus。
- 移动端不横向溢出。
- `npm exec vite build` 通过。

## 验收标准

1. 功能验收

- 月度模式不再展示长条形时间轴列表。
- 月度模式展示统计页同款热力图。
- 有效阅读天数、峰值日、具体时长仍可读取。
- 阶段总结和 AI 对照仍显示在热力图之后。

2. 视觉验收

- 首屏不再被长列表占满。
- 热力图和复盘页标题不重复。
- 图例、tooltip、日期格子清晰可读。
- 暗色主题仍可识别热度层级。

3. 范围验收

- 不修改全局滚动条。
- 不修改书籍详情页。
- 不修改统计页数据逻辑。
- 不引入新的图表库。

## 风险与取舍

1. 现有热力图只支持单月

- 这是保留年度 / 总览条形列表的主要原因。
- 如果后续要做年度热力图，应单独设计按月份分组的矩阵。

2. 标题重复风险

- `ReadingHeatmap` 当前自带标题。
- 复盘页外层也有标题。
- 实现时必须让热力图支持隐藏或压缩标题。

3. 空数据表达风险

- 空热力图可能显得像组件坏了。
- 空状态继续走 `ReviewEmptyBlock` 更稳妥。

## 不做事项

- 不重做统计页。
- 不改阅读统计接口。
- 不为年度 / 总览强行套单月热力图。
- 不新增全局主题变量。
- 不调整复盘页其他卡片结构。
