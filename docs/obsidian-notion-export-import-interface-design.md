# Obsidian / Notion 双通道导出导入接口与数据结构设计

## 目标

基于：

- [设计文档](./obsidian-notion-export-import-design.md)
- [实施计划](./obsidian-notion-export-import-implementation-plan.md)

继续下沉到可直接实现的接口层，明确：

- Rust 侧核心类型。
- Tauri commands 设计。
- 前端 TypeScript 类型。
- 设置与凭据持久化边界。
- 各资产导出入口如何复用同一套底层编排。

本设计优先遵循当前仓库约定：

- JSON 序列化统一使用 `camelCase`
- 命令层尽量薄
- 敏感凭据进入 `Stronghold`
- 非敏感路径与偏好进入本地配置文件

## 设计结论

### 1. 命令层不合并为一个胖接口

保留“按资产暴露命令”的现有模式，不新增一个包办所有阅读资产的单一导出命令。

原因：

- 现有页面已经按资产拆分：单本笔记、书籍复盘、阅读指南、统计复盘、选书决策。
- 各资产导出参数不同，强行做单一 union request 会抬高前后端复杂度。
- 当前最稳定的复用点是“底层导出编排器”，不是“顶层命令”。

因此：

- 顶层命令继续按资产拆分。
- 底层共享 `ExportDocument` 构建器和 `TargetExporter` 编排器。

### 2. 设置与凭据分开存

- 非敏感配置：
  - Obsidian Vault 路径
  - Obsidian 附件策略
  - Obsidian 导出后是否自动打开
  - Notion 默认目标 `page/database` 类型与 ID
  - Notion 默认封面策略

  继续落在现有 `local-data-directory.json`

- 敏感配置：
  - Notion API Token

  单独进入 `Stronghold`

这与当前：

- 微信读书 API Key
- AI API Key

的处理方式一致，不新发明一套凭据系统。

## 当前基线对齐

### 现有后端返回模式

仓库里当前导出相关返回值大致分两类：

- 单文件导出：`ExportBookNotesMarkdownResponse`、`ExportAiMarkdownResponse`
- 批量导出：`BulkExportResponse` + `BulkExportReport`

新方案建议沿用“单次导出返回聚合结果”的模式，不引入额外任务表。

### 现有设置状态模式

当前设置页通过 `SettingsState` 返回：

- `localData`
- `exportData`
- `network`

新方案不建议把 Notion/Obsidian 配置硬塞进 `ExportDataState`，而是新增单独集成状态字段，保持单一职责。

## Rust 类型设计

### 1. 目标枚举

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalExportTarget {
    Markdown,
    Obsidian,
    Notion,
}
```

说明：

- 保持和前端字符串字面量一一对应。
- `Markdown` 继续作为正式目标，便于同一次任务里同时选本地导出和外部导入。

### 2. 通用请求

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MultiTargetExportRequest {
    pub targets: Vec<ExternalExportTarget>,
    pub obsidian: Option<ObsidianExportOverrides>,
    pub notion: Option<NotionExportOverrides>,
}
```

说明：

- `targets` 至少包含一个目标。
- 首版不新增 `markdown` override，继续使用当前导出目录。
- `obsidian` 和 `notion` 只承载本次导出的临时覆盖项，不替代设置页默认值。

### 3. Obsidian 临时覆盖项

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianExportOverrides {
    pub vault_dir: Option<String>,
    pub open_after_export: Option<bool>,
}
```

说明：

- 首版只允许覆盖 Vault 路径和是否自动打开。
- 附件策略优先走设置页默认值，不在首版请求里扩散。

### 4. Notion 临时覆盖项

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionExportOverrides {
    pub parent_id: Option<String>,
    pub parent_type: Option<NotionParentType>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionParentType {
    Page,
    Database,
}
```

说明：

- 首版只支持手动指定 `page/database` 目标。
- 不做远端目标浏览器，不拉长第一阶段链路。

### 5. 统一导出文档模型

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocument {
    pub source_kind: ExportSourceKind,
    pub source_id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<ExportAsset>,
    pub front_matter: Vec<ExportMetaField>,
    pub sections: Vec<ExportSection>,
    pub exported_at: String,
    pub basis_notice: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportSourceKind {
    BookNotes,
    BookReview,
    ReadingStatsReview,
    ReadingRoute,
    BookDecision,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSection {
    pub heading: String,
    pub body_markdown: String,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportMetaField {
    pub key: String,
    pub value: String,
}
```

说明：

- `ExportDocument` 是目标无关模型。
- `body_markdown` 作为首版统一中间文本格式，避免一开始就自建块级 AST。
- 后续如需更强 Notion 块映射，可以在不破坏命令层的前提下，把 `body_markdown` 替换为更细结构。

### 6. 资源模型

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportAsset {
    pub kind: ExportAssetKind,
    pub remote_url: Option<String>,
    pub local_path: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportAssetKind {
    Cover,
    InlineImage,
    Attachment,
}
```

说明：

- 首版最重要的是 `Cover`。
- `local_path` 只在资源物化后填充。
- `remote_url` 作为 Notion 或 Markdown 的兜底引用。

### 7. 目标级结果

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MultiTargetExportResponse {
    pub export_id: String,
    pub source_kind: ExportSourceKind,
    pub source_id: String,
    pub exported_at: String,
    pub results: Vec<ExportTargetResult>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportTargetResult {
    pub target: ExternalExportTarget,
    pub status: ExportTargetStatus,
    pub title: Option<String>,
    pub path: Option<String>,
    pub url: Option<String>,
    pub page_id: Option<String>,
    pub file_count: Option<usize>,
    pub warning: Option<String>,
    pub error: Option<ExportTargetError>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportTargetStatus {
    Succeeded,
    Failed,
    Skipped,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportTargetError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}
```

说明：

- 目标级失败不提升为整次命令失败，除非输入本身非法。
- `error` 结构复用当前命令错误风格：`code/message/detail`。

## 设置状态设计

### 1. SettingsState 扩展

前端与后端统一新增：

```rust
pub struct SettingsStateResponse {
    pub credential: CredentialStatus,
    pub credential_error: Option<SettingsCredentialError>,
    pub sync_states: Vec<SyncStateRecord>,
    pub local_data: LocalDataState,
    pub export_data: ExportDataState,
    pub integration_data: IntegrationDataState,
    pub network: NetworkState,
    pub app_version: String,
    pub supports_native_updater: bool,
}
```

### 2. 集成状态

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationDataState {
    pub obsidian: ObsidianIntegrationState,
    pub notion: NotionIntegrationState,
}
```

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianIntegrationState {
    pub vault_dir: Option<String>,
    pub has_configured_vault: bool,
    pub attachment_mode: ObsidianAttachmentMode,
    pub open_after_export: bool,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ObsidianAttachmentMode {
    SiblingAssets,
    CentralAssets,
}
```

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionIntegrationState {
    pub credential: NotionCredentialStatus,
    pub parent_id: Option<String>,
    pub parent_type: Option<NotionParentType>,
    pub cover_mode: NotionCoverMode,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionCredentialStatus {
    pub has_credential: bool,
    pub last_validated_at: Option<String>,
    pub last_validation_error: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionCoverMode {
    PageCover,
    ContentImageOnly,
}
```

说明：

- `integrationData` 保持和 `exportData`、`network` 同级，避免污染原本只描述本地导出目录的 `exportDataState`。
- `NotionCredentialStatus` 结构直接镜像当前凭据状态风格。

## 配置落盘设计

### 1. 非敏感配置

扩展 `src-tauri/src/db.rs` 中的 `DataDirectoryConfig`：

```rust
struct DataDirectoryConfig {
    custom_data_dir: Option<String>,
    custom_export_dir: Option<String>,
    weread_proxy_url: Option<String>,
    obsidian_vault_dir: Option<String>,
    obsidian_attachment_mode: Option<String>,
    obsidian_open_after_export: Option<bool>,
    notion_parent_id: Option<String>,
    notion_parent_type: Option<String>,
    notion_cover_mode: Option<String>,
}
```

说明：

- 都是非敏感设置，适合继续和导出目录配置保存在同一个 JSON 文件。
- 不单开新的本地配置文件，减少文件数量。

### 2. 敏感配置

新增 `NotionCredentialService`，模式和 `CredentialService` / `AiService` 保持一致：

```rust
const CLIENT_PATH: &[u8] = b"notion-export-credentials";
const API_TOKEN_RECORD: &[u8] = b"notion-api-token";
const METADATA_RECORD: &[u8] = b"notion-credential-metadata";
const VAULT_PASSWORD: &str = "wxreadmaster-local-notion-credential-v1";
```

说明：

- 不和 AI credential 共用 client path。
- 不把 token 放进 `settingsState` 返回。
- 不写入日志、导出内容和诊断导出。

## Tauri Commands 设计

### 1. 设置相关命令

建议新增：

- `choose_obsidian_vault_directory`
- `save_obsidian_export_settings`
- `reset_obsidian_vault_directory`
- `save_notion_export_settings`

签名建议：

```rust
#[tauri::command]
pub fn choose_obsidian_vault_directory(app: AppHandle) -> Result<ChooseObsidianVaultDirectoryResponse, AppCommandError>
```

```rust
#[tauri::command]
pub fn save_obsidian_export_settings(
    app: AppHandle,
    vault_dir: String,
    attachment_mode: ObsidianAttachmentMode,
    open_after_export: bool,
) -> Result<SettingsStateResponse, AppCommandError>
```

```rust
#[tauri::command]
pub fn save_notion_export_settings(
    app: AppHandle,
    parent_id: Option<String>,
    parent_type: Option<NotionParentType>,
    cover_mode: NotionCoverMode,
) -> Result<SettingsStateResponse, AppCommandError>
```

说明：

- `reset_notion_export_settings` 首版可以不单独做，用保存空值覆盖。
- Obsidian 目录选择复用现有系统目录选择器模式。

### 2. 凭据相关命令

建议新增：

- `get_notion_credential_status`
- `save_notion_credential`
- `remove_notion_credential`
- `test_notion_connection`

签名建议：

```rust
#[tauri::command]
pub async fn get_notion_credential_status(app: AppHandle) -> Result<NotionCredentialStatus, AppCommandError>
```

```rust
#[tauri::command]
pub async fn save_notion_credential(
    app: AppHandle,
    token: String,
) -> Result<NotionCredentialStatus, AppCommandError>
```

```rust
#[tauri::command]
pub async fn remove_notion_credential(
    app: AppHandle,
    confirm: bool,
) -> Result<NotionCredentialStatus, AppCommandError>
```

```rust
#[tauri::command]
pub async fn test_notion_connection(app: AppHandle) -> Result<NotionConnectionTestResult, AppCommandError>
```

说明：

- 保持和现有 WeRead / AI 凭据交互节奏一致。
- 首版不单独开放“浏览 Notion 页面树”命令。

### 3. 导出命令

建议新增五个按资产导出的多目标命令：

- `export_book_notes_targets`
- `export_book_notes_summary_targets`
- `export_reading_stats_review_targets`
- `export_reading_route_targets`
- `export_book_decision_targets`

签名示例：

```rust
#[tauri::command]
pub async fn export_book_notes_targets(
    app: AppHandle,
    book_id: String,
    request: MultiTargetExportRequest,
) -> Result<MultiTargetExportResponse, AppCommandError>
```

```rust
#[tauri::command]
pub fn export_book_notes_summary_targets(
    app: AppHandle,
    book_id: String,
    review_feedback: Option<AiReviewFeedbackExport>,
    request: MultiTargetExportRequest,
) -> Result<MultiTargetExportResponse, AppCommandError>
```

说明：

- 与现有 `export_book_notes_markdown` 等命令并存。
- 后续页面可以逐步迁移到新命令，不需要一次性替换所有旧命令。
- 当前单纯 `Markdown` 导出按钮可继续使用旧命令，等 UI 切换时再接新命令。

## 前端 TypeScript 类型

建议在 `src/lib/types.ts` 中新增：

```ts
export type ExternalExportTarget = "markdown" | "obsidian" | "notion";

export type ObsidianAttachmentMode = "siblingAssets" | "centralAssets";

export type NotionParentType = "page" | "database";

export type NotionCoverMode = "pageCover" | "contentImageOnly";
```

```ts
export type MultiTargetExportRequest = {
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

```ts
export type ExportTargetStatus = "succeeded" | "failed" | "skipped";

export type ExportTargetError = {
  code: string;
  message: string;
  detail?: string;
};

export type ExportTargetResult = {
  target: ExternalExportTarget;
  status: ExportTargetStatus;
  title?: string;
  path?: string;
  url?: string;
  pageId?: string;
  fileCount?: number;
  warning?: string;
  error?: ExportTargetError;
};

export type MultiTargetExportResponse = {
  exportId: string;
  sourceKind: ExportSourceKind;
  sourceId: string;
  exportedAt: string;
  results: ExportTargetResult[];
};
```

```ts
export type IntegrationDataState = {
  obsidian: {
    vaultDir?: string;
    hasConfiguredVault: boolean;
    attachmentMode: ObsidianAttachmentMode;
    openAfterExport: boolean;
  };
  notion: {
    credential: {
      hasCredential: boolean;
      lastValidatedAt?: string;
      lastValidationError?: string;
    };
    parentId?: string;
    parentType?: NotionParentType;
    coverMode: NotionCoverMode;
  };
};
```

并扩展：

```ts
export type SettingsState = {
  credential: CredentialStatus;
  credentialError?: SettingsCredentialError;
  syncStates: SyncState[];
  localData: LocalDataState;
  exportData: ExportDataState;
  integrationData: IntegrationDataState;
  network: NetworkState;
  appVersion: string;
  supportsNativeUpdater: boolean;
};
```

## reading-api.ts 设计

建议新增：

- `chooseObsidianVaultDirectory()`
- `saveObsidianExportSettings()`
- `saveNotionExportSettings()`
- `getNotionCredentialStatus()`
- `saveNotionCredential()`
- `removeNotionCredential()`
- `testNotionConnection()`
- `exportBookNotesTargets()`
- `exportBookNotesSummaryTargets()`
- `exportReadingStatsReviewTargets()`
- `exportReadingRouteTargets()`
- `exportBookDecisionTargets()`

说明：

- Web Preview 下这些命令统一报“需要桌面应用”，不伪造成功结果。
- 命令命名继续贴近 Tauri command 名，减少映射层认知成本。

## 内部模块拆分建议

Rust 侧建议新增：

- `src-tauri/src/export/document.rs`
- `src-tauri/src/export/assets.rs`
- `src-tauri/src/export/obsidian.rs`
- `src-tauri/src/export/notion.rs`
- `src-tauri/src/export/targets.rs`

职责：

- `document.rs`：从现有资产构造 `ExportDocument`
- `assets.rs`：封面与附件物化
- `obsidian.rs`：Vault 落盘
- `notion.rs`：API 请求和 block 写入
- `targets.rs`：多目标编排和结果汇总

## 错误边界

### 1. 整体命令失败

只在以下情况返回 Tauri command error：

- `targets` 为空
- 资产输入参数非法
- 当前资产本地缓存不存在
- 配置状态严重缺失，无法开始任何目标

### 2. 目标级失败

以下情况进入 `ExportTargetResult.error`：

- Obsidian 路径不可写
- Notion token 无效
- Notion page/database 不存在
- 封面上传失败
- 远程图片下载失败

## 首版刻意不做

- 不做通用 `export_reading_asset`
- 不做 Notion 目标浏览器
- 不做进度事件流
- 不做导出任务历史表
- 不做双向同步状态字段

## 验收标准

- [ ] 新类型命名与现有 `camelCase` 约定一致。
- [ ] 敏感凭据仅进入 `Stronghold`。
- [ ] 非敏感设置仅进入本地配置文件。
- [ ] 导出命令继续按资产暴露，不引入单一胖接口。
- [ ] 新增前端类型和 API 名称可直接映射到 Rust 结构。
- [ ] 任一目标失败可在响应里被单独表达，不影响其他目标结果。

