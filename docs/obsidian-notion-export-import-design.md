# Obsidian / Notion 双通道导出导入设计

## 1. 文档目的

本文定义阅读资产从 wxreadmaster 进入外部知识库的统一方案，覆盖：

- 一键导出到 Obsidian Vault。
- 一键导入到 Notion。
- 继续保留现有 Markdown 导出作为通用兜底。

目标不是做一个“通用同步平台”，而是把同一份阅读资产拆成两条清晰、可维护的通道。

## 2. 背景

当前仓库已经具备单本笔记、书籍复盘、阅读指南、阅读统计等 Markdown 导出能力，但导出结果仍主要面向本地文件。

用户常见诉求有两类：

- Obsidian：希望直接落到本地 Vault，继续用双链、标签和本地附件管理。
- Notion：希望直接进入数据库或页面，作为在线知识库检索和整理。

这两类目标的载体不同，但输入资产一致，因此适合共享一套中间模型。

## 3. 设计目标

- 支持同一条导出任务选择一个或两个目标。
- 支持封面作为正式资源进入两边，而不是只停留在正文图片。
- 共享同一份内容模型，避免重复实现。
- 允许任一目标失败时，另一目标继续成功。
- 保留现有 Markdown 导出，不破坏当前工作流。

## 4. 非目标

- 不做通用双向同步。
- 不做自动持续监听文件变更。
- 不做多端协作冲突合并。
- 不做复杂插件生态适配。

## 5. 总体方案

### 5.1 一份输入，三种输出

统一先构造一份 `ExportDocument`，再分别写出：

- `Markdown`：现有通用导出。
- `Obsidian`：本地 Vault 文件 + 附件目录。
- `Notion`：API 创建页面或数据库条目。

### 5.2 任务模型

一次导出定义为 `ExportJob`：

- `targets`: `markdown` / `obsidian` / `notion` 可多选。
- `source`: 单本笔记、书籍复盘、阅读指南或其他 Markdown 资产。
- `assetPolicy`: 封面、图片、附件是否落盘。
- `openAfterFinish`: 是否自动打开目标。

### 5.3 执行策略

- 先做输入校验，再做资源物化。
- 目标之间独立执行，结果分别返回。
- 任一目标失败不回滚已成功目标。
- 当同一任务同时选择 Obsidian 和 Notion 时，后端会优先尝试完成 Obsidian 文件写入，再把成功路径写入 Notion 的 `Obsidian 路径` 属性；返回结果仍保持用户请求的目标顺序。

## 6. 中间数据模型

建议新增统一结构：

- `ExportDocument`
  - `docType`
  - `title`
  - `subtitle`
  - `bookId`
  - `author`
  - `exportedAt`
  - `sourceBoundary`
  - `frontMatter`
  - `sections`
  - `assets`
- `ExportAsset`
  - `kind`：封面、正文图片、附件
  - `remoteUrl`
  - `localPath`
  - `notionFileId`
  - `status`
- `ExportTargetResult`
  - `target`
  - `status`
  - `pathOrUrl`
  - `error`

现有 Markdown 生成逻辑继续作为内容来源，不要求先重构全文渲染器。

## 7. 目标适配

### 7.1 Obsidian

Obsidian 走本地文件输出：

- 生成 `.md` 文件。
- 生成 `assets/` 或同级附件目录。
- 封面优先下载为本地图片，并用相对路径引用。
- front matter 保留 `bookId`、`author`、`exportedAt` 等元数据。
- 导出后可选通过 `obsidian://` 打开笔记。

### 7.2 Notion

Notion 走 API 导入：

- 首版建议以数据库条目为目标，便于保存标题、作者、bookId、导出时间和封面。
- 封面优先写入 Notion 的 page cover。
- 正文按 block 分段写入，避免一次性提交过长内容。
- 仅当有真实 `bookId` 或显式 `wereadUrl` 时写入 `微信读书` URL，避免给统计复盘、本地预览 ID 生成伪链接。
- 若同次导出已成功写入 Obsidian，则把 Vault 文件路径写入 `Obsidian 路径`，便于用户从 Notion 反查本地笔记。
- 若封面无法直接引用公网 URL，则跳过封面或降级为正文内容，不阻断页面创建。

## 8. 封面策略

封面统一作为一等资产处理：

1. 源数据优先取 `book.cover`。
2. 先尝试物化为本地图片。
3. Obsidian 使用本地相对路径。
4. Notion 使用 page cover。
5. 若封面缺失或下载失败，正文继续导出，不阻断主流程。

## 9. 前端交互

建议在现有导出入口上增加目标选择：

- `仅 Markdown`
- `导出到 Obsidian`
- `导入到 Notion`
- `Obsidian + Notion`

设置页补充两组配置：

- Obsidian：Vault 路径、附件策略、导出后是否自动打开。
- Notion：Token、目标数据库/页面、默认封面策略。

导出结果页按目标分别展示成功、失败和打开入口。

## 10. 后端职责划分

- `export/core`：组装统一文档模型。
- `export/markdown`：继续输出通用 Markdown。
- `export/obsidian`：处理文件落盘和附件路径。
- `export/notion`：处理认证、分页写入和 page cover。
- `export/job`：编排多目标任务和结果汇总。

## 11. 风险与降级

- Notion API 失败时，不影响 Obsidian 本地导出。
- Obsidian 路径不可写时，不影响 Notion 导入。
- 封面下载失败时，保留正文和元数据。
- 网络不可用时，至少保留 Markdown 兜底。

## 12. 验收标准

- 支持同一任务同时选择 Obsidian 和 Notion。
- Obsidian 结果可直接在 Vault 中打开。
- Notion 结果可直接出现在目标页面或数据库中。
- 封面能进入至少一个目标的正式封面位。
- 任一目标失败时，其他目标结果仍保留。
- 现有 Markdown 导出行为不回退。
