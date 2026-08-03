# Notion 标准阅读成果库默认视图设计

> **文档状态**：v1.0.17 本地实现、自动化验证与真实 Notion Views API 验收完成
> **日期**：2026-08-01
> **实施更新**：2026-08-04
> **适用范围**：应用主动创建的 Notion `阅读成果库`、默认视图初始化、失败恢复与兼容策略
> **关联文档**：`docs/notion-user-database-connection-refactor-design.md`
> **核心裁决**：标准阅读成果库采用“一张数据库 + 四个最小视图”；应用主动创建的新标准库默认初始化推荐视图，用户连接的已有数据库默认不创建、不修改、不删除视图。首版全部使用 Table，Board 等展示增强在真实 API 冒烟后再评估。

## 1. 背景

### 1.1 当前实施状态（2026-08-03）

首版源码实施已完成，并保持本设计的权限和恢复边界：

- 新建标准成果库在数据库连接保存后，自动发现唯一 data source，并初始化四个 Table 推荐视图。
- `Default view` 只在可唯一识别时更新为 `最近导入`；其余三个业务视图按完整 List + Retrieve 结果幂等创建或复用。
- 用户已有数据库连接流程不触发视图 mutation；旧标准库和第三方模板也不自动改造。
- 逐视图结果持久化为 `created / updated / reused / skipped / conflict / failed / unknown`，部分失败进入 `partial`，数据库仍可正常导出。
- `partial` 重试只重新进入视图初始化，不会再次执行数据库创建 POST。
- List Views 返回 `request_status=incomplete` 或未知状态时，在任何 POST/PATCH 前 fail-closed。
- View POST/PATCH 只对 429 有界重试；网络错误、成功响应解析失败和 5xx 保留结构化 `unknown`，随后只做 List/Retrieve 对账，不盲目重发 mutation。
- provisioning version 1 可安全读取并升级为 version 2；version 0 和未来未知版本仍拒绝处理。
- 设置页展示 4/4 或 N/4 就绪数量、逐视图中文状态、冲突/失败/未知 warning，并提供“重试缺失视图”。

本地验证结果：最终 Rust lib `414/414`、默认视图定向测试 `14/14`、Vitest `80/80` 文件及 `490/490` 断言、glossary `161` 个受管文件、TypeScript `tsc --noEmit`、正式 Vite build、默认视图 Playwright 关键场景 `3/3` 均通过；Rust 格式化和 command/permission 契约亦已核对。

真实 Notion 验收也已完成。验收父页面为 `20c9daca-95bb-83af-9089-01113bb58343`，本次只创建了一张标准成果库：database ID `3b19daca-95bb-813e-a787-fd30ce419e6c`、data source ID `3b19daca-95bb-818f-b23f-000bc2e3a0f4`。database POST 成功后的首次 schema analysis 遇到短暂网络发送错误，应用已先持久化 database ID，并通过同一 provisioning ID 安全续跑，没有再次创建数据库。

四个真实 Table 视图均已创建或更新，最终 ID 为：`最近导入` `3b19daca-95bb-8165-af10-000cc46a369b`、`书籍笔记` `3b19daca-95bb-817e-b44e-000c8ae7076a`、`待复盘` `3b19daca-95bb-8148-b840-000ca96a74b5`、`复盘与报告` `3b19daca-95bb-8164-87a1-000ccf5b5758`。真实响应表明 View API 会把 property ID 从 URL 编码形态规范为解码形态，并在 `configuration.properties` 中补齐其余数据库字段且标为 `visible:false`；此外部分布尔默认值可能省略。fingerprint 已只针对这些等价响应形态做规范化，同时继续严格校验可见属性、顺序、宽度、wrap、filter、sorts 和非默认展示值。

修复后仅调用已有 provisioning 的 continue，四个原 view ID 全部标记为 `reused`，状态转为 `phase=complete / status=complete / 4-of-4 ready`。再次 continue 仍为 complete 且 ID 不变；只读回填预检确认该验收库 `totalPages=0`，没有示例成果页。真实验收没有修改旧标准库、用户手工 Gallery 或其他自定义视图，也没有删除或归档任何资源。

当前 Notion 改造已经把主路径收敛为“连接用户已有数据库”，并保留“一键创建标准阅读成果库”作为无现有数据库用户的兜底。

原设计在 Notion 尚无公开视图管理能力时，将标准库边界约束为“只创建数据库，不创建首页和视图”。Notion Views API 现已把视图提升为一等资源，支持程序化创建、列举、读取、更新、删除及配置筛选、排序、分组和属性可见性。官方明确将 workspace bootstrapping 和 automated view setup 作为适用场景。

因此需要重新裁决：标准库不应恢复成完整视觉工作台，但可以提供一组低维护、高价值的默认视图，降低用户首次进入单表数据库后的整理成本。

本设计只扩展应用主动创建的标准库，不改变普通用户数据库连接的“只读分析、确认后保存、默认不改造远端结构”原则。

## 2. 设计结论

### 2.1 产品结构

标准阅读成果库使用一张统一数据库存放全部阅读资产，通过视图区分不同任务，而不是按“笔记”“复盘”“报告”拆成多张数据库。

理由：

1. 当前五类资产已经共享同一套标题、来源、导出时间、状态、标签和追踪字段。
2. 一张数据库可以统一检索、去重、导出、映射和迁移。
3. 视图只改变展示和筛选，不复制数据，不引入跨库 Relation。
4. 后续新增资产类型只需增加选项和视图规则，不需要扩展多套导出目标。
5. 用户可以在 Notion 中自由增加个人视图，而应用只维护最小推荐集合。

### 2.2 默认视图集合

标准库首版保留四个用户可见入口：

1. `最近导入`
2. `书籍笔记`
3. `待复盘`
4. `复盘与报告`

其中 `最近导入`直接复用 Notion 创建数据库时自动生成的 `Default view`，将其重命名并配置。它同时承担全量检索和最新成果入口，不再额外创建内容范围完全相同的`全部记录`视图。

首版四个视图均使用 Table。`复盘与报告`改用 Board 并按资产类型分组属于展示增强，不是业务闭环前提，放到最小 Table 视图与恢复链路稳定、且获得真实使用证据后的 P3 再裁决。

### 2.3 权限边界

| 数据库来源 | 默认行为 | 允许行为 |
| --- | --- | --- |
| 应用本次新建的标准库 | 自动初始化推荐视图 | 可重命名和配置本次创建时自动生成的默认视图，并创建其余推荐视图 |
| 旧版本由应用创建、但已存在的标准库 | 不自动改造 | 后续可提供显式“初始化推荐视图”，先预检并要求用户确认 |
| 用户连接的已有数据库 | 不修改视图 | 仅分析和保存连接；未来若提供初始化，必须是独立、显式、可预览的操作 |
| 第三方模板数据库 | 不修改视图 | 专用适配器另行设计，不继承标准库初始化规则 |

应用不得以数据库名称为 `阅读成果库` 就推断拥有其视图管理权。只有“本次创建流程返回的数据库 ID”可以直接进入自动初始化。

## 3. 目标与非目标

### 3.1 目标

- 新用户建库后无需手工配置即可按任务浏览阅读成果。
- 保持单库数据契约，不增加多数据库同步和 Relation 复杂度。
- 默认视图与当前标准 schema、五类资产和导出语义一致。
- 视图初始化可重试、可诊断，不因单个视图失败造成数据库重复创建。
- 视图创建失败时保留已经创建的数据库和成功视图，并明确告诉用户降级范围。
- 用户后续在 Notion 中的改名、排序和自定义视图不被后台静默覆盖。

### 3.2 非目标

- 不恢复 `微信读书知识库` 首页、仪表盘和引导区块。
- 首版不创建 Board、Dashboard、Chart、Calendar、Timeline、Gallery、Form 或 Map 视图；先用 Table 验证筛选、排序、字段展示和失败恢复。
- 不把 Notion 变成应用内状态的双向同步源。
- 不持续对用户视图做期望状态对账。
- 不自动删除未知视图、重复视图或用户自建视图。
- 不向用户已有数据库增加字段、选项、公式或 Relation。
- 不保证用户手动删除或改名后的默认视图会被自动恢复。

## 4. 事实基线

### 4.1 当前标准库 schema

`src-tauri/src/export/notion.rs` 的 `reading_library_template_properties()` 当前创建：

- `名称`：Title
- `作者`：Rich text
- `Book ID`：Rich text
- `资产类型`：Select
- `来源`：Select
- `导出时间`：Date
- `导入状态`：Select
- `阅读状态`：Select
- `阅读阶段`：Select
- `进度`：Number（percent）
- `标签`：Multi-select
- `微信读书`：URL
- `Obsidian 路径`、`Prompt 版本`、`输入哈希`、`Scope ID`：Rich text
- `周期`：Select
- `行动数`、`候选书数`、`划线数`、`想法数`、`书签数`、`可导出数`：Number

`资产类型`预置：

- `书籍笔记`
- `书籍复盘`
- `阅读统计复盘`
- `阅读路线`
- `选书决策`

`导入状态`预置：

- `待整理`
- `已导入`
- `已复盘`
- `已归档`

`标签`预置 `重点`、`待复盘`、`可行动`。

### 4.2 Notion API 基线

官方 Views API 要求请求使用 `2025-09-03` 或更高版本；本设计的视图请求以官方当前参考版本 `Notion-Version: 2026-03-11` 为目标。Notion 版本头按请求发送，因此这不等于首版必须一次性迁移所有既有请求。

创建数据库后，Notion 自动生成：

1. 一个 data source；
2. 一个名为 `Default view` 的 Table 视图。

视图创建接口为：

```http
POST /v1/views
Notion-Version: 2026-03-11
```

创建顶层数据库视图时，请求必须包含：

- `database_id`
- `data_source_id`
- `name`
- `type`

并可包含：

- `filter`
- `sorts`
- `quick_filters`
- `configuration`
- `position`

创建请求在 `database_id`、`view_id`、`create_database` 中必须且只能提供一个。本设计只使用 `database_id`。

列举视图：

```http
GET /v1/views?database_id={database_id}
```

列表只返回最小引用，需要再通过 `GET /v1/views/{view_id}` 获取名称、类型、data source、筛选、排序和配置。

更新视图：

```http
PATCH /v1/views/{view_id}
```

可更新名称、筛选、排序、快捷筛选和配置。字段均为可选；配置使用浅合并，清理可空字段时显式传 `null`。

权限要求：

- 列举/读取：`read_content` 或 `read_property`；
- 创建：官方参考要求连接具备相应插入/更新能力；实现预检以 `insert_content + update_content` 为最低能力组合；
- 更新：`update_content` 或 `update_property`；
- 连接还必须能访问父数据库，否则可能返回 404。

### 4.3 API 升级前置条件

当前 `src-tauri/src/export/notion.rs` 的既有请求统一固定为 `Notion-Version: 2022-06-28`。首版不应为了默认视图强制一次性升级全部导出请求，这会把独立展示增强扩大成高风险基础设施迁移。

推荐建立按能力分版本的请求边界：

- 既有 page、block、旧 database 请求暂时保持 `2022-06-28`，避免无关回归；
- 新增 database/data source discovery 与 Views API 请求使用 `2026-03-11`；
- 新版本 DTO 独立定义，不复用假定旧 database schema 形状的解析结构；
- 先验证创建数据库的 `data_sources[0].id`、Retrieve database/data source、List/Retrieve/Create/Update View；
- 后续如决定统一升级，再单独处理 `archived` → `in_trash`、block append 的 `after` → `position` 和全量夹具迁移。

若实际验证表明同一建库流程无法安全混用版本，再将“统一升级全部受影响请求”提升为阻断项；在此之前不预设必须全量迁移。

## 5. 默认视图矩阵

### 5.1 视图定义

| 顺序 | 名称 | 类型 | 核心筛选 | 排序 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 1 | 最近导入 | Table | 无 | 导出时间倒序 | 全量检索、首次进入和日常查看最新成果 |
| 2 | 书籍笔记 | Table | 资产类型 = 书籍笔记 | 导出时间倒序 | 原始划线、想法和章节证据入口 |
| 3 | 待复盘 | Table | 标签包含 待复盘，或导入状态 = 待整理 | 行动数倒序，导出时间倒序 | 稳定的二次整理队列 |
| 4 | 复盘与报告 | Table | 资产类型 ∈ 书籍复盘、阅读统计复盘、阅读路线、选书决策 | 导出时间倒序 | 浏览高阶阅读成果；Board 分组作为后续增强 |

### 5.2 `最近导入`

- 类型：Table。
- 位置：第一个标签页。
- 筛选：无。使用相对日期筛选会让用户误以为旧记录消失，因此首版不限制时间范围。
- 排序：`导出时间` descending。
- 建议显示字段：
  - 名称
  - 资产类型
  - 作者
  - 导出时间
  - 导入状态
  - 标签
- 展示配置：单元格换行，标题列较宽，隐藏追踪和统计类低频字段。
- 设计意图：复用数据库默认视图，同时承担全量检索和日常最新入口，避免维护两个数据范围相同的视图。

### 5.3 `书籍笔记`

- 类型：Table。
- 筛选：`资产类型` Select equals `书籍笔记`。
- 排序：`导出时间` descending。
- 建议显示字段：
  - 名称
  - 作者
  - 导出时间
  - 划线数
  - 想法数
  - 书签数
  - 标签
  - 微信读书
- 设计意图：把证据层与 AI/统计成果分开，但仍保留在统一数据库中。

### 5.4 `待复盘`

- 类型：Table。
- 筛选使用 OR：
  - `标签` Multi-select contains `待复盘`；
  - `导入状态` Select equals `待整理`。
- 排序：
  1. `行动数` descending；
  2. `导出时间` descending。
- 建议显示字段：
  - 名称
  - 资产类型
  - 作者
  - 导入状态
  - 行动数
  - 标签
  - 导出时间
- 设计意图：兼容自动标签和用户手动状态两种入队方式。
- 边界：不使用 `阅读状态 = 复盘中` 作为入队条件，因为阅读生命周期与成果整理状态不是同一维度。

### 5.5 `复盘与报告`

- 首版类型：Table。
- 筛选：使用 OR 组合四个 Select 条件，而不是把数组直接传给单个 equals：
  - `资产类型` Select equals `书籍复盘`
  - `资产类型` Select equals `阅读统计复盘`
  - `资产类型` Select equals `阅读路线`
  - `资产类型` Select equals `选书决策`
- 排序：`导出时间` descending。
- 建议显示字段：
  - 名称
  - 资产类型
  - 作者
  - 导出时间
  - 周期
  - 行动数
  - 导入状态
  - 标签
- 设计意图：聚合所有“加工后成果”，减少为每种资产创建独立视图导致的标签页膨胀。
- 后续增强：只有在 Table 方案真实冒烟稳定且用户确有按类型看板需求时，才改为 Board，并按`资产类型`分组、隐藏空分组。该增强不得阻塞首版。

## 6. 字段依赖与降级

### 6.1 依赖级别

| 字段 | 影响 | 缺失时处理 |
| --- | --- | --- |
| 名称 | 所有视图可用性 | 标准库创建失败；不进入视图初始化 |
| 资产类型 | 书籍笔记、复盘与报告 | 跳过这两个业务视图 |
| 导出时间 | 全部视图默认排序 | 视图仍可创建，降级为 `created_time` descending；返回 warning |
| 导入状态 | 待复盘 | 若标签可用，仅保留标签条件；否则跳过待复盘视图 |
| 标签 | 待复盘 | 若导入状态可用，仅保留待整理条件；否则跳过待复盘视图 |
| 行动数 | 待复盘排序 | 删除第一排序，仅按导出时间或 created_time 倒序 |
| 作者、周期、统计字段 | 属性展示 | 从 configuration.properties 中省略，不阻止视图创建 |

标准库 schema 理论上应完整，因此任何缺失都表明创建响应、data source 解析或 schema 初始化发生异常。降级用于避免扩大失败，不用于掩盖错误；所有降级必须进入结果 warning 和日志。

### 6.2 使用 property ID

视图筛选、分组和属性展示优先使用标准库创建后读取到的 property ID，不使用硬编码显示名称作为长期标识。

- 名称只用于识别和诊断；
- 创建视图 payload 使用 property ID；
- Select/Multi-select 的筛选值仍使用选项名称；
- 创建前必须验证筛选值存在于 schema 选项中；
- 任一筛选值缺失时按视图级降级或跳过，不发送必然失败的请求。

## 7. 初始化流程

### 7.1 推荐执行顺序

```text
生成 provisioning_id
  → 在默认本地数据目录原子写入创建意图（provisioning_id、parent_page_id、started_at、phase=creatingDatabase）
  → 发送一次创建标准数据库请求
  → 若明确失败且确认未产生远端资源：清理创建意图并返回 command error
  → 若结果未知：更新 phase=databaseCreateUnknown，禁止盲目再次 POST
  → 若成功：立即把 database_id、URL 写入恢复记录，phase=databaseCreated
  → 返回已持久化的数据库锚点
  → 自动调用“继续初始化”流程
      → 从新版本 Retrieve database 获取 data_source_id
      → Retrieve data source / 分析 schema，建立 property ID 映射
      → 保存为默认导出数据库，phase=connectionSaved
      → List views(database_id)
      → Retrieve 自动生成的默认视图
      → 将默认视图更新为“最近导入”
      → 创建“书籍笔记”
      → 创建“待复盘”
      → 创建“复盘与报告”
      → 再次 List + Retrieve 校验
      → 保存视图初始化摘要，phase=complete 或 partial
```

创建意图必须发生在远端 POST 之前，数据库 ID 必须在成功响应解析后的第一个本地步骤写入。只在拿到 ID 后才落盘仍有“响应已返回、进程在写文件前退出”的重复建库窗口；预写创建意图可以让应用重启后至少知道上次创建结果待确认，并阻止盲目再次 POST。

provisioning 状态使用默认本地数据目录中的独立文件，例如 `notion-standard-database-provisioning.json`，不塞进稳定连接配置，也不依赖业务 SQLite 已成功打开。文件必须采用临时文件 + rename 的原子替换方式写入，且不得包含 Notion Token。正式可导出的数据库连接仍写入 integration config；provisioning 文件只保存远端资源锚点、阶段、逐视图结果和可恢复错误。

先保存数据库连接，再初始化视图；视图是增强能力，不得阻塞导出目标建立。默认视图先改为`最近导入`，即使后续失败，数据库仍有一个语义清晰的全量入口。

### 7.2 不采用远端事务假设

Notion API 不提供跨“建库 + 多视图”的事务。本地流程必须按 Saga/部分成功处理：

- 数据库创建成功后不得因视图失败而删除数据库；
- 不自动删除已成功创建的视图；
- 不自动重新创建数据库；
- 记录每一步的远端 ID 和状态；
- database ID/URL 已知时返回给用户，允许打开数据库；只有正式连接保存成功后才宣称可导出；
- 提供继续连接和只补缺失视图的恢复入口。

## 8. 幂等策略

### 8.1 为什么不能只按名称创建

`POST /v1/views` 不是幂等接口，网络超时后服务端是否已创建可能未知。直接重发会产生重复视图。

### 8.2 识别规则

每次初始化或重试前：

1. 使用 `database_id` 列举数据库内视图，处理全部分页；
2. 对每个引用执行 Retrieve view；
3. 只考虑 `parent.database_id` 等于目标库、`data_source_id` 等于目标 data source 的顶层视图；
4. 优先按本地已保存的 view ID 匹配；没有 ID 时再按规范化名称 + 视图类型筛选候选；
5. 名称和类型相同后，继续比对 data source、关键 filter、sorts 与 managed configuration 指纹；只有配置等价才视为`reused`；
6. 名称和类型相同但配置不同：不自动覆盖，标记为`conflict`，交给用户选择复用现状或创建稳定后缀视图；
7. 名称相同、类型不同：不覆盖，标记冲突并为应用视图建议稳定后缀，如`复盘与报告（wxreadmaster）`；
8. 多个同名同配置候选：不删除、不任意选首个，返回 duplicate conflict，由显式重试界面让用户确认。

### 8.3 自动管理范围

初始化摘要保存应用成功创建或接管的 view ID：

```ts
type NotionStandardProvisioningPhase =
  | "creatingDatabase"
  | "databaseCreateUnknown"
  | "databaseCreated"
  | "connectionSaved"
  | "viewsInitializing"
  | "complete"
  | "partial";

type NotionStandardProvisioningState = {
  version: 1;
  provisioningId: string;
  parentPageId: string;
  phase: NotionStandardProvisioningPhase;
  startedAt: string;
  updatedAt: string;
  databaseId?: string;
  databaseUrl?: string;
  dataSourceId?: string;
  connectionSavedAt?: string;
  initializedAt?: string;
  lastError?: {
    step: "createDatabase" | "discoverSchema" | "saveConnection" | "reconcileViews";
    code: string;
    message: string;
    retryable: boolean;
    resultUnknown: boolean;
  };
  views: Array<{
    key: "recent" | "notes" | "reviewQueue" | "reviews";
    viewId?: string;
    nameSnapshot: string;
    type: "table";
    managedConfigFingerprint?: string;
    status: "created" | "updated" | "reused" | "skipped" | "conflict" | "failed" | "unknown";
  }>;
};
```

阶段不允许倒退；每次远端副作用后立即原子写入。`creatingDatabase`和`databaseCreateUnknown`可以没有 database ID，此时应用必须进入“创建结果待确认”恢复界面，并提供`关联已创建数据库`与经二次确认的`确认未创建并重试`，不能直接显示新的创建按钮。`complete`记录可以保留用于诊断，也可以在确认 integration config 已稳定保存后归档，但不得在最后一步一次性才写入。

该状态只用于诊断和显式续跑，不用于后台持续强制覆盖。用户在 Notion 中修改视图后，应用默认尊重现状。

### 8.4 未知结果恢复

#### View POST 结果未知

创建视图请求遇到超时、连接中断或 5xx 时：

1. 不立即重复 POST；
2. 重新 List + Retrieve；
3. 若找到名称、类型、data source 和受管配置一致的视图，则视为成功并保存 ID；
4. 找不到时允许有限次数重试；
5. 仍不确定则返回 `unknown`，由用户显式重试补齐。

429 按现有 Notion 限流退避策略处理，但重试前仍应优先执行远端对账。

#### Database POST 结果未知

创建 database 与创建 view 不同：当前流程在没有 database ID 时没有可靠的父页面子资源查询或应用级幂等键，不能仅凭标题`阅读成果库`安全判断哪张库属于本次请求。因此`databaseCreateUnknown`不得承诺自动找回，也不得按名称接管。

恢复方式按优先级为：

1. 用户在 Notion 中确认已创建后，粘贴该数据库链接/ID；应用只读分析并确认其 parent、创建时间窗口和标准 schema，再由用户显式关联到当前 provisioning；
2. 用户确认 Notion 中没有新增库后，显式选择“确认未创建并重试”；该动作清除旧 unknown 状态并生成新的 provisioning ID；
3. 无法确认时保持 unknown，允许放弃本地 provisioning 记录，但不得删除任何远端资源。

不能自动列举/证明结果时，宁可要求一次人工确认，也不能用同名搜索猜测后再次 POST。

## 9. 部分失败与返回契约

### 9.1 当前实现为何不能表达部分成功

当前代码的实际边界是：

```rust
Result<CreateNotionStandardDatabaseResponse, AppCommandError>
```

且 `src-tauri/src/services/settings.rs` 在建库后复用 `create_notion_reading_library_template()`，该旧方法会先把新 database ID 写成 `notion_parent_id`，但不会保存完整字段映射；随后 `analyze_database()` 失败会通过 `?` 返回普通错误。`AppCommandError`只有`code/message/detail`，前端拿不到 database ID、URL、失败阶段或恢复动作。`src/lib/reading-api.ts` 还对所有设置命令统一施加 15 秒超时，而单个 Notion HTTP 请求允许 30 秒，因此前端可能在后端完成前先判定失败。

所以仅在现有成功 DTO 上追加`views`字段不够。必须同时改副作用顺序、持久化状态和命令成功语义。

### 9.2 命令成功语义裁决

采用以下规则，不扩展所有 command 共用的 `AppCommandError`：

1. **远端资源尚未确认创建**：参数、凭据、权限、明确 4xx 等失败继续返回 `Err(AppCommandError)`。
2. **创建请求结果未知且没有 database ID**：优先返回结构化 `provisioning` outcome；本地若连创建意图都无法持久化，才返回 error，但 UI 仍必须禁止在同一会话盲目重试。
3. **已经拿到 database ID**：之后的 schema、连接保存、视图初始化或最终 settings state 读取失败，都不得再退化为丢失远端上下文的普通 error；命令返回`Ok(CreateNotionStandardDatabaseResponse)`，用`phase/status/warnings/lastError`表达未完成。
4. **继续初始化**：使用 provisioning ID 定位本地状态，不接受前端任意 database ID 直接触发自动管理。

不建议为本任务顺手统一多个 command 模块中重复的 `AppCommandError`。那是独立基础设施重构，范围大且不能解决“前端自行超时后丢弃迟到成功结果”。本切片只需保持 settings command error 向后兼容，并为 provisioning command 使用明确的成功 outcome。

### 9.3 创建命令响应

```ts
type NotionDefaultViewResult = {
  key: "recent" | "notes" | "reviewQueue" | "reviews";
  name: string;
  type: "table";
  status: "created" | "updated" | "reused" | "skipped" | "conflict" | "failed" | "unknown";
  viewId?: string;
  url?: string;
  warning?: string;
};

type NotionProvisioningError = {
  step: "createDatabase" | "discoverSchema" | "saveConnection" | "reconcileViews";
  code: string;
  message: string;
  retryable: boolean;
  resultUnknown: boolean;
};

type CreateNotionStandardDatabaseResponse = {
  provisioningId: string;
  phase: NotionStandardProvisioningPhase;
  status: "complete" | "partial" | "recoveryRequired" | "unknown";
  databaseId?: string;
  dataSourceId?: string;
  url?: string;
  title: string;
  connection?: NotionDatabaseConnection;
  views: NotionDefaultViewResult[];
  viewInitialization: "notStarted" | "complete" | "partial" | "failed";
  warnings: string[];
  lastError?: NotionProvisioningError;
  state?: SettingsStateResponse;
};
```

`state`和`connection`必须可选：本地恢复记录已经成功，但 integration config 或最终 `settings_state()` 读取失败时，不能因为组装完整成功 DTO 失败而再次丢掉 database ID。前端收到缺少`state`的 outcome 后重新调用`get_settings_state`；缺少`connection`则显示“继续连接”，不能把响应解析失败转成泛化异常。

### 9.4 状态语义

- `complete`：数据库连接已保存，四个入口均已创建、更新或确认复用。
- `partial`：数据库连接已保存且可导出，但至少一个推荐视图冲突、失败、跳过或结果未知。
- `recoveryRequired`：database ID 已知，但 schema 分析或正式连接保存尚未完成；数据库链接可展示，但不得声称“可正常导出”。
- `unknown`：创建请求结果未知且尚无 database ID；禁止自动重发，要求检查/恢复。

只有`connectionSaved`、`viewsInitializing`、`partial`、`complete`阶段可以声称数据库已成为可用导出目标。仅有 Title/data source 可读不等于本地连接已经持久化。

### 9.5 本地配置保存

数据库连接与视图初始化应分开看待：

- 远端 POST 前预写创建意图；远端 database 创建成功后立即补写 ID/URL；
- schema 分析成功后先保存为默认导出数据库，再初始化推荐视图；
- 视图部分失败不撤销数据库连接；
- 视图摘要按阶段增量保存，不只在流程末尾一次性落盘；
- 应用启动或再次进入设置页时，如果发现未完成 provisioning，必须按状态展示恢复动作：database ID 已知时显示“继续初始化”，创建结果未知时显示“关联已创建数据库”与经二次确认的“确认未创建并重试”；不得默认再次建库；
- 若正式连接配置保存失败，仍返回并保留远端数据库 ID/URL，提示用户继续连接该库，不创建第二个数据库；
- 不再通过把`notion_parent_id`提前改成新 database ID 来充当恢复记录；该字段代表稳定导出目标，只有完整连接保存成功后才切换；
- 读取旧 integration config、写入新 connection、写入 provisioning 状态应各自有明确错误处理，不能用最后一次`settings_state()?`抹掉已完成的远端事实。

### 9.6 命令拆分

保留外部入口名，但把内部能力拆成两个可复用服务步骤，并新增一个续跑命令：

```rust
create_notion_standard_outcomes_database(parent_page_id)
continue_notion_standard_database_provisioning(provisioning_id)
get_notion_standard_database_provisioning()
```

首个命令负责预写意图、最多一次 database POST、保存远端锚点，并可继续执行后续初始化；续跑命令只从本地 provisioning 状态继续，database ID 已知时绝不再次创建数据库。查询命令供应用启动和设置页恢复 UI 使用。

## 10. 前端交互

### 10.1 创建前确认

文案从：

```text
只会新增一张数据库，不会创建首页或修改现有内容。
```

更新为：

```text
将新增一张“阅读成果库”，并在该新数据库中初始化“最近导入、书籍笔记、待复盘、复盘与报告”四个视图。不会创建首页，也不会修改其他数据库或页面。
```

### 10.2 创建中状态与超时

如果当前 Tauri command 仍是一次性 request/response，首版只显示一个不承诺精确阶段的状态：

```text
正在创建阅读成果库并初始化推荐视图…
```

只有在新增 Tauri event、channel 或拆分命令，后端能真实上报阶段后，才显示：

1. `正在创建阅读成果库…`
2. `正在读取标准字段…`
3. `正在初始化推荐视图（2/4）…`
4. `正在保存导出连接…`

禁止由前端定时器伪造阶段进度。不提供取消按钮，避免用户误以为可以回滚已产生的远端副作用。

当前 `invokeSettingsCommand` 的 15 秒通用前端超时短于 Notion 单请求的 30 秒后端超时，不能继续用于 provisioning 命令。首版必须满足以下其一：

- 推荐：创建/续跑命令使用专用超时，覆盖最坏请求序列，并在超时后立即查询本地 provisioning 状态；
- 更稳妥：命令只负责启动/续跑 provisioning 并尽快返回状态，前端通过查询命令或真实事件获取进展。

无论采用哪种方式，前端 Promise 超时都不能被解释为“可以重新创建”。超时后的唯一自动动作是读取 provisioning 状态；只有后端明确记录创建未发生，才恢复创建按钮。

### 10.3 创建后反馈

完整成功：

```text
阅读成果库已创建，并初始化 4 个推荐视图。
```

部分成功且连接已保存：

```text
阅读成果库已创建，可正常导出；3/4 个推荐视图已就绪，剩余视图可稍后重试补齐。
```

需要恢复连接：

```text
阅读成果库已创建，但尚未完成导出连接。请继续初始化；应用不会重复创建数据库。
```

创建结果未知：

```text
上次创建结果尚未确认。请先在 Notion 检查是否新增了“阅读成果库”；如已创建，请粘贴该数据库链接继续关联。应用不会直接再次创建。
```

操作：

- `打开阅读成果库`（database ID/URL 已知时）
- `继续初始化`（recoveryRequired）
- `关联已创建数据库`（unknown，用户粘贴链接/ID并通过只读预检）
- `确认未创建并重试`（unknown，二次确认后生成新的 provisioning）
- `重试缺失视图`（partial 且连接已保存）
- `查看详情`

### 10.4 用户已有库

普通“连接数据库”流程不展示自动初始化勾选框，避免把远端写操作混入只读检查主路径。若未来支持，应提供独立操作：

```text
初始化推荐视图
```

点击后先列出将新增、复用、冲突和不会触碰的视图，用户确认后执行。

## 11. 后端模块设计

### 11.1 版本化 Notion 客户端

建议把当前单一 `NOTION_API_VERSION` 和请求函数改为显式版本参数，而不是直接替换全局常量：

```rust
const NOTION_LEGACY_API_VERSION: &str = "2022-06-28";
const NOTION_VIEWS_API_VERSION: &str = "2026-03-11";

struct NotionDatabaseContext {
    database_id: String,
    data_source_id: String,
    properties: HashMap<String, NotionPropertySchema>,
}

fn notion_request(
    ...,
    notion_version: &'static str,
) -> reqwest::RequestBuilder;
```

既有 page/block 导出调用继续显式传 legacy 版本；database/data source discovery 与 view 调用传 views 版本。两套 DTO 分开测试，并忽略响应中的未知新增字段。待统一升级切片完成后才能删除 legacy 版本。

### 11.2 新增视图服务

建议在 `src-tauri/src/export/notion.rs` 中先实现底层 DTO 与 HTTP 调用，稳定后按职责拆到 `notion_views.rs`：

```rust
async fn list_database_views(...)
async fn retrieve_view(...)
async fn create_view(...)
async fn update_view(...)
async fn reconcile_standard_views(...)
```

`reconcile_standard_views` 输入只接受本次新建标准库的上下文和目标定义，不自行查找或修改任意数据库。

### 11.3 视图定义模型

```rust
struct StandardViewDefinition {
    key: StandardViewKey,
    name: &'static str,
    view_type: StandardViewType,
    filter: Option<Value>,
    sorts: Vec<Value>,
    configuration: Value,
    position: StandardViewPosition,
}
```

视图定义必须由 property ID 映射构造，不在 JSON 中散落中文字段名。

### 11.4 命令边界

现有外部入口名保持不变：

```rust
create_notion_standard_outcomes_database(parent_page_id)
```

但不能继续通过`create_notion_reading_library_template()`这个“创建并立即改写 integration config”的旧 service 方法间接建库。应下沉复用纯远端函数`create_reading_library_template()`，由 provisioning orchestrator 统一控制本地副作用顺序：先预写意图，再 POST，拿到 ID 后补写恢复锚点，schema 成功后才切换稳定导出目标。

新增：

```rust
continue_notion_standard_database_provisioning(provisioning_id)
get_notion_standard_database_provisioning()
retry_notion_standard_database_views(provisioning_id)
```

续跑/重试前必须验证：

- provisioning ID 与本地未完成或 partial 状态一致；
- 记录中的 database ID 与本地当前标准库连接一致，或仍处于连接前恢复阶段；
- 数据库和 data source 可访问；
- schema 仍满足最低依赖；
- database ID 已存在时，任何代码路径都不能再次调用创建数据库 POST。

`retry_notion_standard_database_views`只负责连接已保存后的视图补齐；schema/连接未完成时使用 continue 命令，不混用“重试视图”语义。

## 12. 迁移与兼容

### 12.1 新建标准库

功能上线后新建的标准库执行完整默认视图初始化。

### 12.2 已有标准库

不自动迁移。设置页可在连接详情中提示：

```text
此阅读成果库创建于默认视图功能上线前。你可以预览并手动初始化推荐视图。
```

用户确认后只补缺失视图，不删除、不重命名未知视图。若现有默认视图已被用户修改或改名，不接管它；新增`最近导入（wxreadmaster）`作为全量入口。

### 12.3 普通用户数据库

继续遵守 `docs/notion-user-database-connection-refactor-design.md`：

- 分析接口严格只读；
- 连接和导出不改视图；
- schema、视图、公式和 Relation 归用户管理；
- 本文不扩大普通连接权限。

### 12.4 旧 API 版本兼容与能力降级

Views API 升级应作为独立技术切片验证。P0 的 provisioning 安全底座和 P1 的连接闭环不以视图能力为前提：即使 Views API feature flag 关闭或真实冒烟未通过，标准库创建仍必须先写创建意图、保存远端锚点、防止重复 POST，并在 schema 成功后原子保存正式连接。

只有 P2 的推荐视图初始化受 capability 检测或 feature flag 控制。视图能力不可用时，结果应为“数据库已连接、推荐视图未初始化”的明确降级，并保留后续显式补齐入口；不得退回当前“直接建库且无恢复状态”的旧流程，也不得把视图不可用误报为整个标准库创建失败。

## 13. 测试策略

### 13.1 Rust 单元测试

- 首版四个视图定义使用正确类型、顺序和稳定 key。
- 筛选、排序和属性展示使用 property ID。
- `待复盘`正确构造 OR 条件。
- `复盘与报告`正确使用 compound OR 组合四个资产类型条件。
- 缺少导出时间时回退 created_time 排序。
- 缺少资产类型时跳过依赖视图并产生 warning。
- 缺少标签或导入状态时正确简化待复盘条件。
- 配置中的可见属性只包含 schema 存在字段。
- 同名同类型复用、同名异类型冲突、重复候选都返回确定结果。

### 13.2 Mock API 集成测试

覆盖完整请求序列：

1. 在远端 POST 前原子写入创建意图；
2. 创建 database，并立即把 database ID/URL 补写到 provisioning 状态；
3. 使用新版本获取 database/data source 并保存数据库连接；
4. List/Retrieve 默认视图；
5. PATCH 默认视图为`最近导入`；
6. POST 三个业务视图；
7. 最终 List/Retrieve 校验并保存`complete`或`partial`摘要。

异常场景：

- 创建意图本地写入失败时不发送 POST；
- 创建数据库明确 400/403/404 时可安全结束创建意图；
- 创建数据库 429/5xx/超时且结果未知时进入`databaseCreateUnknown`，不自动发送第二次 POST；
- unknown 状态关联用户粘贴的 database ID 前执行只读校验，并要求用户确认；不按同名自动接管；
- 只有用户明确确认远端未创建后才清除 unknown 并生成新的 provisioning ID；
- 创建数据库成功后、恢复锚点写入前模拟异常，验证创建意图仍阻止盲目重建并给出人工/远端检查路径；
- database ID 已保存后 schema 分析失败，返回`recoveryRequired`且响应含 database ID/URL；
- database ID 已保存后进程退出，重启能从 provisioning 状态继续；
- 数据库成功但新版本响应缺 data source ID；
- integration config 保存失败时仍保留 provisioning 锚点，稳定导出目标不被提前切换；
- 最终`settings_state()`读取失败时，成功 outcome 仍保留 database ID/URL，前端可单独刷新状态；
- List views 分页且 cursor 作为不透明值原样回传；
- Retrieve 单个视图 404；
- 更新默认视图失败；
- 第二个业务视图创建 429 后成功；
- POST view 超时但远端实际已创建；
- 同名同类型但配置不同返回 conflict，不误判 reused；
- 多个同名候选不任意接管；
- 部分成功后重试只补缺失视图；
- 续跑时 database ID 已存在，断言 database create POST 调用数仍为 1；
- API 返回未知字段时解析保持向前兼容。

### 13.3 前端测试

- 创建前文案明确会在新库内初始化四个视图。
- 一次性 command 只显示笼统进行中状态，不伪造阶段进度。
- provisioning 命令不复用短于后端请求上限的 15 秒通用超时。
- 前端超时后先查询 provisioning 状态，不显示可直接再次创建的按钮。
- 若接入真实事件协议，阶段和`2/4`进度与后端事件一致。
- 完整成功显示 4/4。
- `partial`且连接已保存时显示数据库链接和可正常导出。
- `recoveryRequired`显示数据库链接和“继续初始化”，不声称可正常导出。
- `unknown`显示“关联已创建数据库”与经二次确认的“确认未创建并重试”，不显示普通重试创建。
- `重试缺失视图`只在连接已保存，且整体 status 为`partial`并至少一个视图状态为`failed`、`unknown`或可重试的`skipped`时显示；`conflict`应进入显式冲突处理，不作为普通重试。
- 发现未完成 provisioning 时显示对应恢复动作，不展示新的建库主操作。
- 用户已有数据库连接流程不出现隐式视图初始化选项。
- 重复点击被单飞锁阻止。

### 13.4 真实环境冒烟

使用专门的空父页面执行：

- 新建标准库；
- 回查 database 与 data source；
- 回查四个视图名称、类型、顺序、filter、sorts 和 configuration；
- 写入五类测试成果；
- 分别通过视图查询或 Notion UI 检查命中范围；
- 模拟用户修改一个视图后重启应用，确认不会自动覆盖；
- 完成后保留测试库供版本验证，删除需人工执行，不纳入自动测试。

## 14. 验收标准

### 14.1 产品验收

- [x] 新建标准库最终有且仅有四个推荐入口，不产生重复全量视图。
- [x] 书籍笔记、待复盘、复盘与报告能正确区分任务。
- [x] 全部资产仍存放于同一数据库。
- [x] 视图部分失败不影响标准库作为导出目标。
- [x] 用户已有数据库不会在连接、分析或导出时被修改视图。
- [x] 用户在 Notion 中修改默认视图后不会被后台静默恢复。
- [x] 创建前明确披露将在新库中初始化视图。

### 14.2 技术验收

- [x] 新增的 database/data source discovery 与 Views API 请求使用并验证 `2026-03-11`；既有导出请求版本不被无依据扩大修改。
- [x] database ID 与 data source ID 不混用。
- [x] 远端 POST 前原子写入不含凭据的创建意图；拿到 database ID 后立即补写可跨重启恢复的锚点。
- [x] provisioning 使用独立持久化状态，不用提前切换`notion_parent_id`冒充恢复记录。
- [x] database ID 已知后的失败通过结构化 outcome 返回，不丢失 ID/URL。
- [x] `recoveryRequired`与“连接已保存、视图 partial”语义严格分离。
- [x] provisioning 命令不受短于单次 Notion 请求上限的通用前端超时控制；超时后先查状态。
- [x] 默认视图初始化以 List + Retrieve 预检开始。
- [x] 所有筛选、排序和属性配置优先使用 property ID。
- [x] 同名同类型只有在关键配置等价时才判定 reused。
- [x] 网络结果未知时不会盲目重复 database/view POST。
- [x] database ID 已存在的续跑路径不会创建第二张数据库。
- [x] 创建响应包含 provisioning 阶段、逐视图状态、warning 和可恢复错误。
- [x] 视图初始化状态与数据库连接状态解耦。
- [x] 前端不伪造后端未上报的分阶段进度。
- [x] Mock、Rust、前端和真实环境冒烟均通过。

## 15. 实施分期

### P0：创建安全与可恢复命令契约

- 为 provisioning 定义独立、无凭据、原子写入的本地状态文件。
- 远端 POST 前预写创建意图；拿到 database ID 后立即补写 ID/URL。
- 标准库 orchestrator 不再复用会提前改写 integration config 的旧 service 包装方法。
- database ID 已知后的失败统一返回`partial/recoveryRequired` outcome，不通过普通 error 丢失远端上下文。
- 新增 provisioning 查询/继续命令；应用启动和设置页可恢复未完成状态。
- 移除该流程对 15 秒通用 settings 前端超时的依赖；超时后先查询状态。
- 加入单飞锁；未完成/未知 provisioning 存在时禁止新的 database POST。

### P1：新版本发现能力与最小连接闭环

- 为 Notion 请求增加显式版本参数，不替换既有全局行为。
- 新增使用 `2026-03-11` 的 database/data source discovery DTO。
- schema 成功后原子保存正式数据库连接，再把阶段推进到`connectionSaved`。
- 保持现有连接、分析、导出和建库回归通过。
- 完成 database POST 只调用一次、跨重启续跑、连接保存失败恢复的 Mock 集成测试。

### P2：最小 Table 视图初始化与必要幂等

- 实现 List/Retrieve/Create/Update View。
- 每次创建/更新前 List + Retrieve；未知结果先对账，不盲目 POST。
- 接管本次新建数据库的自动默认视图为`最近导入`。
- 创建`书籍笔记`、`待复盘`、`复盘与报告`三个 Table 视图。
- 保存逐视图 ID、状态和 managed configuration 指纹。
- 实现同名配置等价复用、配置冲突识别和只补缺失视图。
- 扩展创建 outcome、warning UI 和`重试缺失视图`。

### P3：展示增强与已有标准库显式初始化

- 根据真实使用评估是否把`复盘与报告`升级为 Board；没有证据则继续保持 Table。
- 识别旧版本标准库但不自动修改。
- 提供预览、冲突说明和用户确认。
- 初始化时不接管已被用户修改的默认视图。

## 16. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 新旧 API 模型边界不清 | 既有导出或 block 追加回归 | 显式按请求传版本；新 DTO 隔离；不在首版全量迁移旧请求 |
| 建库前本地状态无法写入 | 远端成功后没有可靠恢复锚点 | 创建意图写入失败则不发送 database POST |
| 建库请求结果未知 | 用户重复点击产生第二张数据库 | 进入`databaseCreateUnknown`；前端先查询状态，不自动重发 |
| 建库成功、连接保存前失败 | 用户误以为全部失败并重复建库 | 预写创建意图；拿到 ID 后立即补写；返回`recoveryRequired`和数据库链接 |
| 建库成功、视图失败 | 用户误以为全部失败并重复建库 | 先保存连接；返回`partial`；重试只补视图 |
| 前端 15 秒超时早于后端请求完成 | UI 报错但远端仍在继续，重试造成重复资源 | provisioning 使用专用时限或启动/查询模式；前端超时后只查本地状态 |
| POST view 超时产生重复视图 | 标签页重复 | 重试前 List + Retrieve 对账；保存 view ID；不盲目重发 |
| 同名视图配置不同 | 误接管用户视图或错误宣称成功 | 比对 managed configuration 指纹；不等价则 conflict，不自动覆盖 |
| 用户改名导致名称幂等失效 | 可能补出重复视图 | 新建流程保存 view ID；后续默认不自动对账；显式重试展示冲突 |
| 筛选选项与 schema 不一致 | 创建视图 400 | 创建前读取选项；缺失时降级/跳过并 warning |
| 视图过多增加认知负担 | 标签页拥挤 | 固定四个入口；复用默认视图；高阶成果合并为“复盘与报告” |
| 看板展示先于真实需求 | 增加配置复杂度和测试面 | 首版全部 Table；Board 放到最小视图闭环稳定且有真实使用证据后的 P3 |
| 前端伪造阶段进度 | 状态与真实副作用不一致 | 无事件协议时只显示笼统进行中；有后端事件后再显示精确进度 |
| 应用越界修改用户库 | 信任损失 | 只自动管理本次新建标准库；普通连接保持只读分析和不改造原则 |

## 17. 与现有设计的冲突裁决

本文对 `docs/notion-user-database-connection-refactor-design.md` 作以下局部修订：

1. 原“标准创建只新增一张数据库，不创建视图”改为：
   - 不创建首页或仪表盘；
   - 允许在本次新建的标准库内部初始化推荐视图。
2. 原“不自动重写用户数据库视图”继续有效，适用于：
   - 用户连接的已有数据库；
   - 旧版本标准库；
   - 第三方模板数据库。
3. “契约优先，视觉归用户”继续有效。默认视图属于标准库快速起步配置，不代表应用持续拥有用户后续视觉布局。
4. 筛选和排序必须使用数据源查询兼容结构。`复盘与报告`的四类资产通过 compound OR 组合四个 Select equals 条件，不使用不存在的“equals 数组”语义。
5. 若两份文档在标准库默认视图问题上冲突，以本文为准；其他数据库连接、字段映射、导出和 Books Tracker 边界仍以主设计文档为准。

## 18. 最终原则

1. **一库多视图，不拆多库。** 数据契约统一，任务入口分开。
2. **标准库可初始化，用户库不越界。** 自动写操作只发生在本次新建资源内。
3. **四个入口足够。** 最近导入兼任全量入口；书籍笔记、待复盘、复盘与报告覆盖其余主任务。
4. **按能力升级，不扩大爆炸半径。** 新 discovery/view 请求使用新版本，既有导出请求无必要不改。
5. **先写创建意图，再产生远端副作用。** database POST 前落盘，拿到 ID 后立即补写；稳定连接只在 schema 成功后切换。
6. **拿到 ID 后不再返回“什么都没创建”。** 后续失败使用结构化`recoveryRequired/partial` outcome，并始终保留数据库链接。
7. **前端超时不是重建依据。** 任何超时先查询 provisioning 状态；未完成或未知状态禁止第二次 database POST。
8. **重试先对账。** 任何未知的 view 结果都先 List + Retrieve，再决定是否创建。
9. **同名不等于同配置。** 只有关键配置等价才复用，否则明确冲突。
10. **正确性幂等不是后期增强。** 防重复建库、未知结果保护和视图创建前对账必须与各自副作用同一期交付。
11. **默认不是强制。** 用户后续拥有视图，应用不持续覆盖。
