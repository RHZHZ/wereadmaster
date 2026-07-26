# M2 实施说明 —— 功能收敛第二里程碑(PR\-8 \~ PR\-13)

> **status: current** · 2026\-07\-26
> 上游:docs/functional\-consolidation\-blueprint.md(4.1\-4.3、5 节、第 8 节已决事项);前置:M1 全部合并(依赖三维状态模型、reading\-selectors 基础、glossary)。
> M2 出口条件:同一信息/动作在全应用只有一个主入口;报告图逻辑单实例;从选书决策结果页两次点击内可开始读一本书;`npm test`、`npm run e2e` 全绿。
> 行号锚点基于 2026\-07\-26 工作区,已核对。

## 0 切片总览与依赖

| PR | 主题 | 主要触碰 | 依赖 |
| --- | --- | --- | --- |
| PR\-8 | TodayPlan 完整引擎 | reading\-selectors.ts、新增测试 | M1 PR\-2 |
| PR\-9 | 总览三模块合一 | DashboardPage.tsx 及配套 pages/dashboard\-\*.ts | PR\-8 |
| PR\-10 | 报告图逻辑单实例 | 新 features/reading\-stats/use\-report\-image.ts \+ ReportImagePanel;两页删重 | — |
| PR\-11 | 统计 × 周期复盘合并 | StatisticsPage、ReadingReviewPage(退役为子组件)、App.tsx 导航 | PR\-10 |
| PR\-12 | 成果单视图 | ReadingHubPage、App.tsx 子菜单与 readingHubTab | PR\-11 |
| PR\-13 | 决策 → 开始读闭环 | BookDecisionPage、CandidateBookshelfPage、App.tsx | 仅 M1 |

建议顺序:PR\-10 → PR\-11 → PR\-12 一条线(同一导航区,避免冲突);PR\-8 → PR\-9 一条线,两条线可并行;PR\-13 随时。

## 1 PR\-8 TodayPlan 完整引擎(A1、B4 收口)

在 M1 的 reading\-selectors.ts 上扩展,新增:

```ts
export type SuggestedActionKind =
  | "continueReading" | "organizeNotes" | "startCandidate"
  | "makeDecision" | "applyStatsAdvice" | "syncData" | "explore";

export type SuggestedAction = {
  kind: SuggestedActionKind;
  itemId?: string;
  title: string;          // 文案取自 glossary,如 `继续读《x》`
  reason: string;         // 必填,可解释:如 "昨天读了 32 分钟,还差 12% 读完"
};

export type TodayPlan = {
  primary?: SuggestedAction;
  secondary: SuggestedAction[];      // ≤3,与 primary 不同 kind
  queues: {
    continueReading: QueueItem[];    // lifeStatus==="reading",lastReadAt desc,≤3
    toOrganize: OrganizeCandidate[]; // M1 的 getOrganizeQueue
    candidates: ReadingItem[];       // M1 的 getCandidateQueue
  };
};

export function getTodayPlan(input: {
  items: ReadingItem[];
  shelfEntries: ShelfEntry[];          // lastReadAt / progressPercent
  notebooks: NotebookBook[];
  reviewedBookIds: Set<string>;
  statsReviewNextActions?: string[];   // 最新周期复盘的 nextActions
  hasCredential: boolean;
}): TodayPlan
```

**primary 决策表(自上而下第一个命中)**\:

| 条件 | primary |
| --- | --- |
| 无凭据或从未同步 | syncData("先同步书架和笔记") |
| 存在 lifeStatus\=reading 且今天未读(lastReadAt \< 今日零点) | continueReading(最近的一本) |
| 待整理队列非空 | organizeNotes(队首,manual 优先) |
| 候选 ≥ 2 且无未读完成的决策 | makeDecision |
| 候选 ≥ 1 | startCandidate(队首) |
| 其余 | explore("去发现页找下一本") |

secondary \= 其余 kind 中各取队首,截断 3 个;statsReviewNextActions 存在时以 applyStatsAdvice 参与 secondary(**全应用仅此一处承载统计建议动作**)。

vitest 用例:决策表每行一例;primary 与 secondary 不重复 kind;今天已读过的在读书不做 primary(但仍在 queues.continueReading);reason 非空;空数据兜底 explore/syncData。

## 2 PR\-9 总览三模块合一(A1)

### 2\.1 删除

- "今日可做" panel(DashboardPage.tsx:682\-,含 aria\-label\="今日可做" 整块)及其动作聚合逻辑;"执行统计建议"项(:1387\-1398 一带)一并消失。
- "本地队列" panel(:846\-,含继续读/待复盘/本地候选三列,:861\-887、:968\-1098 的三套本地规则在 M1 已改调 selectors,此处整块移除)。
- "今日阅读工作台" panel(:1692\-)。
- 配套退役:src/pages/dashboard\-workbench\-actions.ts(\+test)、dashboard\-daily\-card.ts(\+test)中仅服务上述模块的函数;`getNotebookReviewCandidates`(:1001\-1075)删除。

### 2\.2 新增与保留

- 新渲染单元 `<TodayPlanPanel plan={...}/>`\:1 主动作大按钮(带 reason 副文案)\+ ≤3 备选行 \+ 三个可折叠队列。数据源即 PR\-8 `getTodayPlan`。
- 保留为**纯信息卡**(去动作化):微信读书概况卡(最近 5 本,:667\-680,仅展示)、阅读人格卡(:716\-795,按钮"复盘"移除,整卡可点跳统计\-解读 tab)、"下周期建议"卡(:797\-818)降级为文本引用,其执行动作由 TodayPlan 的 applyStatsAdvice 唯一承载。
- hero 四按钮(:607\-624)保留导航职能,补"统计"直达(修 A1/P13 统计入口权重)。

### 2\.3 验收

- [ ] 总览首屏动作区只有一个模块;"最近在读的那本书"在总览至多出现 2 次(概况卡信息展示 \+ TodayPlan 主动作)
- [ ] 同一动作(继续读/整理/统计建议)全页唯一
- [ ] e2e:dashboard 相关断言改为 TodayPlanPanel 的 data\-testid

## 3 PR\-10 报告图逻辑单实例(A2)

### 3\.1 抽取

新文件 `src/features/reading-stats/use-report-image.ts` \+ `ReportImagePanel.tsx`(features/reading\-stats 目录已存在)。收编两页的同名复制函数(StatisticsPage.tsx:499\-865 与 ReadingReviewPage.tsx:578\-944):`resolveReportDataCompleteness`、`buildReportDisabledReason`、`buildLifetimeReportDisabledReason`、`isFutureReadingStatsPeriod`、`handleReportDownload/Share`、`handleLifetimeReportDownload/Share`、`handleReportPeriodSync`、`showReportArtifactSuccess`,以及报告统计加载 useEffect(:220\-287 / :244\-311)。

### 3\.2 行为统一(消灭分叉)

唯一行为采用复盘页版本:**报告注入"当前刚生成的周期复盘 ?? 缓存复盘"**(ReadingReviewPage.tsx:214\-228);统计页只取缓存的旧行为(StatisticsPage.tsx:198\-204)废除。hook 签名:`useReportImage({ periodContext, currentReview? })`。

### 3\.3 验收

- [ ] 两处入口生成的同周期报告图字节级同源(同一渲染路径)
- [ ] 两页合计删除 ≥700 行;vitest 覆盖 disabledReason 分支

## 4 PR\-11 统计 × 周期复盘合并(A1、A2、A3)

### 4\.1 页面

- StatisticsPage 增双 tab:**数据**(现图表区 :458\-470 等)与**解读**(承接 ReadingReviewPage 主体)。周期导航器与周期状态上提页头,两 tab 共享(删除 ReadingReviewPage 自带的重复导航器 :385\-406 与重复周期选项 :85\-90)。
- ReadingReviewPage 降级为 `features/reading-stats/InsightTab.tsx` 子组件:保留 AI 周期复盘生成/查看、人格、行动建议区块(:524\-556),周期上下文由父页传入;hero、独立同步按钮、报告向导挂载(:407\-427)移除(报告面板由页头 ReportImagePanel 统一挂载)。

### 4\.2 导航与旧路径

- App.tsx:`readingReviewSubItems` 删除 `report` 项(:230);ReadingHubPage 的 report 分支(:741\-748)删除。
- 旧路径重定向:`handleOpenReadingReviewTab("report")` 的调用点(DashboardPage 人格卡 :722\-725、StatisticsPage hero `onOpenReview` :344 与 App.tsx:1891\-1894)改为 `navigate("stats", { tab: "insight" })`;statsPage 自身的 onOpenReview 按钮删除(已在页内)。
- 偏好项"默认启动页"(SettingsPage:1901\-1906)选项不变(统计仍是合法启动页);`resolveBottomNavigationId` 中 stats 分支维持"我的"高亮(移动端结构 M4 才动)。
- 文案按 glossary:tab 标签"数据 / 解读";周期 AI 资产统一叫"周期复盘"。

### 4\.3 验收

- [ ] 全应用只剩一个周期切换器实现的两处挂载(统计页头)
- [ ] 旧"阅读报告"入口(侧边栏子项、总览人格卡)全部落到统计\-解读 tab,无死链
- [ ] 同周期数据在数据/解读两 tab 一致(同一份 stats 状态,不重复拉取)

## 5 PR\-12 成果单视图(A1、A8、已决事项 \#1/\#3)

### 5\.1 合并 books/guides 两 tab

- ReadingHubPage 收敛为单一"成果库"视图:以现 guides tab 的三层结构(资产库 → 书籍成果详情 → 版本详情,:620\-736)为主体;顶部加类型筛选 chips(书籍复盘 / 阅读指南 / 阅读路线 / 周期复盘 / 选书决策 / 助手收藏)。
- books tab(:437\-)拆解:"建议生成复盘"卡上提为页头常驻(数据来自 M1 `getOrganizeQueue`,与总览同源);"已生成复盘列表"并入资产库(书籍复盘类型);**查看历史复盘统一走资产库版本详情**(AIAssetVersionDetailView,:1648\-1659),BookAiSummaryPage 仅保留"生成/重新生成"职责——同一复盘从此只有一套查看 UI。
- `ReadingWorkflowTemplateStrip` 两处渲染(:476、:674)删除(页内第三套导航,A8/P12)。
- 资产库纳入周期复盘(subject\=周期)与选书决策(subject\=候选集),为 M3 的助手收藏预留类型枚举(已决事项 \#3;M2 先展示 M1 已有缓存的最新决策,完整版本链随 M3 资产泛型化)。

### 5\.2 导航与状态清理

- App.tsx:`readingReviewSubItems` 整个删除(:227\-231),侧边栏"成果"点击直达单视图(消灭 A6 的"点击只展开"特例之一);全局 `readingHubTab` 状态、`setReadingHubTab` 调用点(:483、:1069\-1073、:1891\-1894)删除,类型筛选降为页内本地状态。
- 返回文案统一走 glossary("返回成果"),"返回复盘中心/阅读指南库/书籍成果详情"私有地名清除(A8)。

### 5\.3 验收

- [ ] 书籍复盘的查看路径全应用唯一(资产库);BookAiSummaryPage 无历史列表职责
- [ ] 成果页可按六类筛选;选书决策与周期复盘可从成果页找回(user\-guide"总入口"承诺成立)
- [ ] readingHubTab 不再是全局状态;移动端底部"成果"tab 记忆行为随之简化

## 6 PR\-13 决策 → 开始读闭环(B3、B7 收尾)

### 6\.1 结果页动作化

- 主推荐卡(BookDecisionPage.tsx:528\-550)增主 CTA 行:**去微信读书打开**(复用书籍详情的 `onOpenInWeread`/`onOpenBook` 链路,BookDetailPage.tsx:500 同款注入)\+ **标记在读**(`patch(itemId, { lifeStatus: "reading", finishedSource 不动 })`,M1 能力)\+ 打开详情。备选/暂缓卡提供"暂缓"(M1 语义:isCandidate\=false \+ dropped)。
- `internalActionLabels`(:71\-92)从纯文案映射升级为动作描述符:

```ts
type DecisionAction = { label: string; kind?: "openDetails" | "openWeread" | "markReading"; bookId?: string };
```

行动清单逐条渲染为可执行按钮 \+ 勾选;**无法识别的动作 ID 原样展示 AI 文本**,删除"完成一次可验证的阅读动作。"模糊兜底(:88\-92)——宁可生硬,不可失真(诚实原则)。

- 候选书架:决策生成后,入选书卡片显示"决策推荐"徽章,菜单"开始读"置顶(M1 已有该菜单项)。

### 6\.2 验收

- [ ] 从决策结果页 ≤2 次点击:开始读(打开微信读书或标记在读)
- [ ] 标记在读后,总览 TodayPlan 出现该书的 continueReading;候选身份保留(is\_candidate 不变,由用户后续暂缓/移除)
- [ ] 行动清单无模糊兜底文案

## 7 风险与迁移

1. **e2e 冲击面最大的里程碑**\:dashboard 三模块、统计/复盘合并、ReadingHub 结构全变。策略同 M1:每个 PR 内"先迁断言到 data\-testid、再改结构";app\-smoke.spec.ts 建议按页面拆分为多个 spec 文件(383KB 单文件已不可维护),拆分作为 PR\-10 的附带任务。
2. **旧路径兼容**\:readingReview 的 report tab 消失后,启动页偏好、bookAiBackView\="readingReview" 回跳、移动端底部 tab 记忆均需回归测试;App.tsx 高亮映射(:384\-434)逐分支核对。
3. **数据一致性**\:统计页与解读 tab 共享一份 stats 状态后,`listBookNotesSummaries` 的三处独立拉取(Dashboard/ReadingHub/Notes,P8)顺势收敛为 App 级缓存 \+ 失效事件(复盘生成后广播),避免"生成了复盘但建议列表不刷新"。
4. **不做**\:移动端导航重构、导航历史栈、AI 资产泛型命令、本地批注入库(M3/M4)。

## 8 M2 出口验收汇总

- [ ] 重叠矩阵清零:周期统计数据、AI 周期复盘、人格、报告向导、建议复盘、继续读,每项全应用仅一个动作入口(信息性引用允许,但不带动作)
- [ ] 报告图单实例;两入口产物一致
- [ ] "成果"单视图六类可筛;两套复盘查看 UI 收敛为一套
- [ ] 决策 → 开始读 ≤2 次点击;TodayPlan 闭环可走通:决策 → 标记在读 → 次日 primary\=继续读 → 读完 → 待整理 → 生成复盘 → 已整理
- [ ] e2e 按页面拆分并全绿
