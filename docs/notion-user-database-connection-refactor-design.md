# Notion 用户数据库接入改造设计

> **文档状态**：v1.0.17 数据库连接主路径、标准库 provisioning 安全、默认视图、真实 Views API 验收与页面创建标签写入均已完成
> **日期**：2026-08-01
> **实施更新**：2026-08-04
> **适用范围**：Notion 凭据、数据库连接、字段兼容、导出目标、标准数据库初始化
> **核心裁决**：Notion 主路径由“应用创建/拼接模板工作台”改为“连接用户自定义数据库”；应用只维护同步契约和可选的标准数据库兜底，不再维护一套面向用户的完整 Notion 视觉模板。标准库默认视图的专项裁决见 `docs/notion-standard-outcomes-database-default-views-design.md`。

## 1. 背景

当前 Notion 设置同时承载以下概念：

- 推荐第三方 Books Tracker 模板；
- 接入现有模板；
- 创建基础 Notion 工作台；
- 创建 `阅读成果库`；
- 展示模板字段和工作台预览；
- 手动配置高级 Page / Database 目标。

这些能力在技术上可以共存，但在产品层形成了重复心智：用户不清楚自己是在复制模板、创建数据库、连接现有数据库，还是配置导出目标。

与此同时，应用真正不可替代的价值不是 Notion 首页布局，而是：

1. 安全保存和验证 Notion Integration Token；
2. 识别用户指定的目标数据库；
3. 检查数据库是否可写以及字段是否兼容；
4. 将微信读书笔记、AI 复盘、阅读路线、统计复盘和选书决策稳定写入；
5. 在目标结构不完整时给出可理解、可恢复的处理方式。

Notion 本身已经提供成熟的视图、公式、Relation、筛选、排序和仪表盘编辑能力。应用继续维护视觉工作台会增加用户决策成本、模板兼容承诺和长期维护成本，也会与用户已有 Notion 体系形成平行结构。

因此，本次改造将产品边界收敛为：

> **wxreadmaster 管数据契约和稳定导出，用户管数据库结构选择与 Notion 展示。**

## 2. 设计结论

### 2.1 主路径

用户粘贴一个已共享给 Integration 的 Notion 数据库链接或 ID，应用执行只读检查，识别标题字段和可兼容属性；用户确认后将其保存为默认 Notion 导出目标。

### 2.2 兜底路径

如果用户没有合适的数据库，可选择“一键创建标准阅读成果库”。应用在用户指定的父页面下创建一张带推荐字段的数据库；只有 schema 分析与正式连接保存成功后，才将其设为默认导出目标。

兜底路径只新增一张数据库，并按专项设计在该新库中初始化最小推荐视图；不再创建：

- `微信读书知识库` 首页；
- 阅读仪表盘；
- 首页引导块；
- 完整视觉工作台或模板预览承诺的复杂布局；
- 与第三方模板绑定的视觉区块。

远端 database POST 前必须先写入本地 provisioning 创建意图；拿到 database ID 后立即补写恢复锚点。后续 schema、正式连接或推荐视图失败均从该状态继续，不得把普通 command error 或前端超时当作再次创建数据库的依据。

2026-08-03 真实 Views API 验收已验证该边界：本次标准库只执行一次 database POST；schema analysis 的短暂网络失败后，应用使用已知 database ID 和同一 provisioning ID 安全恢复。四个推荐 Table 视图最终全部按原 view ID `reused` 并进入 `complete`，再次续跑仍保持相同 database/data source/view ID。真实响应的 property ID URL 编码差异、隐藏属性补齐和布尔默认值省略已在视图 fingerprint 中做有限规范化；用户已有数据库、旧标准库、手工 Gallery 和其他自定义视图仍不进入自动 mutation 范围。

### 2.3 模板定位

第三方 Notion 模板不再是通用导出的主流程。

- 可以在帮助文档中作为使用示例；
- 可以保留经过验证的专用适配器；
- 不再以“接入任意模板”描述通用能力；
- 不要求用户先复制推荐模板才能使用 Notion 导出。

### 2.4 产品命名

当前功能是单向写入，不包含 Notion 到 wxreadmaster 的持续读取与合并，因此统一使用：

- 一级名称：`Notion 导出`；
- 配置动作：`连接数据库`；
- 目标名称：`导出数据库`；
- 资源创建：`创建标准阅读成果库`。

不再将该功能称为“Notion 同步”或“Notion 阅读库导入”。

## 3. 目标

- 用户无需理解“工作台模式”和“现有模板模式”的差异。
- 已有 Notion 数据库的用户可以直接连接，不被迫创建第二套数据库或首页。
- 用户自定义字段、视图、公式和布局的所有权保持在 Notion 内。
- 应用在连接前明确展示兼容结果，不以静默跳过掩盖字段不匹配。
- 没有数据库的新用户仍可一键获得可用的标准数据库。
- 当前五类阅读资产继续使用同一条 Notion 导出管线。
- 保留标题与正文的最低可用导出能力，同时为完整元数据提供字段映射能力。
- 降低模板特定代码、文案、测试和支持成本。

## 4. 非目标

- 不做 Notion 到 wxreadmaster 的双向同步。
- 不自动重写用户数据库的视图、筛选、公式和 Relation。
- 不自动猜测任意第三方模板的完整业务含义。
- 不删除或迁移用户已经创建的 Notion 页面和数据库。
- 不按书名或作者做高风险的自动去重合并。
- 不在本次改造中实现后台定时同步。
- 不将 Books Tracker 专用适配逻辑泛化为“万能模板适配器”。
- 不要求任意用户数据库包含应用的全部推荐字段。

## 5. 当前实现盘点

### 5.1 前端设置页

`src/pages/SettingsPage.tsx` 当前包含：

- `NOTION_RECOMMENDED_TEMPLATE_URL` 推荐模板常量；
- `existingTemplate | workspace` 两种初始化模式；
- 推荐模板、字段标签和工作台预览；
- 父页面链接输入；
- `创建阅读成果库` 与 `创建基础工作台` 两条调用；
- 高级目标手动配置。

其中“高级目标”实际上已经具备连接用户数据库的基础能力，但被放在次级位置，且缺少连接前检查和字段兼容反馈。

### 5.2 前端 API

`src/lib/reading-api.ts` 当前提供：

- `saveNotionExportSettings`；
- `createNotionReadingLibraryTemplate`；
- `createNotionReadingWorkspaceTemplate`；
- 凭据保存、删除和验证。

缺少专门的数据库只读分析接口和字段映射保存接口。

### 5.3 后端导出器

`src-tauri/src/export/notion.rs` 已具备以下可复用能力：

- 目标为数据库时读取 schema；
- 自动识别 Title 属性，不强制标题字段名为 `名称`；
- 仅在属性名称和类型匹配时写入元数据；
- 用户删除非必要字段后，标题和正文仍可继续导出；
- 支持 Page Cover 和正文封面策略。

当前主要限制是元数据匹配仍依赖固定中文字段名称。用户使用 `Author`、`Type`、`Created at` 等字段名时，相应数据会被静默跳过。

### 5.4 标准数据库创建

`create_notion_reading_library_template` 已能在父页面下创建 `阅读成果库` 并保存为默认目标，可以直接改名并保留为兜底能力。

`create_notion_reading_workspace_template` 会额外创建首页和引导块。改造后退出主流程，进入兼容保留期，最终删除。

### 5.5 Books Tracker 专用适配

项目已有：

- `src-tauri/src/export/notion_tracker.rs`；
- `src-tauri/src/commands/notion_tracker.rs`。

该适配器可分析 Book Library、增加 Book ID、创建/复用成果库并建立 Relation，但当前未在 `src-tauri/src/lib.rs` 注册命令，前端也没有接入。

本次改造不把它并入通用流程。后续若启用，应作为明确标注的“Books Tracker 专用连接”，独立于普通数据库连接，并继续要求用户在实际写入前确认外部变更。

## 6. 目标信息架构

设置页的 Notion 区域改为四层：

```text
Notion 导出

连接状态
  Token 已保存 / 未保存
  数据库已连接 / 未连接

1. 连接 Notion
  Integration Token
  [验证连接]

2. 连接导出数据库
  数据库链接或 ID
  [检查数据库]

  检查结果
    数据库名称
    标题字段
    可写权限
    已兼容字段
    待映射字段
    不兼容字段
  [配置字段映射]
  [设为导出数据库]

没有数据库？
  [创建标准阅读成果库]

高级
  封面策略
  当前数据库 ID
  目标类型
  断开连接
```

### 6.1 删除的设置内容

- 推荐模板主卡片；
- Books Tracker 外链作为主操作；
- `接入现有模板 / 创建基础工作台` 双模式控件；
- 工作台视觉预览；
- 模板字段装饰性预览；
- `复制视图配方`；
- 面向普通用户的 Page / Database 类型选择。

### 6.2 高级目标的处理

普通流程只接受 Database 目标。直接向父页面写子页面的 Page 模式保留在高级区域，用于兼容已有用户，但不作为推荐路径。

理由：数据库目标可以提供可筛选、可映射的结构化属性；Page 模式只有页面正文，无法提供一致的成果管理体验。

## 7. 用户流程

### 7.1 首次连接用户已有数据库

1. 用户创建 Notion Integration，并把目标数据库共享给该 Integration。
2. 用户在设置页填写 Token，点击“验证连接”。
3. 用户粘贴数据库链接或 ID。
4. 应用解析 ID 并执行只读检查。
5. 页面展示数据库名称、权限、标题字段和字段兼容结果。
6. 如果存在待映射字段，用户可进入字段映射，也可以先按最低兼容模式连接。
7. 用户点击“设为导出数据库”。
8. 应用保存数据库 ID、目标类型和字段映射快照。
9. 后续导出默认写入该数据库。

### 7.2 用户没有数据库

1. 用户完成 Token 验证。
2. 点击“创建标准阅读成果库”。
3. 填写或粘贴一个已共享的父页面链接或 ID。
4. 应用明确提示：只会新增一张数据库，并在该新库内初始化最小推荐视图；不会创建首页，也不会修改其他数据库或页面。
5. 用户确认后，应用先写入本地 provisioning 创建意图，再发送一次数据库创建请求。
6. 拿到 database ID 后立即保存恢复锚点；数据库 schema 分析成功后保存为默认导出目标，再按专项设计初始化推荐视图。
7. schema 或连接保存失败时显示数据库链接和“继续初始化”，不声称已可导出；视图失败不撤销已保存的连接。
8. 页面展示“打开阅读成果库”、连接状态和推荐视图初始化状态。前端超时后先查询 provisioning 状态，不直接再次创建。

### 7.3 用户更换数据库

1. 用户输入新数据库并执行检查。
2. 如果当前已有导出目标，确认框明确显示旧目标与新目标。
3. 用户确认后仅切换本地配置，不迁移历史 Notion 页面。
4. 原数据库及其中内容保持不变。

### 7.4 数据库结构发生变化

导出前继续读取实时 schema；发生以下情况时：

- 标题属性仍存在：正文导出继续；
- 可选字段被删除：跳过该字段并返回 warning；
- 映射属性改名但 property ID 未变：继续写入；
- 映射属性类型变化：跳过并提示重新检查映射；
- 标题属性缺失：阻止导出并提示修复数据库。

## 8. 兼容等级

数据库检查结果分为三级：

| 等级 | 条件 | 能力 | UI 状态 |
| --- | --- | --- | --- |
| 完整兼容 | 有 Title，核心字段已映射且类型正确 | 标题、正文和主要元数据均可写入 | 绿色，可直接连接 |
| 基础兼容 | 有 Title，但部分元数据字段缺失 | 标题和正文可写入，部分元数据跳过 | 黄色，允许连接 |
| 不可连接 | 无 Title、无访问权限或对象不是数据库 | 无法可靠创建页面 | 红色，禁止连接 |

### 8.1 最低契约

用户数据库只需满足：

- 是 Integration 可访问的 Notion 数据库；
- 至少包含一个 Title 属性。

### 8.2 推荐契约

完整元数据建议支持：

| 逻辑字段 | 推荐类型 | 必需性 |
| --- | --- | --- |
| 标题 | Title | 必需 |
| 作者 | Rich text | 可选 |
| Book ID | Rich text | 可选 |
| 资产类型 | Select | 可选 |
| 来源 | Select | 可选 |
| 导出时间 | Date | 可选 |
| 导入状态 | Select / Status | 可选 |
| 阅读状态 | Select / Status | 可选 |
| 阅读阶段 | Select / Status | 可选 |
| 进度 | Number | 可选 |
| 标签 | Multi-select | 可选 |
| 微信读书 | URL | 可选 |
| Obsidian 路径 | Rich text | 可选 |
| Prompt 版本 | Rich text | 可选 |
| 输入哈希 | Rich text | 可选 |
| Scope ID | Rich text | 可选 |
| 周期 | Select | 可选 |
| 行动数、候选书数、划线数、想法数、书签数、可导出数 | Number | 可选 |

缺少任何可选字段都不得阻止正文导出。

### 8.3 Select / Status / Multi-select 选项约束

Notion 的选项类属性要求字段类型兼容，并可能在页面创建时对值做额外校验。v1.0.17 对普通数据库连接采用以下实际规则：

- 只读分析可以读取已有选项，但不会单独 PATCH 用户数据库 schema，也不会新增、重命名或删除属性；
- `multi_select` 标签先执行 trim、空值过滤和首次出现顺序去重，再随正常页面创建请求提交；
- Notion 接受未知标签时，由 Notion 在页面写入流程中处理对应选项；应用不额外发起 schema mutation；
- Notion 拒绝标签或页面属性时，不再把未知标签静默跳过并报告成功，而是让对应资产 × Notion 目标明确失败，保留结构化错误供修复和精确重试；
- `select` 和 `status` 仍按兼容类型与现有映射保守写入，不为未知值盲目修改用户数据库；
- 缺少任何可选字段时，继续省略该属性，标题和正文按最低兼容契约导出。

标准阅读成果库仍可在创建 schema 时预置少量通用标签选项，当前为 `重点`、`待复盘`、`可行动`；这只适用于应用主动创建的新数据库，不代表应用会后台改造用户已有数据库。

## 9. 字段映射设计

### 9.1 为什么需要字段映射

只允许用户自定义数据库而不提供字段映射，会导致“看似支持任意数据库，实际只写标题和正文”。这不符合诚实性原则。

字段映射需要把应用的逻辑字段与 Notion 的实际属性绑定，并保存 property ID，以抵抗显示名称变化。

### 9.2 映射模型

```ts
type NotionLogicalField =
  | "title"
  | "author"
  | "bookId"
  | "assetType"
  | "source"
  | "exportedAt"
  | "importStatus"
  | "readingStatus"
  | "readingStage"
  | "progress"
  | "tags"
  | "wereadUrl"
  | "obsidianPath"
  | "promptVersion"
  | "inputHash"
  | "scopeId"
  | "period"
  | "actionCount"
  | "candidateCount"
  | "highlightCount"
  | "thoughtCount"
  | "bookmarkCount"
  | "exportableCount";

type NotionPropertyMapping = {
  logicalField: NotionLogicalField;
  propertyId: string;
  propertyNameSnapshot: string;
  propertyType: string;
  enabled: boolean;
};

type NotionDatabaseConnection = {
  databaseId: string;
  databaseName?: string;
  databaseUrl?: string;
  titlePropertyId: string;
  titlePropertyNameSnapshot: string;
  mappings: NotionPropertyMapping[];
  schemaCheckedAt: string;
  schemaFingerprint?: string;
};
```

### 9.3 自动映射顺序

只读检查按以下优先级生成建议：

1. Title 类型自动映射为标题；
2. 先按历史保存的 property ID 恢复；
3. 再按标准字段名精确匹配；
4. 再按有限的内置别名匹配，如 `作者 / Author`；
5. 无法安全判断时保持未映射，交给用户选择；
6. 不基于模糊语义自动写入可能有副作用的字段。

### 9.4 类型约束

每个逻辑字段只展示兼容类型的候选属性。例如：

- `author` 只允许 Rich text；
- `exportedAt` 只允许 Date；
- `tags` 只允许 Multi-select；
- `progress` 只允许 Number；
- `wereadUrl` 只允许 URL。

Title 为唯一必选映射，其他映射均允许关闭。

### 9.5 映射失效

如果 property ID 不存在或类型与保存值不一致：

- 当前字段停止写入；
- 其他字段和正文继续；
- 导出结果返回结构化 warning；
- 设置页状态变为“需要重新检查”；
- 不自动改造用户数据库。

## 10. 后端接口设计

### 10.1 分析数据库

新增 Tauri command：

```rust
#[tauri::command]
pub async fn analyze_notion_database(
    app: AppHandle,
    database_id: String,
) -> Result<AnalyzeNotionDatabaseResponse, AppCommandError>
```

响应建议：

```ts
type AnalyzeNotionDatabaseResponse = {
  databaseId: string;
  databaseName?: string;
  databaseUrl?: string;
  titleProperty?: NotionPropertySummary;
  properties: NotionPropertySummary[];
  suggestedMappings: NotionPropertyMapping[];
  compatibility: "full" | "basic" | "invalid";
  issues: NotionDatabaseIssue[];
};
```

该接口必须只读，不保存设置、不创建属性、不创建页面。

### 10.2 保存连接

新增或扩展保存命令：

```rust
#[tauri::command]
pub fn save_notion_database_connection(
    app: AppHandle,
    connection: NotionDatabaseConnection,
    cover_mode: NotionCoverMode,
) -> Result<SettingsStateResponse, AppCommandError>
```

保存前再次验证：

- database ID 格式；
- Title 映射存在；
- property ID 与类型合法；
- 映射逻辑字段不重复。

### 10.3 创建标准数据库

将对外函数和文案由 template 改为 standard database：

```rust
#[tauri::command]
pub async fn create_notion_standard_outcomes_database(
    app: AppHandle,
    parent_page_id: String,
) -> Result<CreateNotionStandardDatabaseResponse, AppCommandError>
```

首个兼容版本可以内部复用 `create_notion_reading_library_template`，但新前端只调用新命名。待迁移完成后删除旧命令。

### 10.4 导出接口

现有各类 `export_*_targets` 的外部契约不需要改变。Notion 导出器内部改为：

1. 读取当前数据库 schema；
2. 读取保存的 property ID 映射；
3. 以 property ID 优先定位当前属性；
4. 仅当保存的映射列表整体为空时，启用标准名称兼容逻辑；新配置中的未映射或 disabled 字段严格视为“不导出”；
5. 构建可写属性；
6. 创建页面和正文 blocks；
7. 返回成功 URL 与字段级 warnings。

## 11. 配置存储与迁移

### 11.1 兼容现有配置

现有配置包含：

- `notion_parent_id`；
- `notion_parent_type`；
- `notion_cover_mode`。

改造后新增独立的数据库连接映射配置，不在首版强制迁移旧配置格式。

### 11.2 迁移规则

| 现有状态 | 迁移结果 |
| --- | --- |
| `parentType = database` 且数据库可访问 | 保留为当前目标，首次进入设置或首次导出时补做只读分析 |
| `parentType = database` 但不可访问 | 保留 ID，不清空；显示“需要重新连接” |
| `parentType = page` | 继续兼容，标记为高级页面目标，不自动转换数据库 |
| 由旧工作台创建的 `阅读成果库` | 视为普通用户数据库，照常连接 |
| 已有 Books Tracker 配置 | 不删除；仅在专用适配器真正启用时读取 |

### 11.3 不做自动远端迁移

本地升级不得：

- 删除旧工作台首页；
- 移动旧成果页；
- 修改数据库名称；
- 删除旧数据库字段；
- 自动给数据库增加缺失字段。

## 12. 前端状态设计

建议使用明确状态机，而不是多个相互独立布尔值：

```ts
type NotionConnectionStage =
  | "idle"
  | "validatingCredential"
  | "analyzingDatabase"
  | "analysisReady"
  | "savingConnection"
  | "creatingStandardDatabase"
  | "connected"
  | "error";
```

关键临时状态：

```ts
type NotionDatabaseDraft = {
  input: string;
  normalizedDatabaseId?: string;
  analysis?: AnalyzeNotionDatabaseResult;
  mappings: NotionPropertyMapping[];
  dirty: boolean;
};
```

规则：

- 数据库输入变化后，旧分析结果立即失效；
- 未完成分析不能保存普通数据库连接；
- 保存失败不清空输入和映射；
- 切换目标必须二次确认；
- 创建数据库进行中禁止重复提交；
- 网络结果未知时不自动重试创建数据库。

## 13. 文案规范

| 旧文案 | 新文案 |
| --- | --- |
| Notion 阅读库导入 | Notion 导出 |
| 接入现有模板 | 连接已有数据库 |
| 创建基础工作台 | 创建标准阅读成果库 |
| 在模板中创建阅读成果库 | 创建标准阅读成果库 |
| 父页面链接或 ID | 数据库链接或 ID（连接流程）/ 父页面链接或 ID（建库流程） |
| 模板字段预览 | 数据库兼容结果 |
| 高级目标 | 高级设置 |
| 目标已配置 | 数据库已连接 |
| 复制视图配方 | 删除 |

警告文案必须明确能力降级，例如：

```text
该数据库可以接收标题和正文，但“作者、资产类型、导出时间”尚未映射。你可以先连接，或配置字段映射后获得完整元数据。
```

禁止只显示“连接成功”，却不说明元数据被跳过。

## 14. 标准阅读成果库

### 14.1 保留理由

完全要求用户自行建库会提高首次使用门槛。标准数据库仍然有价值，但它应是：

- 快速起步工具；
- 稳定 schema 参考实现；
- 无现有数据库用户的兜底；
- 测试和排障时的基准目标。

它不再承担完整 Notion 产品体验或视觉模板职责。

### 14.2 创建内容

保留当前 `reading_library_template_properties()` 的标准字段集合，但在实现前复核字段必要性。可考虑默认仅创建核心字段，将低频统计字段作为后续可选扩展；首版为降低迁移风险，可以保持当前字段集合不变。

### 14.3 创建后的行为

- database POST 前先原子写入 provisioning 创建意图，拿到 database ID 后立即保存恢复锚点；
- schema 分析与完整连接保存成功后，才设为默认导出数据库并写入字段映射；
- schema 或连接保存失败时保留数据库 ID/URL，显示“继续初始化”，但不声称已可导出；
- 显示数据库链接；
- 不自动创建首页或仪表盘；应用本次新建的标准库按专项设计初始化最小推荐视图；
- 视图能力不可用或初始化部分失败时保留已保存的导出连接，并明确显示降级状态；
- 不展示第三方模板推荐；
- 用户可在 Notion 中自由删除可选字段，后续导出相应降级。

## 15. Books Tracker 边界

Books Tracker 不是普通数据库连接的前置能力。

后续若启用专用适配器，应满足：

- 设置页放在“专用集成”或独立帮助入口；
- 明确只支持经过验证的 Books Tracker 版本；
- 分析阶段只读；
- 修改 Book Library、增加 Book ID 和 Relation 前列出变更并二次确认；
- 普通数据库导出不依赖 tracker 配置；
- 专用适配失败时允许退回独立成果数据库导出；
- 不再以“接入任意模板”承诺相同能力。

当前后端命令未注册、前端未接入。在通用数据库改造完成前，不应优先开放该能力。

## 16. 实施分期

本章 P0-P3 仅描述“用户数据库连接主路径”原改造的分期和历史实施状态。标准库 provisioning、防重复建库、部分成功契约和默认视图不复用本章编号，统一按 `docs/notion-standard-outcomes-database-default-views-design.md` 第 15 节的专项 P0-P3 执行；其中专项 P0 创建安全是上线任何新建标准库流程的前置条件。

### P0：收敛主流程

- 设置页标题和文案统一为 Notion 导出。
- 将现有高级数据库目标提升为主路径。
- 新增数据库链接解析、只读分析和兼容等级展示。
- 普通流程只接受 Database 目标。
- 删除推荐模板卡片、工作台预览和初始化双模式。
- 保留“一键创建标准阅读成果库”兜底。
- 旧 Page 目标移入高级设置。
- 不改现有导出文档和正文 blocks 生成逻辑。

### P1：字段映射

- 新增逻辑字段到 property ID 的映射模型。
- 增加自动建议、手动映射和类型过滤。
- 导出器按 property ID 写入属性。
- 导出结果增加字段级 warning。
- 数据库 schema 变化时显示“需要重新检查”。

### P2：清理旧实现

- 删除 `create_notion_reading_workspace_template` 前端入口。
- 删除完整工作台创建代码和对应首页 blocks。
- 删除 `NotionInitializationMode`。
- 删除推荐模板常量、工作台预览样式和测试。
- 旧命令经过一个兼容版本后从 Tauri 注册中移除。
- 更新所有 Notion 设计文档的状态和冲突说明。

### P3：可选专用适配

- 决定是否正式启用 Books Tracker 专用适配器。
- 若启用，注册相关命令并开发独立前端流程。
- 若不启用，删除未接通的 command 和 tracker 实现，避免长期死代码。

## 17. 代码改造清单

### 17.1 前端

| 文件 | 改造 |
| --- | --- |
| `src/pages/SettingsPage.tsx` | 重写 Notion 分区；删除模板双模式和工作台预览；新增数据库分析、兼容结果和映射入口 |
| `src/pages/SettingsPage.test.tsx` | 从“默认接入模板”测试改为数据库连接、基础兼容、切换确认和创建标准库测试 |
| `src/lib/reading-api.ts` | 新增 analyze/save connection/create standard database API；旧 workspace API 标记弃用 |
| `src/lib/types.ts` | 新增数据库分析、属性摘要、字段映射和连接配置类型 |
| `src/lib/notion-page-id.ts` | 拆分或扩展为数据库对象 ID 解析；保留 URL 与纯 ID 支持 |
| 设置页样式文件 | 删除模板预览样式，新增兼容状态和映射表样式 |

### 17.2 Tauri / Rust

| 文件 | 改造 |
| --- | --- |
| `src-tauri/src/commands/settings.rs` | 新增分析、保存连接、创建标准数据库命令；旧工作台命令弃用 |
| `src-tauri/src/services/settings.rs` | 增加连接验证、映射保存和旧配置迁移 |
| `src-tauri/src/export/notion.rs` | 暴露 schema 分析；按 property ID 映射写入；返回字段 warning；保留标准字段名回退 |
| `src-tauri/src/export/targets.rs` | 如有需要扩展 Notion 连接配置，不改变目标枚举语义 |
| `src-tauri/src/db.rs` 或独立配置模块 | 存储数据库连接与字段映射 |
| `src-tauri/src/lib.rs` | 注册新命令；旧命令按兼容周期移除 |
| capability 配置 | 增加新命令权限，删除退役命令权限 |

### 17.3 文档

需要标记为历史方案或补充冲突说明：

- `docs/notion-existing-template-library-flow-design.md`；
- `docs/notion-reading-workspace-ui-design.md`；
- `docs/notion-page-content-template-design.md`；
- `docs/notion-reading-library-template-design.md`；
- `docs/notion-reading-outcomes-workspace-design.md`；
- `docs/notion-books-tracker-deep-integration-design.md`；
- `docs/functional-consolidation-blueprint.md` 中 Notion 工作台和自动视图相关表述。

裁决原则：关于 Notion 主流程、完整工作台和用户数据库职责的冲突，以本文为准。

## 18. 测试策略

### 18.1 前端测试

- 未保存 Token 时可以输入，但检查数据库会得到明确凭据提示。
- Token 验证成功后状态正确更新。
- 支持完整 Notion 数据库 URL 和纯 UUID。
- 输入变化会清除旧分析结果。
- 完整兼容数据库显示可直接连接。
- 只有 Title 的数据库显示基础兼容并允许连接。
- 无 Title 数据库禁止连接。
- 切换已有目标必须确认。
- 保存失败不清空输入和映射。
- 创建标准数据库前要求父页面，创建中不能重复点击。
- UI 不再出现“接入现有模板”“创建基础工作台”“复制 Books Tracker 模板”。

### 18.2 Rust 单元测试

- schema 分析可以识别任意名称的 Title。
- 标准名称可以生成自动映射。
- property ID 映射在显示名称变化后仍有效。
- property 类型变化后对应字段被跳过并产生 warning。
- 缺少可选字段不阻止页面创建。
- 缺少 Title 阻止数据库连接和导出。
- percent 类型进度继续按 0-1 写入。
- Status 没有所需选项时不导致整页失败。
- Multi-select 只保留 schema 已有选项；未知标签被跳过并返回 warning。
- Multi-select 没有任何选项时省略该字段，不阻止整页创建。
- 文档没有标签时不产生多余 warning。
- 标准数据库 payload 仍包含有效 Title、推荐字段和预置通用标签选项。

### 18.3 集成测试

使用 mock Notion API 覆盖：

- GET database 成功、403、404、429、超时；
- 分析接口绝不产生 POST / PATCH；
- 保存连接不会改动远端 schema；
- 创建标准数据库在同一 provisioning 中最多产生一次数据库创建请求；
- database POST 前创建意图写入失败时不发送远端请求；
- 网络结果未知时进入待确认状态，不自动创建第二个数据库；
- database ID 已知后的 schema/连接失败返回可恢复结果并保留 ID/URL；
- 前端超时后先查询 provisioning，不恢复普通创建按钮；
- 长正文部分成功仍返回页面 URL 和 warning；
- 字段映射后页面 payload 使用实际属性。

### 18.4 回归测试

- Obsidian 单目标导出不受影响；
- Obsidian + Notion 双目标导出不受影响；
- 五类阅读资产均可写入基础兼容数据库；
- 旧版本创建的阅读成果库继续可用；
- 高级 Page 目标在兼容期继续工作；
- 封面策略升级前后保持不变。

## 19. 验收标准

### 19.1 产品验收

- [ ] 用户不复制任何 Notion 模板也能完成 Notion 导出配置。
- [ ] Notion 主流程只有“验证连接 → 检查数据库 → 设为导出数据库”。
- [ ] 用户已有数据库不会被应用修改 schema、公式、Relation 或视图。
- [ ] 只有 Title 属性的数据库可以接收标题和正文。
- [ ] 字段缺失或未映射时，界面明确说明降级范围。
- [ ] 没有数据库的用户可以一键创建标准阅读成果库。
- [ ] 标准创建只新增一张数据库，不创建首页或仪表盘；推荐视图仅初始化在本次新建的标准库中。
- [ ] 标准库创建在远端 POST 前保存 provisioning 创建意图；未完成或结果未知时不会盲目创建第二张数据库。
- [ ] 只有正式连接保存成功后才声称标准库可导出；视图失败不撤销已保存连接。
- [ ] 切换数据库不会迁移或删除历史 Notion 内容。
- [ ] 设置页不再将单向导出描述为同步。

### 19.2 技术验收

- [ ] 数据库分析命令为严格只读。
- [ ] 字段映射以 property ID 为主，名称只用于展示和回退。
- [x] 可选字段异常不会阻止标题和正文导出。
- [x] Multi-select 未知值只会跳过并返回 warning，不会修改用户 schema 或导致整页失败。
- [x] 缺少 Title 时不发送创建页面请求。
- [ ] 旧 database 目标无需用户重新配置即可继续导出。
- [ ] Page 目标只存在于高级兼容路径。
- [ ] 标准数据库创建不覆盖用户封面策略。
- [ ] 所有新增 Tauri 命令均注册 capability 并有测试。
- [ ] 旧工作台命令和代码按兼容周期完成清理。

### 19.3 文档验收

- [ ] 用户帮助只讲数据库授权、连接、兼容结果和导出。
- [ ] 第三方模板被描述为可选示例，而不是使用前提。
- [ ] Books Tracker 专用能力与普通数据库能力分开描述。
- [ ] 旧设计文档明确标注历史状态或被本文取代的章节。

## 20. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 用户以为“任意数据库”会自动写入全部字段 | 产生隐性数据缺失 | 兼容等级 + 字段清单 + 明确 warning |
| 字段映射模型增加实现量 | P0 交付变慢 | P0 先做标准名称自动兼容，P1 再交付 property ID 映射 |
| 删除工作台入口影响少量新用户 | 缺少快速起步路径 | 保留创建标准阅读成果库 |
| 旧 Page 目标被误伤 | 已有用户升级后导出失败 | 放入高级兼容路径，至少保留一个版本 |
| Books Tracker 代码成为死代码 | 维护和安全负担 | P3 明确“接通或删除”，不长期悬置 |
| Notion API 版本演进 | database / data source 接口变化 | 将 schema 读取和属性定位集中在适配层，避免散落业务代码 |
| 用户修改 Status / Select / Multi-select 选项 | 页面创建可能 400 | 导出前读取实时 schema；仅写入兼容的已有选项，不兼容值跳过并 warning |

## 21. 发布与迁移建议

### 21.1 第一个版本

- 上线新的数据库连接主界面；
- 保留旧工作台后端命令但不展示入口；
- 自动识别旧 database 目标；
- 保留高级 Page 目标；
- 记录用户连接类型和兼容等级，用于排障，不上传数据库内容。

### 21.2 第二个版本

- 上线字段映射；
- 导出器优先使用 property ID；
- 将旧固定名称写入逻辑降级为兼容回退；
- 根据迁移数据判断是否可以删除旧工作台命令。

### 21.3 后续版本

- 删除确认无调用的工作台代码和样式；
- 裁决 Books Tracker 专用适配器去留；
- 评估 Notion 新 data source API 迁移，但不扩大本次产品边界。

## 22. 最终原则

1. **数据库优先，模板可选。** Notion 导出不依赖第三方模板。
2. **契约优先，视觉归用户。** 应用保证数据写入，不管理首页布局。
3. **最低可用，逐级增强。** Title + 正文始终可用，元数据通过兼容字段和映射增强。
4. **只读分析，确认后保存。** 检查数据库不产生任何远端写入。
5. **不静默承诺。** 写不了哪些字段必须告诉用户。
6. **不自动改造。** 普通连接不修改用户 schema、公式、Relation 和视图。
7. **保留兜底，不保留双重心智。** 一键建库仍在，完整工作台退出主流程。
