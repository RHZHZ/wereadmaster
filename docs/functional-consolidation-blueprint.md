# WeReadMaster 功能收敛与重构蓝图(总体 \+ P0 详细设计)

> **status: current** · 2026-08-04
> **实施状态**：M1 三维状态、真实笔记门禁、基础 selectors、glossary、统一文档导出与 v1.0.17 发布收口已完成代码实施；M2-M4 仍按本文边界推进，不因 v1.0.17 发布视为已实现。
> **依据**\:《WeReadMaster 功能设计问题分析》(2026\-07\-26,40 项问题,编号 A1\-A8 / B1\-B12 / C1\-C7 / D1\-D4 / E1\-E3 / F1\-F3 / G1\-G6,本文沿用该编号)
> **裁决声明**\:凡与下列现行文档冲突处,以本文为准 —— reading\-management\-closure\-roadmap.md(总览动作条数)、daily\-reading\-workbench\-refactor\-plan.md(首屏动作规格)、reading\-outcomes\-product\-design.md(成果分类与入口)、ai\-feature\-plan.md(AI 命令形态与命名)。详见第 9 节冲突裁决表。

## 1 背景与要解决的问题

分析报告的结论:产品只有三类原子能力(同步浏览、单本 AI 成果、周期统计与解读),却被投影到 6\+ 入口;"一本书的生命周期"主线在决策→开始读、阅读中状态、本地书→成果三处断裂;多数问题的共同根源是缺少统一的领域模型(状态、命名、资产),UI 由后端能力逐条驱动生长。

本方案不是新增功能计划,而是一次**收敛**\:先修模型与诚实性(P0),再收入口与闭环(P1),最后做体验与治理(P2)。目标与问题的对应关系:

| 目标 | 覆盖问题 | 阶段 |
| --- | --- | --- |
| 状态模型三维化,消灭互斥覆盖与幽灵状态 | B1 B2 B5 B6 B7 | P0(M1) |
| 清除虚假交互与虚假数据 | C2 C3 B10 | P0(M1) |
| 命名词典一词一义 \+ 文档单一事实来源 | A3 G1 G2 | P0(M1) |
| "下一步"由一个引擎回答 | A1 B4 | P1(M2) |
| 统计 × 周期复盘合并,报告逻辑单实例 | A1 A2 | P1(M2) |
| AI 收敛为"对话 \+ 资产"两层 | C1 C4 C5 C6 | P1(M3) |
| 本地批注入库,进备份/导出/笔记中心 | D1 D3 | P1(M3) |
| 导出中心、设置分层、导航历史栈 | E1 E3 F1 F3 A4 A5 | P2(M4) |

## 2 设计原则

> **北极星**\:用户的一天只需要回答三个问题——"现在读什么、读完整理什么、成果放到哪"。每个问题在产品里只有一个回答者。

1. **一条主线,单一回答者。** 任何"下一步"类建议(继续读、待整理、候选、统计建议)只能由一个引擎产出、在一个位置作为主入口出现;其他位置最多是只读引用。
2. **状态是三个正交维度,不是一条枚举。** 书的"来源身份"、"生命周期"、"整理进度"互不覆盖,可以并存。任何写操作只 patch 自己的维度。
3. **一词一义,一义一词。** UI 文案、导航、文档、内部 feature 名共用一本词典;新增名词必须先进词典。
4. **诚实优先。** 不收集不生效的输入,不展示编造的数字,不用"已保护"的文案掩盖未覆盖的数据。收敛期内,宁可先把文案改真话,再补功能。
5. **用户产出是一等资产。** 划线、想法、AI 提问、行动项反馈,无论来自微信书还是本地书,必须入 SQLite、入备份、入导出管线。
6. **配置能自动就不外露。** 系统能探测、能推断的(响应格式策略、状态推进),默认自动;高级配置收进"高级"层。

## 3 非目标

沿用既有"不做清单":不做全书向量问答、不写回微信读书远端、不做重型阅读器(EPUB CFI/PDF)、不做任务打卡与社交、不做后台自动 AI。本次重构额外声明:**不更换 UI 框架、不改视觉语言、不新增任何面向用户的新能力**——所有工作都是对既有能力的收敛、修复与连通。

## 4 总体蓝图(方案级)

### 4\.1 目标信息架构

桌面与移动共用同一套心智模型,消灭"双导航"(A4):

```
总览    今日工作台 —— 唯一"下一步"引擎(1 主动作 + ≤3 备选 + 可展开队列)
书库    微信书架 | 候选 | 本地书(三个 tab,统一"书的家")
笔记    微信笔记 + 本地批注(来源筛选:微信 / 本地)
成果    AI 资产库(书籍复盘 / 阅读指南 / 阅读路线 / 周期复盘 / 选书决策 / 助手收藏)
统计    数据 | 解读(周期复盘)双 tab
发现、设置    桌面侧边栏保留;移动端收入"我的"
```

要点:

- 一级导航"复盘"更名为"**成果**",三个子 tab(书籍复盘/阅读指南/阅读报告)合并为**单一资产库视图**(按书分组 \+ 按类型筛选),消灭 books/guides 两套查看 UI 并行的问题(A1)。"成果""成果"等私有地名随之消亡(A8)。
- 移动端底部 5 tab:总览 / 书库 / 笔记 / 成果 / 我的;**删除汉堡抽屉**,统计、发现、设置从"我的"进入;高亮由唯一的 `view → tab` 映射表决定,不再随入口漂移。
- 侧边栏一级项全部"点击即导航"(默认落到第一个子 tab),子 tab 在页内切换,消灭"点了没反应"的展开态(A6)。
- 桌面侧边栏 7 项收为 6 项:总览、书库、笔记、成果、统计、发现(设置保持齿轮入口)。

### 4\.2 "下一步"引擎唯一化(A1、B4)

新增 `src/lib/reading-selectors.ts` 作为唯一的建议产出模块,输出:

```ts
type TodayPlan = {
  primary?: SuggestedAction;          // 今日主动作,至多 1 个
  secondary: SuggestedAction[];       // 备选,至多 3 个
  queues: {                           // 折叠队列,展开可见
    continueReading: QueueItem[];     // 在读(lifeStatus=reading,按 lastReadAt)
    toOrganize: QueueItem[];          // 待整理(见 5.1.4 唯一规则)
    candidates: QueueItem[];          // 候选(isCandidate=1,含轻管理)
  };
};
type SuggestedAction = { kind; itemId?; title; reason; onOpen };  // reason 必填,建议可解释
```

总览页删除"今日可做 / 本地队列 / 今日阅读工作台"三个模块(DashboardPage.tsx:685、846、1692),只渲染一个 `TodayPlan`。统计建议、阅读人格等信息卡保留,但**不再承载动作**(动作一律进 TodayPlan)。"建议复盘"三套规则(NotesPage / ReadingHubPage / DashboardPage 各一套)全部删除,统一调用 selectors。

**规格裁决(G1)**\:总览首屏动作 \= 1 主 \+ ≤3 备选,队列默认折叠。此规格取代 roadmap 的"≤5 条"与 outcomes 的"4 类动作"。

### 4\.3 统计 × 周期复盘合并(A1、A2)

- StatisticsPage 改双 tab:**数据**(现统计图表)与**解读**(现 ReadingReviewPage 内容:AI 周期复盘、人格、行动建议)。周期切换器与周期状态提升到页头,两 tab 共享。
- 报告图逻辑单实例化:抽 `useReportImage(periodContext)` hook \+ `ReportImagePanel` 组件,替换两页各约 400 行的复制(StatisticsPage.tsx:499\-865 与 ReadingReviewPage.tsx:578\-944);"把刚生成的复盘注入报告"的行为保留为唯一行为,消灭分叉。
- ReadingReviewPage 退役;成果页的"周期复盘"类型指向统计页"解读"tab 的归档版本。
- 文案统一(见词典):页面与资产叫"周期复盘",分享图片叫"报告图片"。

### 4\.4 AI 收敛:"对话 \+ 资产"两层(C1、C4、C5、C6)

**资产层**\:五类 AI 产物(书籍复盘 / 阅读指南 / 阅读路线 / 周期复盘 / 选书决策)统一为一个资产模型:

```
ai_assets: { feature, subjectId, version, inputHash, payload(JSON), createdAt }
ai_asset_feedback: { assetRef, entryId, state, updatedAt }   // 行动项/复盘问题反馈
```

Tauri 命令由"四件套 × 5 资产"(summarize\_\* / get\_latest\_\* / export\_**markdown / export**\_targets,共 20 条)收敛为 6 条泛型命令:`generate_ai_asset(feature, subject, params)`、`get_ai_asset`、`list_ai_assets`、`export_ai_asset(target)`、`set_ai_asset_feedback`、`get_ai_asset_feedback`。新增 AI 产物类型不再新增命令与页面,只注册 feature schema。AI 域命令预期 43 → 约 18 条。选书决策作为资产进入"成果"库,历史决策从此可回看(已决事项 \#3)。

**对话层**\:AI 阅读助手是唯一对话入口。四项修复:

- 本地阅读器选区问答并入助手线程(激活 `localReaderSelection` scope,废除独立的 `ask_local_reader_selection_question` 通道与 `AiQuestionDraftStorage`),消灭死 scope 与第三套问答历史(C6)。
- 助手内跳转型 CTA("生成 书籍复盘"按钮跳到另一个页面)改为**就地生成 \+ 转存资产**\:助手回复中的生成动作直接调 `generate_ai_asset`,结果以卡片形式出现在对话里并同步入资产库。对话本身采用**收藏制**(已决事项 \#3):默认只保存在助手历史,用户对某条回答显式"转存为成果"才进入成果库——库中永远只有被用户认领过的内容。
- 换页不再清空对话:scope 切换时保留当前线程,顶部显示"上下文已切换"提示条,用户可一键回到原上下文(C6)。
- 上下文控制简化(C4、C5):10 类芯片收敛为三档预设——"仅当前对象 / 当前对象 \+ 我的阅读档案 / 自定义";"响应格式策略"从 composer 芯片移除(只在设置\-高级可见);`aiAssetSummary` 芯片改名"资产摘要",消灭与 `readingMemory` 的同名冲突;助手偏好只保留浮层一个入口,设置页改为跳转链接。

**边界文档**\:为助手补一份输入边界契约(每档预设发送什么、不发送什么),纳入 ai\-feature\-plan 的数据边界章节(G4)。

### 4\.5 本地批注入库(D1、D3)

- 新表 `local_annotations { id, bookId, kind: highlight|thought|ai_qa, anchor(JSON), color, content, createdAt, updatedAt }`,替代 webview 存储(LocalReaderHighlightStorage / ThoughtStorage / AiQuestionDraftStorage)。
- 一次性迁移器:首次启动扫描 webview 存储 → 写入 SQLite → 原键标记 migrated 保留一个版本作回滚依据。
- 入管线:备份/恢复、数据目录迁移自动覆盖;本地阅读器导出改走统一导出管线(目录/Obsidian/Notion),废除浏览器下载旁路;笔记中心增加"来源:微信 / 本地"筛选,本地书笔记进入建议复盘规则与复盘输入契约(`source: weread | local | merged`)。
- "关联微信版本"(D3)获得第一个真实后效:关联后,书籍详情与复盘输入可选"合并两侧笔记"视图;做不到之前,该按钮下线。
- **M1 先行项(诚实优先)**\:在批注入库完成前,设置页备份卡与本地阅读器导出处先加一行说明"本地阅读器批注暂未包含在备份中",消除错误安全感。

### 4\.6 导出中心(E1、E3)

统一"资产 → 知识库"出口:一个导出对话框(资产多选 × 目标选择 × 预检),数据侧复用批量导出向导的队列/重试/报告机制。各页面保留"快捷导出"薄入口(带默认目标),目标偏好全局共享一份(settings.exportTargetPreference)。Notion 视图配方改由 `create_notion_reading_workspace_template` 在建库时直接创建,删除"复制视图配方"人肉步骤(E2)。

### 4\.7 设置分层(F1、F3)

- **基础层**(默认可见):微信凭据、AI(Provider 预设 \+ Key \+ 模型,兼容模式由探测自动决定并隐藏)、外观、导出目录与目标。
- **高级层**(折叠进"高级"):网络代理、更新源细节、备份/迁移、诊断、响应格式策略手动覆盖。
- 兼容性探测:探测成功即自动应用推荐策略并 toast 告知,结果面板渲染在 AI 分区(修复 F2);探测失败才引导用户看详情。
- 微信代理从"凭据"卡拆出为独立"网络"项;Android 专属文案仅在移动端渲染(F3)。

### 4\.8 导航历史栈(A5、A4 收尾)

引入极简 history stack(无需路由库):`navStack: Array<{view, params}>`,back \= pop,返回按钮文案统一"返回"\+来源页名(由栈顶决定,不再硬编码);删除 detailBackView / bookNotesBackView / bookAiBackView 三个联合类型与全部伪造 NotebookBook 的入口(配合 5.2.2)。底部导航高亮 \= 栈底一级 view 的映射,单一事实来源。

## 5 P0 详细设计

### 5\.1 P0\-A 状态模型重构(B1、B2、B5、B6、B7)

#### 5\.1.1 现状与缺陷

现模型 `ReadingItemState { itemId, itemType: book|album|mp|candidate, status: toRead|reading|reviewing|organized, title, author, cover, category, note, createdAt, updatedAt }`,命令 `list_reading_item_states / get_reading_item_state / upsert_reading_item_state / remove_reading_item_state`。缺陷:一书一条记录使候选身份与整理状态互斥(B1);`reading` 无写入路径(B2);来源靠 note 魔法字符串(B6);轻管理候选(album/mp)与 candidate 口径不一(B5)。

#### 5\.1.2 新模型:三维正交

沿用 `reading_item_states` 表,ALTER 增列(SQLite 友好),旧列 `itemType/status/note` 保留一个版本用于回滚核对,下版删除:

```sql
ALTER TABLE reading_item_states ADD COLUMN item_kind TEXT;            -- book|album|mp|localBook
ALTER TABLE reading_item_states ADD COLUMN is_candidate INTEGER DEFAULT 0;
ALTER TABLE reading_item_states ADD COLUMN candidate_source TEXT;     -- weread|ai_unconfirmed|ai_confirmed|light
ALTER TABLE reading_item_states ADD COLUMN life_status TEXT DEFAULT 'none';
                                       -- none|want|reading|paused|finished|dropped
ALTER TABLE reading_item_states ADD COLUMN finished_source TEXT;      -- weread_auto|manual
ALTER TABLE reading_item_states ADD COLUMN organize_status TEXT DEFAULT 'none';
                                       -- none|to_organize|organized
ALTER TABLE reading_item_states ADD COLUMN user_note TEXT;            -- 真正还给用户的备注
ALTER TABLE reading_item_states ADD COLUMN source_meta TEXT;          -- JSON,见下
```

`source_meta` 结构:`{ savedFrom?: "discovery"|"detail"|"assistant"|"shelf"|"localImport", aiReason?: string, confirmedAt?: string }`。

**维度语义与不变式**\:

| 维度 | 取值 | 规则 |
| --- | --- | --- |
| 身份 | itemKind \+ isCandidate \+ candidateSource | isCandidate 是独立布尔,album/mp 保存候选时同样 isCandidate\=1、candidateSource\=light(修 B5);与另两维**永不互相覆盖** |
| 生命周期 | lifeStatus,finishedSource | 用户可写全部取值;微信同步 progress\=100 且 finishTime 存在时自动置 finished(finished\_source\=weread\_auto);**finished\_source\=manual 的记录不被同步覆盖**;候选/本地书从此可手动标读完(修 B2) |
| 整理 | organizeStatus | 与候选身份并存;"标记已整理"只 patch 本维,不再改写身份、不再覆盖备注(修 B1) |

**删除语义**\:`remove_reading_item_state` 仅响应用户显式"删除记录";候选书架"移除候选"改为两个选项——默认\*\*"暂缓"\*\*(isCandidate\=0 \+ lifeStatus\=dropped,保留记录),次选"删除记录"(收进二级确认)。暂缓记录供助手"排除书目"与后续选书决策复用("曾暂缓"作为负样本),取舍历史从此可沉淀(已决事项 \#2)。

#### 5\.1.3 命令 API

- 保留 `list_reading_item_states / get_reading_item_state`(返回结构增新字段)。
- 新增 `patch_reading_item_state(itemId, patch, bookMeta?)`\:**部分更新**,patch 只含要改的维度字段;记录不存在时用 bookMeta(title/author/cover/category/itemKind)创建。
- `upsert_reading_item_state` 退役(桌面端前后端同包发布,可直接切换;`normalizeWebPreviewReadingItemStateRecord` 的 Web 预览数据结构同步升级)。
- 前端 9 个写入点全部改为维度级 patch:

| 写入点 | 现行为 | 新行为 |
| --- | --- | --- |
| 发现页"保存候选"(DiscoveryPage:398\-406) | upsert candidate\+toRead\+note 文案 | patch { isCandidate:true, candidateSource:"weread" }, sourceMeta.savedFrom\="discovery" |
| 详情页"加入候选"(BookDetailPage:311\-320) | 同上,覆盖已有状态 | patch { isCandidate:true },其余维度不动 |
| 详情页"待整理/已整理"(BookDetailPage:268\-297) | upsert 覆盖 itemType | patch { organizeStatus } |
| 详情页"清除状态"(BookDetailPage:332\-352) | 删除整条记录 | 改为"清除整理状态"\= patch { organizeStatus:"none" };删除记录移入更深的菜单 |
| 书籍复盘页"标记已整理"(BookAiSummaryPage:377\-404) | upsert 覆盖 note | patch { organizeStatus:"organized" },不碰 user\_note |
| 书架页 album/mp"保存候选"(BookshelfPage:268\-288) | upsert itemType\=album/mp | patch { isCandidate:true, candidateSource:"light" };book 类型不再静默 return,同样支持加候选 |
| AI 助手加候选 ×3(ReadingAssistantPanel:1033\-1173) | upsert candidate\+note\=AI 理由 | patch { isCandidate:true, candidateSource:"ai\_unconfirmed"或"ai\_confirmed" }, sourceMeta.aiReason\=理由 |
| (新增)详情页/书库生命周期控件 | 无 | patch { lifeStatus, finishedSource:"manual" } |

#### 5\.1.4 派生规则统一(reading\-selectors.ts)

M1 只落两条唯一规则,供现有三处页面直接替换调用(完整 TodayPlan 在 M2):

- **待整理队列** \= organizeStatus\=to\_organize(手动)∪ 系统建议;**系统建议** \= 可导出笔记数 \> 0 且无 book\_review 资产 且 organizeStatus ≠ organized,排序:手动优先 → 想法数 desc → 总笔记数 desc → lastReadAt desc,UI 标注来源徽章"手动/建议"(修 B4 三套规则)。该规则对本地书同样适用、不加开关:M1\-M2 期间本地批注未入库,"有可导出笔记"条件自然不满足;M3 批注入 SQLite 后无缝纳入(已决事项 \#4)。
- **候选队列** \= isCandidate\=1(含 light,带"轻管理"徽章),排序:updatedAt desc(修 B5、B8 的队列侧;候选书架页排序增加"最近添加/书名"切换)。
- 来源徽章一律读 candidateSource \+ sourceMeta,不再解析 note 文本;`ai-rec-` 合成 ID 逻辑保留,但确认状态由 candidateSource 承载(修 B6)。

#### 5\.1.5 UI 映射

- 详情页"本地整理"区重组为三组控件:候选开关 / 生命周期(想读·在读·暂缓·读完·放弃)/ 整理状态(待整理·已整理),外加一个真正的"我的备注"输入(user\_note)。
- 详情页主 CTA 随 lifeStatus 联动:finished 且有笔记 → 主按钮"生成书籍复盘";reading → "查看笔记";候选禁用卡(B7)删除,原位置就是可点的主 CTA。
- 候选书架卡片菜单:开始读(lifeStatus\=reading)/ 暂缓 / 删除记录 —— 补上 B3 需要的第一块拼图(完整"决策→开始读"闭环在 M2 决策结果页落地)。

#### 5\.1.6 迁移(db.rs migration vN\+1)

幂等 backfill,迁移前自动执行一次内置备份:

| 旧记录 | 新字段 |
| --- | --- |
| itemType\=candidate, status\=toRead | item\_kind\=book, is\_candidate\=1, life\_status\=want |
| itemType∈{album,mp}, status\=toRead | item\_kind 原值, is\_candidate\=1, candidate\_source\=light |
| status\=reviewing | organize\_status\=to\_organize |
| status\=organized | organize\_status\=organized |
| note 含"来自 AI 阅读助手推荐" | candidate\_source\=ai\_unconfirmed, source\_meta.aiReason\=note 剩余文本 |
| note 含"已通过微信读书搜索确认" | candidate\_source\=ai\_confirmed |
| note 为其他系统文案("发现页保存的本地候选"等) | source\_meta.savedFrom 映射,user\_note 置空 |
| note 为其余自由文本 | user\_note\=note |
| itemId 以 ai\-rec\- 开头 | candidate\_source\=ai\_unconfirmed(若未确认) |

#### 5\.1.7 验收标准

- [ ] 详情页把候选书标为"待整理"后,候选书架与总览候选队列仍显示该书
- [ ] "加入候选"不改变已有 organize\_status;"标记已整理"不改变 is\_candidate 与 user\_note
- [ ] 候选/本地书可手动标"读完",出现在待整理建议中;微信自动读完不覆盖手动值
- [ ] 书架有声书保存候选后,总览候选队列可见(带轻管理徽章)
- [ ] 全部来源徽章在 note 字段清空的情况下仍正确显示
- [ ] 旧库迁移后:原 candidate 数量 \= 迁移后 is\_candidate\=1 数量;笔记页/成果页/总览的"建议复盘"列表完全一致
- [ ] `rg 'status: "reading"'` 有真实写入路径;cargo test 覆盖 backfill 各分支

### 5\.2 P0\-B 诚实性修复(C2、C3、B10)

#### 5\.2.1 选书决策:参考因子与时间窗口真接入(C2)

**决策**\:接入而非删除——因子对决策质量有真实影响,UI 与文档已做出承诺,删除属于倒退。

- 接口变更(前端 reading\-api.ts \+ Rust summarize\_book\_decision / get\_latest\_book\_decision / export 同步):

```ts
summarizeBookDecision({
  candidates, goal, regenerate,
  referenceFactors: ReferenceFactor[],          // 向导第 3 步勾选
  recentReadingWindowDays: number | "auto",     // 时间窗口
  recentReadingContext: {                        // 前端按窗口聚合后传入
    finishedTitles: string[];                    // 窗口内读完(≤5)
    activeCategories: { name, minutes }[];       // 窗口内类别分布(≤5)
    averageDailyMinutes: number;
  }
})
```

- candidates 构造(buildBookDecisionCandidates)不再硬编码 `localStatus:"toRead"`,改传真实 lifeStatus/organizeStatus。
- prompt 升级为 `book-decision-v2`\:因子作为"用户声明的判断维度"注入,要求输出的 rationale 逐因子回应;recentReadingContext 作为"近期阅读背景"注入。
- inputHash v2 \= hash(candidates \+ goal \+ referenceFactors \+ windowDays \+ recentReadingContext 摘要)。旧 v1 缓存自然失效,不迁移(决策缓存价值低,可接受)。
- 结果页"基于 X 本候选和 N 个参考因子生成"的声明从此为真;factors 与窗口存入资产 payload,回看时可见。

#### 5\.2.2 移除伪造笔记数(C3)

- 删除 App.tsx 三处 `noteCount: 1, totalNoteCount: 1` 伪造(:1266\-1276、:1293\-1304 及同型第三处),NotebookBook 参数改为 `noteCount?: number`(undefined \= 未知)。
- BookAiSummaryPage 入场逻辑改三态:未知 → 先取真实笔记(listBookNotes)再判断;为 0 → 生成按钮禁用 \+ 空态引导("先同步笔记或在阅读器写想法");大于 0 → 正常。canGenerate 不再使用 `?? 1` 兜底。
- "来源统计"仅在真实数据就绪后渲染;加载中显示占位,不显示编造数字(:1331\-1341 的 fallback 删除)。

#### 5\.2.3 "生成选书决策"缓存语义修正(B10)

- `get_latest_book_decision` 收紧为 **inputHash 精确匹配才返回**;不匹配返回 null,前端直接进入生成流程(带 loading),删除结果页"当前候选书或目标与缓存输入不同…"警告分支(BookDecisionPage:462\-473)。
- 命中缓存时,结果页显著展示"生成于 {时间}"徽章 \+ "重新生成"次按钮;按钮语义与行为从此一致。

#### 5\.2.4 验收标准

- [ ] 勾选不同参考因子/窗口生成两次,请求体不同、inputHash 不同、输出 rationale 逐因子回应
- [ ] 无笔记的书无法发起复盘生成,页面给出下一步引导;来源统计永不显示"划线 1 条"类占位假数
- [ ] 决策结果页不再出现"缓存输入不同"警告;缓存命中有生成时间徽章
- [ ] e2e:从详情页进入 书籍复盘页,来源统计与笔记页计数一致

### 5\.3 P0\-C 命名词典与文档规范(A3、G1、G2)

#### 5\.3.1 词典(唯一权威表)

| 概念 | 唯一 UI 名 | 内部 feature |
| --- | --- | --- |
| 单本书 AI 成果 | 书籍复盘 | book\_review（缓存层对 book\-notes\-summary 做读别名，新写入统一） |
| 单本推进建议 | 阅读指南 | reading\_guide |
| 跨书排序建议 | 阅读路线 | reading\_route |
| 周期统计 AI 解读 | 周期复盘 | stats\_review |
| 统计分享图 | 报告图片 | report\_image |
| 下一本取舍 | 选书决策 | book\_decision |
| 对话入口 | AI 阅读助手 | assistant |
| AI 产出集合 | 成果 | ai\_asset |
| 本地整理状态 | 待整理 / 已整理 | to\_organize / organized |

规范词、动作词和旧称迁移映射统一维护在 [`docs/GLOSSARY.md`](./GLOSSARY.md)；本文不复制第二份旧称表，避免双重事实源。

#### 5\.3.2 落地机制

- 新建 `src/lib/glossary.ts`\:`export const TERMS = {...} as const`,所有页面标题、导航项、按钮、toast、返回文案从常量取值;新建 `docs/GLOSSARY.md` 为对外唯一权威(含淘汰词表)。
- 新建 `scripts/check-glossary.mjs`(纳入 `npm test`):扫描 src/ 与 docs/ 中的淘汰词,白名单机制(历史 release\-notes 豁免),违例即失败——词典从此有强制力。
- e2e 配套:app\-smoke.spec.ts 中受影响的文案断言**一次性**迁移为 `data-testid` \+ 从 glossary 导入文案,避免后续每次改词全量崩(见 7.2)。

#### 5\.3.3 文档规范(G1、G2 的最小治理)

- 每份 docs/\*.md 计划/设计文档头部加状态行:`> status: current | superseded-by: <file> | archived`;被取代时**必须回写**旧文头部。
- product\-audit.md 回归审计:只保留"未解决问题"章节,已完成项迁出到 CHANGELOG 性质文档;三套"阶段"编号停用,里程碑一律引用本文的 M1\-M4。

#### 5\.3.4 验收标准

- [ ] check\-glossary 通过;UI 全量走查无淘汰词
- [ ] 同一功能在导航、页面标题、按钮、返回文案、user\-guide 中名称一致
- [ ] 现行文档均有 status 头;audit 中不再存在已勾选的"问题"

### 5\.4 P0\-D 顺手修复(小改动,随 M1 出)

- **F2**\:aiProviderProbe 结果面板从 account 分支(SettingsPage:1390\-1433)移至 ai 分支"测试兼容性"按钮下方。
- **C4 局部**\:`CONTEXT_LABELS.aiAssetSummary` 改"资产摘要",消灭双"阅读记忆"芯片。
- **A7 局部**\:MinePage:66 `noteCount` 误取 bookCount 修正;"代理与网络诊断"入口文案改为与落点一致。
- **B11**\:阅读阶段边界固定为 69% 仍属“深入推进”，70% / 95% / 99% 属“收束整理”，100% 或 `finished=true` 属“完成归档”；文档、后端计算与边界测试保持一致。

## 6 实施顺序与切片

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| **M1(P0)** | 状态模型三维化 \+ 迁移;诚实性三修复;词典 \+ 检查脚本;P0\-D | 5\.1.7 / 5.2.4 / 5.3.4 验收全过;npm test、cargo test、e2e 绿 |
| **M2(P1a)** | reading\-selectors 完整 TodayPlan,总览三模块合一;统计×周期复盘合并;决策结果页/候选卡"开始读"闭环(B3、B7 收尾);"成果"单视图 | 同一信息全应用只有一个动作入口;报告图逻辑单实例 |
| **M3(P1b)** | AI 资产泛型命令与四件套退役;助手三修复(就地生成/保留对话/选区并入);本地批注入 SQLite \+ 迁移器 \+ 进管线;助手输入边界文档 | AI 命令 ≤20;备份包含本地批注;死 scope 消失 |
| **M4(P2)** | 导出中心;设置分层;导航历史栈 \+ 移动端单导航;书架生命周期筛选 | 导出目标偏好全局唯一;返回永远回到来处 |

M1 建议 PR 切片(可直接建任务):PR\-1 db 迁移 \+ patch 命令 \+ cargo 测试;PR\-2 前端类型/API/selectors 两条唯一规则;PR\-3 九个写入点改造 \+ 详情页控件重组;PR\-4 决策因子接入(prompt v2 \+ hash v2);PR\-5 noteCount 三态 \+ 缓存语义;PR\-6 glossary \+ 检查脚本 \+ 文案替换 \+ e2e testid 迁移;PR\-7 P0\-D 四项 \+ 文档状态头。

## 7 迁移与兼容风险

1. **DB 迁移**\:迁移前强制自动备份(复用现有备份命令);backfill 幂等可重跑;保留旧列一个版本,回滚 \= 恢复备份。
2. **e2e 文案断言**\:tests/e2e/app\-smoke.spec.ts(约 380KB)存在大量文案断言,词典替换会大面积破坏。策略:PR\-6 一次性把受影响断言迁到 data\-testid \+ glossary 导入,先改断言、后改文案,同 PR 内完成。
3. **决策缓存失效**\:hash v2 使旧决策缓存不再命中,属预期行为;资产库中旧版本仍可回看。
4. **Android 同步发版**\:桌面与 Android 共用前后端,M1 需双端一起发;Web 只读预览的数据 normalizer 同步更新。
5. **助手对话保留策略变更**(M3)可能与"隐私·本地清空"预期交互,保留"清空当前对话"显式按钮不变。

## 8 已决事项(原开放问题,2026\-07\-26 拍板)

第一版列出的四个开放问题已全部定案,决策、理由与落点如下:

| \# | 议题 | 决定 | 理由要点 | 落点 |
| --- | --- | --- | --- | --- |
| 1 | 一级导航命名 | **"成果"** | "复盘"已被书籍复盘/周期复盘两个资产类型占用,容器与内容物同名正是 A3 命名混乱的源头;"成果"可容纳决策、助手收藏等非复盘型资产,与 reading\-outcomes 既有方向一致 | 4\.1 与 5.3.1 词典按"成果"执行,无条件分支 |
| 2 | 候选"移除"默认项 | **默认"暂缓"(保留记录),"删除记录"为二级次选项** | "为什么暂缓"是选书决策最有复用价值的上下文;保留记录后助手可识别"曾暂缓"避免重复推荐(接入"排除书目"上下文),决策生成可作负样本;本地记录零成本、误触可逆 | 5\.1.2 删除语义;M2 候选卡菜单 |
| 3 | 选书决策与助手对话是否进"成果"库 | **进;助手侧采用收藏制** | 不进则"成果页是 AI 资产总入口"的承诺永远不成立;M3 泛型化后决策本就是 ai\_assets 的一个 feature,列出为零边际成本。助手对话默认只留在助手历史,用户显式"转存为成果"才入库,避免成果库变成"按时间堆叠的 AI 输出垃圾堆" | 4\.4 对话层;M3 |
| 4 | 本地书手动"读完"是否触发建议复盘 | **触发,且不加任何开关** | 唯一建议规则已是"有可导出笔记 \+ 无复盘 \+ 未整理",不触发反而要维护一条排除特例,违背单一规则原则;M1\-M2 期间本地批注未入库,条件自然不满足;M3 入库后无缝生效,无需临时逻辑 | 5\.1.4 规则不变,随 M3 自然激活 |

四个决定的共同逻辑:站在"可回溯 \+ 单一规则"两条原则一边,不新增任何特例。

## 9 与现行文档冲突裁决表

| 议题 | 旧口径 | 本文裁决 |
| --- | --- | --- |
| 总览首屏动作数量 | roadmap ≤5 条 / workbench 1\+2 / outcomes 4 类 | 1 主 \+ ≤3 备选 \+ 折叠队列(4.2) |
| 本地追踪状态枚举 | audit:候选/在读/待整理/已整理;ai\-feature\-plan:改"待整理"不强制迁移 | 三维模型(5.1.2);"待整理"为淘汰词 |
| 统计页 AI 卡 | ai\-feature\-plan 保留大卡 / audit 已移除 | 并入统计"解读"tab(4.3) |
| AI 命令形态 | 四件套 × 资产 | 泛型 6 命令(4.4) |
| 移动端阅读边界 | concept\-plan 不做移动阅读器 / user\-guide 已支持 | 承认现状:移动端支持本地阅读,concept\-plan 标 superseded |
| 成果分类 | outcomes 四类 / notion 文档五类 | 五类 \+ 助手收藏(4.4 资产层),Notion 侧同表 |
| 复盘是否并入版本体系 | third\-stage\-plan 四种时态并存 | 已并入,以资产统一模型为准 |

* * *

*本方案为收敛型重构蓝图:M1 完成后产品不新增任何能力,但"状态会互相覆盖、控件不生效、数字是编的、同一个词指三样东西"这四类最伤信任的问题清零;M2\-M4 逐步兑现"一条工作流"的目标形态。*
