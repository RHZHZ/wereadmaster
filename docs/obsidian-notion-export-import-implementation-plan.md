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

首版支持：

- 创建数据库条目或页面。
- 写入标题、作者、bookId、导出时间、来源边界。
- 标准数据库创建 `封面` Files & media 属性，作为 Gallery Card preview 的稳定来源。
- 页面创建成功后，独立 PATCH 数据库属性封面和 Page cover。
- 正文分 block 写入。

封面契约：

- 页面创建 POST 不携带封面 mutation，避免封面错误触发 POST 重发和重复页面。
- 属性封面和 Page cover 使用相同有效 HTTP(S) URL，但分别记录成功、失败和 reconciliation 结果。
- `contentImageOnly` 只禁用 Page cover，不禁用数据库 `封面` 属性。
- `cover` logical field 只映射到 `files`；同名错误类型或多个候选字段时 fail-closed。

### 3.3 失败策略

- block 写入失败时保留已创建页面。
- 两种封面写入独立容错；封面失败不阻断正文。
- 封面 PATCH 的网络错误、超时或 5xx 不盲目重试 mutation；通过 GET 最新页面状态做 reconciliation。
- 只有 429 按 `Retry-After` 做有界重试。
- 认证失败直接返回目标级错误。
- 页面创建 POST 不因后续封面失败而重发。
- 所有主要 Notion 路径复用支持系统代理、rustls、SOCKS、连接超时和总请求超时的统一客户端。
- 数据库检查把连接、超时、DNS、TLS、代理等客户端失败与 401/403/404 等 Notion HTTP API 错误分开；前端使用 45 秒专用门限。
- 用户可见 Toast 保持简洁，不拼接底层请求 URL；结构化 detail 仍保留用于诊断且不得包含 Token。

### 3.4 现有成果页回填

- 先分页读取所有成果页并生成预检快照。
- 预检固定 database ID、schema fingerprint、唯一 `封面/files` 字段方案和唯一 Book ID 字段。
- 只按 Book ID 读取本地缓存，不访问微信读书远端；只接受 HTTP(S) 封面。
- 处理每页前重新读取最新状态，只补空的属性封面和空的 Page cover，已有人工值分别保留。
- 单页两种封面独立更新；一个成功一个失败记为 `partial`，单页失败不停止整体。
- 支持显式确认、进度事件、operation ID 取消、结构化报告和单飞保护。
- 不创建数据库，不创建、删除或归档成果页；schema 漂移或字段冲突时停止并要求重新预检。

### 3.5 验收

- 目标页面可正常创建。
- 标准数据库存在 `封面` Files & media 属性，并可映射为 Gallery Card preview。
- 新导出页面能独立写入属性封面和 Page cover。
- `contentImageOnly` 模式仍写属性封面，但不写 Page cover。
- 长正文不会因单次提交过大而整体失败。
- 旧页回填只补空值，保留人工封面；缺本地封面时跳过并报告。
- 真实回填前必须再次取得用户明确确认，本地测试不执行真实 Notion mutation。

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
- 标准数据库 payload 包含 `封面/files`。
- analysis 建议 `cover -> files` 映射。
- 页面创建 payload 不嵌入封面 mutation。
- 属性封面与 Page cover 空值判断相互独立。
- 回填字段冲突、Book ID 歧义、schema 漂移、显式确认、取消汇总和本地封面优先级测试。

### 集成测试

- Markdown 导出回归。
- Obsidian 导出回归。
- Notion 失败降级回归。
- Tauri runtime、build manifest、generated permissions 与 capability 一致性。
- 前端 preflight/run/cancel/progress mapper 的 fail-closed 契约。
- Settings 页预检摘要、显式确认、blocked 状态、进度、取消和报告 E2E；全部使用本地 Tauri mock。

### 手工验收

- 本地 Vault 可直接打开。
- Notion 页面可见标题、属性封面、Page cover 和正文。
- Gallery Card preview 绑定 `封面` 后可显示封面。
- `contentImageOnly` 下 Gallery 属性封面仍存在，Page cover 不写入。
- 旧页已有人工封面不被覆盖，缺本地封面被跳过并报告。
- 失败后仍保留已成功目标结果。
- 真实封面回填只在用户查看预检并再次明确确认后执行。

2026-08-03 真实验收：用户确认既有成果页封面回填测试通过，Gallery 已从 `封面` Files & media 属性正常展示卡片封面。该结果完成本阶段真实 mutation 和视觉验收；未来再次运行仍必须重新预检并显式确认。

2026-08-03 默认视图实施：应用新建标准成果库已接入 `最近导入`、`书籍笔记`、`待复盘`、`复盘与报告` 四个 Table 视图。视图状态独立于数据库可用性持久化；`partial` 可单独重试，已知 database ID 后不会再次创建数据库。List Views 不完整时 fail-closed，View mutation 结果未知时只对账、不盲目重发。用户已有数据库保持只读连接，不自动改造视图。本地自动化已覆盖契约和恢复路径，真实 Views API mutation 待用户另行明确授权后验收。

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
- [ ] 标准数据库默认包含 `封面` Files & media 属性，Gallery 可绑定该属性。
- [ ] 属性封面与 Page cover 独立写入、独立容错，失败不触发页面创建 POST 重发。
- [ ] `contentImageOnly` 仅禁用 Page cover，不禁用属性封面。
- [ ] 旧页回填只补空值，支持预检、显式确认、进度、取消、报告和 fail-closed。
- [ ] 任一目标失败不影响其他目标结果。
- [ ] 现有 Markdown 导出保持可用。

