# Obsidian / Notion 双通道导出导入实施计划

## 目标

基于 [设计文档](./obsidian-notion-export-import-design.md)，按最小闭环实现外部知识库导出导入能力。

首轮只交付：

- 统一导出中间模型。
- Obsidian 本地 Vault 导出。
- Notion API 导入。
- 现有 Markdown 导出继续可用。
- 失败时的目标级独立回退。

首轮不交付：

- 双向同步。
- 持续监听文件夹变更。
- 多目标冲突合并。
- 完整附件管理后台。
- 通用插件适配层。

## 当前基线

### 已有能力

- `src-tauri/src/export/markdown.rs` 已能生成单本笔记和 AI 资产 Markdown。
- `src-tauri/src/export/bulk.rs` 已有批量导出索引和报告结构。
- `src-tauri/src/services/notes.rs` 已承载笔记导出流程。
- `src-tauri/src/services/ai.rs` 已承载多类导出、写文件和目录管理。
- `docs/export-storage-location.md` 已把导出目录和数据库目录拆开。
- 前端已有 `导出 Markdown` 入口和批量导出向导。

### 主要缺口

- 没有统一的导出文档模型。
- 没有 Obsidian Vault 专用落盘路径和附件策略。
- 没有 Notion API 认证、页面创建和 block 写入链路。
- 没有目标级导出结果面板。

## 实施原则

- KISS：首版只支持阅读资产导出，不做全量同步。
- YAGNI：先实现单向导出，不预留过多双向状态。
- DRY：内容生成只保留一份，目标适配只做薄层转换。
- SOLID：内容组装、资源下载、目标写入、UI 配置彼此解耦。

## 阶段 1：统一模型与资源物化

目标：先把“要导出的内容”收敛成稳定中间结构，再写目标适配器。

### 1.1 中间模型

建议新增：

- `ExportDocument`
- `ExportSection`
- `ExportAsset`
- `ExportTarget`
- `ExportTargetResult`
- `ExportJob`

建议放置位置：

- 后端：`src-tauri/src/export/`
- 前端类型：`src/lib/types.ts`

核心约束：

- `ExportDocument` 只表达内容，不绑定具体目标格式。
- `ExportAsset` 负责封面、正文图片和附件的统一描述。
- 目标写入失败不污染输入模型。

### 1.2 资源物化

先实现资源下载与本地化：

- 封面下载为本地图片。
- 失败时保留远程 URL 作为降级。
- 图片、附件统一走资源目录。

建议新增内部 helper：

- `materialize_export_assets()`
- `resolve_cover_asset()`
- `write_export_asset_file()`

验收：

- 封面下载失败不阻断正文导出。
- 同一资产可被多个目标复用。

## 阶段 2：Obsidian 导出

目标：把资产稳定落到用户选定的 Vault。

### 2.1 输出规则

- 生成 `.md` 文件。
- 生成同目录或子目录附件。
- 图片使用相对路径。
- front matter 保留书籍和导出元数据。
- 导出后可选自动打开笔记。

### 2.2 交互与配置

设置页新增：

- `Obsidian Vault 路径`
- `附件目录策略`
- `导出后自动打开`

默认行为：

- 不自动创建不必要的多层目录。
- 路径不可写时明确报错。

### 2.3 验收

- 选择 Obsidian 后能在 Vault 中直接看到导出文件。
- 封面本地化后能被 Markdown 正常引用。
- 导出失败不影响 Notion 或 Markdown 结果。

## 阶段 3：Notion 导入

目标：把同一份资产写入 Notion 页面或数据库。

### 3.1 认证与配置

设置页新增：

- `Notion Token`
- `目标数据库 / 页面`
- `默认封面策略`

实现约束：

- Token 只做本地保存。
- 不进入导出内容。

### 3.2 写入规则

首版优先支持：

- 创建数据库条目或页面。
- 写入标题、作者、bookId、导出时间、来源边界。
- 封面作为 page cover。
- 正文分 block 写入。

### 3.3 失败策略

- block 写入失败时保留已创建页面。
- 封面失败不阻断正文。
- 认证失败直接返回目标级错误。

### 3.4 验收

- 目标页面可正常创建。
- 封面能出现在 Notion 页面封面位。
- 长正文不会因单次提交过大而整体失败。

## 阶段 4：前端导出入口

目标：让用户在一个入口里选择目标，而不是分散到多个页面。

### 4.1 导出入口

现有导出按钮增加目标选项：

- `仅 Markdown`
- `导出到 Obsidian`
- `导入到 Notion`
- `Obsidian + Notion`

### 4.2 结果展示

结果面板按目标分组展示：

- 成功状态
- 失败原因
- 打开目录 / 打开页面

### 4.3 设置页

设置页新增两个卡片：

- Obsidian 导出配置
- Notion 导入配置

验收：

- 用户能清楚知道每个目标的结果。
- 任一目标失败不覆盖其他目标状态。

## 阶段 5：测试与回归

### 单元测试

- 中间模型组装测试。
- 封面物化测试。
- Obsidian 路径拼接测试。
- Notion block 拆分测试。

### 集成测试

- Markdown 导出回归。
- Obsidian 导出回归。
- Notion 失败降级回归。

### 手工验收

- 本地 Vault 可直接打开。
- Notion 页面可见标题、封面和正文。
- 失败后仍保留已成功目标结果。

## 风险

- Notion API 变更会影响写入细节。
- 远程封面可用性不稳定。
- 附件落盘路径若过度复杂，会影响 Obsidian 兼容性。
- 过早抽象通用同步层会增加维护成本。

## 非目标

- 不做持续同步。
- 不做冲突合并。
- 不做跨平台双向绑定。
- 不把所有导出格式抽象成一个超级接口。

## 验收标准

- [ ] 同一任务可选择 Obsidian、Notion 或两者同时导出。
- [ ] Obsidian 结果可直接进入 Vault。
- [ ] Notion 结果可直接进入页面或数据库。
- [ ] 封面至少在一个目标中以正式封面位呈现。
- [ ] 任一目标失败不影响其他目标结果。
- [ ] 现有 Markdown 导出保持可用。

