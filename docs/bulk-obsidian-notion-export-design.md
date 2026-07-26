# 批量导出页面 Obsidian / Notion 多目标改造设计

## 1. 文档目的

本文定义“笔记页批量导出向导”从现有 Markdown 批量导出升级为多目标导出的方案。

目标是让用户在批量导出时一次选择：

- Markdown
- Obsidian
- Notion
- Obsidian + Notion

并继续保留现有预检、同步缺失笔记、取消、失败报告和重试能力。

## 2. 当前基线

### 已有能力

- `NotesPage` 已有批量导出向导。
- `preflight_bulk_export` 可扫描本地笔记缓存、笔记概览和已生成书籍复盘缓存。
- `export_bulk_notes` 可按策略导出多本书：
  - 仅导出本地缓存。
  - 先同步缺失笔记再导出。
  - 只导出选中书籍。
- 批量导出会生成：
  - `notes/*.md`
  - `reviews/*.md`
  - `index.md`
  - `export-report.md`
- 已有单项资产多目标导出：
  - 单本笔记
  - 单本 AI 复盘
  - 阅读统计复盘
  - 阅读路线
  - 选书决策
- 后端已有统一 `ExportDocument`、`MultiTargetExportRequest`、`export_document_targets`。

### 主要缺口

- 批量导出请求只有 Markdown 语义，没有目标选择。
- 批量结果只有文件级 `notesFile` / `aiReviewFile`，无法表达 Notion URL 或 Obsidian 文件路径。
- 进度事件只按“书籍状态”统计，没有目标级成功/失败统计。
- 重试逻辑只重试单本 Markdown 导出，不能复用多目标请求。

## 3. 设计目标

- 批量导出支持多目标选择。
- 每本书、每个目标独立返回结果。
- 单本失败不影响其他书。
- 单目标失败不影响其他目标。
- Markdown 继续作为稳定兜底，不破坏现有导出目录、索引和报告。
- Obsidian 批量导出直接落到 Vault。
- Notion 批量导入支持部分成功、失败明细和单本重试。

## 4. 非目标

- 不做双向同步。
- 不更新已有 Notion 页面，只创建新页面或数据库条目。
- 不做 Notion 去重、冲突合并、增量更新。
- 不做批量 AI 生成复盘。
- 不把“书籍复盘独立批量导出弹窗”合并进笔记批量导出向导。
- 不引入持久化任务历史表；首版仍以本次响应和报告文件为准。

## 5. 产品行为

### 5.1 批量导出目标

导出向导新增目标选择：

- `Markdown`
- `Obsidian`
- `Notion`
- `Obsidian + Notion`

默认值建议保持 `Markdown`，降低现有用户心智变化。

### 5.2 策略与目标关系

现有导出策略不变：

- `仅导出本地已缓存内容`
- `先同步缺失笔记再导出`
- `只导出选中的书`

目标选择只决定“准备好的每本书如何写出”，不改变同步策略。

### 5.3 已生成复盘

批量笔记导出当前会附带导出本地已有书籍复盘缓存。多目标改造后：

- 笔记和复盘仍属于同一本书的两个资产。
- Markdown 目标继续写 `notes/` 和 `reviews/`。
- Obsidian / Notion 目标首版只导出“笔记资产”。
- 已生成复盘的多目标批量导出后续由“书籍复盘批量导出弹窗”单独升级。

原因：

- 批量笔记和批量复盘的选择、筛选、重试语义不同。
- 避免一次改造把“笔记多目标”和“复盘多目标”耦合成复杂任务。
- 符合 KISS / YAGNI，先让批量笔记闭环稳定。

## 6. 后端设计

### 6.1 请求模型

扩展 `BulkExportRequest`：

```rust
pub struct BulkExportRequest {
    pub strategy: BulkExportStrategy,
    pub selected_book_ids: Option<Vec<String>>,
    pub concurrency: Option<usize>,
    pub exclude_without_exportable_notes: Option<bool>,
    pub targets: Option<MultiTargetExportRequest>,
}
```

兼容策略：

- `targets == None` 时等价于 `Markdown`。
- 前端新版总是传 `targets`。
- 后端保留默认值，避免旧前端或测试调用失败。

### 6.2 结果模型

新增目标级结果：

```rust
pub struct BulkExportTargetResult {
    pub target: ExternalExportTarget,
    pub status: ExportTargetStatus,
    pub path: Option<String>,
    pub url: Option<String>,
    pub page_id: Option<String>,
    pub warning: Option<String>,
    pub error: Option<ExportTargetError>,
}

pub struct BulkExportAssetResult {
    pub source_kind: ExportSourceKind,
    pub source_id: String,
    pub title: String,
    pub results: Vec<BulkExportTargetResult>,
}
```

扩展 `BulkExportResultItem`：

```rust
pub struct BulkExportResultItem {
    pub book_id: String,
    pub title: String,
    pub status: BulkExportItemStatus,
    pub notes_file: Option<String>,
    pub ai_review_file: Option<String>,
    pub targets: Vec<BulkExportTargetResult>,
    pub reason: String,
}
```

兼容策略：

- 保留 `notes_file` / `ai_review_file`，让现有报告和前端旧展示不立刻失效。
- `targets` 用于新版多目标展示。
- Markdown 的 `path` 可以是相对路径，也可以在报告中保留相对路径；前端展示完整导出根目录。

### 6.3 执行流程

当前流程：

1. 预检。
2. 准备可导出项。
3. 同步缺失笔记。
4. 写 Markdown 文件。
5. 附带写已生成复盘。
6. 写索引和报告。

改造后：

1. 预检。
2. 准备可导出项。
3. 同步缺失笔记。
4. 对每本书构造一次 `ExportDocument` 和 Markdown 字符串。
5. 调用 `export_document_targets` 写入 Markdown / Obsidian / Notion。
6. 收集每本书每目标结果。
7. Markdown 目标仍写入本次批量目录结构。
8. 写新版索引和报告。

### 6.4 Markdown 目标特殊处理

批量 Markdown 与单项 Markdown 不完全相同：

- 单项 Markdown 写入全局导出目录。
- 批量 Markdown 必须写入本次批量目录下的 `notes/`。

因此不建议直接让 `export_document_targets` 的 Markdown 分支处理批量 Markdown。

建议新增批量内部 dispatcher：

```rust
async fn export_bulk_book_notes_targets(
    app: &AppHandle,
    notes: &BookNotesRecord,
    exported_at: &str,
    notes_dir: &Path,
    request: &MultiTargetExportRequest,
) -> BulkExportAssetResult
```

规则：

- `Markdown`：写入 `notes_dir`，返回相对文件名。
- `Obsidian` / `Notion`：复用 `export_document_targets`，但过滤掉 Markdown 目标。
- 这样避免修改全局 dispatcher 的语义。

### 6.5 Notion 批量节流

Notion 批量导入必须限制并发：

- 同步缺失笔记并发继续使用现有 `1..=3`。
- Notion 写入首版建议串行，或单独限制为 `1`。
- Obsidian 本地写入可跟随现有批量处理顺序。

理由：

- Notion API 速率限制和网络错误概率高。
- 串行更容易给用户解释部分成功结果。
- 首版不追求最快，只追求稳定和可恢复。

## 7. 前端设计

### 7.1 向导设置区

在现有策略和筛选设置旁增加“导出到”选择：

- 放在 `bulk-export-toolbar` 内。
- 使用现有 `compact-export-select` 或新增 `bulk-export-target-select`。
- 默认 `Markdown`。
- 导出中禁用。

### 7.2 预检摘要

预检摘要新增目标提示：

- `目标：Markdown`
- `目标：Obsidian`
- `目标：Notion`
- `目标：Obsidian + Notion`

Notion 目标选中时显示提示：

- “Notion 批量导入可能较慢；单本失败不影响其他书。”

Obsidian 目标选中但未配置 Vault 时：

- 允许开始导出，由后端返回目标级失败。
- 或前端根据设置状态提前提示。

首版建议：后端兜底校验，前端只做提示，不阻断。

### 7.3 进度展示

进度面板保留现有书籍维度，新增目标提示：

- 当前：正在处理《书名》
- 目标：Markdown / Obsidian / Notion
- 统计：已导出、失败、跳过、取消

首版不要求逐目标实时进度；结果阶段必须逐目标展示。

### 7.4 结果展示

批量结果页从“前 6 本列表”升级为：

- 汇总：成功书籍数、失败书籍数、目标数、导出根目录。
- 每本书结果：
  - 书名
  - 总状态
  - Markdown 路径
  - Obsidian 路径
  - Notion URL
  - warning / error
- 失败项支持“重试本书”。

首版可继续只展示前 6 本，但失败项必须优先展示。

## 8. 报告文件设计

### 8.1 `index.md`

索引按书籍列出：

- 书名
- Markdown 文件链接
- Obsidian 路径
- Notion 页面链接
- 状态

### 8.2 `export-report.md`

报告按书籍和目标列出：

```markdown
## 深度工作

- 总状态：Exported
- 原因：已完成 2/3 个目标。
- Markdown：notes/深度工作-xxx.md
- Obsidian：C:/Vault/深度工作-xxx.md
- Notion：https://www.notion.so/...
- Notion 警告：封面不可用，正文已导入。
```

失败报告必须避免写入：

- 微信读书 API Key
- AI API Key
- Notion Token
- 本地数据库路径

## 9. 状态判定

每本书总状态按目标结果计算：

- `Exported`：至少一个目标成功，且没有目标失败。
- `Failed`：所有目标失败，或笔记准备阶段失败。
- `Skipped`：预检或策略导致跳过。
- `Canceled`：用户取消后未开始处理。

部分成功建议仍使用 `Exported`，但 reason 写明：

- “已完成 1/2 个目标，Notion 导入失败。”

如果后续希望更精确，可新增 `PartialExported`，但首版不建议扩展枚举。

## 10. 重试设计

现有 `handleRetryBulkExportItem(bookId)` 保留。

重试时使用当前向导的目标选择：

- `selectedBookIds = [bookId]`
- `strategy = syncMissingNotes`
- `concurrency = 1`
- `targets = 当前目标选择`

如果用户上一次是 `Obsidian + Notion`，重试仍重试两个目标。

首版不做“只重试失败目标”，避免前端状态和后端请求复杂化。

## 11. 兼容性

### 11.1 旧 Markdown 行为

必须保持：

- 批量导出目录命名不变。
- `notes/`、`reviews/`、`index.md`、`export-report.md` 继续生成。
- 预检逻辑不变。
- 同步缺失笔记必须由用户显式选择。

### 11.2 单项导出

不修改单项导出入口。

批量导出可以复用：

- `ExportDocument::from_book_notes`
- `serialize_book_notes_markdown`
- `export_document_targets`
- `ExportTargetResult`

但不要反向要求单项导出适配批量目录结构。

## 12. 风险与控制

### Notion 速率限制

风险：

- 批量页面创建失败或变慢。

控制：

- Notion 写入串行。
- 单本失败继续后续书。
- 报告记录失败原因。

### Obsidian 路径写入失败

风险：

- Vault 未配置、路径不可写、附件下载失败。

控制：

- 目标级失败，不影响 Markdown / Notion。
- 失败原因直接展示。

### 报告体积变大

风险：

- 大批量导出报告过长。

控制：

- 报告保留完整明细。
- 前端只展示摘要和失败优先列表。

### 用户误解为同步

风险：

- 用户以为 Notion / Obsidian 后续会自动更新。

控制：

- 向导边界说明写明“只创建本次导出结果，不做后续同步”。
- Notion 首版不更新已有页面。

## 13. 实施拆解

### 阶段 1：类型扩展

- 扩展 `BulkExportRequest` 支持 `targets`。
- 扩展 `BulkExportResultItem` 支持目标级结果。
- 前端同步类型。
- 保持旧字段兼容。

### 阶段 2：后端批量目标执行

- 新增批量内部目标执行函数。
- Markdown 目标写入批量目录。
- Obsidian / Notion 目标复用现有 adapter。
- Notion 批量写入串行。

### 阶段 3：报告升级

- `serialize_bulk_export_index` 展示多目标链接。
- `serialize_bulk_export_report` 展示每目标结果。
- 保留 `notesFile` / `aiReviewFile`。

### 阶段 4：前端向导

- 新增导出目标选择状态。
- `exportBulkNotes` 传入 `targets`。
- 结果页展示目标级结果。
- 重试时携带当前目标。

### 阶段 5：测试

- Rust：请求兼容、目标结果聚合、报告序列化。
- 前端：API 映射、向导选择、结果展示。
- 手工：Markdown 批量回归、Obsidian Vault、Notion 页面。

## 14. 验收标准

- [ ] 批量导出可选择 Markdown / Obsidian / Notion / Obsidian + Notion。
- [ ] 默认 Markdown 行为不回退。
- [ ] 单本书单目标失败不阻断其他书或其他目标。
- [ ] 批量结果能展示 Notion URL 和 Obsidian 路径。
- [ ] `index.md` 和 `export-report.md` 包含目标级结果。
- [ ] Notion 批量写入不会并发冲击 API。
- [ ] 重试单本书时会使用当前目标选择。
- [ ] 不会自动生成 AI 复盘。
- [ ] 不会保存或导出任何 Token、API Key、数据库路径。

## 15. 推荐优先级

P0：

- Markdown 兼容不回退。
- 批量笔记多目标执行。
- 结果和报告可解释部分成功。

P1：

- Notion 串行写入和错误分类。
- 前端失败优先展示。
- 单本重试携带目标。

P2：

- 书籍复盘独立批量导出多目标化。
- 只重试失败目标。
- 批量导出历史记录。
