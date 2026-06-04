# 每日阅读工作台改造规划

## 开工摘要

当前最推荐的第一步是 PR-1：只新增 `DailyWorkbenchAction` 纯前端模型和动作解释纯函数，不改 UI、不改样式、不改后端。

第一轮目标：

- 复用现有 `buildTodayActions`。
- 把 `TodayAction[]` 派生为可解释的每日工作台动作。
- 选出一个 `primaryAction` 和最多两个 `secondaryActions`。
- 补齐 `reason`、`outcome`、`effort`、`source`。
- 用纯函数测试锁住边界。

第一轮不做：

- 不改 `DashboardPage` 首屏结构。
- 不改 CSS。
- 不新增 Tauri 命令。
- 不读取单本笔记正文。
- 不调用 AI。
- 不处理 `organized`。

最小验收：

- `npm test -- --run src/pages/dashboard-workbench-actions.test.ts`
- `npm test`
- `npm run build`

## 背景

当前应用已经具备本地优先微信读书管理工具的主要闭环：书架、候选书架、详情、笔记、统计、复盘、阅读指南、选书决策、导出和设置都能串联使用。`reading-management-closure-roadmap.md` 中的 P0 项也已经基本收口。

但主观体验仍然偏“有用但没意思”。这说明问题不再是缺少功能，而是产品动机还没有足够贴近用户每天打开应用时的真实冲动。

现有体验更像阅读资产后台：

- 我有什么书。
- 我有什么笔记。
- 我有什么统计。
- 我生成过什么复盘。
- 我能导出什么内容。

下一阶段应该把主语改成：

- 今天读什么。
- 今天整理什么。
- 今天带走什么。

目标不是继续横向增加入口，而是把已有能力组织成一个更强的每日使用循环。

## 改造目标

把产品从“微信读书个人阅读管理应用”推进到“每日阅读工作台”。

新的核心定义：

> 让用户每天打开应用后，在 3 分钟内明确一个阅读动作，并带走一个可见成果。

必须满足三类价值之一：

- 行动：明确下一步读什么、复盘什么、整理什么。
- 决策：帮助用户在继续读、复盘、选下一本之间取舍。
- 交付物：生成或沉淀可复制、可导出、可分享、可继续写作的成果。

不再把统计、画像、AI 文案和版本历史当作最终价值。它们只能作为行动、决策和交付物的依据。

## 设计原则

### KISS

- 优先重排和解释现有信号，不新增复杂数据模型。
- 首页首屏只突出一个主动作，最多两个备选动作。
- 每个动作必须能一句话解释“为什么现在做”。

### YAGNI

- 不新增泛聊天、知识库问答、自动推荐和后台 AI 生成。
- 不新增完整任务系统。
- 不为未来复杂习惯追踪预留大而全字段。

### DRY

- 复用现有 `buildTodayActions` 的动作来源和排序基础。
- 复用已有本地状态、笔记概览、统计缓存、AI 资产缓存和候选书状态。
- 不复制书籍、笔记、复盘、路线的业务判断，必要时抽到纯函数。

### SOLID

- 总览页负责“今日决策和入口”，不承载长报告。
- 复盘页负责“单本整理和反馈”，不变成任务中心。
- 统计页负责“周期证据”，不直接抢首页主动作。
- 导出和分享保持交付物职责，不承担阅读状态判断。

## 产品判断

当前应用不够有趣的核心原因：

1. 动作存在，但奖励距离太远。
2. 信息完整，但缺少“今天就做这件事”的压迫感。
3. AI 产物完整，但更像结果库，不像连续陪伴。
4. 首页有多个合理入口，但没有足够鲜明的主叙事。

因此下一阶段不应该问“还能加什么功能”，而应该问：

- 哪个动作最值得今天做。
- 为什么是它。
- 做完能得到什么。
- 做完后状态如何改变。

## 改造范围

### 要做

- 将总览页改造成“今日阅读工作台”。
- 将 `今日可做` 从 3-5 条动作列表升级为 `今日最值得做` 主卡。
- 为主动作补充 `为什么现在做` 和 `完成后得到什么`。
- 保留轻量备选动作，例如 `轻量 5 分钟`、`深度 30 分钟`。
- 增加无需 AI 的 `今日卡片`，从本地数据中给出一个每日阅读提示或成果入口。
- 将复盘反馈从“状态记录”强化为“这本书是否已整理过”的轻反馈。
- 用现有缓存和本地状态驱动，不引入后台自动同步或自动 AI。

### 不做

- 不新增全局任务系统。
- 不做每日打卡、积分、等级或成就体系。
- 不做自动 AI 生成。
- 不做泛用阅读聊天。
- 不做跨书知识库问答。
- 不做需要长期维护复杂字段的习惯追踪。
- 不把首页变成更大的统计仪表盘。

## 核心体验

### 1. 今日最值得做

首页首屏展示一个主卡：

```text
今日最值得做
复盘《深度工作》的 8 条笔记

为什么是它：
你已经读到 76%，有 14 条划线，但还没有生成复盘。

完成后你会得到：
一份行动清单 + 3 个复盘问题
```

主卡只允许一个主按钮。

可选主按钮：

- 继续阅读
- 生成复盘
- 打开阅读指南
- 执行选书决策
- 同步必要缓存
- 配置必要凭据

### 2. 轻量和深度备选

主卡下方保留两个小动作：

- 轻量 5 分钟：适合复制卡片、同步笔记、查看一个问题。
- 深度 30 分钟：适合生成复盘、阅读指南或选书决策。

这两个动作来自同一动作池，但要按耗时和收益重新解释，而不是直接展示原动作标题。

### 3. 今日卡片

今日卡片不默认调用 AI，只基于本地数据生成。

候选类型：

- 今日一句划线。
- 今日一个复盘问题。
- 今日一个未处理行动项。
- 今日一本该继续读的书。
- 今日一个阅读偏差提醒。
- 今日一个可导出的成果。

卡片目标是提供“每天打开看一眼”的理由，而不是新增报告页。

### 4. 完成后的状态反馈

当用户完成复盘、复制行动清单、导出 Markdown、生成报告图或标记行动项后，页面应该明确反馈：

```text
这本书已从“读过”推进到“已整理”。
```

首版不需要复杂任务模型，只使用已有 AI 反馈记录、本地阅读状态和导出结果做轻量表达。

## 信号来源

优先使用现有本地信号：

- 书架缓存。
- 最近阅读记录。
- 笔记概览。
- 单本笔记数量。
- 本地候选书状态。
- 已生成选书决策。
- 已生成书籍复盘。
- 已生成阅读指南。
- 已生成统计复盘的下一步建议。
- AI Provider 配置状态。
- 微信读书凭据状态。

禁止自动触发：

- 后台同步书架。
- 后台同步笔记。
- 后台读取单本笔记正文。
- 后台调用 AI。
- 后台刷新推荐。

## 动作模型

现有 `TodayAction` 可以保留，但需要派生更适合首页主卡的展示模型。

建议新增纯前端模型：

```ts
type DailyWorkbenchAction = {
  title: string;
  verb: string;
  reason: string;
  outcome: string;
  effort: "light" | "deep" | "setup";
  tone: "green" | "blue" | "gold" | "muted";
  source: "credential" | "shelf" | "notes" | "review" | "route" | "decision" | "stats" | "candidate";
  onClick: () => void;
};
```

实现建议：

- 先由现有 `buildTodayActions` 生成基础动作。
- 再通过纯函数 `buildDailyWorkbenchActions` 补全 `reason`、`outcome`、`effort` 和 `source`。
- `DashboardPage` 只消费最终展示模型，避免 UI 中堆业务判断。

## 阶段规划

### P0：总览主卡改造

目标：

- 首页首屏从动作列表改成一个主动作。
- 让用户不需要比较多个入口，也能知道今天最值得做什么。

范围：

- 保留原动作池。
- 选择最高优先级动作作为主卡。
- 其余动作降级为轻量备选。
- 主卡文案补 `为什么现在做` 和 `完成后得到什么`。

验收标准：

- 首屏只有一个最高优先级主动作。
- 主动作必须有原因和结果。
- 无凭据、无缓存、无笔记、无候选、无 AI Provider 时仍有单一主路径。
- 不新增后端命令。
- 不自动调用 AI。

建议测试点：

- 有继续读和待复盘同书时，主卡只展示一个动作。
- 有待复盘书时，主卡说明笔记数量或复盘缺失原因。
- AI 未配置且需要生成时，主卡引导设置。
- 无数据时，主卡引导同步书架缓存。

#### P0 实施细案

当前 `DashboardPage.tsx` 已经存在：

- `TodayAction`：用于展示今日动作。
- `WeightedTodayAction`：用于排序和去重。
- `buildTodayActions`：聚合凭据、书架、最近阅读、待复盘、本地候选、选书决策和统计建议。
- `selectTodayActions`：按权重、动作 key 和主体 key 去重，最多返回 5 条。

P0 不重写这套动作池，只在它之上派生更适合首屏的工作台展示。

建议迁移步骤：

1. 保留 `buildTodayActions` 的输入、排序和去重。
2. 新增 `DailyWorkbenchAction` 展示模型。
3. 新增 `buildDailyWorkbenchActions(todayActions)` 纯函数。
4. 将 `todayActions[0]` 映射为 `primaryAction`。
5. 将剩余动作映射为 `secondaryActions`，最多展示 2 条。
6. 原 `今日可做` 列表保留为辅助区或移到首屏以下，不再作为首屏主体验。

首版不需要改后端、不需要读取额外数据库，也不需要修改 `ReadingItemState`。

#### 动作映射规则

| 原动作标题特征 | source | effort | reason 示例 | outcome 示例 |
| --- | --- | --- | --- | --- |
| `先连接微信读书` | `credential` | `setup` | `还没有本地阅读资产入口` | `连接后可同步书架、笔记和统计` |
| `同步书架缓存` | `shelf` | `setup` | `本地还没有可用书架缓存` | `获得后续复盘、候选和统计的资产底座` |
| `继续看《...》` | `shelf` | `light` | `这是最近推进过的书` | `回到当前阅读现场，继续积累可整理内容` |
| `打开《...》阅读指南` | `route` | `deep` | `没有最近阅读记录，需要先确定一本书的推进方式` | `得到本书下一步阅读和整理路径` |
| `复盘《...》` | `review` | `deep` | `这本书已有笔记信号，适合整理成结构化输出` | `得到行动清单、复盘问题和可导出的 Markdown` |
| `去笔记中心同步笔记` | `notes` | `setup` | `当前缺少可复盘的笔记信号` | `同步后可以发现最适合整理的书` |
| `执行选书决策：...` | `decision` | `light` | `已有生成过的候选取舍结果` | `确认下一本书，并减少候选堆积` |
| `查看候选《...》` | `candidate` | `light` | `本地候选需要进入下一步取舍` | `确认是否继续保留、阅读或纳入决策` |
| `去发现页保存候选` | `candidate` | `light` | `当前还没有本地候选` | `沉淀下一本书的候选池` |
| `配置 AI Provider` | `credential` | `setup` | `生成复盘、指南或决策前需要本机 Provider` | `后续可手动生成本地 AI 阅读资产` |
| `查看书籍复盘` | `review` | `light` | `已有或可生成的复盘资产需要处理` | `进入复盘中心查看和整理书籍资产` |
| `执行统计建议` | `stats` | `light` | `已有周期复盘给出下一步建议` | `回到阅读报告核对并执行建议` |

映射规则必须保持保守：

- 如果无法识别动作来源，使用 `source = "shelf"`、`effort = "light"`，并沿用原 description。
- 不根据标题生成超出原始数据的断言。
- 不把“阅读人格”作为主动作来源，只能作为右侧证据或今日卡片候选。

#### 首屏 UI 结构

建议结构：

```text
今日阅读工作台

[今日最值得做主卡]
标题：复盘《...》
原因：为什么现在做
结果：完成后得到什么
按钮：开始复盘

[轻量 5 分钟] [深度 30 分钟]

[今日卡片，P1 再补]
```

P0 可先不实现今日卡片，只预留布局或继续保留现有画像/推荐模块。

#### 与阅读人格模块的边界

当前总览已经有 `buildReadingPersona`、`resolveReadingPersona` 和 `PersonaIllustration`。P0 不移动这部分，不把人格卡改造成主动作。

阅读人格在 P0 中只允许作为：

- 右侧阅读画像。
- 今日卡片的候选来源。
- 主动作的旁证，但不是主动作本身。

禁止出现：

- `今天最值得做：查看你的阅读人格`
- 基于人格生成心理判断。
- 基于人格自动调用 AI。

#### P0 文件影响

优先影响：

- `src/pages/DashboardPage.tsx`
- `src/styles.css`

可选新增：

- `src/pages/dashboard-workbench-actions.ts`
- `src/pages/dashboard-workbench-actions.test.ts`

不建议影响：

- Rust 命令层。
- SQLite 表结构。
- AI prompt。
- 设置页。
- 统计页数据模型。

#### P0 测试细化

纯函数测试：

- `先连接微信读书` 映射为 setup 主动作。
- `复盘《...》` 映射为 deep 主动作，并包含行动清单/复盘问题 outcome。
- `继续看《...》` 映射为 light 主动作。
- 未识别标题能保守回退，不抛错。

E2E 测试：

- 首页首屏展示 `今日最值得做`。
- 首屏主卡只出现一个主按钮。
- 有多个今日动作时，只展示一个主卡和最多两个备选动作。
- 无凭据时主卡引导设置。
- 无书架缓存时主卡引导同步。

### P1：今日卡片

目标：

- 给用户一个每天打开应用即可消费的轻量反馈。

范围：

- 从本地笔记、已生成复盘、统计缓存和候选状态中选择一个卡片。
- 不调用 AI。
- 不展示伪结论。
- 数据不足时展示积累样本的轻提示。

验收标准：

- 今日卡片能解释来源。
- 点击卡片能进入对应书籍、笔记、复盘或统计页。
- 缺少数据时不展示空洞鸡汤文案。

建议测试点：

- 有已生成复盘问题时，卡片展示一个复盘问题。
- 有最近阅读但无复盘时，卡片引导继续读或整理。
- 无笔记时，卡片引导同步笔记。

#### P1 实施细案

今日卡片不是新的功能入口集合，而是首页的低成本反馈层。它的职责是让用户每天打开应用时能获得一个“可读、可点、可带走”的小内容。

建议新增纯前端模型：

```ts
type DailyReadingCard = {
  title: string;
  body: string;
  sourceLabel: string;
  actionLabel: string;
  tone: "quote" | "question" | "action" | "book" | "stats" | "empty";
  onClick: () => void;
};
```

首版卡片只使用总览已持有或已经加载过的本地数据：

- `notesOverview`。
- `readingStatsCache`。
- `reviewSuggestion`。
- `bookDecisionSession`。
- `readingStates`。
- `recentEntries`。
- `reviewItems`。
- `candidateItems`。
- `overviewPersona`。

首版不读取单本笔记正文，因此 `今日一句划线` 暂不作为 P1 必做项。它可以在后续有轻量笔记摘要缓存后再进入候选。

#### 卡片候选优先级

优先级按“能触发今天行动”排序：

1. 已生成统计复盘的第一条 `nextActions`。
2. 已生成选书决策的第一本推荐候选。
3. 待复盘书籍中的第一本。
4. 最近阅读书籍。
5. 候选书架中的第一本候选。
6. 阅读人格或月度画像的本地摘要。
7. 空态引导。

示例：

```text
今日卡片
这周期最值得处理：把最近读完的书整理成一页复盘。

来源：本地阅读报告
按钮：查看阅读报告
```

```text
今日卡片
《深度工作》已经有 14 条笔记，适合今天整理成结构化复盘。

来源：本地笔记概览
按钮：开始复盘
```

```text
今日卡片
本月阅读样本还不够稳定，先继续积累阅读记录。

来源：本地统计画像
按钮：查看统计
```

#### 今日卡片边界

允许：

- 引用本地缓存中的统计建议。
- 引用已生成 AI 资产的结构化字段。
- 引用笔记数量、候选数量、最近阅读书名等确定字段。
- 使用阅读人格的本地摘要，但必须保持“阅读风格”语义。

禁止：

- 编造用户没有写过的划线或想法。
- 在没有单本笔记正文的情况下展示“今日一句划线”。
- 自动读取单本笔记正文。
- 自动调用 AI 生成卡片。
- 输出心理诊断、性格判断或人生建议。

#### P1 文件影响

优先影响：

- `src/pages/DashboardPage.tsx`
- `src/styles.css`

可选新增：

- `src/pages/dashboard-daily-card.ts`
- `src/pages/dashboard-daily-card.test.ts`

不建议影响：

- `src-tauri` 命令层。
- 单本笔记读取命令。
- AI prompt。
- 数据库结构。

#### P1 测试细化

纯函数测试：

- 有 `reviewSuggestion.review.nextActions` 时，优先生成统计建议卡片。
- 有 `bookDecisionSession.response.decision.topCandidates` 时，能生成选书决策卡片。
- 有 `reviewItems` 时，能生成待复盘卡片。
- 数据不足时，生成空态卡片且不输出伪结论。

E2E 测试：

- 首页展示 `今日卡片`。
- 今日卡片包含来源说明。
- 点击今日卡片能进入对应页面。
- 无数据时今日卡片引导同步或设置，不展示假数据。

### P2：复盘完成感

目标：

- 让复盘从“看报告”变成“推进一本书的整理状态”。

范围：

- 在单本复盘页突出一个首选行动。
- 复用已有行动项反馈和复盘问题反馈。
- 完成关键动作后展示轻量状态反馈。
- 可以把本地状态更新为 `已整理`，但必须由用户显式点击。

验收标准：

- 用户能明确知道一本书是否已经整理过。
- 标记整理不会写回微信读书。
- 清除 AI 输出缓存不应误删用户整理反馈。

建议测试点：

- 标记行动项后，页面展示完成反馈。
- 复制行动清单后，不自动标记已整理。
- 用户显式标记已整理后，总览不再把同一本书作为待复盘主动作。

#### P2 实施细案

当前代码已经存在本地阅读状态中的 `organized` 语义，书籍详情页也有：

- `reviewing`：待复盘，需要整理笔记。
- `organized`：已整理，已完成沉淀。

P2 应优先复用这套状态，不新增任务表。

核心原则：

- `生成复盘` 不等于 `已整理`。
- `复制行动清单` 不等于 `已整理`。
- `导出 Markdown` 不等于 `已整理`。
- 只有用户显式点击 `标记已整理`，才把本地状态推进到 `organized`。

#### 单本复盘页体验

建议在单本复盘页顶部或行动区增加一个轻量状态条：

```text
整理状态：待整理
这份复盘已经生成，但还没有被你确认吸收。

主动作：标记已整理
```

标记后：

```text
整理状态：已整理
这本书已从“读过”推进到“已整理”，后续总览不会优先提醒它复盘。
```

如果没有生成复盘：

```text
整理状态：待生成复盘
先生成或读取本地复盘，再决定是否标记已整理。
```

#### 与行动项反馈的关系

行动项和复盘问题反馈继续保留当前轻量能力。

建议规则：

- 已完成任一行动项：可以显示“已有执行反馈”。
- 回答任一复盘问题：可以显示“已有复盘反馈”。
- 这些反馈可以增强完成感，但不自动改为 `organized`。
- `organized` 仍由用户显式点击触发。

这样可以避免把复盘页扩展成任务系统，同时保留用户控制权。

#### 与总览动作的关系

总览构建待复盘动作时，应降低或过滤 `organized` 书籍。

建议规则：

- `reviewing` 优先进入待复盘队列。
- 有笔记但无复盘的书可以进入待复盘队列。
- `organized` 不作为 `今日最值得做` 的复盘主动作。
- 如果用户主动进入书籍详情或复盘中心，仍可查看和更新已整理书籍。

#### P2 文件影响

优先影响：

- `src/pages/BookAiSummaryPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/BookDetailPage.tsx`

可能影响：

- `src/lib/reading-api.ts`
- `src/lib/types.ts`
- `src-tauri/src/commands/reading_state.rs`

只有在现有 `upsert_reading_item_state` 已足够表达 `organized` 时，才不需要改 Rust。若前端已能更新 `organized`，P2 不应新增后端命令。

#### P2 测试细化

纯函数测试：

- `organized` 书籍不进入主复盘动作。
- `reviewing` 书籍优先进入复盘动作。
- 有行动反馈但未显式整理时，仍不视为 `organized`。

组件或 E2E 测试：

- 单本复盘页生成复盘后展示 `标记已整理`。
- 点击 `标记已整理` 后展示 `已整理` 状态。
- 复制行动清单不会自动展示 `已整理`。
- 返回总览后，同一本书不再作为复盘主卡。

### P3：输出物收口

目标：

- 让“带走一个成果”成为稳定体验。

范围：

- 总览主卡明确对应交付物。
- 单本复盘、阅读指南、统计报告、选书决策都展示可复制或可导出的结果。
- 导出成功后在本地状态中形成轻量记录。

验收标准：

- 用户能在 3 分钟内完成一次可见产出。
- 导出和复制不包含敏感数据。
- 不因为缺 AI Provider 阻塞非 AI 交付物。

#### P3 实施细案

当前应用已经具备多类输出能力：

- 单本笔记 Markdown。
- 单条笔记分享图片。
- 当前组笔记分享图片。
- 单本 AI 复盘 Markdown。
- 单本 AI 复盘复制。
- 行动清单复制。
- 复盘问题复制。
- 阅读指南 Markdown。
- 选书决策 Markdown。
- 阅读报告图片。
- 长期复盘报告图片。

P3 不新增新的导出系统，重点是统一“成果感”：

- 首页主动作明确完成后会得到什么成果。
- 目标页面的主按钮文案和首页 outcome 对齐。
- 成果生成后有一致的成功反馈。
- 成果不要求用户理解内部功能名。

#### 成果类型目录

建议用前端轻量枚举整理成果类型：

```ts
type ReadingArtifactKind =
  | "notes-markdown"
  | "note-card-image"
  | "book-review-markdown"
  | "action-checklist"
  | "reflection-questions"
  | "reading-route-markdown"
  | "book-decision-markdown"
  | "period-report-image"
  | "lifetime-report-image";
```

首版不要求持久化 `ReadingArtifactKind`，可以只用于：

- 首页主卡 outcome 文案。
- 导出/复制成功 toast。
- 页面内成功状态说明。
- 测试断言。

#### 页面成果映射

| 页面 | 当前能力 | P3 统一成果表达 |
| --- | --- | --- |
| 单本笔记页 | 导出 Markdown、导出分享图片 | `笔记归档`、`摘录卡片` |
| 单本 AI 复盘页 | 复制完整复盘、复制行动清单、复制复盘问题、导出 Markdown | `复盘文档`、`行动清单`、`复盘问题` |
| 阅读指南页 | 导出 Markdown | `阅读处方` 或 `跨书路线` |
| 选书决策页 | 导出 Markdown | `下一本书决策` |
| 统计/阅读报告页 | 导出报告图 | `周期阅读报告`、`长期复盘报告` |
| 总览页 | 跳转入口 | `完成后你会得到...` |

#### 成功反馈文案规范

建议统一为：

```text
已生成：复盘文档
已保存到：...
```

或：

```text
已复制：行动清单
可以直接粘贴到写作、待办或笔记工具。
```

避免：

- 只说 `导出成功`，但不说用户得到了什么。
- 只展示文件路径，缺少成果名称。
- 使用内部术语，例如 `AI asset`、`prompt version` 作为主要反馈。

#### 与已整理状态的关系

P3 不自动把导出或复制视为 `已整理`。

允许：

- 导出成功后提示“如果你已经吸收这份复盘，可以标记已整理”。
- 单本复盘页在成功导出后展示 `标记已整理` 的辅助动作。

禁止：

- 导出成功自动写入 `organized`。
- 复制行动清单自动写入 `organized`。
- 生成报告图后自动修改任何书籍状态。

#### P3 文件影响

优先影响：

- `src/pages/BookAiSummaryPage.tsx`
- `src/pages/BookNotesPage.tsx`
- `src/pages/ReadingRoutePage.tsx`
- `src/pages/BookDecisionPage.tsx`
- `src/pages/ReadingReviewPage.tsx`
- `src/pages/StatisticsPage.tsx`

可选新增：

- `src/lib/reading-artifacts.ts`

不建议影响：

- Rust 导出实现。
- 导出文件格式。
- AI prompt。
- 数据库结构。

首版只统一前端表达，不重写导出链路。

#### P3 测试细化

组件或 E2E 测试：

- 单本复盘页复制行动清单后，toast 明确包含 `行动清单`。
- 单本复盘页导出 Markdown 后，页面显示 `复盘文档` 或 `Markdown` 成果。
- 阅读报告页生成图片后，toast 明确包含 `阅读报告` 或 `长期复盘报告`。
- 缺 AI Provider 时，单本笔记 Markdown 导出仍可用。
- 导出或复制不会自动把书籍标记为 `已整理`。

## 页面影响

### 总览页

重点改造页。

从：

- 多个动作。
- 多个摘要。
- 队列和推荐并列。

改为：

- 一个今日主动作。
- 两个备选动作。
- 一个今日卡片。
- 队列和推荐下沉为辅助信息。

### 书籍详情

保持管理页定位。

补充：

- 当前书是否已复盘。
- 当前书是否已整理。
- 下一步建议来自首页同一套动作解释。

不承载长 AI 内容。

### 笔记页

保持笔记索引和单本笔记入口。

补充：

- 哪本最适合今天整理。
- 为什么适合整理。

不新增浏览模式。

### 单本复盘页

强化完成感。

补充：

- 首选行动。
- 整理状态。
- 完成后的反馈文案。

不扩展成任务管理系统。

### 统计和阅读报告页

继续作为证据页。

只提供能回流到首页的下一步建议，不抢首页主动作。

## 工程拆分

### 1. P0 提取动作解释纯函数

候选文件：

- `src/pages/DashboardPage.tsx`
- 或新增 `src/pages/dashboard-workbench-actions.ts`

建议先新增纯函数文件，降低 `DashboardPage.tsx` 复杂度。

输出：

- `selectPrimaryWorkbenchAction`
- `buildWorkbenchActionReason`
- `buildWorkbenchActionOutcome`
- `classifyWorkbenchEffort`
- `buildDailyWorkbenchActions`

### 2. P0 改造总览 UI

候选文件：

- `src/pages/DashboardPage.tsx`
- `src/styles.css`

输出：

- 主动作卡。
- 备选动作条。
- 今日卡片容器。

### 3. P1 增加今日卡片

候选文件：

- `src/pages/DashboardPage.tsx`
- `src/styles.css`
- 可新增 `src/pages/dashboard-daily-card.ts`

输出：

- `DailyReadingCard`。
- 今日卡片候选排序。
- 空态卡片。

### 4. P2 强化复盘完成感

候选文件：

- `src/pages/BookAiSummaryPage.tsx`
- `src/components/AiActionFeedbackChecklist.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/BookDetailPage.tsx`
- 现有反馈持久化命令和类型。

首版优先使用现有反馈，不急于新增数据库字段。

输出：

- 单本复盘整理状态条。
- 显式 `标记已整理`。
- 总览过滤或降权已整理书籍。

### 5. P3 统一成果表达

候选文件：

- `src/pages/BookAiSummaryPage.tsx`
- `src/pages/BookNotesPage.tsx`
- `src/pages/ReadingRoutePage.tsx`
- `src/pages/BookDecisionPage.tsx`
- `src/pages/ReadingReviewPage.tsx`
- `src/pages/StatisticsPage.tsx`
- 可新增 `src/lib/reading-artifacts.ts`

输出：

- 成果类型文案。
- 复制/导出成功反馈统一。
- 首页 outcome 与目标页面成果文案对齐。

### 6. 增加测试

候选文件：

- `tests/e2e/app-smoke.spec.ts`
- 可新增 `src/pages/dashboard-workbench-actions.test.ts`
- 可新增 `src/pages/dashboard-daily-card.test.ts`

优先写纯函数测试，再补 E2E。

测试顺序：

1. P0 动作解释纯函数。
2. P1 今日卡片纯函数。
3. P2 已整理过滤规则。
4. P0/P1 首页 E2E。
5. P2/P3 关键交付物 E2E。

## 与既有规划的关系

这份文档只负责“每日阅读工作台”体验主线，不替代其他专项规划。

| 文档 | 关系 | 本规划中的处理 |
| --- | --- | --- |
| `product-audit.md` | 上游产品审计 | 继承“行动、决策、交付物”判断，并进一步落到首页每日循环 |
| `reading-management-closure-roadmap.md` | 已完成闭环路线 | 在 P0 已收口基础上继续增强主动作和完成感 |
| `ai-feature-plan.md` | AI 能力边界 | 不扩 AI；只消费已生成 AI 资产和本地缓存 |
| `third-stage-plan.md` | AI 资产连续性 | 不处理版本链；只在后期方向中保留资产详情和归档可能性 |
| `reading-stats-visualization-refactor-plan.md` | 统计和报告专项 | 统计只作为今日动作和今日卡片的证据来源 |
| `book-review-export-plan.md` | 复盘导出专项 | P3 只统一成果表达，不改变导出流程 |
| `github-release-updates.md` | 发布和更新专项 | 本规划不涉及发布链路 |
| `android-release-signing-fix-plan.md` | Android 签名专项 | 本规划不涉及移动打包和签名 |
| `local-reader-*` 系列 | 本地阅读器专项 | 不改变本地阅读器正文、划线、AI 问答和导出逻辑 |

## 范围冲突处理

如果实现过程中和其他规划产生冲突，按以下规则处理：

1. 安全和隐私边界优先于体验增强。
2. 已有发布、签名、更新链路不因本规划改动。
3. AI 调用边界优先于今日卡片内容丰富度。
4. 统计页专项规划优先决定统计页面结构；本规划只决定总览如何引用统计信号。
5. 导出专项优先决定文件内容；本规划只决定用户看到的成果表达。
6. 本地阅读器专项优先决定正文和本地划线体验；本规划不主动读取正文。

需要暂停实现并重新确认的情况：

- P0/P1 需要新增后端命令。
- 今日卡片需要读取单本笔记正文。
- 主动作需要自动调用 AI 才能成立。
- `organized` 无法通过现有命令表达。
- 成果表达统一要求修改导出文件 schema。
- 首页首屏必须牺牲安全边界才能显得更丰富。

## 后期规划方向

以下方向先记录，不进入 P0-P3 的交付范围。后续只有在“每日阅读工作台”主循环稳定后，才按价值、复杂度和数据边界逐项评估。

### 1. 阅读状态时间线

价值类型：

- 行动。
- 可回溯。

目标：

- 让用户看到一本书从候选、开始阅读、产生笔记、生成复盘、完成整理到导出的过程。
- 时间线不是全局动态流，而是服务单本书资产详情。

可能形态：

- 单本书资产详情页展示关键节点。
- 节点包括保存候选、打开详情、同步笔记、生成复盘、标记已整理、导出 Markdown。
- 只记录本地动作，不补写微信读书未提供的阅读事件。

暂不进入当前阶段的原因：

- 需要更稳定的本地事件模型。
- 容易演变成复杂活动流，干扰当前“今日主动作”改造。

触发条件：

- P2 的复盘完成感稳定后，仍需要解释“这本书走到哪一步了”。

### 2. 轻量阅读习惯回路

价值类型：

- 行动。
- 决策。

目标：

- 帮用户识别自己反复出现的阅读行为，例如长书停滞、只收藏不开始、读完不整理、方法论过载。
- 输出只服务下一步动作，不做心理诊断。

可能形态：

- 首页今日卡片展示一个行为提醒。
- 统计页给出“本周期最值得修正的一个阅读习惯”。
- 只展示一个建议，避免变成习惯报告。

暂不进入当前阶段的原因：

- 需要谨慎控制文案，避免伪人格化和过度评价。
- 需要更明确的本地规则阈值。

触发条件：

- 今日卡片已经稳定，且用户仍需要更个人化的提醒。

### 3. 阅读人格二阶段

价值类型：

- 决策。
- 可解释画像。

目标：

- 将已有阅读画像升级为更可解释的阅读风格反馈。
- 只表达阅读偏好和周期状态，不表达真实人格、心理结论或人生建议。

可能形态：

- 首页保留简短人格状态。
- 统计或阅读报告页展示完整维度解释。
- 画像必须能回溯到分类、时长、长读书目和节奏数据。

暂不进入当前阶段的原因：

- 已在 `ai-feature-plan.md` 中有阅读人格 MBTI-like 方向，需要避免和每日工作台抢主线。
- 容易视觉上很吸引人，但实际不一定推动行动。

触发条件：

- 阅读报告的本地规则已经稳定。
- 首页主动作和今日卡片已经形成稳定使用循环。

### 4. 输出物模板体系

价值类型：

- 交付物。

目标：

- 把复盘、指南、选书决策、统计报告和分享卡片沉淀成稳定模板。
- 让用户能快速产出周报、书评草稿、行动清单或分享素材。

可能形态：

- 复盘 Markdown 模板。
- 阅读周报模板。
- 单书复盘卡片模板。
- 候选书决策摘要模板。
- 写作提纲模板。

暂不进入当前阶段的原因：

- 当前应先证明用户愿意每天完成一个轻量成果。
- 模板体系过早抽象会增加维护成本。

触发条件：

- P3 输出物收口完成后，导出和复制路径仍显得分散。

### 5. 本地阅读资产详情页

价值类型：

- 可回溯。
- 决策。

目标：

- 将一本书在本应用里的状态聚合成资产详情，而不是只展示微信读书详情。
- 重点回答这本书是否值得继续读、是否值得复盘、是否已经整理、有哪些输出物。

可能形态：

- 详情页新增本地资产区。
- 聚合笔记、复盘、阅读指南、导出记录、候选状态和整理状态。
- 长 AI 内容仍跳转到独立页面。

暂不进入当前阶段的原因：

- 需要先完成首页动作解释，否则资产详情会继续像信息堆叠。

触发条件：

- 首页主动作需要更强的单本书落地页承接。

### 6. 候选书决策升级

价值类型：

- 决策。

目标：

- 让候选书架从“保存候选”升级成“管理下一本书取舍”。
- 继续只处理本地候选，不做泛推荐。

可能形态：

- 候选按阅读目标分组。
- 决策结果展示“现在读 / 暂缓 / 删除候选”的建议。
- 支持从当前书阅读指南进入候选书比较。

暂不进入当前阶段的原因：

- 当前优先级应放在首页每日动作，而不是候选管理深化。
- 删除候选和暂缓候选涉及更明确的本地状态语义。

触发条件：

- 用户已经开始持续保存候选，但候选堆积导致选书困难。

### 7. 阅读复盘轻量归档

价值类型：

- 交付物。
- 可回溯。

目标：

- 让用户完成复盘后能把结果归档为一份稳定资产。
- 区分“已生成复盘”和“我已经整理吸收过”。

可能形态：

- 显式 `标记已整理`。
- 归档时记录整理时间、采用的行动项数量和是否已导出。
- 总览不再优先提醒已整理书籍。

暂不进入当前阶段的原因：

- 需要谨慎避免变成任务管理系统。
- 首版可以先通过反馈记录和文案表达完成感。

触发条件：

- P2 中用户明确需要区分“生成过”和“整理过”。

### 8. 发布后真实使用复盘

价值类型：

- 产品验证。

目标：

- 在正式发布或自用一段时间后，回看哪些动作真正被使用。
- 用真实行为修正主动作排序，而不是继续凭主观判断扩展功能。

可能形态：

- 本地匿名关闭的使用审计清单，不上传。
- 手动检查最近完成的动作、导出、复盘和候选决策。
- 形成下一轮产品审计文档。

暂不进入当前阶段的原因：

- 需要先有稳定的每日工作台体验。
- 不应提前引入埋点和使用分析复杂度。

触发条件：

- P0-P1 完成并连续自用一到两周。

## 后期方向优先级建议

优先级按“是否增强每日主循环”排序：

1. 阅读复盘轻量归档。
2. 本地阅读资产详情页。
3. 输出物模板体系。
4. 轻量阅读习惯回路。
5. 候选书决策升级。
6. 阅读状态时间线。
7. 阅读人格二阶段。
8. 发布后真实使用复盘。

这个顺序不是固定排期。每一项进入开发前，都需要重新确认它是否能服务“今天读什么、今天整理什么、今天带走什么”。

## 阶段交付计划

### PR-1：P0 动作模型与纯函数

目标：

- 只新增动作解释模型和纯函数。
- 不改页面结构。
- 不改样式。

交付内容：

- `DailyWorkbenchAction`。
- `buildDailyWorkbenchActions`。
- 主动作和备选动作选择逻辑。
- 动作标题到 `source / effort / reason / outcome` 的保守映射。
- 纯函数测试。

验收标准：

- `buildTodayActions` 的原有行为不变。
- 未识别动作能回退到原 description。
- 不新增后端命令。
- 不修改数据库结构。

回滚成本：

- 低。删除新增纯函数和测试即可。

#### PR-1 接口草图

建议先让 `TodayAction` 保持在 `DashboardPage.tsx` 内部，再按需要把类型迁出。若迁出会扩大改动，首版可以在新文件中定义一个结构兼容的输入类型。

```ts
export type WorkbenchActionInput = {
  title: string;
  description: string;
  tone: "green" | "blue" | "gold" | "muted";
  onClick?: () => void;
};

export type DailyWorkbenchAction = WorkbenchActionInput & {
  verb: string;
  reason: string;
  outcome: string;
  effort: "light" | "deep" | "setup";
  source: "credential" | "shelf" | "notes" | "review" | "route" | "decision" | "stats" | "candidate";
};

export type DailyWorkbenchActions = {
  primaryAction?: DailyWorkbenchAction;
  secondaryActions: DailyWorkbenchAction[];
};
```

建议纯函数：

```ts
export function buildDailyWorkbenchActions(actions: WorkbenchActionInput[]): DailyWorkbenchActions {
  const mapped = actions.map(mapWorkbenchAction);

  return {
    primaryAction: mapped[0],
    secondaryActions: mapped.slice(1, 3)
  };
}
```

映射函数应保持顺序敏感：

- 不重新排序。
- 不重新去重。
- 不改变原 `onClick`。
- 不吞掉原 `tone`。
- 不要求 title 完全等于某个字符串，优先用 `startsWith` 或包含特征做保守判断。

回退策略：

```ts
function fallbackAction(action: WorkbenchActionInput): DailyWorkbenchAction {
  return {
    ...action,
    verb: "继续处理",
    reason: action.description,
    outcome: "回到对应页面继续处理",
    effort: "light",
    source: "shelf"
  };
}
```

PR-1 不需要让 UI 消费这些函数；只要测试证明映射正确即可。

### PR-2：P0 总览首屏改造

目标：

- 将 `今日可做` 首屏表现改为 `今日最值得做` 主卡。
- 保留最多两个备选动作。
- 原队列、画像和推荐下沉为辅助信息。

交付内容：

- 总览主卡 UI。
- 备选动作条。
- 响应式样式。
- 首页 E2E 覆盖。

验收标准：

- 首屏只出现一个主动作。
- 主卡包含原因和结果。
- 无凭据、无缓存、无 AI Provider 时有明确主路径。
- 980px 以下不出现文字重叠或横向溢出。

回滚成本：

- 中。保留 PR-1 纯函数，恢复原 `todayActions` 列表渲染即可。

#### PR-2 UI 草图

`DashboardPage` 中建议新增派生数据：

```ts
const workbenchActions = useMemo(
  () => buildDailyWorkbenchActions(todayActions),
  [todayActions]
);

const primaryAction = workbenchActions.primaryAction;
const secondaryActions = workbenchActions.secondaryActions;
```

渲染结构建议：

```tsx
<article className="daily-workbench-panel" aria-label="今日阅读工作台">
  <div className="daily-workbench-heading">
    <p className="section-kicker">今日阅读工作台</p>
    <h3>今日最值得做</h3>
  </div>

  {primaryAction ? (
    <button className={`daily-workbench-primary is-${primaryAction.tone}`} type="button" onClick={primaryAction.onClick}>
      <span>{primaryAction.verb}</span>
      <strong>{primaryAction.title}</strong>
      <small>为什么现在做：{primaryAction.reason}</small>
      <small>完成后得到：{primaryAction.outcome}</small>
    </button>
  ) : null}

  {secondaryActions.length > 0 ? (
    <div className="daily-workbench-secondary" aria-label="备选动作">
      {secondaryActions.map((action) => (
        <button type="button" onClick={action.onClick}>
          <span>{action.effort === "deep" ? "深度 30 分钟" : "轻量 5 分钟"}</span>
          <strong>{action.title}</strong>
        </button>
      ))}
    </div>
  ) : null}
</article>
```

实际实现时可以拆组件，但首版不建议抽太多层。优先保持可读和可回滚。

#### PR-2 样式约束

建议类名：

- `daily-workbench-panel`
- `daily-workbench-heading`
- `daily-workbench-primary`
- `daily-workbench-secondary`
- `daily-workbench-secondary-item`

布局规则：

- 桌面端主卡至少占据工作台区域的主要宽度。
- 备选动作横向排列，但每个按钮有稳定最小宽度。
- 980px 以下备选动作纵向排列。
- 主卡内部 reason 和 outcome 允许换行。
- 不设置会截断 reason/outcome 的固定高度。
- 按钮 hover 不应改变布局尺寸。

视觉规则：

- 主卡可以用更明显的背景和边框。
- 备选动作使用轻量按钮或小卡，不能抢主卡。
- 不新增大幅插画。
- 不用阅读人格插图作为主卡背景。

#### PR-2 迁移策略

原 `today-actions-panel` 不建议立即删除。首版可以：

- 将原列表移动到工作台下方。
- 或保留为隐藏/辅助模块，方便回滚。
- E2E 更新后再删除旧断言。

如果首屏过于拥挤，优先下沉：

1. 原 `今日可做` 列表。
2. 推荐书籍。
3. 最近内容。
4. 阅读人格详细维度。

不要下沉：

- 凭据/同步错误提示。
- 主动作。
- 关键空态主路径。

### PR-3：P1 今日卡片

目标：

- 增加无需 AI 的每日轻量反馈。
- 只使用总览已有本地数据。

交付内容：

- `DailyReadingCard`。
- 卡片候选排序。
- 空态卡片。
- 今日卡片 UI。
- 纯函数测试和必要 E2E。

验收标准：

- 今日卡片展示来源。
- 点击能进入对应页面。
- 数据不足时不展示伪结论。
- 不读取单本笔记正文。
- 不调用 AI。

回滚成本：

- 低到中。移除卡片 UI 和纯函数即可，不影响 P0。

#### PR-3 接口草图

```ts
export type DailyReadingCardTone = "stats" | "decision" | "review" | "book" | "candidate" | "persona" | "empty";

export type DailyReadingCard = {
  title: string;
  body: string;
  sourceLabel: string;
  actionLabel: string;
  tone: DailyReadingCardTone;
};

export type DailyReadingCardInput = {
  reviewActions: string[];
  topDecisionTitle?: string;
  reviewItemTitle?: string;
  reviewItemMeta?: string;
  recentBookTitle?: string;
  candidateTitle?: string;
  personaSnapshot?: string;
  hasCredential: boolean;
  hasShelfData: boolean;
};
```

首版建议只让纯函数返回文案，不返回 `onClick`。跳转动作可在 `DashboardPage` 中根据 `tone` 绑定，避免把页面回调塞进纯函数测试。

```ts
export function buildDailyReadingCard(input: DailyReadingCardInput): DailyReadingCard {
  if (!input.hasCredential) {
    return emptyCard("先连接微信读书", "连接后可以同步书架、笔记和统计。", "凭据状态", "打开设置");
  }

  if (!input.hasShelfData) {
    return emptyCard("先同步书架缓存", "本地还没有可用于整理的阅读资产。", "书架缓存", "去书架同步");
  }

  // 继续按统计建议、选书决策、待复盘、最近阅读、候选、画像降级。
}
```

#### PR-3 UI 草图

```tsx
<article className={`daily-reading-card is-${dailyCard.tone}`} aria-label="今日卡片">
  <div>
    <p className="section-kicker">今日卡片</p>
    <h3>{dailyCard.title}</h3>
    <p>{dailyCard.body}</p>
  </div>
  <footer>
    <span>{dailyCard.sourceLabel}</span>
    <button type="button" onClick={handleDailyCardClick}>
      {dailyCard.actionLabel}
    </button>
  </footer>
</article>
```

跳转建议：

- `stats`：打开阅读报告。
- `decision`：打开选书决策。
- `review`：打开对应书籍复盘或复盘中心。
- `book`：打开最近书籍详情。
- `candidate`：打开候选书或候选书架。
- `persona`：打开统计页。
- `empty`：按空态类型打开设置、书架或笔记。

首版如果某些 tone 无法精确跳转，允许回退到对应中心页，不阻塞 PR-3。

#### PR-3 迁移策略

- 今日卡片放在主卡和队列之间。
- 不替换阅读人格卡。
- 不替换推荐区。
- 如果页面过长，优先将推荐区继续下沉。

### PR-4：P2 复盘完成感

目标：

- 单本复盘页区分 `已生成` 和 `已整理`。
- 显式使用 `organized` 状态表达整理完成。

交付内容：

- 单本复盘整理状态条。
- `标记已整理` 操作入口。
- 总览过滤或降权已整理书籍。
- 相关测试。

验收标准：

- 生成、复制、导出都不会自动标记已整理。
- 只有用户显式点击才进入 `organized`。
- 已整理书籍不再作为总览复盘主动作。
- 不写回微信读书远端。

回滚成本：

- 中。需要移除整理状态入口，并恢复总览待复盘规则。

#### PR-4 状态流

```text
无复盘
  -> 生成或读取复盘

已生成复盘
  -> 用户查看/复制/导出/反馈
  -> 仍然是已生成复盘，不自动整理

用户点击标记已整理
  -> upsert reading item state: organized
  -> 总览降低或移除待复盘提醒
```

#### PR-4 UI 草图

```tsx
<section className="review-completion-strip" aria-label="复盘整理状态">
  <div>
    <p className="section-kicker">整理状态</p>
    <h4>{isOrganized ? "已整理" : "待整理"}</h4>
    <p>{isOrganized ? "这本书已完成沉淀。" : "这份复盘已经生成，确认吸收后可以标记已整理。"}</p>
  </div>
  {!isOrganized ? (
    <button type="button" onClick={handleMarkOrganized}>
      标记已整理
    </button>
  ) : null}
</section>
```

如果没有复盘结果：

- 不展示 `标记已整理`。
- 展示 `先生成复盘` 或保留现有生成入口。

#### PR-4 总览规则草图

建议在构建 `reviewItems` 或进入 `buildTodayActions` 前处理：

```ts
const organizedBookIds = new Set(
  readingStates.filter((state) => state.status === "organized").map((state) => state.itemId)
);

const actionableReviewItems = reviewItems.filter((item) => !organizedBookIds.has(item.id));
```

如果当前 `DashboardQueueItem.id` 和 `ReadingItemState.itemId` 不完全一致，需要先统一比较 key，避免误过滤。

#### PR-4 迁移策略

- 先只在单本复盘页展示整理状态。
- 再让总览过滤已整理书籍。
- 最后再考虑书籍详情页更明显展示整理状态。

不要一次性把复盘中心、书籍详情和总览全部大改。

### PR-5：P3 成果表达统一

目标：

- 统一复制和导出的成果名称、成功反馈和首页 outcome 文案。
- 不重写导出链路。

交付内容：

- 成果类型文案。
- 复制/导出 toast 文案统一。
- 页面内成功提示文案统一。
- 关键路径 E2E。

验收标准：

- 用户能看懂自己得到的是哪类成果。
- 非 AI 交付物不受 AI Provider 缺失影响。
- 导出和复制不包含敏感数据。
- 导出/复制不会自动标记已整理。

回滚成本：

- 低。主要是文案和轻量前端常量。

#### PR-5 接口草图

```ts
export type ReadingArtifactKind =
  | "notes-markdown"
  | "note-card-image"
  | "book-review-markdown"
  | "action-checklist"
  | "reflection-questions"
  | "reading-route-markdown"
  | "book-decision-markdown"
  | "period-report-image"
  | "lifetime-report-image";

export const readingArtifactLabels: Record<ReadingArtifactKind, string> = {
  "notes-markdown": "笔记归档",
  "note-card-image": "摘录卡片",
  "book-review-markdown": "复盘文档",
  "action-checklist": "行动清单",
  "reflection-questions": "复盘问题",
  "reading-route-markdown": "阅读处方",
  "book-decision-markdown": "下一本书决策",
  "period-report-image": "周期阅读报告",
  "lifetime-report-image": "长期复盘报告"
};
```

可选辅助函数：

```ts
export function formatArtifactCreatedMessage(kind: ReadingArtifactKind): string {
  return `已生成：${readingArtifactLabels[kind]}`;
}

export function formatArtifactCopiedMessage(kind: ReadingArtifactKind): string {
  return `已复制：${readingArtifactLabels[kind]}`;
}
```

#### PR-5 迁移策略

- 先改 toast 文案。
- 再改页面内成功状态。
- 最后让首页 outcome 引用同一套 label。

不要改：

- 导出函数签名。
- 导出文件名。
- Markdown 内容结构。
- 图片生成逻辑。

#### PR-5 实施记录

已落地：

- 新增 `src/lib/reading-artifacts.ts`，集中维护阅读成果类型、展示名称和成功反馈文案。
- 总览主动作 outcome 复用同一套成果名称，例如 `行动清单`、`复盘问题`、`复盘文档`、`阅读处方`、`下一本书决策`。
- 单本 AI 复盘页统一复制和导出反馈：
  - 复制完整复盘：`已复制：复盘文档`。
  - 复制行动清单：`已复制：行动清单`。
  - 复制复盘问题：`已复制：复盘问题`。
  - 导出 Markdown：`已导出：复盘文档`。
- 单本笔记页统一笔记归档和摘录卡片反馈：
  - 导出 Markdown：`已导出：笔记归档`。
  - 导出单张或组合分享图片：`已生成：摘录卡片`。
- 阅读指南、选书决策、阅读报告相关导出使用统一成果名称：
  - 阅读指南：`阅读处方`。
  - 选书决策：`下一本书决策`。
  - 周期报告：`周期阅读报告`。
  - 长期报告：`长期复盘报告`。
- 关键 E2E 已覆盖复制、导出不会自动标记 `organized`。

保持不做：

- 不改 Rust 导出命令。
- 不改导出文件名。
- 不改 Markdown 或图片内容结构。
- 不新增导出记录表。
- 不把复制或导出自动视为 `已整理`。

已验证：

```powershell
npm test -- --run "src/lib/reading-artifacts.test.ts" "src/pages/dashboard-workbench-actions.test.ts" "src/pages/PreparedAssetUpdatePrompt.test.tsx"
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "单本复盘只有显式点击才标记已整理并从总览复盘动作移除"
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "桌面端主流程可导航并使用本地命令 mock 数据"
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "选书决策命中本地缓存时直接展示结果"
npm test
npm run build
```

### 后续切片：总览本地进展摘要

目标：

- 在 P0-P3 收口后，让首页不只告诉用户“今天做什么”，也能看到本地阅读资产已经推进到哪里。
- 只使用总览已有本地状态，不新增后端命令、不新增导出记录表、不写入任何新状态。

已落地：

- 新增 `src/pages/dashboard-local-progress.ts`，把本地进展摘要抽成纯函数。
- 总览新增 `本地进展` 面板，展示：
  - 已整理书籍数。
  - 待复盘书籍数。
  - 本地候选数。
  - 已同步笔记书数。
- 高亮信号优先级：
  - 最近已整理书籍。
  - 本地标记待复盘书籍。
  - 笔记概览里的可复盘队列。
  - 最近候选书。
  - 笔记样本。
  - 明确空态。
- 面板放在 `今日卡片` 后面，不抢 `今日阅读工作台` 的首屏主动作位置。
- 窄屏下自动单列，指标区保持两列，避免横向溢出。

保持不做：

- 不记录复制/导出流水。
- 不新增时间线事件模型。
- 不把笔记候选自动写成 `reviewing`。
- 不改变 `organized` 的显式触发规则。

已验证：

```powershell
npm test -- --run "src/pages/dashboard-local-progress.test.ts" "src/pages/DashboardPage.test.tsx"
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "总览今日卡片展示本地来源并可跳转" --timeout=60000
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "总览今日卡片空态只给明确同步路径" --timeout=60000
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "总览今日卡片在窄屏下保持单列且不溢出" --timeout=60000
npm test
npm run build
```

### 后续切片：单本资产状态

目标：

- 让单本详情页不只提供动作按钮，也解释这本书当前处在本地阅读资产流程的哪一步。
- 把微信进度、本地整理状态和候选状态整合成一个只读状态卡，帮助用户判断下一步该查看笔记、做 AI 复盘、规划阅读指南，还是先加入候选。
- 复用现有前端状态和按钮，不新增后端命令、不新增持久化模型。

已落地：

- 新增 `src/pages/book-asset-status.ts`，把单本资产状态判断抽成纯函数。
- `BookDetailPage` 的 `本书管理` 区新增 `本书资产状态` 卡片，展示：
  - 当前状态：`已整理`、`待复盘`、`本地候选`、`已读完`、`阅读中`、`未开始`。
  - 当前微信进度。
  - 建议动作。
  - 简短原因。
- 状态优先级：
  - 显式 `organized`。
  - 显式 `reviewing`。
  - 本地候选 `candidate/toRead`。
  - 微信进度已读完。
  - 微信进度已开始。
  - 未开始。
- 建议动作只指向页面已有能力，不在状态卡上新增独立点击行为。
- 窄屏下状态卡自动单列，避免与整理状态按钮和动作网格互相挤压。

保持不做：

- 不新增资产时间线或导出流水。
- 不把复制、导出、生成自动写成 `organized`。
- 不合并微信读书版本和本地书库版本。
- 不改变 `待复盘`、`已整理`、`加入候选` 的写入规则。

已验证：

```powershell
npm test -- --run "src/pages/book-asset-status.test.ts" "src/pages/BookDetailPage.test.tsx"
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "桌面端主流程可导航并使用本地命令 mock 数据" --timeout=60000
npm run build
```

### 后续切片：单本笔记复盘输入状态

目标：

- 让单本笔记页不只展示划线和想法，也告诉用户这本笔记是否已经适合进入复盘。
- 用已有笔记统计解释“现在能得到什么”，承接总览和书籍详情页的复盘动作。
- 只消费已加载的单本笔记数据，不新增后端命令、不新增 AI 调用、不写本地状态。

已落地：

- 新增 `src/pages/book-notes-review-status.ts`，把复盘输入判断抽成纯函数。
- 单本笔记页在统计区后新增 `复盘输入状态` 卡片，展示：
  - 当前状态：`适合复盘`、`可先整理`、`待积累`。
  - 关键输入指标。
  - 建议动作。
  - 简短原因。
- 判断规则：
  - 同时有划线和想法时，提示 `适合复盘`，建议进入 `AI 复盘`。
  - 只有部分材料或可导出内容时，提示 `可先整理`，建议先查看章节。
  - 没有可用材料时，提示 `待积累`，建议继续阅读。
- 窄屏下自动单列，避免与章节/卡片视图工具互相挤压。

保持不做：

- 不读取额外笔记正文。
- 不自动生成 AI 复盘。
- 不把进入笔记页、导出笔记或查看卡片写成 `reviewing` / `organized`。
- 不改变单本笔记导出、分享图片或 AI 复盘入口行为。

已验证：

```powershell
npm test -- --run "src/pages/book-notes-review-status.test.ts"
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "桌面端主流程可导航并使用本地命令 mock 数据" --timeout=60000
npm run build
```

### 后续切片：复盘中心资产概览

目标：

- 让复盘中心的书籍复盘页不只列出“已生成”和“建议生成”，也能在顶部说明当前复盘资产整体推进到哪一步。
- 用已有复盘缓存和候选书列表解释“下一步先处理哪本”，承接总览、单本详情页和单本笔记页的复盘动机。
- 只消费页面已加载的 `summaryItems` 和 `reviewCandidates`，不新增后端命令、不自动调用 AI、不写入整理状态。

已落地：

- 新增 `src/pages/book-review-asset-overview.ts`，把复盘资产概览判断抽成纯函数。
- 书籍复盘页新增 `复盘资产进度` 面板，展示：
  - 当前状态：`复盘进行中`、`复盘已沉淀`、`待建立资产`。
  - 关键指标：已生成、待整理、有反馈。
  - 最近更新时间。
  - 下一步建议：优先生成候选书、回看已生成复盘，或先去笔记中心积累输入。
- `复盘资产下一步` 新增行动按钮，但只复用现有页面入口：
  - 有候选书时进入对应单本 AI 复盘页，生成仍需用户手动确认。
  - 没有候选但已有复盘时进入优先回看的已生成复盘。
  - 没有复盘也没有候选时进入笔记中心。
- 下一步优先候选直接复用现有 `getReviewCandidates` 排序结果，不复制候选排序逻辑。
- 移除书籍复盘页下方重复的 `书籍复盘状态` 状态条，避免 `已生成`、`待整理`、`有反馈` 两处重复展示。
- 窄屏下概览自动单列，指标区在更窄屏幕下也切成单列，避免横向溢出。

保持不做：

- 不新增复盘中心任务系统。
- 不自动生成候选书复盘。
- 不把查看、导出或进入详情写成 `organized`。
- 不改变复盘导出弹窗、已生成复盘列表、建议生成列表的交互边界。

已验证：

```powershell
npm test -- --run "src/pages/book-review-asset-overview.test.ts"
npm test -- --run "src/pages/ReadingHubPage.test.tsx"
./node_modules/.bin/playwright.cmd test "tests/e2e/app-smoke.spec.ts" -g "桌面端主流程可导航并使用本地命令 mock 数据" --timeout=60000
npm run build
```

## 开工前检查清单

### 代码状态

- 确认当前工作区未混入无关改动。
- 若工作区已有发布、Android、签名或 Tauri 配置改动，本次实现不触碰这些文件。
- 先阅读 `DashboardPage.tsx` 当前最新状态，确认 `buildTodayActions`、阅读人格模块和队列模块没有新的结构变化。
- 先阅读 `BookAiSummaryPage.tsx` 和 `BookDetailPage.tsx`，确认 `organized` 更新路径是否已经可从前端调用。

### 数据边界

- P0/P1 不新增 Tauri 命令。
- P0/P1 不读取单本笔记正文。
- P0/P1 不调用 AI。
- P2 优先复用 `upsert_reading_item_state`。
- P3 不修改导出文件格式。

### UI 边界

- 首页首屏只保留一个主动作。
- 备选动作最多两个。
- 今日卡片只能有一个主入口。
- 阅读人格不作为主动作。
- 队列和推荐不抢首屏主卡。

### 测试边界

- 纯函数优先。
- E2E 只覆盖关键路径，不为每种文案写脆弱断言。
- 对文案断言优先使用稳定标题，例如 `今日最值得做`、`今日卡片`、`标记已整理`。
- 对响应式只检查无横向溢出、主卡可见和按钮不重叠。

## 阶段验收矩阵

| 阶段 | 用户价值 | 主要文件 | 必测项 | 不应触碰 |
| --- | --- | --- | --- | --- |
| P0 函数 | 主动作可解释 | `dashboard-workbench-actions.ts` | 动作映射、回退、主/备选选择 | 后端、样式 |
| P0 UI | 首屏知道做什么 | `DashboardPage.tsx`、`styles.css` | 主卡、备选动作、空态 | AI、数据库 |
| P1 | 每天看一眼 | `dashboard-daily-card.ts`、`DashboardPage.tsx` | 来源、跳转、空态 | 单本笔记正文、AI |
| P2 | 读过推进到已整理 | `BookAiSummaryPage.tsx`、`DashboardPage.tsx` | 显式标记、总览过滤 | 自动整理、远端写回 |
| P3 | 带走一个成果 | 多个页面文案 | 成果名称、复制/导出反馈 | 导出链路、文件格式 |

## 文件级任务拆解

### P0 函数层

新增候选文件：

- `src/pages/dashboard-workbench-actions.ts`
- `src/pages/dashboard-workbench-actions.test.ts`

职责：

- 接收现有 `TodayAction[]`。
- 生成 `DailyWorkbenchAction[]`。
- 选择 `primaryAction` 和最多两个 `secondaryActions`。
- 根据标题和 description 做保守映射。
- 不引入 React 组件和 DOM。

不放入该文件：

- JSX。
- 样式类名。
- Tauri 调用。
- localStorage。
- AI 或笔记正文读取。

### P0 UI 层

修改候选文件：

- `src/pages/DashboardPage.tsx`
- `src/styles.css`
- `tests/e2e/app-smoke.spec.ts`

职责：

- 使用 `buildDailyWorkbenchActions(todayActions)`。
- 渲染 `今日最值得做` 主卡。
- 渲染最多两个备选动作。
- 保留原队列和画像模块，但降低视觉优先级。
- 增加首页 E2E。

不做：

- 改动 `buildTodayActions` 的排序语义。
- 改动阅读人格计算。
- 改动推荐请求。
- 改动统计缓存读取。

### P1 今日卡片

新增候选文件：

- `src/pages/dashboard-daily-card.ts`
- `src/pages/dashboard-daily-card.test.ts`

修改候选文件：

- `src/pages/DashboardPage.tsx`
- `src/styles.css`
- `tests/e2e/app-smoke.spec.ts`

职责：

- 接收总览已有数据快照。
- 生成最多一个 `DailyReadingCard`。
- 提供来源、正文、按钮文案和跳转动作。
- 保守处理空态。

不做：

- 读取单本笔记正文。
- 新增 Tauri 命令。
- 调用 AI。
- 从远端刷新推荐。

### P2 复盘完成感

修改候选文件：

- `src/pages/BookAiSummaryPage.tsx`
- `src/pages/BookDetailPage.tsx`
- `src/pages/DashboardPage.tsx`
- `tests/e2e/app-smoke.spec.ts`

可能修改：

- `src/lib/reading-api.ts`
- `src/lib/types.ts`

职责：

- 显示当前复盘整理状态。
- 提供显式 `标记已整理`。
- 使用现有本地状态能力写入 `organized`。
- 总览构建动作时过滤或降权已整理书籍。

不做：

- 复制、导出或生成后自动整理。
- 新增任务表。
- 写回微信读书远端。

### P3 成果表达

新增候选文件：

- `src/lib/reading-artifacts.ts`

修改候选文件：

- `src/pages/BookAiSummaryPage.tsx`
- `src/pages/BookNotesPage.tsx`
- `src/pages/ReadingRoutePage.tsx`
- `src/pages/BookDecisionPage.tsx`
- `src/pages/ReadingReviewPage.tsx`
- `src/pages/StatisticsPage.tsx`

职责：

- 统一成果名称。
- 统一复制和导出成功反馈。
- 让首页 outcome 和目标页成果一致。

不做：

- 改 Rust 导出逻辑。
- 改 Markdown 格式。
- 改图片生成逻辑。
- 新增导出记录表。

## 验证命令

每个阶段建议按风险递增运行：

### PR-1

```powershell
npm test -- --run src/pages/dashboard-workbench-actions.test.ts
npm test
npm run build
```

### PR-2

```powershell
npm test -- --run src/pages/dashboard-workbench-actions.test.ts
npm run build
npm run e2e -- tests/e2e/app-smoke.spec.ts
```

### PR-3

```powershell
npm test -- --run src/pages/dashboard-daily-card.test.ts
npm test -- --run src/pages/dashboard-workbench-actions.test.ts
npm run build
npm run e2e -- tests/e2e/app-smoke.spec.ts
```

### PR-4

```powershell
npm test
npm run build
npm run e2e -- tests/e2e/app-smoke.spec.ts
```

### PR-5

```powershell
npm test
npm run build
npm run e2e -- tests/e2e/app-smoke.spec.ts
```

如果只改文案和纯前端展示，优先跑 `npm test` 和 `npm run build`。涉及总览首屏、响应式或复制/导出反馈时，再跑 E2E。

Rust 验证只有在改到 `src-tauri` 时才需要：

```powershell
cargo fmt --check --manifest-path "src-tauri/Cargo.toml"
cargo test --manifest-path "src-tauri/Cargo.toml"
cargo check --manifest-path "src-tauri/Cargo.toml"
```

当前规划下，P0/P1/P3 不应该需要 Rust 验证。

## 测试夹具与 E2E 场景

现有 `tests/e2e/app-smoke.spec.ts` 已经通过 `installTauriMock` 覆盖大量总览场景。实现时优先复用已有 mock 开关，不新增重复夹具。

### 已有可复用 mock 开关

| 场景 | 现有开关 | 用途 |
| --- | --- | --- |
| 无微信读书凭据 | `{ hasCredential: false }` | 验证主卡引导设置 |
| AI Provider 未配置 | `{ hasAiCredential: false }` | 验证主卡引导配置 AI |
| 同一本书重复动作 | `{ duplicateDashboardActions: true }` | 验证主动作去重后仍只选一个 |
| 长统计建议 | `{ longStatsAction: true }` | 验证主卡/备选动作长文本不撑破布局 |
| 无候选书 | `{ emptyCandidateStates: true }` | 验证主卡或卡片引导发现页 |
| 无复盘信号 | `{ emptyReviewSignals: true }` | 验证主卡引导笔记中心 |
| 已缓存选书决策 | `{ cachedBookDecision: true }` | 验证决策动作和今日卡片 |
| 无最近阅读 | `{ noRecentReadingEntries: true }` | 验证阅读指南入口 |
| 空数据 | `{ emptyData: true }` | 验证同步书架缓存空态 |

### P0 建议 E2E

测试名建议：

```text
总览以今日最值得做主卡承接最高优先级动作
总览主卡在无凭据时只引导设置
总览主卡在空书架时引导同步书架缓存
总览主卡和备选动作在窄屏下不水平溢出
```

断言建议：

- `page.getByLabel("今日阅读工作台")` 可见。
- 包含 `今日最值得做`。
- 主卡只包含一个主要按钮。
- 备选动作数量不超过 2。
- 旧 `今日可做` 如果保留，下沉后不应抢首屏断言。

避免：

- 对完整长文案做精确匹配。
- 依赖卡片 CSS 顺序做脆弱断言。

### P1 建议 E2E

测试名建议：

```text
总览今日卡片展示来源并跳转到对应页面
总览今日卡片在空数据时不展示伪结论
总览今日卡片优先使用已生成统计建议
```

断言建议：

- `page.getByLabel("今日卡片")` 可见。
- 卡片包含 `来源` 或具体来源标签。
- 点击按钮后进入对应页面。
- `get_book_notes` 调用次数不因今日卡片增加。
- `summarize_*` 调用次数不因今日卡片增加。

### P2 建议 E2E

测试名建议：

```text
单本复盘页显式标记已整理后总览不再优先提醒
复制行动清单不会自动标记已整理
导出复盘 Markdown 不会自动标记已整理
```

断言建议：

- 单本复盘页出现 `整理状态`。
- 生成或缓存复盘后出现 `标记已整理`。
- 点击后出现 `已整理`。
- 返回总览后同一本书不再作为主复盘动作。

需要确认：

- `installTauriMock` 中 `upsert_reading_item_state` 是否已经能保存 `organized`。
- 如果已有，P2 不新增 mock 命令。

### P3 建议 E2E

测试名建议：

```text
单本复盘复制行动清单使用统一成果文案
单本复盘导出 Markdown 使用统一成果文案
阅读报告图片导出使用统一成果文案
```

断言建议：

- toast 或成功提示包含 `行动清单`、`复盘文档`、`阅读报告` 等稳定成果名。
- 不断言完整路径。
- 不断言文件系统真实写入。

## 视觉 QA 清单

P0/P1 属于首页首屏结构改造，完成后必须做视觉检查。优先使用 Browser 或 Playwright 打开本地页面，不只依赖单元测试。

### 视口

建议至少检查：

- 桌面宽屏：`1660 x 760`
- 默认桌面：`1280 x 800`
- 窄屏：`390 x 844`
- 小高度桌面：`1280 x 640`

### P0 必查

- `今日阅读工作台` 在首屏可见。
- `今日最值得做` 主卡视觉权重大于备选动作。
- 主卡只有一个主要按钮。
- `为什么现在做` 和 `完成后得到` 不被截断。
- 长书名不会撑破主卡。
- 长统计建议不会挤压按钮。
- 备选动作最多两条。
- 旧 `今日可做` 如果保留，不能比主卡更显眼。
- 阅读人格卡不抢主卡层级。

### P1 必查

- 今日卡片显示来源。
- 今日卡片正文不超过两句的视觉密度。
- 今日卡片按钮不溢出。
- 空态卡片不显得像伪鸡汤。
- 今日卡片和主卡之间有明确层级差异。

### P2 必查

- 单本复盘页 `整理状态` 不挤占复盘内容主标题。
- `标记已整理` 是明确动作，但不比 `生成复盘` 更早抢占注意力。
- 已整理状态能被用户看见，但不会变成大面积成功横幅。

### P3 必查

- toast 或页面成功提示能看出成果名称。
- 文件路径较长时不撑破容器。
- 复制成功和导出成功的视觉反馈一致但不混淆。

### 视觉失败判定

出现以下任一情况，应回到样式或布局调整：

- 首屏同时出现三个以上同等权重的大卡。
- 主按钮文字换行后按钮高度异常。
- 主卡 reason/outcome 被 ellipsis 截断。
- 窄屏出现横向滚动。
- 今日卡片比主动作更显眼。
- 阅读人格插图成为首屏视觉中心。
- 长路径或长书名撑破容器。

## 决策记录

### 决策 1：先改总览，不先扩 AI

结论：

- 先把已有动作重组为每日工作台。
- 不新增 AI 能力。

原因：

- 当前问题是主循环不够强，不是 AI 输出不够多。
- 新 AI 能力会增加数据边界、提示词和缓存复杂度。

影响：

- P0/P1 不调用 AI。
- 今日卡片只用本地已有数据。

### 决策 2：今日卡片首版不展示原文划线

结论：

- 首版不做 `今日一句划线`。

原因：

- 总览目前没有单本笔记正文。
- 为了一句划线自动读取笔记正文，会破坏“不后台读取”的边界。

影响：

- 今日卡片可以展示笔记数量、复盘问题、统计建议、候选决策。
- 后续如果有轻量笔记摘要缓存，再评估加入划线卡片。

### 决策 3：已整理必须由用户显式触发

结论：

- `organized` 只能由用户点击 `标记已整理` 触发。

原因：

- 生成、复制和导出只能说明产物出现，不能说明用户已经吸收。
- 自动整理会制造错误的完成感。

影响：

- P2 不把复制、导出、生成绑定到整理状态。
- 总览可以过滤或降权 `organized`，但不能自动写入。

### 决策 4：阅读人格不是首页主动作

结论：

- 阅读人格只作为证据辅助或画像展示，不作为主 CTA。

原因：

- 阅读人格有趣但不一定推动行动。
- 首页主动作必须落到读、整理或交付物。

影响：

- P0 不移动 `PersonaIllustration` 的业务地位。
- P1 可使用人格摘要生成卡片，但不能输出心理诊断。

### 决策 5：P3 只统一表达，不重写导出

结论：

- P3 只统一成果名称、toast 和页面反馈。

原因：

- 当前导出链路已经覆盖主要产物。
- 重写导出格式会扩大风险，且不能直接解决“没意思”。

影响：

- 不改 Rust 导出。
- 不改 Markdown schema。
- 不新增导出记录表。

## 未决问题

以下问题先记录，不阻塞 P0。

### 问题 1：`organized` 的前端更新路径是否已经完整

需要确认：

- 前端是否已有可复用的 `upsert_reading_item_state` 调用。
- 单本复盘页是否能拿到足够的 bookId、title、cover、itemType 来写入状态。

处理策略：

- 如果已有路径完整，P2 直接复用。
- 如果缺字段，优先从现有页面 props 和缓存补齐。
- 只有现有命令无法表达时，才评估后端改动。

### 问题 2：总览是否保留原 `今日可做` 列表

候选方案：

- 方案 A：原列表下沉到首屏下方。
- 方案 B：只保留主卡和两个备选动作，删除原列表展示。

建议：

- PR-2 先采用方案 A，降低回滚风险。
- 自用验证后，如果列表继续制造噪声，再改为方案 B。

### 问题 3：今日卡片是否每天固定

候选方案：

- 方案 A：每次打开都按最新本地状态重新计算。
- 方案 B：按自然日固定一张卡片。

建议：

- 首版用方案 A，不新增持久化。
- 如果用户反馈卡片频繁变化，再评估按日期固定。

### 问题 4：主动作是否允许用户手动忽略

候选方案：

- 方案 A：不提供忽略，只通过权重和状态变化自然切换。
- 方案 B：提供 `今天不处理`，写入本地轻量状态。

建议：

- 首版用方案 A。
- 只有自用验证中反复出现“主动作合理但今天不想做”，再评估方案 B。

### 问题 5：成果表达是否需要持久化记录

候选方案：

- 方案 A：只改前端反馈，不持久化。
- 方案 B：记录最近一次导出/复制成果。

建议：

- 首版用方案 A。
- 如果后续做阅读状态时间线或资产详情页，再评估方案 B。

## 自用验证脚本

完成 P0-P1 后，建议连续自用 3 天，手动记录：

- 打开应用 10 秒内，是否知道今天最值得做什么。
- 是否点击了主卡。
- 是否点击了今日卡片。
- 是否完成过一次复制、导出、生成或标记整理。
- 哪些主动作看起来合理但自己没有兴趣点。
- 哪些卡片让人觉得像废话。

记录方式优先使用手动 Markdown，不做埋点。

建议记录模板：

```text
日期：
主动作：
是否点击：
今日卡片：
是否点击：
完成的成果：
无聊点：
下一轮调整：
```

## 文案与空态规范

### 主卡文案结构

主卡必须使用稳定结构：

```text
今日最值得做
{动作标题}

为什么现在做
{基于本地信号的一句话原因}

完成后得到
{一个具体成果或状态推进}
```

标题规则：

- 优先使用动词开头，例如 `复盘`、`继续读`、`生成`、`同步`、`配置`、`确认`。
- 标题最多表达一个动作，不使用 `并且`、`同时`、`顺便` 串联多个目标。
- 书名过长时 UI 层截断，文案层不改写书名。

原因规则：

- 只能引用确定信号：最近阅读、笔记数量、候选数量、已生成缓存、凭据状态、AI Provider 状态、统计建议。
- 不使用推测语气，例如 `你可能焦虑`、`你应该更自律`。
- 不使用心理诊断或人格判断。

成果规则：

- 必须落到可见结果：`行动清单`、`复盘问题`、`阅读指南`、`候选决策`、`本地缓存`、`统计报告`。
- 如果只是跳转浏览，成果写成状态推进，例如 `回到当前阅读现场`、`确认下一本书`。
- 不承诺 AI 一定生成高质量结果。

### 今日卡片文案结构

今日卡片必须包含：

- 标题。
- 正文。
- 来源。
- 一个动作入口。

示例：

```text
今日卡片
《深度工作》已有 14 条笔记，适合整理成一页复盘。

来源：本地笔记概览
按钮：开始复盘
```

卡片正文不超过两句。来源必须可解释，不能写成 `智能推荐` 这类含混标签。

### 空态矩阵

| 状态 | 主卡标题 | 原因 | 成果 | 主按钮 |
| --- | --- | --- | --- | --- |
| 无微信读书凭据 | 先连接微信读书 | 还没有本地阅读资产入口 | 连接后可同步书架、笔记和统计 | 打开设置 |
| 有凭据但无书架缓存 | 同步书架缓存 | 本地还没有可用书架数据 | 获得后续复盘和候选的资产底座 | 去书架同步 |
| 有书架但无笔记信号 | 去笔记中心同步笔记 | 当前缺少可复盘内容 | 找出适合整理的书 | 打开笔记 |
| 有笔记但无 AI Provider | 配置 AI Provider | 生成复盘前需要本机 Provider | 后续可手动生成阅读资产 | 打开设置 |
| 有最近阅读 | 继续读《...》 | 这是最近推进过的书 | 回到当前阅读现场 | 打开书籍 |
| 有待复盘书 | 复盘《...》 | 这本书已有笔记信号 | 得到行动清单和复盘问题 | 开始复盘 |
| 有候选决策 | 执行选书决策：... | 已有生成过的候选取舍结果 | 确认下一本书 | 查看决策 |
| 无候选 | 去发现页保存候选 | 当前还没有本地候选 | 建立下一本书候选池 | 打开发现 |

空态优先级应与 `buildTodayActions` 的权重保持一致，不再单独维护一套 UI 判断。

### 禁用文案

禁止使用：

- `智能为你安排`
- `AI 已经理解你`
- `你的人格决定了`
- `必须`
- `唯一正确`
- `最佳人生建议`

推荐使用：

- `基于本地缓存`
- `来自本地笔记概览`
- `来自已生成复盘`
- `适合先处理`
- `可以继续`
- `完成后会得到`

## 响应式与视觉约束

### 桌面端

- 主卡应占据首屏主要视觉重量。
- 备选动作不能比主卡更抢眼。
- 队列、推荐、阅读人格和统计摘要都应低于主卡层级。
- 主卡按钮只保留一个主要按钮。

### 窄屏

- 主卡、备选动作和今日卡片纵向排列。
- 备选动作最多两条，不做横向滚动。
- 书名和成果文案允许换行，但按钮文字不能溢出。
- 不使用固定高度截断正文导致关键信息不可见。

### 视觉层级

建议层级：

1. 今日最值得做。
2. 主动作原因和成果。
3. 主按钮。
4. 轻量/深度备选动作。
5. 今日卡片。
6. 队列、推荐、画像、统计摘要。

不建议：

- 把所有模块都做成同等重量卡片。
- 在主卡内塞入统计图、封面列表或长 AI 文案。
- 用大面积装饰图抢主动作注意力。

## 实现反模式

以下实现即使看起来更丰富，也应避免：

- 为今日卡片新增后端命令。
- 为了展示一句划线而自动读取单本笔记正文。
- 为了完成感自动把导出过的书标记为 `organized`。
- 把阅读人格升级成首页主 CTA。
- 让总览同时出现 4 个以上同等权重按钮。
- 为 P0 引入新状态表。
- 为 P3 重写导出文件格式。
- 在文案中使用无法从本地数据解释的判断。

## 风险与约束

- 不要让首页文案变成伪智能评价。
- 不要为了“有趣”引入过度拟人化或心理诊断。
- 不要自动发送笔记正文。
- 不要让今日卡片依赖远端实时数据。
- 不要把“已整理”设计成复杂任务系统。
- 不要让统计和 AI 输出占据首页首屏主导权。

## 成功标准

产品成功标准：

- 用户打开应用后 10 秒内知道今天最值得做什么。
- 用户 3 分钟内能完成一个轻量成果。
- 用户能感到一本书从“读过”推进到“整理过”。

工程成功标准：

- 不新增后端命令也能完成 P0。
- P0 只改总览相关前端和样式。
- 动作解释逻辑有纯函数测试。
- 不破坏现有同步、复盘、导出和设置边界。

## 推荐执行顺序

1. 新增 `DailyWorkbenchAction` 纯前端模型。
2. 将现有今日动作派生为主动作、轻量动作和深度动作。
3. 改造总览首屏为“今日最值得做”。
4. 为 P0 补纯函数测试和首页 E2E。
5. 新增 `DailyReadingCard`，但只使用总览已有本地数据。
6. 为 P1 补卡片候选排序测试。
7. 在单本复盘页强化完成反馈，复用 `organized`。
8. 调整总览待复盘动作，过滤或降权已整理书籍。
9. 统一复制/导出的成果表达，不重写导出链路。
10. 再评估是否需要新增本地整理状态字段或导出记录字段。

这个顺序符合 KISS 和 YAGNI：先让已有信号变得更有用，再决定是否需要新增状态。
