# 全局导出交互重构设计

> **状态**：v1.0.17 已实施单资产统一导出与书籍复盘批量多目标向导；M4 完整导出中心未启动
> **范围**：单资产文档导出、批量导出中的共享目标交互、结果展示与设置边界
> **不包含**：报告图片和笔记卡片图片交付、跨资产多选的完整导出中心、新导出目标、导出历史持久化
> **上位依据**：`functional-consolidation-blueprint.md`、`next-step-priority-design.md`、`GLOSSARY.md`
> **关联设计**：`reading-review-export-dialog-design.md`、`bulk-export-wizard-layout.md`、`bulk-obsidian-notion-export-design.md`
> **产品裁决**：2026-08-02
> **实施更新**：2026-08-04

## 1. 摘要

当前多个页面重复使用同一套导出交互：页面先显示“导出到”下拉框，再显示“一键导出”按钮，导出完成后又在页面正文中各自渲染一套目标结果。底层实际上已经支持 Markdown、Obsidian、Notion 独立多选和目标级结果，页面 UI 却仍依赖单值 `ExportDestination` 与 `obsidianNotion` 组合枚举。

本设计作出以下全局裁决：

1. **单资产页面统一使用共享 `AssetExportDialog`。** 页面只保留一个语义化入口，例如“导出笔记”“导出书籍复盘”“导出阅读路线”。
2. **导出目标改为三个独立多选项。** Markdown、Obsidian、Notion 分别选择，不再把 `Obsidian + Notion` 作为第四个目标。
3. **执行弹窗只读消费长期配置。** Markdown 目录、Obsidian Vault、Notion 凭据与数据库继续由设置页管理；弹窗不提供“更改保存位置”等重复设置入口。
4. **完整结果留在弹窗内。** 页面正文不再重复渲染目标级结果；toast 只作辅助通知，不能成为结果事实源。
5. **批量流程保留专用向导。** `NotesPage` 和 `BookReviewExportDialog` 不改造成轻量单资产弹窗，只复用目标选择、配置摘要、错误与结果组件。
6. **图片交付保持独立。** 报告图片、笔记卡片图片的生成、下载、保存到相册和分享不进入文档导出弹窗。
7. **本设计不是 M4 完整导出中心。** 它只收敛现有页面的执行交互和共享组件，为 M4 的“资产多选 × 目标选择 × 预检”导出中心提供可复用基础。
8. **v1.0.17 批量执行态使用独立页面。** 书籍复盘批量向导在提交后隐藏设置内容与普通底部操作，执行期间不可关闭；完成后进入结构化结果页。
9. **Notion 新标签随页面创建写入。** 标签清理并稳定去重后直接进入 `multi_select` 页面属性，不额外 PATCH 数据库 schema；Notion 拒绝时对应资产 × 目标明确失败。

目标架构：

```text
单资产页面
  → 语义化“导出…”按钮
  → AssetExportDialog
  → ExportTargetSelector
  → ExportDestinationSummary
  → ExportResultList / ExportFailurePanel

批量笔记
  → NotesPage 专用 BulkExportWizard
  → 复用目标选择、配置状态和目标结果组件

批量书籍复盘
  → BookReviewExportDialog
  → 保留资产选择与三步流程
  → 复用目标选择、配置状态和目标结果组件

图片交付
  → ReportGenerationWizardDialog / 图片卡片操作
  → 不进入文档导出框架

长期配置
  → SettingsPage
  → 导出目录 / Obsidian / Notion 的唯一编辑入口
```

## 2. 背景与问题审计

### 2.1 单资产页面重复同一种交互

现行代码至少在以下页面维护相近状态：

```ts
const [exportDestination, setExportDestination] =
  useState<ExportDestination>("markdown");

const [exportResult, setExportResult] =
  useState<MultiTargetExportResponse>();
```

并使用相近的操作区：

```tsx
<button>
  {isExporting ? "导出中" : "一键导出"}
</button>

<label className="compact-export-select">
  <span>导出到</span>
  <select value={exportDestination}>
    <option value="markdown">Markdown</option>
    <option value="obsidian">Obsidian</option>
    <option value="notion">Notion</option>
    <option value="obsidianNotion">Obsidian + Notion</option>
  </select>
</label>
```

受影响页面包括：

| 页面 | 当前资产 | 当前问题 |
| --- | --- | --- |
| `ReadingReviewPage` | 周期复盘 | 下拉框与“一键导出”并列，完整结果进入正文 |
| `BookAiSummaryPage` | 书籍复盘 | 同一模式重复，另有复制完整复盘操作 |
| `BookNotesPage` | 单本笔记 | 手工处理 `obsidianNotion`，另有笔记卡片图片交付 |
| `ReadingRoutePage` | 阅读指南或阅读路线 | 同一页面需要根据当前资产动态命名入口 |
| `BookDecisionPage` | 选书决策 | 单值目标和页面正文结果重复 |

这些页面的差异主要是“导出的资产是什么”和“调用哪个命令”，不是目标选择与结果交互本身。继续为每页复制弹窗会把当前重复从工具栏搬进五套新组件，不能解决结构问题。

### 2.2 “一键导出”与真实行为不一致

当前用户需要：

```text
先选择“导出到”
  → 再点击“一键导出”
```

因此按钮既不是完整入口，也不是一键完成。紧凑下拉框还无法清楚承载：

- 多个目标同时选择；
- 目标是否已经配置；
- 真实保存目录、Vault 或 Notion 数据库；
- 部分成功；
- 目标级警告和失败；
- 失败目标重试；
- Web 只读预览和移动端能力差异。

### 2.3 组合枚举与底层契约错位

现行前端兼容层：

```ts
export type ExportDestination =
  | "markdown"
  | "obsidian"
  | "notion"
  | "obsidianNotion";
```

底层真实契约则是目标数组：

```ts
export type ExternalExportTarget =
  | "markdown"
  | "obsidian"
  | "notion";

export type MultiTargetExportRequest = {
  targets: ExternalExportTarget[];
};
```

`obsidianNotion` 只是旧 UI 为表达两个选项同时选中而产生的组合值。若未来再增加目标，组合枚举会指数增长。共享 UI 必须直接维护 `ExternalExportTarget[]`，不再制造组合目标。

### 2.4 页面正文重复承担结果中心

多个页面在主要内容之后渲染 `export-result-list` 或 `book-notes-export-results`。这会造成：

- 导出动作发生在页头，结果出现在用户可能看不到的正文位置；
- 每页重复实现成功、失败、路径、URL 和警告展示；
- 用户关闭或滚动页面后难以理解当前结果属于哪次执行；
- toast 与正文结果可能形成两套不同摘要；
- 后续重试和“前往设置”没有稳定容器。

完整结果应与本次导出上下文一起保留在弹窗结果态。

### 2.5 设置职责已经存在

`SettingsPage` 已负责：

- Markdown 导出目录的选择、输入、保存和恢复默认；
- Obsidian Vault、附件模式和导出后打开设置；
- Notion 凭据、父级目标、数据库连接、字段映射和相关校验。

因此所有执行弹窗都不得再出现：

- “更改保存位置”；
- “选择 Vault”；
- Token 输入框；
- Notion 数据库连接编辑器；
- 字段映射编辑器。

弹窗应只读展示当前事实；配置异常时提供“前往设置”。

## 3. 产品目标与非目标

### 3.1 目标

- 让所有单资产页面使用一致的导出心智模型。
- 页面只保留一个与资产一致的导出入口。
- 支持 Markdown、Obsidian、Notion 独立单选或多选。
- 执行前明确展示目标配置状态和实际目的地摘要。
- 复用现有 `MultiTargetExportRequest` / `MultiTargetExportResponse`。
- 统一展示成功、失败、跳过、警告和顶层命令错误。
- 失败后保留用户选择，支持返回选择或重试失败目标。
- 批量流程复用共享部件，但不损失预检、策略、并发、进度和取消能力。
- 明确桌面、移动端和 Web 只读预览的能力边界。
- 为 M4 完整导出中心沉淀稳定组件，而不提前扩张 M4 产品范围。

### 3.2 非目标

本设计不做：

- 跨页面、跨资产类型的统一资产多选；
- 导出任务历史、后台队列或持久化重试中心；
- 新增 PDF、HTML、Word 等目标；
- 双向同步、Notion 页面更新或冲突合并；
- 在执行弹窗中编辑长期设置；
- 自动生成缺失的书籍复盘、周期复盘、阅读指南、阅读路线或选书决策；
- 打开弹窗时自动同步微信读书远端；
- 打开弹窗时自动连接 Notion 或创建数据库；
- 合并报告图片和笔记卡片图片交付；
- 为 Web 只读预览伪造本地可执行能力；
- 在 T9 / M1 RC 门禁完成前直接扩大实现范围。

## 4. 全局产品裁决

### 4.1 页面入口使用资产语义，不再使用“一键导出”

| 页面/场景 | 新入口文案 | 说明 |
| --- | --- | --- |
| 单本笔记 | 导出笔记 | 仅文档目标；笔记卡片图片仍用独立操作 |
| 书籍复盘 | 导出书籍复盘 | 与“复制完整复盘”并列但职责不同 |
| 周期复盘 | 导出周期复盘 | 若页面上下文明确，也可使用“导出报告”，首个接入按专项设计执行 |
| 单本阅读指南 | 导出阅读指南 | 根据当前资产动态生成 |
| 多本阅读路线 | 导出阅读路线 | 根据当前资产动态生成 |
| 选书决策 | 导出选书决策 | 只导出已生成结果 |
| 笔记中心批量 | 批量导出笔记 | 打开专用批量向导 |
| 成果页批量书籍复盘 | 导出书籍复盘 | 打开现有三步批量对话框 |

入口点击只打开弹窗或向导，不立即写入目标。因此按钮不显示“导出中”；运行状态主要留在弹窗内。执行期间页面入口可以禁用，防止打开第二个实例。

### 4.2 单资产统一，批量保持专用

统一的是以下通用问题：

- 选哪些目标；
- 目标是否可用；
- 实际目的地是什么；
- 各目标执行结果是什么；
- 配置错误如何回到设置；
- 顶层错误如何恢复。

不统一的是资产范围与任务编排：

- 单资产不需要书籍搜索、批量选择和预检；
- 笔记批量需要同步策略、并发、过滤、取消和书籍维度进度；
- 书籍复盘批量需要资产搜索、筛选、选择和内容选项；
- M4 导出中心才负责跨资产类型选择和统一任务历史。

### 4.3 设置页是长期配置唯一事实来源

执行弹窗内的目的地摘要为只读快照：

| 目标 | 展示事实 | 不允许的编辑 |
| --- | --- | --- |
| Markdown | 当前 `exportDir` | 更改目录、恢复默认 |
| Obsidian | 当前 Vault 名称或路径 | 选择 Vault、附件模式设置 |
| Notion | 当前数据库或父级目标、连接状态 | Token、数据库连接、字段映射 |

“前往设置”是恢复路径，不是把设置复制进弹窗。用户从设置返回后，弹窗必须重新读取配置状态，不继续使用旧快照。

### 4.4 目标选择使用独立多选

统一目标顺序：

```text
Markdown
Obsidian
Notion
```

选择规则：

- 每个目标独立选择；
- 至少选择一个目标才能执行；
- 不展示 `Obsidian + Notion` 组合项；
- 选中未就绪目标时不允许提交，并在该卡片内说明原因；
- Markdown 初始默认选中；
- 后续如引入 `settings.exportTargetPreference`，由全局设置提供默认值，页面不得各自持久化一份偏好。

### 4.5 结果事实留在弹窗，toast 只作辅助

`MultiTargetExportResponse.results` 是结果事实源。弹窗根据目标结果展示：

- 目标名称；
- `succeeded | failed | skipped`；
- 路径、URL、页面 ID 或文件数；
- 警告；
- 结构化错误；
- 可用的“打开位置”“打开页面”“前往设置”或“重试”操作。

页面正文默认不保留完整列表。确需保留时只显示最近一次的一行摘要，例如“已完成 2/3 个目标”，并提供“查看详情”重新打开结果弹窗。

## 5. 信息架构与共享组件

### 5.1 `AssetExportDialog`

建议公共接口：

```ts
type AssetExportDialogProps = {
  open: boolean;
  sourceKind: ExportSourceKind;
  assetTitle: string;
  assetDescription?: string;
  availableTargets?: ExternalExportTarget[];
  initialTargets?: ExternalExportTarget[];
  platformMode: "desktop" | "mobile" | "webReadonly";
  onExport: (
    targets: ExternalExportTarget[]
  ) => Promise<MultiTargetExportResponse>;
  onOpenSettings: (
    target: ExternalExportTarget
  ) => void;
  onClose: () => void;
};
```

职责：

- 管理选择态、执行态和结果态；
- 读取或接收统一配置状态；
- 校验目标可执行性；
- 调用页面提供的资产导出适配器；
- 展示目标结果和顶层错误；
- 保留失败后的选择；
- 管理焦点、键盘和响应式布局。

不负责：

- 获取或生成资产正文；
- 决定资产是否存在；
- 编辑设置；
- 处理批量书籍列表；
- 处理图片生成和分享。

### 5.2 组件层级

```text
AssetExportDialog
├── ExportAssetSummary
├── ExportTargetSelector
│   └── ExportTargetCard × 3
├── ExportReadinessNotice
├── ExportProgressPanel
├── ExportResultSummary
├── ExportResultList
│   └── ExportTargetResultCard × N
└── ExportFailurePanel
```

可独立复用组件：

| 组件 | 单资产 | 批量笔记 | 批量书籍复盘 | M4 导出中心 |
| --- | --- | --- | --- | --- |
| `ExportTargetSelector` | 使用 | 使用 | 使用 | 使用 |
| `ExportTargetCard` | 使用 | 使用 | 使用 | 使用 |
| `ExportDestinationSummary` | 使用 | 使用 | 使用 | 使用 |
| `ExportReadinessNotice` | 使用 | 使用 | 使用 | 使用 |
| `ExportTargetResultCard` | 使用 | 每书/每目标复用 | 每资产/每目标复用 | 使用 |
| `ExportFailurePanel` | 使用 | 已有，可统一外观 | 已有，可统一外观 | 使用 |
| `AssetExportDialog` 外壳 | 使用 | 不使用 | 不使用 | 不直接使用 |

### 5.3 资产摘要

弹窗顶部必须说明“本次导出的是什么”，避免同一共享弹窗失去上下文。

示例：

```text
导出书籍复盘
《深度工作》
已生成于 2026-08-02 21:30
```

```text
导出周期复盘
月度 · 2026 年 7 月
```

```text
导出阅读路线
3 本书 · 当前已生成版本
```

资产摘要只展示现有事实，不在导出时触发生成或刷新。

### 5.4 目标卡

目标卡结构：

```text
[✓] Markdown
    保存到：C:\...\exports
    已配置
```

```text
[ ] Obsidian
    Vault：D:\Notes\Reading
    已配置
```

```text
[ ] Notion
    数据库：阅读成果库
    已连接
```

目标卡必须同时表达：

- 是否选中；
- 是否可执行；
- 当前目的地摘要；
- 恢复建议；
- 适用平台。

不能只用颜色表达状态，也不能只显示“默认目录”而隐藏真实落点。

### 5.5 底部操作区

选择态：

```text
[取消]                         [开始导出]
```

执行态：

```text
正在导出到 2 个目标……
```

结果态按结果动态显示：

- 全部成功：`[关闭]`；
- 部分成功：`[关闭] [返回选择] [重试失败目标]`；
- 全部失败：`[返回选择] [重试]`；
- 顶层失败：`[关闭] [返回选择] [重试]`。

执行期间不允许重复提交。若底层没有取消能力，不显示会误导用户的“取消导出”；关闭按钮在执行期间禁用。

## 6. 状态模型

### 6.1 弹窗阶段

```ts
type AssetExportDialogStage =
  | "select"
  | "running"
  | "result";
```

不把执行态塞入多个布尔值，避免出现“同时选择态和结果态”“错误但仍显示运行中”等非法组合。

### 6.2 运行结果

```ts
type AssetExportRunState =
  | { status: "idle" }
  | {
      status: "running";
      targets: ExternalExportTarget[];
    }
  | {
      status: "completed";
      response: MultiTargetExportResponse;
      outcome: "succeeded" | "partial" | "failed" | "skipped";
    }
  | {
      status: "commandFailed";
      error: CommandErrorInfo;
    };
```

`commandFailed` 表示命令在返回目标级结果前整体失败，与 `results[].status === "failed"` 必须区分。

### 6.3 目标配置状态

```ts
type ExportTargetReadiness =
  | "ready"
  | "missing"
  | "invalid"
  | "readonly"
  | "unsupported";

type ExportTargetConfiguration = {
  target: ExternalExportTarget;
  readiness: ExportTargetReadiness;
  destinationLabel: string;
  detail?: string;
  settingsCategory: "export";
  settingsAnchor?: "directory" | "obsidian" | "notion";
};
```

状态语义：

| 状态 | 含义 | 是否可选 | 是否可提交 |
| --- | --- | --- | --- |
| `ready` | 配置完整且平台支持 | 是 | 是 |
| `missing` | 必要配置缺失 | 可聚焦查看 | 否 |
| `invalid` | 配置存在但失效或不完整 | 可聚焦查看 | 否 |
| `readonly` | Web 只读预览 | 否 | 否 |
| `unsupported` | 当前平台不支持 | 否 | 否 |

### 6.4 统一配置解析

建议新增纯函数：

```ts
function resolveExportTargetConfigurations(input: {
  exportData: ExportDataState;
  integrationData: IntegrationDataState;
  platformMode: "desktop" | "mobile" | "webReadonly";
}): ExportTargetConfiguration[];
```

事实映射：

- Markdown 从 `exportData.exportDir` 读取；
- Obsidian 从 `integrationData.obsidian` 读取；
- Notion 从 `integrationData.notion.credential`、父级和 `databaseConnection` 读取；
- 不显示 Token；
- 不在页面组件内重复判断同一配置状态；
- 后端仍需最终校验，前端预检不能替代执行时校验。

## 7. 执行与结果规则

### 7.1 请求

共享弹窗直接提交目标数组：

```ts
const request: MultiTargetExportRequest = {
  targets: selectedTargets
};
```

页面适配器示例：

```ts
<AssetExportDialog
  sourceKind="bookReview"
  assetTitle={book.title}
  onExport={(targets) =>
    exportBookNotesSummaryTargets(book.bookId, reviewFeedback, {
      targets
    })
  }
/>
```

配置权威来源仍为持久化设置和后端。若命令暂时要求显式传递 Vault 或 Notion 父级，适配层可从设置快照构造请求，但不得把弹窗临时输入写回设置。

### 7.2 结果汇总算法

根据 `results` 计算：

```ts
function summarizeExportOutcome(
  results: ExportTargetResult[]
): "succeeded" | "partial" | "failed" | "skipped";
```

规则：

- 所有目标成功：`succeeded`；
- 成功与失败或跳过并存：`partial`；
- 没有成功且至少一个失败：`failed`；
- 全部跳过：`skipped`。

警告不改变成功状态，但必须展示。

### 7.3 部分成功

例如 Obsidian 成功、Notion 失败：

- 顶部显示“部分完成”，而不是笼统失败；
- 保留 Obsidian 成功路径；
- Notion 卡显示错误分类与恢复建议；
- 优先只重试失败目标；
- 不自动重写已成功目标；
- 如果底层不支持安全的目标级重试，界面必须明确说明整体重试限制，不能静默重复写入。

### 7.4 顶层命令失败

命令整体失败时，使用共享 `ExportFailurePanel` 展示：

1. 错误分类标题；
2. 原始可读错误；
3. 恢复建议；
4. 状态保留说明；
5. 返回选择和重试操作。

不得只显示 toast，不得把错误结果态同时显示为运行中。

### 7.5 “前往设置”与返回

建议导航参数：

```ts
type OpenExportSettingsIntent = {
  category: "export";
  anchor: "directory" | "obsidian" | "notion";
  returnContext?: {
    sourceKind: ExportSourceKind;
    sourceId: string;
  };
};
```

规则：

- 点击后关闭或挂起当前弹窗；
- 设置页定位到对应分区；
- 返回资产页面后重新读取配置；
- 可以保留用户之前的目标选择；
- 不复用旧的 readiness 快照；
- 不自动继续执行，仍由用户确认后提交。

## 8. 页面接入矩阵

### 8.1 周期复盘

涉及：

- `src/features/reading-review/components/ReviewHeroSection.tsx`
- `src/features/reading-review/hooks/useReadingReviewPage.ts`
- `src/pages/ReadingReviewPage.tsx`

改造：

- 删除 `exportDestination` 下拉框；
- 入口按专项设计使用“导出报告”，后续统计与周期复盘合并时统一为“导出周期复盘”；
- `handleExport` 改为接收 `ExternalExportTarget[]`；
- 接入共享 `AssetExportDialog`，不新增长期维护的页面专用弹窗；
- 页面正文完整结果迁入弹窗。

`reading-review-export-dialog-design.md` 继续作为首个接入样板和页面级文案规格；公共组件、状态和迁移规则以本文为准。

### 8.2 书籍复盘

涉及：

- `src/pages/BookAiSummaryPage.tsx`

改造：

- 删除单值 `exportDestination`；
- 保留“复制完整复盘”；
- 将“一键导出 + 导出到”改为“导出书籍复盘”；
- 通过适配器把选中的目标数组传给 `exportBookNotesSummaryTargets`；
- 完整结果迁入共享弹窗。

### 8.3 单本笔记

涉及：

- `src/pages/BookNotesPage.tsx`

改造：

- 删除页面内手工 `obsidianNotion` 分支；
- 将目标下拉框与“一键导出”改为“导出笔记”；
- 接入共享弹窗；
- 文档导出结果迁入弹窗；
- 笔记卡片图片的保存和分享继续保留独立操作，不进入目标卡。

### 8.4 阅读指南与阅读路线

涉及：

- `src/pages/ReadingRoutePage.tsx`
- `src/pages/reading-route/useReadingRoutePageState.ts`

改造：

- 根据当前结果类型动态使用“导出阅读指南”或“导出阅读路线”；
- 状态 hook 的导出函数接收目标数组；
- 页面不再直接维护 `ExportDestination`；
- 结果迁入共享弹窗；
- 资产摘要显示单本或多本范围。

### 8.5 选书决策

涉及：

- `src/pages/BookDecisionPage.tsx`

改造：

- 将“一键导出 + 导出到”改为“导出选书决策”；
- 仅在已有决策结果时可打开；
- 提交目标数组给 `exportBookDecisionTargets`；
- 完整结果迁入共享弹窗。

### 8.6 页面摘要保留规则

默认删除所有页面正文中的完整 `export-result-list`。若某页面确需提示最近一次结果，仅允许：

```text
最近一次导出：已完成 2/3 个目标
[查看详情]
```

它不能替代弹窗结果，也不能复制目标级错误全文。

## 9. 批量流程复用边界

### 9.1 笔记中心批量导出

`NotesPage` 必须保留：

- 预检统计；
- 本地缓存、同步缺失笔记、只导出选中书籍三种策略；
- 搜索、过滤和书籍选择；
- 同步并发；
- 取消和真实进度；
- 书籍维度结果；
- 顶层错误和失败后状态保留。

只替换以下部分：

- `bulkDestination: ExportDestination` 改为 `selectedTargets: ExternalExportTarget[]`；
- 紧凑“导出到”下拉框改为共享 `ExportTargetSelector`；
- `bulkTargetsRequest` 直接接收目标数组；
- 结果中的目标级条目使用共享 `ExportTargetResultCard`；
- 配置异常在执行前明确阻断并提供“前往设置”。

批量向导仍遵守 `bulk-export-wizard-layout.md`：书籍列表独立滚动、底部操作固定，目标选择不能吞掉列表主要高度。

### 9.2 批量书籍复盘

`BookReviewExportDialog` 保留三步：

```text
选择复盘 → 确认设置 → 导出结果
```

保留：

- 搜索和选择；
- 是否包含行动反馈、反思反馈、代表性摘录；
- 已选择数量和筛选状态；
- 结构化顶层失败；
- 返回选择与重试。

升级点（已落地）：

- “确认设置”步骤接入共享 `ExportTargetSelection`，展示 Markdown、Obsidian、Notion 独立多选及只读目的地摘要；Markdown 默认选中但不是强制兜底；
- 新增 `export_book_notes_summaries_targets` 批量多目标命令，旧 Markdown 命令继续保留用于兼容；
- 结果按“书籍 × 目标”两层展示，单项状态沿用 `succeeded | failed | skipped`；
- 失败重试只提交失败或跳过的“书籍 × 目标”组合，结果合并时保留已成功组合，不重复写入；
- Notion 单独重试通过 `knownObsidianPath` 复用同书已成功的 Obsidian 路径作为上下文，但不重跑 Obsidian；
- 请求级失败保存原始请求快照，“重试请求”重放该快照，避免用户选择或设置状态变化导致请求漂移；
- 只有选中 Markdown 时才创建批次目录，`index.md` 只收录成功 Markdown 文件；
- 页面正文不再重复渲染批量结果，完整结果留在对话框。

### 9.3 不把两个批量向导合并

笔记批量和书籍复盘批量的资产选择、内容选项、预检和重试语义不同。本轮不创建一个高配置万能向导。共享组件解决视觉与目标语义一致性，专用向导保留任务模型的差异。

## 10. 图片交付边界

### 10.1 报告图片

`StatisticsPage` 与 `ReportGenerationWizardDialog` 负责：

- 生成报告图片；
- 预览；
- 下载；
- 保存到相册；
- 分享。

这些动作的目标是图片文件或系统分享面板，不是 Markdown、Obsidian、Notion 文档目标，因此不进入 `AssetExportDialog`。

### 10.2 笔记卡片图片

`BookNotesPage` 的单张或分组卡片图片交付同样保持独立。页面可以同时存在：

```text
[导出笔记] [生成/分享笔记卡片]
```

两者名称必须区分，不能把“导出笔记”解释为图片交付。

### 10.3 未来扩展原则

只有当某种输出满足“同一文档资产写入知识库目标”的语义，才进入目标选择框架。下载文件、保存相册、调用系统分享等交付通道不作为 `ExternalExportTarget` 扩展。

## 11. 平台与响应式边界

### 11.1 桌面应用

- 完整显示三个目标和真实配置状态；
- 支持执行文档导出；
- 能力允许时提供打开文件位置或 Notion 页面；
- 桌面弹窗固定最大高度，内容区滚动，底部操作固定。

### 11.2 移动端

- 使用底部面板或接近全屏的对话框；
- 目标卡纵向排列；
- 长路径允许两行或视觉省略，并保留完整可访问名称；
- 底部主操作位于安全区域内；
- 不支持的目标直接显示“桌面应用可用”，而不是点击后才失败；
- 不出现横向溢出。

### 11.3 Web 只读预览

Web 只读预览可以打开能力说明面板，但不能调用桌面命令或伪造配置：

```text
当前为 Web 只读预览
文档导出请在桌面应用中执行。
```

目标卡为只读说明态，主操作不可执行。

## 12. 可访问性

- 弹窗使用 `role="dialog"` 和 `aria-modal="true"`。
- `aria-label` 根据资产生成，例如“导出书籍复盘”。
- 打开时保存触发按钮引用，并把焦点移到标题或首个可交互目标。
- 关闭后焦点恢复到页面入口。
- `Esc` 可在选择态和结果态关闭；执行态若无取消能力则禁止关闭。
- 目标卡支持键盘切换，选中状态通过控件状态、图标和文字共同表达。
- 错误不能只用颜色表达。
- 长路径和 URL 在视觉截断时保留完整 `aria-label` 或可复制内容。
- 运行区域设置 `aria-busy="true"`，禁止重复提交。
- 顶层错误可使用 `role="alert"`，但避免重复播报所有结果卡。
- 结果列表按目标顺序稳定渲染，不因完成顺序导致焦点跳动。

## 13. 数据契约与兼容迁移

### 13.1 保持现有多目标协议

继续使用：

```ts
type ExternalExportTarget =
  | "markdown"
  | "obsidian"
  | "notion";

type MultiTargetExportRequest = {
  targets: ExternalExportTarget[];
  obsidian?: {
    vaultDir?: string;
    openAfterExport?: boolean;
  };
  notion?: {
    parentId?: string;
    parentType?: NotionParentType;
  };
};
```

共享组件不新增新的后端目标类型，也不改变 `ExportTargetResult` 的状态语义。

### 13.2 `ExportDestination` 作为临时兼容层

迁移期允许保留：

```ts
export type ExportDestination =
  | "markdown"
  | "obsidian"
  | "notion"
  | "obsidianNotion";
```

但规则是：

- 仅供尚未迁移的旧页面和旧测试使用；
- 新共享组件不得依赖；
- 新代码直接使用 `ExternalExportTarget[]`；
- 页面逐个迁移后删除 `obsidianNotion` UI 选项；
- 所有调用点迁移完成后再删除类型和 `exportTargetsFromDestination`，避免一次性大改。

### 13.3 toast 兼容

`formatMultiTargetExportToast` 可保留为辅助摘要生成器，但：

- 不用 toast 推断结果态；
- toast 不承载完整错误；
- toast 文案应与弹窗汇总一致；
- 弹窗关闭后，toast 可以提示本次操作已经完成。

### 13.4 配置状态不新增重复存储

首轮不新增导出配置表。目标状态从现有 `SettingsState.exportData` 和 `SettingsState.integrationData` 派生。

如 M4 引入：

```ts
settings.exportTargetPreference
```

它只存默认目标偏好，不存目录、Vault、Token 或数据库配置副本。

## 14. 与 M4 导出中心的关系

`functional-consolidation-blueprint.md` 对 M4 的目标是：

```text
资产多选 × 目标选择 × 预检
```

本设计只完成第二部分的共享能力，并收敛现有页面入口。两者关系：

| 能力 | 本设计 | M4 导出中心 |
| --- | --- | --- |
| 当前页面单资产快捷导出 | 是 | 继续保留薄入口 |
| 统一目标选择与配置摘要 | 是 | 复用 |
| 目标级结果卡 | 是 | 复用 |
| 单资产执行状态 | 是 | 复用或适配 |
| 跨资产类型选择 | 否 | 是 |
| 全局资产搜索和筛选 | 否 | 是 |
| 统一预检队列 | 仅批量专用向导 | 是 |
| 持久化任务历史 | 否 | 由 M4 另行裁决 |
| 全局目标偏好 | 可延后 | 是，单一事实源 |

因此，本设计可以作为未来实现准备，但不代表 M4 已经启动。T9 / M1 期间应只保留设计结论，不因本文件新增 RC 范围。

## 15. 现有文档冲突裁决

| 文档 | 现有内容 | 本文裁决 |
| --- | --- | --- |
| `reading-review-export-dialog-design.md` | 建议新增页面专用 `ReadingReviewExportDialog` | 页面规格继续有效；实现改为接入共享 `AssetExportDialog`，仅保留薄适配层 |
| `reading-review-export-dialog-design.md` | 范围明确不含其他页面 | 该限制只表示专项文档边界；全局扩展由本文定义 |
| `bulk-obsidian-notion-export-design.md` | 提供 `Obsidian + Notion` 第四选项 | UI 目标选择被本文取代，改为 Obsidian 与 Notion 独立多选 |
| `bulk-obsidian-notion-export-design.md` | 建议继续使用紧凑下拉框 | 被本文取代，批量向导使用共享目标选择组件 |
| `bulk-obsidian-notion-export-design.md` | 可允许未配置目标提交后由后端失败 | 被本文取代，前端预检阻断，后端仍保留最终校验 |
| `bulk-export-wizard-layout.md` | 批量列表独立滚动、底部操作固定、失败留在弹窗 | 继续有效，优先级不变 |
| `functional-consolidation-blueprint.md` | M4 建完整导出中心 | 继续有效；本文不提前实现跨资产导出中心 |

冲突裁决只覆盖交互和共享组件，不否定旧批量设计中的后端兼容、批量目录、节流和报告文件设计。

## 16. 文件级实施计划

### 阶段 A：共享基础，不迁移页面

- [x] 新增共享 `src/components/export/AssetExportDialog.tsx`。
- [x] 抽取 `ExportTargetSelection.tsx`，统一目标选择、配置状态和目的地摘要。
- [x] 统一目标级结果、顶层失败和设置恢复交互。
- [x] 新增目标配置解析、选择、提交资格与结果汇总纯函数测试。

### 阶段 B：接入首个页面

以周期复盘专项设计为首个样板：

- [x] `ReviewHeroSection` 收敛为单一语义化入口。
- [x] `useReadingReviewPage` 接收目标数组。
- [x] `ReadingReviewPage` 接入共享弹窗。
- [x] 删除该页面完整正文结果列表。
- [x] 验证设置只读、部分成功、顶层失败和焦点恢复。

### 阶段 C：迁移其余单资产页面

已完成：

1. [x] `BookAiSummaryPage`；
2. [x] `BookNotesPage`；
3. [x] `ReadingRoutePage` 与状态 hook；
4. [x] `BookDecisionPage`。

各页面已删除生产交互中的单值 `ExportDestination` 状态和旧正文结果列表，继续复用原有单资产 Tauri 命令。

### 阶段 D：批量向导复用

- [ ] `NotesPage` 批量笔记向导的进一步共享组件收敛另行安排，不影响现有批量多目标能力。
- [x] `BookReviewExportDialog` 接入共享目标选择与配置摘要。
- [x] 新增 Rust/Tauri 批量书籍复盘多目标协议与命令。
- [x] 批量结果按“书籍 × 目标”展示，并支持组合级精确重试。
- [x] 保留批量笔记与批量书籍复盘两个专用向导，不合并外壳。

### 阶段 E：清理兼容层

仅在全部调用点迁移并通过回归后：

- [ ] 删除生产 UI 中的 `obsidianNotion`。
- [ ] 删除不再使用的 `ExportDestination`。
- [ ] 删除 `exportTargetsFromDestination`。
- [ ] 收敛重复 toast 和结果渲染代码。
- [ ] 搜索并删除遗留“一键导出”和“导出到”组合控件。

### 阶段 F：M4 对接

M4 另行设计和排期：

- [ ] 资产多选；
- [ ] 跨类型预检；
- [ ] 统一任务队列与报告；
- [ ] 全局目标偏好；
- [ ] 页面薄入口与导出中心之间的上下文交接。

## 17. 测试矩阵

### 17.1 纯函数与组件测试

- 默认打开时 Markdown 选中。
- Obsidian 与 Notion 可分别选择，也可同时选择。
- 请求中只出现三个基础目标，不出现 `obsidianNotion`。
- 未选择任何目标时主按钮禁用。
- 选中未配置或失效目标时不能提交。
- Markdown 显示真实导出目录，弹窗中没有“更改保存位置”。
- Obsidian 显示当前 Vault，Notion 显示当前数据库或父级。
- 运行中不能重复提交或关闭。
- 全部成功、部分成功、全部失败、全部跳过正确汇总。
- 顶层命令失败使用结构化错误面板。
- 返回选择保留目标。
- 重试失败目标只提交失败目标。
- 配置从设置返回后重新解析。
- Web 只读模式不调用 `onExport`。

### 17.2 单资产 E2E

每类页面至少覆盖：

1. 页面不再同时出现“导出到”和“一键导出”；
2. 语义化入口打开共享弹窗；
3. 资产标题和范围正确；
4. 目的地只读，弹窗内没有配置编辑；
5. 两个目标同时选择时提交两个独立目标；
6. 配置异常显示“前往设置”；
7. 部分成功保留成功路径和失败恢复；
8. 页面正文不重复渲染完整结果；
9. 键盘关闭和焦点恢复正确；
10. 移动端无横向溢出。

### 17.3 批量 E2E

- 目标选择改为独立多选后，原有三种批量策略不变。
- 书籍列表仍独立滚动，底部操作固定。
- 未配置目标在执行前阻断。
- 同步并发只影响缺失笔记同步，不改变目标语义。
- 单本失败不阻断其他书籍。
- 单目标失败不覆盖其他目标成功。
- 顶层失败保留预检、策略、过滤和选择。
- 重试不静默改变原同步策略。
- 批量导出不自动生成书籍复盘。

### 17.4 平台和可访问性

- 桌面完整执行三个目标。
- 移动端仅开放真实支持的目标。
- Web 只读预览不调用原生命令。
- `Tab` 顺序稳定。
- `Esc`、焦点进入和恢复符合规则。
- 屏幕阅读器可读出选中、配置异常和结果状态。

### 17.5 回归命令

实现共享组件或迁移页面后至少运行：

```bash
npm test
npm run build
npm run e2e -- --grep "导出|批量导出|周期复盘|书籍复盘|阅读指南|阅读路线|选书决策"
```

触及 Rust 命令、批量契约或设置状态时追加：

```bash
cargo fmt --check --manifest-path "src-tauri/Cargo.toml"
cargo check --manifest-path "src-tauri/Cargo.toml"
cargo test --manifest-path "src-tauri/Cargo.toml" --lib
```

## 18. 验收标准

### 产品验收

- [ ] 所有单资产页面只保留一个语义化文档导出入口。
- [ ] 生产 UI 不再把 `Obsidian + Notion` 作为独立目标。
- [ ] 任何执行弹窗都不提供“更改保存位置”。
- [ ] 配置编辑只发生在设置页。
- [ ] 文档导出与图片交付在入口、文案和组件上清晰分离。
- [ ] 完整目标结果在弹窗或批量向导中可见，不依赖 toast。
- [ ] 部分成功不会被显示为全部失败。
- [ ] 顶层命令失败有结构化恢复路径。

### 工程验收

- [ ] 单资产页面共用一个 `AssetExportDialog`，不复制五套弹窗。
- [ ] 新共享 UI 直接使用 `ExternalExportTarget[]`。
- [ ] 目标配置状态由统一解析函数产生。
- [ ] 页面导出命令通过薄适配器接入，不改变资产生成逻辑。
- [ ] 批量向导只复用共享部件，不丢失专用状态与能力。
- [ ] 迁移完成后删除生产 UI 的 `obsidianNotion` 依赖。
- [ ] 构建、测试、E2E 和受影响的 Rust 门禁通过。

### 范围验收

- [ ] 本设计没有把 M4 跨资产导出中心提前塞入 T9 / M1。
- [ ] 没有新增导出目标或持久化任务历史。
- [ ] 没有把设置编辑复制进执行弹窗。
- [ ] 没有把报告图片和笔记卡片图片并入文档目标。

## 19. 回滚策略

- **共享组件回滚**：单个页面可暂时恢复旧入口，底层多目标契约不变。
- **页面级回滚**：每次只迁移一个页面，出现问题时只回滚该适配层。
- **批量回滚**：保留原批量任务模型和后端兼容默认，目标选择 UI 可独立回滚。
- **数据无需回滚**：本设计首轮不新增持久化表，不迁移用户目录、Vault 或 Notion 配置。
- **设置边界不回滚**：即使页面 UI 回滚，也不重新在执行弹窗中加入“更改保存位置”。
- **平台降级**：某平台暂不支持时显示明确只读或不支持状态，不回退到点击后失败的虚假入口。

## 20. 最终用户路径

单资产：

```text
查看资产
  → 点击“导出笔记 / 导出书籍复盘 / 导出周期复盘 / 导出阅读指南 / 导出阅读路线 / 导出选书决策”
  → 选择一个或多个目标
  → 查看只读目的地与配置状态
  → 开始导出
  → 查看每个目标的真实结果
```

批量资产：

```text
打开专用批量向导
  → 选择资产范围与批量策略
  → 选择一个或多个目标
  → 预检配置和内容
  → 执行并查看书籍级、目标级结果
```

设置异常：

```text
目标不可用
  → 前往设置
  → 修复长期配置
  → 返回原资产
  → 重新确认并执行
```

这三条路径共同遵守一个边界：**页面负责说明要导出的资产，弹窗或向导负责本次执行，设置页负责长期配置，结果组件负责展示事实。**
