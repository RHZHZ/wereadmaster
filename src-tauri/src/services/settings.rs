use std::{
    collections::BTreeMap,
    fmt::Write,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    db::{self, ImaAssetRouteConfig, DATABASE_FILE_NAME},
    errors::AppError,
    export::{
        document::ExportSourceKind,
        ima_client::{ima_compatibility_status, ImaCompatibilityStatus, IMA_ADAPTER_VERSION},
        notion::{
            analyze_database, create_reading_library_template,
            create_reading_library_template_typed, create_reading_workspace_template,
            NotionDatabaseAnalysis,
        },
        notion_views::{
            discover_database_context, reconcile_standard_views, view_results_complete,
            NotionDefaultViewResult,
        },
        targets::NotionParentType,
    },
    repositories::sync_state::{SyncStateRecord, SyncStateRepository},
    services::{
        credentials::{CredentialService, CredentialServiceError, CredentialStatus},
        ima_credentials::{ImaCredentialService, ImaCredentialStatus},
        notion_credentials::{NotionCredentialService, NotionCredentialStatus},
        notion_provisioning::{
            clear_provisioning, provisioning_path, read_provisioning,
            try_begin_provisioning_operation, write_provisioning_atomic, NotionProvisioningError,
            NotionStandardProvisioningPhase, NotionStandardProvisioningState,
            NotionStandardProvisioningStatus,
        },
        weread_gateway::normalize_weread_proxy_url,
    },
};

const CACHE_TABLES: &[&str] = &[
    "retrieval_embeddings",
    "retrieval_index_profiles",
    "retrieval_documents_fts",
    "retrieval_documents",
    "shelf_entries",
    "shelf_archives",
    "book_details",
    "book_progress",
    "chapters",
    "notebook_books",
    "highlights",
    "thoughts",
    "reading_stats",
    "raw_cache",
    "note_synthesis_batches",
    "note_synthesis_job_items",
    "note_synthesis_jobs",
    "ai_outputs",
    "ai_assistant_messages",
    "ai_assistant_threads",
    "sync_state",
];

const DIAGNOSTIC_TABLES: &[&str] = &[
    "shelf_entries",
    "shelf_archives",
    "book_details",
    "book_progress",
    "chapters",
    "notebook_books",
    "highlights",
    "thoughts",
    "reading_stats",
    "raw_cache",
    "note_synthesis_jobs",
    "note_synthesis_job_items",
    "note_synthesis_batches",
    "sync_state",
    "ai_outputs",
    "ai_feedback_records",
    "ai_assistant_threads",
    "ai_assistant_messages",
    "ai_assistant_preferences",
    "reading_item_states",
];

const BACKUP_MANIFEST_FILE_NAME: &str = "manifest.json";
const BACKUP_KIND: &str = "wxreadmaster-local-data-backup";
const BACKUP_SCHEMA_VERSION: u32 = 1;
const DATA_OPERATION_STATE_FILE_NAME: &str = "local-data-operation-state.json";
const APP_UPDATE_RELEASE_FEED_URL: &str =
    "https://github.com/RHZHZ/wereadmaster/releases/latest/download/latest.json";
const MAX_EXPORT_IMAGE_BASE64_LENGTH: usize = 32 * 1024 * 1024;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsCredentialError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDataState {
    pub data_dir: String,
    pub default_data_dir: String,
    pub database_path: String,
    pub database_size_bytes: u64,
    pub cache_row_count: u64,
    pub is_custom_data_dir: bool,
    pub last_data_operation_error: Option<String>,
    pub table_counts: Vec<TableCountRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataState {
    pub export_dir: String,
    pub default_export_dir: String,
    pub is_custom_export_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationDataState {
    pub obsidian: ObsidianIntegrationState,
    pub notion: NotionIntegrationState,
    pub ima: ImaIntegrationState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianIntegrationState {
    pub vault_dir: Option<String>,
    pub has_configured_vault: bool,
    pub attachment_mode: ObsidianAttachmentMode,
    pub open_after_export: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ObsidianAttachmentMode {
    SiblingAssets,
    CentralAssets,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionIntegrationState {
    pub credential: NotionCredentialStatus,
    pub parent_id: Option<String>,
    pub parent_type: Option<NotionParentType>,
    pub cover_mode: NotionCoverMode,
    pub database_connection: Option<db::NotionDatabaseConnectionConfig>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImaIntegrationState {
    pub credential: ImaCredentialStatus,
    pub note_folder_id: Option<String>,
    pub knowledge_base_id: Option<String>,
    pub knowledge_base_folder_id: Option<String>,
    pub publish_to_knowledge_base: bool,
    pub asset_routes: BTreeMap<String, ImaAssetRouteConfig>,
    pub adapter_version: String,
    pub checked_adapter_version: Option<String>,
    pub latest_version: Option<String>,
    pub release_desc: Option<String>,
    pub update_instruction: Option<String>,
    pub update_checked_date: Option<String>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub compatibility_status: ImaCompatibilityStatus,
    pub can_attempt_write: bool,
    pub is_write_compatible: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionCoverMode {
    PageCover,
    ContentImageOnly,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooseObsidianVaultDirectoryResponse {
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkState {
    pub weread_proxy_url: Option<String>,
    pub is_custom_weread_proxy: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCountRecord {
    pub table: String,
    pub row_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearLocalCacheResponse {
    pub deleted_rows: u64,
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearAiOutputCacheResponse {
    pub deleted_rows: u64,
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsResponse {
    pub file_name: String,
    pub path: String,
    pub exported_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImageResponse {
    pub file_name: String,
    pub path: String,
    pub exported_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBackupResponse {
    pub backup_id: String,
    pub path: String,
    pub exported_at: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupResponse {
    pub restored_from: String,
    pub restored_at: String,
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooseDataDirectoryResponse {
    pub path: Option<String>,
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateDataDirectoryResponse {
    pub previous_data_dir: String,
    pub data_dir: String,
    pub migrated_at: String,
    pub files: Vec<String>,
    pub state: SettingsStateResponse,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooseExportDirectoryResponse {
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveExportDirectoryResponse {
    pub path: String,
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotionReadingLibraryTemplateResponse {
    pub database_id: String,
    pub url: String,
    pub title: String,
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotionReadingWorkspaceTemplateResponse {
    pub home_page_id: String,
    pub home_page_url: String,
    pub database_id: String,
    pub database_url: String,
    pub title: String,
    pub warning: Option<String>,
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionStandardProvisioningResolution {
    LinkCurrentConnection,
    ConfirmNotCreated,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotionStandardDatabaseResponse {
    pub provisioning_id: String,
    pub phase: NotionStandardProvisioningPhase,
    pub status: NotionStandardProvisioningStatus,
    pub database_id: Option<String>,
    pub data_source_id: Option<String>,
    pub url: Option<String>,
    pub title: String,
    pub connection: Option<db::NotionDatabaseConnectionConfig>,
    pub state: Option<SettingsStateResponse>,
    pub views: Vec<NotionDefaultViewResult>,
    pub view_initialization: String,
    pub warnings: Vec<String>,
    pub last_error: Option<NotionProvisioningError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetExportDirectoryResponse {
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWereadProxyResponse {
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetWereadProxyResponse {
    pub state: SettingsStateResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAppUpdateManifestResponse {
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    kind: String,
    schema_version: u32,
    exported_at: String,
    database_file: String,
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DataOperationState {
    last_error: Option<String>,
    last_error_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RemoteAppUpdateManifestRecord {
    version: Option<String>,
    notes: Option<String>,
    pub_date: Option<String>,
}

pub struct SettingsService {
    app: AppHandle,
}

impl SettingsService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn settings_state(&self) -> Result<SettingsStateResponse, AppError> {
        let connection = self.open_connection()?;
        let sync_states = SyncStateRepository::new(&connection)
            .list()
            .map_err(AppError::from)?;
        let (credential, credential_error) =
            match CredentialService::new(self.app.clone()).credential_status() {
                Ok(credential) => (credential, None),
                Err(error) => (
                    CredentialStatus {
                        has_credential: false,
                        last_validated_at: None,
                        last_validation_error: Some(error.user_message()),
                    },
                    Some(settings_credential_error(error)),
                ),
            };

        Ok(SettingsStateResponse {
            credential,
            credential_error,
            sync_states,
            local_data: self.local_data_state(&connection)?,
            export_data: self.export_data_state()?,
            integration_data: self.integration_data_state()?,
            network: self.network_state()?,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            supports_native_updater: cfg!(desktop),
        })
    }

    pub fn clear_local_cache(&self, confirm: bool) -> Result<ClearLocalCacheResponse, AppError> {
        if !confirm {
            return Err(AppError::InvalidPayload(
                "清除本地缓存需要显式确认。".to_string(),
            ));
        }

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction().map_err(AppError::from)?;
        let deleted_rows = clear_cache_tables(&transaction)?;

        transaction.commit().map_err(AppError::from)?;

        Ok(ClearLocalCacheResponse {
            deleted_rows,
            state: self.settings_state()?,
        })
    }

    pub fn clear_ai_output_cache(
        &self,
        confirm: bool,
    ) -> Result<ClearAiOutputCacheResponse, AppError> {
        if !confirm {
            return Err(AppError::InvalidPayload(
                "清除 AI 输出缓存需要显式确认。".to_string(),
            ));
        }

        let connection = self.open_connection()?;
        let deleted_rows = clear_ai_output_cache(&connection)?;

        Ok(ClearAiOutputCacheResponse {
            deleted_rows,
            state: self.settings_state()?,
        })
    }

    pub fn export_diagnostics(&self) -> Result<ExportDiagnosticsResponse, AppError> {
        let state = self.settings_state()?;
        let exported_at = current_unix_seconds();
        let markdown = serialize_diagnostics_markdown(&state, &exported_at);
        let export_dir = db::active_export_dir(&self.app).map_err(AppError::Storage)?;
        fs::create_dir_all(&export_dir).map_err(|error| AppError::Storage(error.to_string()))?;

        let file_name = format!("wxreadmaster-diagnostics-{exported_at}.md");
        let path = export_dir.join(&file_name);
        fs::write(&path, markdown).map_err(|error| AppError::Storage(error.to_string()))?;

        Ok(ExportDiagnosticsResponse {
            file_name,
            path: path.to_string_lossy().to_string(),
            exported_at,
        })
    }

    pub fn export_report_image(
        &self,
        file_name: String,
        png_base64: String,
    ) -> Result<ExportImageResponse, AppError> {
        let exported_at = current_unix_seconds();
        let image_bytes = decode_png_base64(&png_base64)?;
        let file_name = sanitize_png_file_name(&file_name);
        let export_dir = db::active_export_dir(&self.app).map_err(AppError::Storage)?;
        fs::create_dir_all(&export_dir).map_err(|error| AppError::Storage(error.to_string()))?;

        let path = next_available_export_path(&export_dir, &file_name);
        fs::write(&path, image_bytes).map_err(|error| AppError::Storage(error.to_string()))?;

        Ok(ExportImageResponse {
            file_name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or(file_name),
            path: path.to_string_lossy().to_string(),
            exported_at,
        })
    }

    pub fn export_local_data_backup(&self) -> Result<ExportBackupResponse, AppError> {
        let exported_at = current_unix_seconds();
        let backup_id = format!("wxreadmaster-backup-{exported_at}");
        let data_dir = db::active_data_dir(&self.app).map_err(AppError::Storage)?;
        fs::create_dir_all(&data_dir).map_err(|error| AppError::Storage(error.to_string()))?;
        let backup_dir = data_dir.join("backups").join(&backup_id);
        let files = create_database_backup(&data_dir, &backup_dir, &exported_at)?;

        Ok(ExportBackupResponse {
            backup_id,
            path: backup_dir.display().to_string(),
            exported_at,
            files,
        })
    }

    pub fn restore_local_data_backup(
        &self,
        backup_path: String,
        confirm: bool,
    ) -> Result<RestoreBackupResponse, AppError> {
        if !confirm {
            return Err(AppError::InvalidPayload(
                "恢复本地备份需要显式确认。".to_string(),
            ));
        }

        let backup_dir = PathBuf::from(backup_path.trim());
        let manifest = match read_backup_manifest(&backup_dir) {
            Ok(manifest) => manifest,
            Err(error) => {
                self.record_data_operation_error("恢复失败", &error.user_message());
                return Err(error);
            }
        };
        if let Err(error) = validate_backup_manifest(&manifest.files) {
            self.record_data_operation_error("恢复失败", &error.user_message());
            return Err(error);
        }
        if let Err(error) = validate_backup_database(&backup_dir.join(&manifest.database_file)) {
            self.record_data_operation_error("恢复失败", &error.user_message());
            return Err(error);
        }

        let data_dir = match db::active_data_dir(&self.app).map_err(AppError::Storage) {
            Ok(data_dir) => data_dir,
            Err(error) => {
                self.record_data_operation_error("恢复失败", &error.user_message());
                return Err(error);
            }
        };
        if let Err(error) =
            fs::create_dir_all(&data_dir).map_err(|error| AppError::Storage(error.to_string()))
        {
            self.record_data_operation_error("恢复失败", &error.user_message());
            return Err(error);
        }
        if let Err(error) = restore_backup_files(&backup_dir, &data_dir, &manifest.files) {
            self.record_data_operation_error("恢复失败", &error.user_message());
            return Err(error);
        }

        Ok(RestoreBackupResponse {
            restored_from: backup_dir.display().to_string(),
            restored_at: current_unix_seconds(),
            state: self.settings_state()?,
        })
    }

    pub fn choose_custom_data_directory(
        &self,
        target_dir: Option<String>,
    ) -> Result<ChooseDataDirectoryResponse, AppError> {
        let selected_dir = select_custom_data_directory(target_dir.as_deref(), || {
            pick_folder(&self.app, "选择本地数据库迁移目录")
        })?;

        Ok(ChooseDataDirectoryResponse {
            path: selected_dir.map(|path| path.display().to_string()),
            state: self.settings_state()?,
        })
    }

    pub fn migrate_local_data_directory(
        &self,
        target_dir: String,
        confirm: bool,
    ) -> Result<MigrateDataDirectoryResponse, AppError> {
        if !confirm {
            return Err(AppError::InvalidPayload(
                "迁移本地数据目录需要显式确认。".to_string(),
            ));
        }

        let target_dir = PathBuf::from(target_dir.trim());
        if let Err(error) = validate_custom_data_directory(&target_dir) {
            self.record_data_operation_error("迁移失败", &error.user_message());
            return Err(error);
        }
        if let Err(error) = validate_writable_directory(&target_dir, "目标目录不可写，已取消迁移。")
        {
            self.record_data_operation_error("迁移失败", &error.user_message());
            return Err(error);
        }

        let previous_data_dir = match db::active_data_dir(&self.app).map_err(AppError::Storage) {
            Ok(data_dir) => data_dir,
            Err(error) => {
                self.record_data_operation_error("迁移失败", &error.user_message());
                return Err(error);
            }
        };
        let default_data_dir = match db::default_data_dir(&self.app).map_err(AppError::Storage) {
            Ok(data_dir) => data_dir,
            Err(error) => {
                self.record_data_operation_error("迁移失败", &error.user_message());
                return Err(error);
            }
        };
        if same_path(&previous_data_dir, &target_dir) {
            let error = AppError::InvalidPayload("目标目录已是当前本地数据目录。".to_string());
            self.record_data_operation_error("迁移失败", &error.user_message());
            return Err(error);
        }

        let files = match existing_database_file_manifest(&previous_data_dir) {
            Ok(files) => files,
            Err(error) => {
                self.record_data_operation_error("迁移失败", &error.user_message());
                return Err(error);
            }
        };
        if files.is_empty() {
            let error = AppError::InvalidPayload("当前没有可迁移的本地数据库。".to_string());
            self.record_data_operation_error("迁移失败", &error.user_message());
            return Err(error);
        }

        if let Err(error) = migrate_database_files(&previous_data_dir, &target_dir, &files) {
            self.record_data_operation_error("迁移失败", &error.user_message());
            return Err(error);
        }
        if let Err(error) = validate_backup_database(&target_dir.join(DATABASE_FILE_NAME)) {
            self.record_data_operation_error("迁移失败", &error.user_message());
            return Err(error);
        }
        if let Err(error) =
            db::write_custom_data_directory_config(&default_data_dir, Some(&target_dir))
                .map_err(AppError::Storage)
        {
            self.record_data_operation_error("迁移失败", &error.user_message());
            return Err(error);
        }

        Ok(MigrateDataDirectoryResponse {
            previous_data_dir: previous_data_dir.display().to_string(),
            data_dir: target_dir.display().to_string(),
            migrated_at: current_unix_seconds(),
            files,
            state: self.settings_state()?,
            restart_required: true,
        })
    }

    pub fn choose_custom_export_directory(
        &self,
    ) -> Result<ChooseExportDirectoryResponse, AppError> {
        let selected_dir = pick_folder(&self.app, "选择导出保存位置");

        let Some(path) = selected_dir else {
            return Ok(ChooseExportDirectoryResponse { path: None });
        };

        validate_export_directory(&path)?;
        validate_writable_directory(&path, "目标目录不可写，已取消设置导出保存位置。")?;

        Ok(ChooseExportDirectoryResponse {
            path: Some(path.display().to_string()),
        })
    }

    pub fn save_custom_export_directory(
        &self,
        target_dir: String,
    ) -> Result<SaveExportDirectoryResponse, AppError> {
        let path = target_dir.trim();
        if path.is_empty() {
            return Err(AppError::InvalidPayload(
                "请先选择或输入导出保存位置。".to_string(),
            ));
        }

        let path = PathBuf::from(path);
        validate_export_directory(&path)?;
        validate_writable_directory(&path, "目标目录不可写，已取消设置导出保存位置。")?;

        let default_data_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        db::write_custom_export_directory_config(&default_data_dir, Some(&path))
            .map_err(AppError::Storage)?;

        Ok(SaveExportDirectoryResponse {
            path: path.display().to_string(),
            state: self.settings_state()?,
        })
    }

    pub fn reset_custom_export_directory(&self) -> Result<ResetExportDirectoryResponse, AppError> {
        let default_data_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        db::write_custom_export_directory_config(&default_data_dir, None)
            .map_err(AppError::Storage)?;

        Ok(ResetExportDirectoryResponse {
            state: self.settings_state()?,
        })
    }

    pub fn save_weread_proxy_url(
        &self,
        proxy_url: String,
    ) -> Result<SaveWereadProxyResponse, AppError> {
        let proxy_url = normalize_weread_proxy_url(&proxy_url)?.ok_or_else(|| {
            AppError::InvalidPayload("请先输入微信读书网络代理地址。".to_string())
        })?;
        let default_data_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        db::write_weread_proxy_url_config(&default_data_dir, Some(&proxy_url))
            .map_err(AppError::Storage)?;

        Ok(SaveWereadProxyResponse {
            state: self.settings_state()?,
        })
    }

    pub fn reset_weread_proxy_url(&self) -> Result<ResetWereadProxyResponse, AppError> {
        let default_data_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        db::write_weread_proxy_url_config(&default_data_dir, None).map_err(AppError::Storage)?;

        Ok(ResetWereadProxyResponse {
            state: self.settings_state()?,
        })
    }

    pub fn choose_obsidian_vault_directory(
        &self,
    ) -> Result<ChooseObsidianVaultDirectoryResponse, AppError> {
        let selected_dir = pick_folder(&self.app, "选择 Obsidian Vault");
        let Some(path) = selected_dir else {
            return Ok(ChooseObsidianVaultDirectoryResponse { path: None });
        };
        validate_export_directory(&path)?;
        validate_writable_directory(&path, "Obsidian Vault 不可写，已取消设置。")?;
        Ok(ChooseObsidianVaultDirectoryResponse {
            path: Some(path.display().to_string()),
        })
    }

    pub fn save_obsidian_export_settings(
        &self,
        vault_dir: String,
        attachment_mode: ObsidianAttachmentMode,
        open_after_export: bool,
    ) -> Result<SettingsStateResponse, AppError> {
        let vault_dir = vault_dir.trim();
        if vault_dir.is_empty() {
            return Err(AppError::InvalidPayload(
                "请先选择 Obsidian Vault。".to_string(),
            ));
        }
        let vault_path = PathBuf::from(vault_dir);
        validate_export_directory(&vault_path)?;
        validate_writable_directory(&vault_path, "Obsidian Vault 不可写，已取消设置。")?;

        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        integration.obsidian_vault_dir = Some(vault_path.display().to_string());
        integration.obsidian_attachment_mode = Some(attachment_mode.as_config_value().to_string());
        integration.obsidian_open_after_export = open_after_export;
        db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)?;
        self.settings_state()
    }

    pub fn save_notion_export_settings(
        &self,
        parent_id: Option<String>,
        parent_type: Option<NotionParentType>,
        cover_mode: NotionCoverMode,
    ) -> Result<SettingsStateResponse, AppError> {
        let parent_id = normalize_optional_string(parent_id);
        if parent_id.is_some() != parent_type.is_some() {
            return Err(AppError::InvalidPayload(
                "Notion 目标 ID 与目标类型必须同时设置。".to_string(),
            ));
        }

        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        integration.notion_parent_id = parent_id;
        integration.notion_parent_type = parent_type
            .map(NotionParentType::as_config_value)
            .map(str::to_string);
        integration.notion_cover_mode = Some(cover_mode.as_config_value().to_string());
        db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)?;
        self.settings_state()
    }

    pub fn save_ima_export_settings(
        &self,
        note_folder_id: Option<String>,
        knowledge_base_id: Option<String>,
        knowledge_base_folder_id: Option<String>,
        publish_to_knowledge_base: bool,
        asset_routes: Option<BTreeMap<String, ImaAssetRouteConfig>>,
    ) -> Result<SettingsStateResponse, AppError> {
        let note_folder_id = normalize_optional_string(note_folder_id);
        let knowledge_base_id = normalize_optional_string(knowledge_base_id);
        let knowledge_base_folder_id = normalize_optional_string(knowledge_base_folder_id);
        if note_folder_id.as_deref() == Some("0") {
            return Err(AppError::InvalidPayload(
                "Ima 笔记本 ID 不能使用分页游标 0。".to_string(),
            ));
        }
        if publish_to_knowledge_base && knowledge_base_id.is_none() {
            return Err(AppError::InvalidPayload(
                "发布到 Ima 知识库时必须选择目标知识库。".to_string(),
            ));
        }
        if knowledge_base_folder_id.is_some() && !publish_to_knowledge_base {
            return Err(AppError::InvalidPayload(
                "选择 Ima 知识库文件夹时必须启用知识库发布。".to_string(),
            ));
        }

        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        integration.ima_note_folder_id = note_folder_id;
        integration.ima_knowledge_base_id = knowledge_base_id;
        integration.ima_knowledge_base_folder_id = knowledge_base_folder_id;
        integration.ima_publish_to_knowledge_base = publish_to_knowledge_base;
        if let Some(asset_routes) = asset_routes {
            integration.ima_asset_routes = normalize_ima_asset_routes(asset_routes, &integration)?;
        }
        db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)?;
        self.settings_state()
    }

    pub async fn analyze_notion_database(
        &self,
        database_id: String,
    ) -> Result<NotionDatabaseAnalysis, AppError> {
        let database_id = normalize_optional_string(Some(database_id)).ok_or_else(|| {
            AppError::InvalidPayload("请填写 Notion 数据库链接或 ID。".to_string())
        })?;
        let token = NotionCredentialService::new(self.app.clone())
            .read_token()
            .map_err(|error| AppError::Authentication(error.user_message()))?;
        analyze_database(&token, &database_id)
            .await
            .map_err(|error| classify_notion_analysis_error(&error))
    }

    pub fn save_notion_database_connection(
        &self,
        connection: db::NotionDatabaseConnectionConfig,
    ) -> Result<SettingsStateResponse, AppError> {
        validate_notion_database_connection(&connection)?;
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        integration.notion_parent_id = Some(connection.database_id.clone());
        integration.notion_parent_type =
            Some(NotionParentType::Database.as_config_value().to_string());
        integration.notion_database_connection = Some(connection);
        db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)?;
        self.settings_state()
    }

    pub async fn create_notion_standard_outcomes_database(
        &self,
        parent_page_id: String,
    ) -> Result<CreateNotionStandardDatabaseResponse, AppError> {
        let parent_page_id = normalize_optional_string(Some(parent_page_id)).ok_or_else(|| {
            AppError::InvalidPayload(
                "请先填写已共享给 Integration 的 Notion 父页面 ID。".to_string(),
            )
        })?;
        let token = NotionCredentialService::new(self.app.clone())
            .read_token()
            .map_err(|error| AppError::Authentication(error.user_message()))?;
        let _operation = try_begin_provisioning_operation()?;
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let path = provisioning_path(&config_dir);

        if let Some(existing) = read_provisioning(&path)? {
            return self.provisioning_response(existing);
        }

        let mut provisioning = NotionStandardProvisioningState::creating(parent_page_id.clone());
        write_provisioning_atomic(&path, &provisioning)?;

        let output = match create_reading_library_template_typed(&token, &parent_page_id).await {
            Ok(output) => output,
            Err(error) if error.result_unknown => {
                provisioning.last_error = Some(NotionProvisioningError {
                    step: "createDatabase".to_string(),
                    code: error.code,
                    message: error.message,
                    retryable: error.retryable,
                    result_unknown: true,
                });
                provisioning.transition(NotionStandardProvisioningPhase::DatabaseCreateUnknown)?;
                write_provisioning_atomic(&path, &provisioning)?;
                return self.provisioning_response(provisioning);
            }
            Err(error) => {
                clear_provisioning(&path)?;
                return Err(AppError::Gateway(error.message));
            }
        };

        provisioning.database_id = Some(output.database_id);
        provisioning.database_url = Some(output.url);
        provisioning.title = output.title;
        provisioning.last_error = None;
        provisioning.transition(NotionStandardProvisioningPhase::DatabaseCreated)?;
        write_provisioning_atomic(&path, &provisioning)?;

        self.continue_notion_standard_database_provisioning_inner(&token, &path, provisioning)
            .await
    }

    pub fn get_notion_standard_database_provisioning(
        &self,
    ) -> Result<Option<CreateNotionStandardDatabaseResponse>, AppError> {
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let path = provisioning_path(&config_dir);
        read_provisioning(&path)?
            .map(|provisioning| self.provisioning_response(provisioning))
            .transpose()
    }

    pub async fn continue_notion_standard_database_provisioning(
        &self,
        provisioning_id: String,
    ) -> Result<CreateNotionStandardDatabaseResponse, AppError> {
        let provisioning_id = normalize_optional_string(Some(provisioning_id))
            .ok_or_else(|| AppError::InvalidPayload("缺少 provisioning ID。".to_string()))?;
        let token = NotionCredentialService::new(self.app.clone())
            .read_token()
            .map_err(|error| AppError::Authentication(error.user_message()))?;
        let _operation = try_begin_provisioning_operation()?;
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let path = provisioning_path(&config_dir);
        let provisioning = read_provisioning(&path)?.ok_or_else(|| {
            AppError::InvalidPayload("没有可继续的标准阅读成果库初始化任务。".to_string())
        })?;
        validate_provisioning_id(&provisioning, &provisioning_id)?;

        if matches!(
            provisioning.phase,
            NotionStandardProvisioningPhase::Complete
                | NotionStandardProvisioningPhase::CreatingDatabase
                | NotionStandardProvisioningPhase::DatabaseCreateUnknown
        ) {
            return self.provisioning_response(provisioning);
        }

        self.continue_notion_standard_database_provisioning_inner(&token, &path, provisioning)
            .await
    }

    pub async fn resolve_notion_standard_database_provisioning(
        &self,
        provisioning_id: String,
        resolution: NotionStandardProvisioningResolution,
        confirm: bool,
    ) -> Result<Option<CreateNotionStandardDatabaseResponse>, AppError> {
        let provisioning_id = normalize_optional_string(Some(provisioning_id))
            .ok_or_else(|| AppError::InvalidPayload("缺少 provisioning ID。".to_string()))?;
        let _operation = try_begin_provisioning_operation()?;
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let path = provisioning_path(&config_dir);
        let mut provisioning = read_provisioning(&path)?.ok_or_else(|| {
            AppError::InvalidPayload("没有可处理的标准阅读成果库初始化任务。".to_string())
        })?;
        validate_provisioning_id(&provisioning, &provisioning_id)?;

        match resolution {
            NotionStandardProvisioningResolution::ConfirmNotCreated => {
                if !confirm {
                    return Err(AppError::InvalidPayload(
                        "重新开放创建前必须确认 Notion 中没有创建出该数据库。".to_string(),
                    ));
                }
                if !matches!(
                    provisioning.phase,
                    NotionStandardProvisioningPhase::CreatingDatabase
                        | NotionStandardProvisioningPhase::DatabaseCreateUnknown
                ) {
                    return Err(AppError::InvalidPayload(
                        "当前任务已经保存数据库 ID，不能确认其未创建。".to_string(),
                    ));
                }
                clear_provisioning(&path)?;
                Ok(None)
            }
            NotionStandardProvisioningResolution::LinkCurrentConnection => {
                let integration =
                    db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
                let connection = integration.notion_database_connection.ok_or_else(|| {
                    AppError::InvalidPayload(
                        "请先检查并保存 Notion 数据库连接，再执行关联。".to_string(),
                    )
                })?;
                let expected_database_id =
                    provisioning.database_id.as_deref().ok_or_else(|| {
                        AppError::InvalidPayload(
                            "创建结果未知且没有 database ID，不能自动关联数据库。".to_string(),
                        )
                    })?;
                if normalize_notion_id(&connection.database_id)
                    != normalize_notion_id(expected_database_id)
                {
                    return Err(AppError::InvalidPayload(
                        "当前已连接数据库与待恢复 database ID 不一致，已拒绝关联。".to_string(),
                    ));
                }
                provisioning.connection_saved_at = Some(current_unix_seconds());
                provisioning.last_error = None;
                provisioning.transition(NotionStandardProvisioningPhase::ConnectionSaved)?;
                write_provisioning_atomic(&path, &provisioning)?;
                let token_for_resolution = NotionCredentialService::new(self.app.clone())
                    .read_token()
                    .map_err(|error| AppError::Authentication(error.user_message()))?;
                self.continue_notion_standard_database_provisioning_inner(
                    &token_for_resolution,
                    &path,
                    provisioning,
                )
                .await
                .map(Some)
            }
        }
    }

    async fn continue_notion_standard_database_provisioning_inner(
        &self,
        token: &str,
        path: &Path,
        mut provisioning: NotionStandardProvisioningState,
    ) -> Result<CreateNotionStandardDatabaseResponse, AppError> {
        let database_id = provisioning.database_id.clone().ok_or_else(|| {
            AppError::Storage(
                "Notion provisioning 缺少 database ID，已停止继续初始化。".to_string(),
            )
        })?;

        if provisioning.connection_saved_at.is_none() {
            let analysis = match analyze_database(token, &database_id).await {
                Ok(analysis) => analysis,
                Err(error) => {
                    provisioning.last_error = Some(NotionProvisioningError {
                        step: "analyzeDatabase".to_string(),
                        code: "notion_database_analysis_failed".to_string(),
                        message: format!("标准成果库已创建，但读取字段失败：{error}"),
                        retryable: true,
                        result_unknown: false,
                    });
                    write_provisioning_atomic(path, &provisioning)?;
                    return self.provisioning_response(provisioning);
                }
            };
            let connection = match notion_connection_from_analysis(&analysis) {
                Ok(connection) => connection,
                Err(error) => {
                    provisioning.last_error = Some(NotionProvisioningError {
                        step: "buildConnection".to_string(),
                        code: error.code().to_string(),
                        message: error.user_message(),
                        retryable: false,
                        result_unknown: false,
                    });
                    write_provisioning_atomic(path, &provisioning)?;
                    return self.provisioning_response(provisioning);
                }
            };

            let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
            let save_result = (|| {
                let mut integration =
                    db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
                integration.notion_parent_id = Some(connection.database_id.clone());
                integration.notion_parent_type =
                    Some(NotionParentType::Database.as_config_value().to_string());
                integration.notion_database_connection = Some(connection.clone());
                db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)
            })();
            if let Err(error) = save_result {
                provisioning.last_error = Some(NotionProvisioningError {
                    step: "saveConnection".to_string(),
                    code: error.code().to_string(),
                    message: error.user_message(),
                    retryable: true,
                    result_unknown: false,
                });
                write_provisioning_atomic(path, &provisioning)?;
                return self.provisioning_response(provisioning);
            }

            provisioning.connection_saved_at = Some(current_unix_seconds());
            provisioning.last_error = None;
            provisioning.transition(NotionStandardProvisioningPhase::ConnectionSaved)?;
            write_provisioning_atomic(path, &provisioning)?;
        }

        provisioning.last_error = None;
        provisioning.transition(NotionStandardProvisioningPhase::ViewsInitializing)?;
        write_provisioning_atomic(path, &provisioning)?;

        let context = match discover_database_context(token, &database_id).await {
            Ok(context) => context,
            Err(error) => {
                provisioning.last_error = Some(NotionProvisioningError {
                    step: "discoverDataSource".to_string(),
                    code: "notion_data_source_discovery_failed".to_string(),
                    message: format!(
                        "数据库连接已保存，可以正常导出；推荐视图初始化前读取 data source 失败：{error}"
                    ),
                    retryable: true,
                    result_unknown: false,
                });
                provisioning.transition(NotionStandardProvisioningPhase::Partial)?;
                write_provisioning_atomic(path, &provisioning)?;
                return self.provisioning_response(provisioning);
            }
        };
        provisioning.data_source_id = Some(context.data_source_id.clone());
        write_provisioning_atomic(path, &provisioning)?;

        let results = reconcile_standard_views(token, &context, &provisioning.views).await;
        let complete = view_results_complete(&results);
        provisioning.views = results;
        if complete {
            provisioning.initialized_at = Some(current_unix_seconds());
            provisioning.last_error = None;
            provisioning.transition(NotionStandardProvisioningPhase::Complete)?;
        } else {
            let result_unknown = provisioning.views.iter().any(|view| {
                matches!(
                    view.status,
                    crate::export::notion_views::NotionDefaultViewStatus::Unknown
                )
            });
            provisioning.last_error = Some(NotionProvisioningError {
                step: "initializeViews".to_string(),
                code: if result_unknown {
                    "notion_view_initialization_result_unknown"
                } else {
                    "notion_view_initialization_partial"
                }
                .to_string(),
                message:
                    "数据库连接已保存，可以正常导出；部分推荐视图尚未初始化，可安全重试缺失视图。"
                        .to_string(),
                retryable: true,
                result_unknown,
            });
            provisioning.transition(NotionStandardProvisioningPhase::Partial)?;
        }
        write_provisioning_atomic(path, &provisioning)?;
        self.provisioning_response(provisioning)
    }

    fn provisioning_response(
        &self,
        provisioning: NotionStandardProvisioningState,
    ) -> Result<CreateNotionStandardDatabaseResponse, AppError> {
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let connection_saved = provisioning.connection_saved_at.is_some()
            && matches!(
                provisioning.phase,
                NotionStandardProvisioningPhase::ConnectionSaved
                    | NotionStandardProvisioningPhase::ViewsInitializing
                    | NotionStandardProvisioningPhase::Partial
                    | NotionStandardProvisioningPhase::Complete
            );
        let connection = if connection_saved {
            db::read_integration_config(&config_dir)
                .map_err(AppError::Storage)?
                .notion_database_connection
                .filter(|connection| {
                    provisioning
                        .database_id
                        .as_deref()
                        .map(|database_id| {
                            normalize_notion_id(&connection.database_id)
                                == normalize_notion_id(database_id)
                        })
                        .unwrap_or(false)
                })
        } else {
            None
        };
        let mut warnings = provisioning
            .views
            .iter()
            .filter_map(|view| view.warning.clone())
            .collect::<Vec<_>>();
        warnings.sort();
        warnings.dedup();
        let state = if connection.is_some() {
            match self.settings_state() {
                Ok(state) => Some(state),
                Err(error) => {
                    warnings.push(format!(
                        "导出连接已保存，但设置状态刷新失败：{}",
                        error.user_message()
                    ));
                    None
                }
            }
        } else {
            None
        };
        let view_initialization = match provisioning.phase {
            NotionStandardProvisioningPhase::ViewsInitializing => "initializing",
            NotionStandardProvisioningPhase::Partial => "partial",
            NotionStandardProvisioningPhase::Complete => "complete",
            _ => "notStarted",
        }
        .to_string();

        let status = provisioning.status();
        Ok(CreateNotionStandardDatabaseResponse {
            provisioning_id: provisioning.provisioning_id,
            phase: provisioning.phase,
            status,
            database_id: provisioning.database_id,
            data_source_id: provisioning.data_source_id,
            url: provisioning.database_url,
            title: provisioning.title,
            connection,
            state,
            views: provisioning.views,
            view_initialization,
            warnings,
            last_error: provisioning.last_error,
        })
    }

    pub async fn create_notion_reading_library_template(
        &self,
        parent_page_id: String,
    ) -> Result<CreateNotionReadingLibraryTemplateResponse, AppError> {
        let parent_page_id = normalize_optional_string(Some(parent_page_id)).ok_or_else(|| {
            AppError::InvalidPayload(
                "请先填写已共享给 Integration 的 Notion 父页面 ID。".to_string(),
            )
        })?;
        let token = NotionCredentialService::new(self.app.clone())
            .read_token()
            .map_err(|error| AppError::Authentication(error.user_message()))?;
        let output = create_reading_library_template(&token, &parent_page_id)
            .await
            .map_err(|error| AppError::Gateway(format!("创建 Notion 阅读库数据库失败：{error}")))?;

        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        integration.notion_parent_id = Some(output.database_id.clone());
        integration.notion_parent_type =
            Some(NotionParentType::Database.as_config_value().to_string());
        db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)?;

        Ok(CreateNotionReadingLibraryTemplateResponse {
            database_id: output.database_id,
            url: output.url,
            title: output.title,
            state: self.settings_state()?,
        })
    }

    pub async fn create_notion_reading_workspace_template(
        &self,
        parent_page_id: String,
    ) -> Result<CreateNotionReadingWorkspaceTemplateResponse, AppError> {
        let parent_page_id = normalize_optional_string(Some(parent_page_id)).ok_or_else(|| {
            AppError::InvalidPayload(
                "请先填写已共享给 Integration 的 Notion 父页面 ID。".to_string(),
            )
        })?;
        let token = NotionCredentialService::new(self.app.clone())
            .read_token()
            .map_err(|error| AppError::Authentication(error.user_message()))?;
        let output = create_reading_workspace_template(&token, &parent_page_id)
            .await
            .map_err(|error| AppError::Gateway(format!("创建 Notion 阅读工作台失败：{error}")))?;

        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        integration.notion_parent_id = Some(output.database_id.clone());
        integration.notion_parent_type =
            Some(NotionParentType::Database.as_config_value().to_string());
        db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)?;

        Ok(CreateNotionReadingWorkspaceTemplateResponse {
            home_page_id: output.home_page_id,
            home_page_url: output.home_page_url,
            database_id: output.database_id,
            database_url: output.database_url,
            title: output.title,
            warning: output.warning,
            state: self.settings_state()?,
        })
    }

    pub async fn remote_app_update_manifest() -> Result<RemoteAppUpdateManifestResponse, AppError> {
        let response = HttpClient::new()
            .get(APP_UPDATE_RELEASE_FEED_URL)
            .send()
            .await
            .map_err(|error| AppError::Gateway(format!("无法连接 GitHub 更新源：{error}")))?;

        if !response.status().is_success() {
            return Err(AppError::Gateway(format!(
                "GitHub 更新源返回异常状态：{}。",
                response.status()
            )));
        }

        let manifest = response
            .json::<RemoteAppUpdateManifestRecord>()
            .await
            .map_err(|error| AppError::Gateway(format!("更新清单解析失败：{error}")))?;

        let version = normalize_optional_string(manifest.version)
            .ok_or_else(|| AppError::Gateway("更新清单缺少版本号。".to_string()))?;

        Ok(RemoteAppUpdateManifestResponse {
            version,
            notes: normalize_optional_string(manifest.notes),
            published_at: normalize_optional_string(manifest.pub_date),
        })
    }

    fn local_data_state(
        &self,
        connection: &rusqlite::Connection,
    ) -> Result<LocalDataState, AppError> {
        let default_data_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let data_dir = db::active_data_dir(&self.app).map_err(AppError::Storage)?;
        let database_path = db::database_path(&self.app).map_err(AppError::Storage)?;
        let database_size_bytes = fs::metadata(&database_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let table_counts = DIAGNOSTIC_TABLES
            .iter()
            .map(|table| table_count(connection, table))
            .collect::<Result<Vec<_>, _>>()?;
        let cache_row_count = table_counts
            .iter()
            .filter(|record| CACHE_TABLES.contains(&record.table.as_str()))
            .map(|record| record.row_count)
            .sum::<u64>();

        Ok(LocalDataState {
            data_dir: data_dir.display().to_string(),
            default_data_dir: default_data_dir.display().to_string(),
            database_path: database_path.display().to_string(),
            database_size_bytes,
            cache_row_count,
            is_custom_data_dir: !same_path(&data_dir, &default_data_dir),
            last_data_operation_error: read_data_operation_state(&default_data_dir)
                .last_error
                .map(|error| sanitize_diagnostic_text(&error)),
            table_counts,
        })
    }

    fn record_data_operation_error(&self, operation: &str, message: &str) {
        if let Ok(default_data_dir) = db::default_data_dir(&self.app) {
            let state = DataOperationState {
                last_error: Some(sanitize_diagnostic_text(&format!("{operation}：{message}"))),
                last_error_at: Some(current_unix_seconds()),
            };
            let _ = write_data_operation_state(&default_data_dir, &state);
        }
    }

    fn export_data_state(&self) -> Result<ExportDataState, AppError> {
        let default_data_dir = db::active_data_dir(&self.app).map_err(AppError::Storage)?;
        let default_export_dir = db::default_export_dir(&self.app).map_err(AppError::Storage)?;
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let custom_export_dir =
            db::read_custom_export_directory_config(&config_dir).map_err(AppError::Storage)?;
        let export_dir = custom_export_dir
            .clone()
            .unwrap_or_else(|| default_export_dir.clone());

        Ok(
            build_export_data_state(&default_data_dir, custom_export_dir.as_deref())
                .with_paths(export_dir, default_export_dir),
        )
    }

    fn network_state(&self) -> Result<NetworkState, AppError> {
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let weread_proxy_url =
            db::read_weread_proxy_url_config(&config_dir).map_err(AppError::Storage)?;

        Ok(NetworkState {
            is_custom_weread_proxy: weread_proxy_url.is_some(),
            weread_proxy_url,
        })
    }

    fn integration_data_state(&self) -> Result<IntegrationDataState, AppError> {
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let integration = db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        let ima_compatibility_status = ima_compatibility_status(
            integration.ima_latest_version.as_deref(),
            integration.ima_update_checked_adapter_version.as_deref(),
            integration.ima_update_last_attempt_at.as_deref(),
            integration.ima_update_last_success_at.as_deref(),
        );
        let ima_can_attempt_write = ima_compatibility_status == ImaCompatibilityStatus::Compatible;
        let vault_dir = normalize_optional_string(integration.obsidian_vault_dir);

        Ok(IntegrationDataState {
            obsidian: ObsidianIntegrationState {
                has_configured_vault: vault_dir.is_some(),
                vault_dir,
                attachment_mode: ObsidianAttachmentMode::from_config_value(
                    integration.obsidian_attachment_mode.as_deref(),
                ),
                open_after_export: integration.obsidian_open_after_export,
            },
            notion: NotionIntegrationState {
                credential: NotionCredentialService::new(self.app.clone())
                    .credential_status()
                    .unwrap_or(NotionCredentialStatus {
                        has_credential: false,
                        last_validated_at: None,
                        last_validation_error: Some("Notion 凭据存储暂时不可用。".to_string()),
                    }),
                parent_id: normalize_optional_string(integration.notion_parent_id),
                parent_type: NotionParentType::from_config_value(
                    integration.notion_parent_type.as_deref(),
                ),
                cover_mode: NotionCoverMode::from_config_value(
                    integration.notion_cover_mode.as_deref(),
                ),
                database_connection: integration.notion_database_connection,
            },
            ima: ImaIntegrationState {
                credential: ImaCredentialService::new(self.app.clone())
                    .credential_status()
                    .unwrap_or(ImaCredentialStatus {
                        has_credential: false,
                        last_validated_at: None,
                        last_validation_error: Some("Ima 凭据存储暂时不可用。".to_string()),
                    }),
                note_folder_id: normalize_optional_string(integration.ima_note_folder_id),
                knowledge_base_id: normalize_optional_string(integration.ima_knowledge_base_id),
                knowledge_base_folder_id: normalize_optional_string(
                    integration.ima_knowledge_base_folder_id,
                ),
                publish_to_knowledge_base: integration.ima_publish_to_knowledge_base,
                asset_routes: integration.ima_asset_routes,
                adapter_version: IMA_ADAPTER_VERSION.to_string(),
                checked_adapter_version: integration.ima_update_checked_adapter_version,
                latest_version: integration.ima_latest_version,
                release_desc: integration.ima_release_desc,
                update_instruction: integration.ima_update_instruction,
                update_checked_date: integration.ima_update_checked_date,
                last_attempt_at: integration.ima_update_last_attempt_at,
                last_success_at: integration.ima_update_last_success_at,
                compatibility_status: ima_compatibility_status,
                can_attempt_write: ima_can_attempt_write,
                is_write_compatible: ima_can_attempt_write,
            },
        })
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AppError> {
        db::open_connection(&self.app).map_err(AppError::Storage)
    }
}

fn validate_provisioning_id(
    provisioning: &NotionStandardProvisioningState,
    provisioning_id: &str,
) -> Result<(), AppError> {
    if provisioning.provisioning_id != provisioning_id {
        return Err(AppError::InvalidPayload(
            "provisioning ID 与当前恢复任务不一致。".to_string(),
        ));
    }
    Ok(())
}

fn normalize_notion_id(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .flat_map(char::to_lowercase)
        .collect()
}

fn validate_notion_database_connection(
    connection: &db::NotionDatabaseConnectionConfig,
) -> Result<(), AppError> {
    if connection.database_id.trim().is_empty()
        || connection.title_property_id.trim().is_empty()
        || connection.title_property_name_snapshot.trim().is_empty()
        || connection.schema_checked_at.trim().is_empty()
    {
        return Err(AppError::InvalidPayload(
            "Notion 数据库连接信息不完整，请重新检查数据库。".to_string(),
        ));
    }
    let has_title_mapping = connection.mappings.iter().any(|mapping| {
        mapping.enabled
            && mapping.logical_field == "title"
            && mapping.property_id == connection.title_property_id
            && mapping.property_type == "title"
    });
    if !has_title_mapping {
        return Err(AppError::InvalidPayload(
            "Notion 数据库连接缺少有效的标题字段映射。".to_string(),
        ));
    }
    Ok(())
}

fn notion_connection_from_analysis(
    analysis: &NotionDatabaseAnalysis,
) -> Result<db::NotionDatabaseConnectionConfig, AppError> {
    let title = analysis.title_property.as_ref().ok_or_else(|| {
        AppError::InvalidPayload("Notion 数据库缺少 Title 属性，无法保存连接。".to_string())
    })?;
    Ok(db::NotionDatabaseConnectionConfig {
        database_id: analysis.database_id.clone(),
        database_name: analysis.database_name.clone(),
        database_url: analysis.database_url.clone(),
        title_property_id: title.id.clone(),
        title_property_name_snapshot: title.name.clone(),
        mappings: analysis
            .suggested_mappings
            .iter()
            .map(|mapping| db::NotionPropertyMappingConfig {
                logical_field: mapping.logical_field.clone(),
                property_id: mapping.property_id.clone(),
                property_name_snapshot: mapping.property_name_snapshot.clone(),
                property_type: mapping.property_type.clone(),
                enabled: mapping.enabled,
            })
            .collect(),
        schema_checked_at: analysis.schema_checked_at.clone(),
        schema_fingerprint: analysis.schema_fingerprint.clone(),
    })
}

impl ObsidianAttachmentMode {
    fn as_config_value(self) -> &'static str {
        match self {
            Self::SiblingAssets => "siblingAssets",
            Self::CentralAssets => "centralAssets",
        }
    }

    pub(crate) fn from_config_value(value: Option<&str>) -> Self {
        match value {
            Some("centralAssets") => Self::CentralAssets,
            _ => Self::SiblingAssets,
        }
    }
}

impl NotionCoverMode {
    fn as_config_value(self) -> &'static str {
        match self {
            Self::PageCover => "pageCover",
            Self::ContentImageOnly => "contentImageOnly",
        }
    }

    fn from_config_value(value: Option<&str>) -> Self {
        match value {
            Some("contentImageOnly") => Self::ContentImageOnly,
            _ => Self::PageCover,
        }
    }
}

#[cfg(not(mobile))]
fn pick_folder(app: &AppHandle, title: &str) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;

    app.dialog()
        .file()
        .set_title(title)
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
}

#[cfg(mobile)]
fn pick_folder(_app: &AppHandle, _title: &str) -> Option<PathBuf> {
    None
}

fn clear_cache_tables(connection: &rusqlite::Connection) -> Result<u64, AppError> {
    let mut deleted_rows = 0_u64;

    for table in CACHE_TABLES {
        deleted_rows += connection
            .execute(&format!("DELETE FROM {table}"), [])
            .map_err(AppError::from)? as u64;
    }

    Ok(deleted_rows)
}

fn clear_ai_output_cache(connection: &rusqlite::Connection) -> Result<u64, AppError> {
    let transaction = connection.unchecked_transaction().map_err(AppError::from)?;
    let mut deleted_rows = 0_u64;

    // Job children must be deleted before jobs so this remains correct if a restored
    // database has foreign-key enforcement disabled by an older SQLite connection.
    for table in [
        "note_synthesis_batches",
        "note_synthesis_job_items",
        "note_synthesis_jobs",
        "ai_outputs",
    ] {
        deleted_rows += transaction
            .execute(&format!("DELETE FROM {table}"), [])
            .map_err(AppError::from)? as u64;
    }

    transaction.commit().map_err(AppError::from)?;
    Ok(deleted_rows)
}

fn local_backup_file_manifest(existing_file_names: &[&str]) -> Vec<String> {
    let allowed = [
        DATABASE_FILE_NAME,
        &format!("{DATABASE_FILE_NAME}-wal"),
        &format!("{DATABASE_FILE_NAME}-shm"),
    ];

    allowed
        .iter()
        .filter(|file_name| {
            existing_file_names
                .iter()
                .any(|existing| existing == *file_name)
        })
        .map(|file_name| (*file_name).to_string())
        .collect()
}

fn local_data_migration_file_manifest(existing_file_names: &[&str]) -> Vec<String> {
    local_backup_file_manifest(existing_file_names)
}

fn validate_backup_manifest(file_names: &[String]) -> Result<(), AppError> {
    let allowed = local_backup_file_manifest(&[
        DATABASE_FILE_NAME,
        &format!("{DATABASE_FILE_NAME}-wal"),
        &format!("{DATABASE_FILE_NAME}-shm"),
    ]);

    if !file_names
        .iter()
        .any(|file_name| file_name == DATABASE_FILE_NAME)
    {
        return Err(AppError::InvalidPayload(
            "备份包缺少本地数据库文件。".to_string(),
        ));
    }

    if file_names
        .iter()
        .any(|file_name| !allowed.iter().any(|allowed_name| allowed_name == file_name))
    {
        return Err(AppError::InvalidPayload(
            "备份包包含不受支持的文件。".to_string(),
        ));
    }

    Ok(())
}

fn settings_credential_error(error: CredentialServiceError) -> SettingsCredentialError {
    let detail = match &error {
        CredentialServiceError::Storage(detail) if !detail.trim().is_empty() => {
            Some(detail.clone())
        }
        _ => None,
    };

    SettingsCredentialError {
        code: error.code().to_string(),
        message: error.user_message(),
        detail,
    }
}

fn existing_database_file_manifest(data_dir: &Path) -> Result<Vec<String>, AppError> {
    let candidates = [
        DATABASE_FILE_NAME,
        &format!("{DATABASE_FILE_NAME}-wal"),
        &format!("{DATABASE_FILE_NAME}-shm"),
    ];
    let existing = candidates
        .iter()
        .filter(|file_name| data_dir.join(file_name).is_file())
        .copied()
        .collect::<Vec<_>>();

    Ok(local_backup_file_manifest(&existing))
}

fn strip_rebuildable_retrieval_data(database_path: &Path) -> Result<(), AppError> {
    let connection = rusqlite::Connection::open(database_path).map_err(AppError::from)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             BEGIN IMMEDIATE;
             DELETE FROM retrieval_embeddings;
             DELETE FROM retrieval_index_profiles;
             DELETE FROM retrieval_documents_fts;
             COMMIT;
             PRAGMA wal_checkpoint(TRUNCATE);",
        )
        .map_err(AppError::from)
}

fn rebuild_restored_retrieval_fts(database_path: &Path) -> Result<(), AppError> {
    let connection = rusqlite::Connection::open(database_path).map_err(AppError::from)?;
    db::initialize_schema(&connection).map_err(AppError::from)?;
    crate::services::retrieval::rebuild_retrieval_fts(&connection).map_err(AppError::from)?;
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(AppError::from)
}

fn create_database_backup(
    data_dir: &Path,
    backup_dir: &Path,
    exported_at: &str,
) -> Result<Vec<String>, AppError> {
    fs::create_dir_all(backup_dir).map_err(|error| AppError::Storage(error.to_string()))?;
    let source_files = existing_database_file_manifest(data_dir)?;
    if source_files.is_empty() {
        return Err(AppError::InvalidPayload(
            "当前没有可备份的本地数据库。".to_string(),
        ));
    }

    copy_named_files(data_dir, backup_dir, &source_files)?;
    let backup_database_path = backup_dir.join(DATABASE_FILE_NAME);
    strip_rebuildable_retrieval_data(&backup_database_path)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = backup_dir.join(format!("{DATABASE_FILE_NAME}{suffix}"));
        if sidecar.exists() {
            fs::remove_file(sidecar).map_err(|error| AppError::Storage(error.to_string()))?;
        }
    }
    let files = vec![DATABASE_FILE_NAME.to_string()];
    let manifest = BackupManifest {
        kind: BACKUP_KIND.to_string(),
        schema_version: BACKUP_SCHEMA_VERSION,
        exported_at: exported_at.to_string(),
        database_file: DATABASE_FILE_NAME.to_string(),
        files: files.clone(),
    };
    write_backup_manifest(backup_dir, &manifest)?;
    validate_backup_manifest(&manifest.files)?;
    validate_backup_database(&backup_dir.join(DATABASE_FILE_NAME))?;

    Ok(files)
}

fn validate_custom_data_directory(path: &Path) -> Result<(), AppError> {
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name == DATABASE_FILE_NAME || name.starts_with(&format!("{DATABASE_FILE_NAME}-"))
        })
    {
        return Err(AppError::InvalidPayload(
            "请选择一个文件夹作为数据目录。".to_string(),
        ));
    }

    if path.is_file() {
        return Err(AppError::InvalidPayload(
            "请选择一个文件夹作为数据目录。".to_string(),
        ));
    }

    Ok(())
}

fn select_custom_data_directory(
    target_dir: Option<&str>,
    pick_folder: impl FnOnce() -> Option<PathBuf>,
) -> Result<Option<PathBuf>, AppError> {
    let selected_dir = match target_dir.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => Some(PathBuf::from(path)),
        None => pick_folder(),
    };

    let Some(path) = selected_dir else {
        return Ok(None);
    };

    validate_custom_data_directory(&path)?;
    validate_writable_directory(&path, "目标目录不可写，已取消迁移。")?;

    Ok(Some(path))
}

fn validate_export_directory(path: &Path) -> Result<(), AppError> {
    if path.is_file() {
        return Err(AppError::InvalidPayload(
            "请选择一个文件夹作为导出保存位置。".to_string(),
        ));
    }

    Ok(())
}

fn decode_png_base64(value: &str) -> Result<Vec<u8>, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidPayload(
            "阅读报告图片内容不能为空。".to_string(),
        ));
    }

    if value.len() > MAX_EXPORT_IMAGE_BASE64_LENGTH {
        return Err(AppError::InvalidPayload(
            "阅读报告图片过大，已取消导出。".to_string(),
        ));
    }

    let payload = if value.to_ascii_lowercase().starts_with("data:") {
        let (header, payload) = value.split_once(',').ok_or_else(|| {
            AppError::InvalidPayload("阅读报告图片内容不是有效的 PNG 数据。".to_string())
        })?;
        let header = header.to_ascii_lowercase();
        if !header.starts_with("data:image/png") || !header.contains(";base64") {
            return Err(AppError::InvalidPayload(
                "阅读报告图片格式无效，仅支持 PNG。".to_string(),
            ));
        }

        payload
    } else {
        value
    };

    let bytes = general_purpose::STANDARD.decode(payload).map_err(|_| {
        AppError::InvalidPayload("阅读报告图片内容不是有效的 PNG 数据。".to_string())
    })?;

    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err(AppError::InvalidPayload(
            "阅读报告图片格式无效，仅支持 PNG。".to_string(),
        ));
    }

    Ok(bytes)
}

fn sanitize_png_file_name(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>();
    let sanitized = sanitized
        .trim_matches(|character| matches!(character, '.' | ' ' | '_' | '\t' | '\n' | '\r'));
    let stem = if sanitized.to_ascii_lowercase().ends_with(".png") {
        &sanitized[..sanitized.len() - 4]
    } else {
        sanitized
    }
    .trim_matches(|character| matches!(character, '.' | ' ' | '_'));
    let mut stem = if stem.is_empty() {
        "reading-report".to_string()
    } else {
        stem.chars().take(120).collect::<String>()
    };

    if is_reserved_windows_file_stem(&stem) {
        stem = format!("wxreadmaster-{stem}");
    }

    format!("{stem}.png")
}

fn is_reserved_windows_file_stem(value: &str) -> bool {
    matches!(
        value.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn next_available_export_path(export_dir: &Path, file_name: &str) -> PathBuf {
    let path = export_dir.join(file_name);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "reading-report".to_string());

    for index in 1.. {
        let candidate = export_dir.join(format!("{stem} ({index}).png"));
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("unbounded candidate search should always return");
}

fn validate_writable_directory(path: &Path, message: &str) -> Result<(), AppError> {
    fs::create_dir_all(path).map_err(|_| AppError::InvalidPayload(message.to_string()))?;
    let probe = path.join(format!(
        ".wxreadmaster-write-test-{}",
        current_unix_seconds()
    ));
    fs::write(&probe, b"ok").map_err(|_| AppError::InvalidPayload(message.to_string()))?;
    fs::remove_file(&probe).map_err(|error| AppError::Storage(error.to_string()))
}

fn classify_notion_analysis_error(error: &str) -> AppError {
    let normalized = error.to_ascii_lowercase();
    let is_network_error = normalized.contains("无法连接 notion api")
        || normalized.contains("初始化 notion 网络客户端失败")
        || normalized.contains("error sending request")
        || normalized.contains("connection refused")
        || normalized.contains("connection reset")
        || normalized.contains("timed out")
        || normalized.contains("timeout")
        || normalized.contains("dns error")
        || normalized.contains("tls error")
        || normalized.contains("proxy error");
    if is_network_error {
        AppError::Network(format!("检查 Notion 数据库失败：{error}"))
    } else {
        AppError::Gateway(format!("检查 Notion 数据库失败：{error}"))
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_ima_asset_routes(
    routes: BTreeMap<String, ImaAssetRouteConfig>,
    global: &db::IntegrationConfig,
) -> Result<BTreeMap<String, ImaAssetRouteConfig>, AppError> {
    routes
        .into_iter()
        .map(|(source_kind, route)| {
            let Some(kind) = ExportSourceKind::from_config_value(&source_kind) else {
                return Err(AppError::InvalidPayload(format!(
                    "未知的 Ima 资产类别：{source_kind}。"
                )));
            };
            let route = ImaAssetRouteConfig {
                note_folder_id: normalize_optional_string(route.note_folder_id),
                knowledge_base_id: normalize_optional_string(route.knowledge_base_id),
                knowledge_base_folder_id: normalize_optional_string(route.knowledge_base_folder_id),
                publish_to_knowledge_base: route.publish_to_knowledge_base,
            };
            if route.note_folder_id.as_deref() == Some("0") {
                return Err(AppError::InvalidPayload(format!(
                    "{} 的 Ima 笔记本 ID 不能使用分页游标 0。",
                    kind.ima_asset_label()
                )));
            }

            let global_publish_to_knowledge_base = if kind == ExportSourceKind::BookDecision {
                false
            } else {
                global.ima_publish_to_knowledge_base
            };
            let publish_to_knowledge_base = route
                .publish_to_knowledge_base
                .unwrap_or(global_publish_to_knowledge_base);
            let knowledge_base_id = route
                .knowledge_base_id
                .as_deref()
                .or(global.ima_knowledge_base_id.as_deref());
            if publish_to_knowledge_base && knowledge_base_id.is_none() {
                return Err(AppError::InvalidPayload(format!(
                    "{} 发布到 Ima 知识库时必须选择目标知识库。",
                    kind.ima_asset_label()
                )));
            }
            if !publish_to_knowledge_base
                && (route.knowledge_base_id.is_some() || route.knowledge_base_folder_id.is_some())
            {
                return Err(AppError::InvalidPayload(format!(
                    "{} 未启用知识库发布，不能指定知识库或文件夹。",
                    kind.ima_asset_label()
                )));
            }
            if route.knowledge_base_folder_id.is_some() && knowledge_base_id.is_none() {
                return Err(AppError::InvalidPayload(format!(
                    "{} 的 Ima 知识库文件夹必须同时指定目标知识库。",
                    kind.ima_asset_label()
                )));
            }

            Ok((kind.as_config_value().to_string(), route))
        })
        .collect()
}

fn build_export_data_state(
    default_data_dir: &Path,
    custom_export_dir: Option<&Path>,
) -> ExportDataState {
    let default_export_dir = default_data_dir.join("exports");
    let export_dir = custom_export_dir.unwrap_or(&default_export_dir);

    ExportDataState {
        export_dir: export_dir.display().to_string(),
        default_export_dir: default_export_dir.display().to_string(),
        is_custom_export_dir: custom_export_dir
            .map(|path| !same_path(path, &default_export_dir))
            .unwrap_or(false),
    }
}

impl ExportDataState {
    fn with_paths(mut self, export_dir: PathBuf, default_export_dir: PathBuf) -> Self {
        self.export_dir = export_dir.display().to_string();
        self.default_export_dir = default_export_dir.display().to_string();
        self.is_custom_export_dir = !same_path(&export_dir, &default_export_dir);
        self
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn migrate_database_files(
    previous_data_dir: &Path,
    target_dir: &Path,
    file_names: &[String],
) -> Result<(), AppError> {
    let rollback_dir = target_dir.join(format!("migration-rollback-{}", current_unix_seconds()));
    fs::create_dir_all(&rollback_dir).map_err(|error| AppError::Storage(error.to_string()))?;
    let existing_target_files = existing_database_file_manifest(target_dir)?;
    copy_named_files(target_dir, &rollback_dir, &existing_target_files)?;

    let migration_result = (|| {
        for file_name in existing_target_files
            .iter()
            .filter(|name| !file_names.contains(name))
        {
            let path = target_dir.join(file_name);
            if path.exists() {
                fs::remove_file(&path).map_err(|error| AppError::Storage(error.to_string()))?;
            }
        }

        copy_named_files(previous_data_dir, target_dir, file_names)
    })();

    if let Err(error) = migration_result {
        let _ = copy_named_files(&rollback_dir, target_dir, &existing_target_files);
        return Err(error);
    }

    let _ = fs::remove_dir_all(&rollback_dir);
    Ok(())
}

fn copy_named_files(from_dir: &Path, to_dir: &Path, file_names: &[String]) -> Result<(), AppError> {
    for file_name in file_names {
        if !from_dir.join(file_name).is_file() {
            continue;
        }
        fs::copy(from_dir.join(file_name), to_dir.join(file_name))
            .map_err(|error| AppError::Storage(error.to_string()))?;
    }

    Ok(())
}

fn write_backup_manifest(backup_dir: &Path, manifest: &BackupManifest) -> Result<(), AppError> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|error| AppError::Storage(error.to_string()))?;
    fs::write(backup_dir.join(BACKUP_MANIFEST_FILE_NAME), content)
        .map_err(|error| AppError::Storage(error.to_string()))
}

fn read_backup_manifest(backup_dir: &Path) -> Result<BackupManifest, AppError> {
    if !backup_dir.is_dir() {
        return Err(AppError::InvalidPayload(
            "备份路径不是有效目录。".to_string(),
        ));
    }

    let content = fs::read_to_string(backup_dir.join(BACKUP_MANIFEST_FILE_NAME))
        .map_err(|_| AppError::InvalidPayload("备份包缺少 manifest.json。".to_string()))?;
    let manifest = serde_json::from_str::<BackupManifest>(&content)
        .map_err(|_| AppError::InvalidPayload("备份包 manifest 无法解析。".to_string()))?;

    if manifest.kind != BACKUP_KIND || manifest.schema_version != BACKUP_SCHEMA_VERSION {
        return Err(AppError::InvalidPayload(
            "备份包类型或版本不受支持。".to_string(),
        ));
    }

    Ok(manifest)
}

fn validate_backup_database(database_path: &Path) -> Result<(), AppError> {
    if !database_path.is_file() {
        return Err(AppError::InvalidPayload(
            "备份包缺少本地数据库文件。".to_string(),
        ));
    }

    let connection = rusqlite::Connection::open(database_path)
        .map_err(|_| AppError::InvalidPayload("备份数据库无法打开，已取消恢复。".to_string()))?;

    let table_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (
                'sync_state',
                'shelf_entries',
                'notebook_books',
                'raw_cache',
                'ai_outputs'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| AppError::InvalidPayload("备份数据库结构无法验证。".to_string()))?;

    if table_count < 5 {
        return Err(AppError::InvalidPayload(
            "备份数据库结构不完整，已取消恢复。".to_string(),
        ));
    }

    Ok(())
}

fn restore_backup_files(
    backup_dir: &Path,
    data_dir: &Path,
    file_names: &[String],
) -> Result<(), AppError> {
    let rollback_dir = data_dir.join(format!("restore-rollback-{}", current_unix_seconds()));
    fs::create_dir_all(&rollback_dir).map_err(|error| AppError::Storage(error.to_string()))?;

    let current_files = existing_database_file_manifest(data_dir)?;
    copy_named_files(data_dir, &rollback_dir, &current_files)?;

    let restore_result = (|| {
        for file_name in current_files
            .iter()
            .filter(|name| !file_names.contains(name))
        {
            let path = data_dir.join(file_name);
            if path.exists() {
                fs::remove_file(&path).map_err(|error| AppError::Storage(error.to_string()))?;
            }
        }

        copy_named_files(backup_dir, data_dir, file_names)?;
        rebuild_restored_retrieval_fts(&data_dir.join(DATABASE_FILE_NAME))
    })();

    if let Err(error) = restore_result {
        let _ = copy_named_files(&rollback_dir, data_dir, &current_files);
        return Err(error);
    }

    let _ = fs::remove_dir_all(&rollback_dir);
    Ok(())
}

fn table_count(
    connection: &rusqlite::Connection,
    table: &str,
) -> Result<TableCountRecord, AppError> {
    let row_count = connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(AppError::from)?
        .max(0) as u64;

    Ok(TableCountRecord {
        table: table.to_string(),
        row_count,
    })
}

fn serialize_diagnostics_markdown(state: &SettingsStateResponse, exported_at: &str) -> String {
    let mut markdown = String::new();

    let _ = writeln!(markdown, "# wxreadmaster 诊断信息");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 导出时间：{}",
        sanitize_diagnostic_text(exported_at)
    );
    let _ = writeln!(
        markdown,
        "- 应用版本：{}",
        sanitize_diagnostic_text(&state.app_version)
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "说明：只包含本地状态摘要，不包含 API Key 明文。");
    let _ = writeln!(markdown);

    let _ = writeln!(markdown, "## 凭据状态");
    let _ = writeln!(
        markdown,
        "- 微信读书凭据：{}",
        if state.credential.has_credential {
            "已保存"
        } else {
            "未保存"
        }
    );
    let _ = writeln!(
        markdown,
        "- 最近验证时间：{}",
        optional_diagnostic_text(state.credential.last_validated_at.as_deref())
    );
    let _ = writeln!(
        markdown,
        "- 最近验证错误：{}",
        optional_diagnostic_text(state.credential.last_validation_error.as_deref())
    );
    let _ = writeln!(markdown);

    let _ = writeln!(markdown, "## 网络设置");
    let _ = writeln!(
        markdown,
        "- 微信读书代理：{}",
        if state.network.is_custom_weread_proxy {
            "已启用"
        } else {
            "默认网络"
        }
    );
    let _ = writeln!(
        markdown,
        "- 代理地址：{}",
        optional_diagnostic_text(state.network.weread_proxy_url.as_deref())
    );
    let _ = writeln!(markdown);

    let _ = writeln!(markdown, "## 本地数据");
    let _ = writeln!(
        markdown,
        "- 数据目录：{}",
        sanitize_diagnostic_text(&state.local_data.data_dir)
    );
    let _ = writeln!(
        markdown,
        "- 数据库文件：{}",
        sanitize_diagnostic_text(&state.local_data.database_path)
    );
    let _ = writeln!(
        markdown,
        "- 数据库大小：{} bytes",
        state.local_data.database_size_bytes
    );
    let _ = writeln!(
        markdown,
        "- 可清理缓存记录数：{}",
        state.local_data.cache_row_count
    );
    let _ = writeln!(
        markdown,
        "- 最近迁移/恢复错误：{}",
        optional_diagnostic_text(state.local_data.last_data_operation_error.as_deref())
    );
    let _ = writeln!(markdown);

    let _ = writeln!(markdown, "## 同步状态");
    if state.sync_states.is_empty() {
        let _ = writeln!(markdown, "- 暂无同步记录");
    } else {
        for sync_state in &state.sync_states {
            let _ = writeln!(
                markdown,
                "- {}：{}",
                sanitize_diagnostic_text(&sync_state.section),
                sanitize_diagnostic_text(&sync_state.status)
            );
            let _ = writeln!(
                markdown,
                "  - 最近成功：{}",
                optional_diagnostic_text(sync_state.last_success_at.as_deref())
            );
            let _ = writeln!(
                markdown,
                "  - 最近尝试：{}",
                optional_diagnostic_text(sync_state.last_attempt_at.as_deref())
            );
            let _ = writeln!(
                markdown,
                "  - 最近错误：{}",
                optional_diagnostic_text(sync_state.error_message.as_deref())
            );
        }
    }
    let _ = writeln!(markdown);

    let _ = writeln!(markdown, "## 表记录数");
    if state.local_data.table_counts.is_empty() {
        let _ = writeln!(markdown, "- 暂无表记录");
    } else {
        for record in &state.local_data.table_counts {
            let _ = writeln!(
                markdown,
                "- {}：{}",
                sanitize_diagnostic_text(&record.table),
                record.row_count
            );
        }
    }

    markdown
}

fn optional_diagnostic_text(value: Option<&str>) -> String {
    value
        .filter(|text| !text.trim().is_empty())
        .map(sanitize_diagnostic_text)
        .unwrap_or_else(|| "无".to_string())
}

fn sanitize_diagnostic_text(value: &str) -> String {
    mask_api_key_fragments(value)
        .replace("apiKey", "credential")
        .replace("APIKEY", "credential")
}

fn read_data_operation_state(data_dir: &Path) -> DataOperationState {
    let path = data_dir.join(DATA_OPERATION_STATE_FILE_NAME);
    let Ok(content) = fs::read_to_string(path) else {
        return DataOperationState::default();
    };

    serde_json::from_str::<DataOperationState>(&content).unwrap_or_default()
}

fn write_data_operation_state(data_dir: &Path, state: &DataOperationState) -> Result<(), AppError> {
    fs::create_dir_all(data_dir).map_err(|error| AppError::Storage(error.to_string()))?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|error| AppError::Storage(error.to_string()))?;
    fs::write(data_dir.join(DATA_OPERATION_STATE_FILE_NAME), content)
        .map_err(|error| AppError::Storage(error.to_string()))
}

fn mask_api_key_fragments(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(index) = rest.find("sk-") {
        sanitized.push_str(&rest[..index]);
        sanitized.push_str("[已隐藏凭据]");

        let secret_and_tail = &rest[index..];
        let tail_index = secret_and_tail
            .char_indices()
            .find_map(|(position, character)| {
                (position > 0 && is_secret_delimiter(character)).then_some(position)
            })
            .unwrap_or(secret_and_tail.len());
        rest = &secret_and_tail[tail_index..];
    }

    sanitized.push_str(rest);
    sanitized
}

fn is_secret_delimiter(character: char) -> bool {
    character.is_whitespace() || matches!(character, '"' | '\'' | '`' | ',' | ';' | ')' | ']' | '}')
}

fn current_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs, path::Path};

    use rusqlite::Connection;
    use serde_json::json;

    use crate::{
        db::{self, initialize_schema},
        export::ima_client::{ImaCompatibilityStatus, IMA_ADAPTER_VERSION},
        repositories::sync_state::SyncStateRecord,
        services::ima_credentials::ImaCredentialStatus,
    };

    use super::{
        build_export_data_state, classify_notion_analysis_error, clear_ai_output_cache,
        clear_cache_tables, create_database_backup, current_unix_seconds, decode_png_base64,
        local_backup_file_manifest, local_data_migration_file_manifest, next_available_export_path,
        read_backup_manifest, read_data_operation_state, restore_backup_files,
        sanitize_diagnostic_text, sanitize_png_file_name, select_custom_data_directory,
        serialize_diagnostics_markdown, table_count, validate_backup_database,
        validate_backup_manifest, validate_custom_data_directory, write_data_operation_state,
        DataOperationState, ExportDataState, ImaIntegrationState, IntegrationDataState,
        LocalDataState, NetworkState, NotionCoverMode, NotionCredentialStatus,
        NotionIntegrationState, ObsidianAttachmentMode, ObsidianIntegrationState,
        SettingsStateResponse, TableCountRecord,
    };

    #[test]
    fn notion_analysis_network_failures_use_network_error_contract() {
        let error = classify_notion_analysis_error(
            "无法连接 Notion API（无法建立网络连接）。请检查网络、系统代理或 VPN 后重试。",
        );
        assert_eq!(error.code(), "gateway_network_error");
        assert_eq!(
            error.user_message(),
            "无法连接 Notion API，请检查网络、系统代理或 VPN 后重试。"
        );

        let api_error = classify_notion_analysis_error("Notion Token 无效或已失效");
        assert_eq!(api_error.code(), "gateway_error");
        assert!(api_error.user_message().contains("Notion Token 无效"));

        let business_error = classify_notion_analysis_error(
            "Notion API 请求失败：database connection property is invalid",
        );
        assert_eq!(business_error.code(), "gateway_error");
    }

    #[test]
    fn decode_png_base64_accepts_png_data_url_only() {
        let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

        let bytes = decode_png_base64(png).expect("png data url should decode");

        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(decode_png_base64("data:text/plain;base64,SGVsbG8=").is_err());
        assert!(decode_png_base64("SGVsbG8=").is_err());
    }

    #[test]
    fn sanitize_png_file_name_blocks_path_traversal_and_reserved_names() {
        assert_eq!(
            sanitize_png_file_name("../2026:05*阅读报告"),
            "2026_05_阅读报告.png"
        );
        assert_eq!(sanitize_png_file_name("CON.png"), "wxreadmaster-CON.png");
        assert_eq!(sanitize_png_file_name("report.PnG"), "report.png");
        assert_eq!(sanitize_png_file_name(""), "reading-report.png");
    }

    #[test]
    fn next_available_export_path_preserves_existing_files() {
        let dir = std::env::temp_dir().join(format!(
            "wxreadmaster-export-test-{}",
            current_unix_seconds()
        ));
        fs::create_dir_all(&dir).expect("test export dir should be created");
        fs::write(dir.join("report.png"), b"old").expect("existing report should be created");

        let path = next_available_export_path(&dir, "report.png");

        assert_eq!(
            path.file_name().and_then(|value| value.to_str()),
            Some("report (1).png")
        );
        fs::remove_dir_all(dir).expect("test export dir should be removed");
    }

    #[test]
    fn table_count_reads_known_cache_table() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let count = table_count(&connection, "raw_cache").expect("count should read");

        assert_eq!(count.table, "raw_cache");
        assert_eq!(count.row_count, 0);
    }

    #[test]
    fn clear_cache_tables_removes_cached_rows_and_sync_state() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO shelf_entries (
                    id, type, title, is_top, is_secret, raw_json, updated_at
                ) VALUES ('b1', 'book', '书名', 0, 0, '{}', '100')
                ",
                [],
            )
            .expect("shelf row should insert");
        connection
            .execute(
                "
                INSERT INTO raw_cache (namespace, cache_key, raw_json, updated_at)
                VALUES ('shelf', 'latest', ?1, '100')
                ",
                [json!({ "books": [] }).to_string()],
            )
            .expect("raw cache should insert");
        connection
            .execute(
                "
                INSERT INTO sync_state (section, status, last_success_at)
                VALUES ('shelf', 'success', '100')
                ",
                [],
            )
            .expect("sync state should insert");

        let deleted = clear_cache_tables(&connection).expect("cache should clear");

        assert_eq!(deleted, 3);
        assert_eq!(
            table_count(&connection, "shelf_entries")
                .expect("shelf count")
                .row_count,
            0
        );
        assert_eq!(
            table_count(&connection, "raw_cache")
                .expect("raw cache count")
                .row_count,
            0
        );
        assert_eq!(
            table_count(&connection, "sync_state")
                .expect("sync state count")
                .row_count,
            0
        );
    }

    #[test]
    fn clear_cache_tables_removes_rebuildable_retrieval_data() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "INSERT INTO retrieval_documents (
                    id, source_type, source_id, book_id, content, normalized_content,
                    metadata_json, content_hash, source_updated_at, indexed_at
                 ) VALUES ('note:highlight:h1', 'highlight', 'h1', 'book-1',
                    '正文', '正文', '{}', 'sha256-v1:h1', '100', '100')",
                [],
            )
            .expect("retrieval document should insert");
        connection
            .execute(
                "INSERT INTO retrieval_documents_fts (
                    document_id, title_tokens, chapter_tokens, content_tokens
                 ) VALUES ('note:highlight:h1', '', '', '正文')",
                [],
            )
            .expect("retrieval fts row should insert");
        connection
            .execute(
                "INSERT INTO retrieval_index_profiles (
                    id, provider_kind, model_id, dimensions, distance_metric,
                    normalization_version, chunking_version, content_hash_version,
                    status, total_document_count, indexed_document_count,
                    created_at, updated_at, completed_at
                 ) VALUES ('profile-1', 'deterministic-test', 'fixture-v1', 2, 'cosine',
                    'retrieval-text-v1', 'document-v1', 'sha256-v1',
                    'ready', 1, 1, '100', '100', '100')",
                [],
            )
            .expect("retrieval profile should insert");
        connection
            .execute(
                "INSERT INTO retrieval_embeddings (
                    profile_id, document_id, content_hash, dimensions, vector_blob,
                    created_at, updated_at
                 ) VALUES ('profile-1', 'note:highlight:h1', 'sha256-v1:h1', 2,
                    X'0000803F00000000', '100', '100')",
                [],
            )
            .expect("retrieval embedding should insert");

        let deleted = clear_cache_tables(&connection).expect("cache should clear");
        assert_eq!(deleted, 4);
        for table in [
            "retrieval_documents",
            "retrieval_documents_fts",
            "retrieval_index_profiles",
            "retrieval_embeddings",
        ] {
            assert_eq!(
                table_count(&connection, table)
                    .expect("retrieval table count should read")
                    .row_count,
                0
            );
        }
    }

    #[test]
    fn clear_cache_tables_removes_ai_outputs() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO ai_outputs (
                    feature,
                    scope_id,
                    prompt_version,
                    input_hash,
                    output_json,
                    source_count,
                    provider_model,
                    created_at,
                    updated_at
                ) VALUES (
                    'book-notes-summary',
                    'book-1',
                    'book-notes-summary-v3',
                    'hash-1',
                    ?1,
                    2,
                    'test-model',
                    '100',
                    '100'
                )
                ",
                [json!({ "overview": "缓存复盘" }).to_string()],
            )
            .expect("ai output should insert");

        let deleted = clear_cache_tables(&connection).expect("cache should clear");

        assert_eq!(deleted, 1);
        assert_eq!(
            table_count(&connection, "ai_outputs")
                .expect("ai output count")
                .row_count,
            0
        );
    }

    #[test]
    fn clear_ai_output_cache_removes_outputs_and_note_synthesis_jobs_only() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO ai_outputs (
                    feature,
                    scope_id,
                    prompt_version,
                    input_hash,
                    output_json,
                    source_count,
                    provider_model,
                    created_at,
                    updated_at
                ) VALUES (
                    'book-notes-summary',
                    'book-1',
                    'book-notes-summary-v3',
                    'hash-1',
                    ?1,
                    2,
                    'test-model',
                    '100',
                    '100'
                )
                ",
                [json!({ "overview": "缓存复盘" }).to_string()],
            )
            .expect("ai output should insert");
        connection
            .execute(
                "
                INSERT INTO note_synthesis_jobs (
                    id, book_id, status, source_snapshot_hash, total_count, processed_count,
                    batch_count, completed_batch_count, failed_batch_count,
                    batch_prompt_version, merge_prompt_version, batching_version,
                    provider_base_url_hash, provider_model, consent_confirmed_at,
                    consent_provider_label, created_at, updated_at
                ) VALUES (
                    'job-1', 'book-1', 'partial', 'snapshot', 1, 0, 1, 0, 1,
                    'batch-v1', 'merge-v1', 'batching-v1', 'provider-hash', 'test-model',
                    '100', 'Test Provider', '100', '100'
                )
                ",
                [],
            )
            .expect("note synthesis job should insert");
        connection
            .execute(
                "
                INSERT INTO note_synthesis_job_items (
                    job_id, document_id, source_type, content_hash, content_snapshot,
                    source_updated_at, batch_index, audit_status
                ) VALUES (
                    'job-1', 'note:highlight:h1', 'highlight', 'content-hash',
                    '不会出现在诊断中的原始笔记', '100', 0, 'pending'
                )
                ",
                [],
            )
            .expect("note synthesis item should insert");
        connection
            .execute(
                "
                INSERT INTO note_synthesis_batches (
                    job_id, batch_index, status, source_types_json, source_count,
                    input_hash, error_code, error_message, updated_at
                ) VALUES (
                    'job-1', 0, 'failed', '[\"highlight\"]', 1,
                    'batch-hash', 'PROVIDER_ERROR', '批次失败', '100'
                )
                ",
                [],
            )
            .expect("note synthesis batch should insert");
        connection
            .execute(
                "
                INSERT INTO shelf_entries (
                    id, type, title, is_top, is_secret, raw_json, updated_at
                ) VALUES ('b1', 'book', '书名', 0, 0, '{}', '100')
                ",
                [],
            )
            .expect("shelf row should insert");
        connection
            .execute(
                "
                INSERT INTO reading_item_states (
                    item_id, item_type, status, title, created_at, updated_at
                ) VALUES ('book-1', 'book', 'reviewing', '书名', '100', '100')
                ",
                [],
            )
            .expect("reading state should insert");

        let deleted = clear_ai_output_cache(&connection).expect("ai output cache should clear");

        assert_eq!(deleted, 4);
        for table in [
            "ai_outputs",
            "note_synthesis_jobs",
            "note_synthesis_job_items",
            "note_synthesis_batches",
        ] {
            assert_eq!(
                table_count(&connection, table)
                    .expect("AI cache table count")
                    .row_count,
                0,
                "{table} should be cleared"
            );
        }
        assert_eq!(
            table_count(&connection, "shelf_entries")
                .expect("shelf count")
                .row_count,
            1
        );
        assert_eq!(
            table_count(&connection, "reading_item_states")
                .expect("reading state count")
                .row_count,
            1
        );
    }

    #[test]
    fn diagnostics_markdown_contains_local_state_without_credentials() {
        let state = SettingsStateResponse {
            credential: crate::services::credentials::CredentialStatus {
                has_credential: true,
                last_validated_at: Some("100".to_string()),
                last_validation_error: None,
            },
            credential_error: None,
            sync_states: vec![SyncStateRecord {
                section: "shelf".to_string(),
                status: "success".to_string(),
                last_success_at: Some("100".to_string()),
                last_attempt_at: Some("100".to_string()),
                error_code: None,
                error_message: Some("apiKey=sk-e2e-secret 请求失败".to_string()),
            }],
            local_data: LocalDataState {
                data_dir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster".to_string(),
                default_data_dir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster".to_string(),
                database_path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/app.db".to_string(),
                database_size_bytes: 48_128,
                cache_row_count: 2,
                is_custom_data_dir: false,
                last_data_operation_error: Some(
                    "迁移失败：目标目录不可写，apiKey=sk-e2e-secret".to_string(),
                ),
                table_counts: vec![TableCountRecord {
                    table: "shelf_entries".to_string(),
                    row_count: 2,
                }],
            },
            export_data: ExportDataState {
                export_dir: "C:/Users/RHZ/Exports".to_string(),
                default_export_dir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports".to_string(),
                is_custom_export_dir: true,
            },
            integration_data: IntegrationDataState {
                obsidian: ObsidianIntegrationState {
                    vault_dir: None,
                    has_configured_vault: false,
                    attachment_mode: ObsidianAttachmentMode::SiblingAssets,
                    open_after_export: false,
                },
                notion: NotionIntegrationState {
                    credential: NotionCredentialStatus {
                        has_credential: false,
                        last_validated_at: None,
                        last_validation_error: None,
                    },
                    parent_id: None,
                    parent_type: None,
                    cover_mode: NotionCoverMode::PageCover,
                    database_connection: None,
                },
                ima: ImaIntegrationState {
                    credential: ImaCredentialStatus::default(),
                    note_folder_id: None,
                    knowledge_base_id: None,
                    knowledge_base_folder_id: None,
                    publish_to_knowledge_base: true,
                    asset_routes: BTreeMap::new(),
                    adapter_version: IMA_ADAPTER_VERSION.to_string(),
                    checked_adapter_version: None,
                    latest_version: None,
                    release_desc: None,
                    update_instruction: None,
                    update_checked_date: None,
                    last_attempt_at: None,
                    last_success_at: None,
                    compatibility_status: ImaCompatibilityStatus::Unconfirmed,
                    can_attempt_write: false,
                    is_write_compatible: false,
                },
            },
            network: NetworkState {
                weread_proxy_url: Some("http://127.0.0.1:7890".to_string()),
                is_custom_weread_proxy: true,
            },
            app_version: "0.1.0".to_string(),
            supports_native_updater: true,
        };

        let markdown = serialize_diagnostics_markdown(&state, "130");

        assert!(markdown.contains("# wxreadmaster 诊断信息"));
        assert!(markdown.contains("- 应用版本：0.1.0"));
        assert!(markdown.contains("app.db"));
        assert!(markdown.contains("最近迁移/恢复错误"));
        assert!(markdown.contains("目标目录不可写"));
        assert!(markdown.contains("微信读书代理：已启用"));
        assert!(markdown.contains("http://127.0.0.1:7890"));
        assert!(markdown.contains("- shelf_entries：2"));
        assert!(markdown.contains("- shelf：success"));
        assert!(markdown.contains("只包含本地状态摘要，不包含 API Key 明文"));
        assert!(!markdown.contains("sk-"));
        assert!(!markdown.contains("apiKey"));
    }

    #[test]
    fn backup_manifest_includes_database_files_but_excludes_secrets() {
        let files = local_backup_file_manifest(&[
            "reading-cache.sqlite3",
            "reading-cache.sqlite3-wal",
            "reading-cache.sqlite3-shm",
            "ai-credentials.hold",
            "stronghold-ai-salt.txt",
            "weread-credentials.hold",
            "audit.log",
        ]);

        assert_eq!(
            files,
            vec![
                "reading-cache.sqlite3".to_string(),
                "reading-cache.sqlite3-wal".to_string(),
                "reading-cache.sqlite3-shm".to_string()
            ]
        );
    }

    #[test]
    fn database_backup_round_trip_restores_original_database() {
        let temp_root = std::env::temp_dir().join(format!(
            "wxreadmaster-backup-round-trip-test-{}",
            current_unix_seconds()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        let data_dir = temp_root.join("data");
        let backup_dir = temp_root.join("backup");
        fs::create_dir_all(&data_dir).expect("data dir should create");

        let database_path = data_dir.join(db::DATABASE_FILE_NAME);
        let connection = Connection::open(&database_path).expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "INSERT INTO reading_item_states (
                    item_id, item_type, status, title, created_at, updated_at
                 ) VALUES ('book-1', 'book', 'reviewing', '原始书名', '100', '100')",
                [],
            )
            .expect("reading item should insert");
        connection
            .execute(
                "INSERT INTO note_synthesis_jobs (
                    id, book_id, status, source_snapshot_hash, total_count, processed_count,
                    batch_count, completed_batch_count, failed_batch_count,
                    batch_prompt_version, merge_prompt_version, batching_version,
                    provider_base_url_hash, provider_model, consent_confirmed_at,
                    consent_provider_label, created_at, updated_at
                 ) VALUES (
                    'job-1', 'book-1', 'partial', 'snapshot', 1, 0, 1, 0, 1,
                    'batch-v1', 'merge-v1', 'batching-v1', 'provider-hash', 'model',
                    '100', 'Provider', '100', '100'
                 )",
                [],
            )
            .expect("note synthesis job should insert");
        connection
            .execute(
                "INSERT INTO note_synthesis_job_items (
                    job_id, document_id, source_type, content_hash, content_snapshot,
                    source_updated_at, batch_index, audit_status
                 ) VALUES (
                    'job-1', 'note:highlight:h1', 'highlight', 'hash',
                    '不可变快照正文', '100', 0, 'pending'
                 )",
                [],
            )
            .expect("note synthesis snapshot should insert");
        connection
            .execute(
                "INSERT INTO note_synthesis_batches (
                    job_id, batch_index, status, source_types_json, source_count,
                    input_hash, output_json, updated_at
                 ) VALUES (
                    'job-1', 0, 'completed', '[\"highlight\"]', 1,
                    'batch-hash', '{\"themes\":[]}', '100'
                 )",
                [],
            )
            .expect("note synthesis batch should insert");
        connection
            .execute(
                "INSERT INTO retrieval_documents (
                    id, source_type, source_id, book_id, content, normalized_content,
                    metadata_json, content_hash, source_updated_at, indexed_at
                 ) VALUES ('note:highlight:h1', 'highlight', 'h1', 'book-1',
                    '深度工作需要专注', '深度工作需要专注', '{}',
                    'sha256-v1:h1', '100', '100')",
                [],
            )
            .expect("retrieval document should insert");
        connection
            .execute(
                "INSERT INTO retrieval_documents_fts (
                    document_id, title_tokens, chapter_tokens, content_tokens
                 ) VALUES ('note:highlight:h1', '', '', '深度 工作 需要 专注')",
                [],
            )
            .expect("retrieval fts row should insert");
        connection
            .execute(
                "INSERT INTO retrieval_index_profiles (
                    id, provider_kind, model_id, dimensions, distance_metric,
                    normalization_version, chunking_version, content_hash_version,
                    status, total_document_count, indexed_document_count,
                    created_at, updated_at, completed_at
                 ) VALUES ('profile-1', 'deterministic-test', 'fixture-v1', 2, 'cosine',
                    'retrieval-text-v1', 'document-v1', 'sha256-v1',
                    'ready', 1, 1, '100', '100', '100')",
                [],
            )
            .expect("retrieval profile should insert");
        connection
            .execute(
                "INSERT INTO retrieval_embeddings (
                    profile_id, document_id, content_hash, dimensions, vector_blob,
                    created_at, updated_at
                 ) VALUES ('profile-1', 'note:highlight:h1', 'sha256-v1:h1', 2,
                    X'0000803F00000000', '100', '100')",
                [],
            )
            .expect("retrieval embedding should insert");
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("database should checkpoint");
        drop(connection);

        let files = create_database_backup(&data_dir, &backup_dir, "100")
            .expect("backup should be created and validated");
        assert!(files.iter().any(|file| file == db::DATABASE_FILE_NAME));
        let manifest = read_backup_manifest(&backup_dir).expect("manifest should read");
        validate_backup_manifest(&manifest.files).expect("manifest should validate");
        let backup_database_path = backup_dir.join(db::DATABASE_FILE_NAME);
        validate_backup_database(&backup_database_path).expect("backup database should validate");
        let backup = Connection::open(&backup_database_path).expect("backup database should open");
        let backup_counts = (
            table_count(&backup, "retrieval_documents")
                .expect("backup retrieval documents count")
                .row_count,
            table_count(&backup, "retrieval_index_profiles")
                .expect("backup profiles count")
                .row_count,
            table_count(&backup, "retrieval_embeddings")
                .expect("backup embeddings count")
                .row_count,
            table_count(&backup, "retrieval_documents_fts")
                .expect("backup fts count")
                .row_count,
        );
        assert_eq!(backup_counts, (1, 0, 0, 0));
        drop(backup);

        let connection = Connection::open(&database_path).expect("database should reopen");
        connection
            .execute(
                "UPDATE reading_item_states SET title = '已修改书名' WHERE item_id = 'book-1'",
                [],
            )
            .expect("reading item should change");
        drop(connection);

        restore_backup_files(&backup_dir, &data_dir, &manifest.files)
            .expect("backup should restore");
        let restored = Connection::open(&database_path).expect("restored database should open");
        let title: String = restored
            .query_row(
                "SELECT title FROM reading_item_states WHERE item_id = 'book-1'",
                [],
                |row| row.get(0),
            )
            .expect("restored row should read");
        assert_eq!(title, "原始书名");
        let restored_snapshot: String = restored
            .query_row(
                "SELECT content_snapshot FROM note_synthesis_job_items
                 WHERE job_id = 'job-1' AND document_id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("restored note synthesis snapshot should read");
        let restored_batch_status: String = restored
            .query_row(
                "SELECT status FROM note_synthesis_batches
                 WHERE job_id = 'job-1' AND batch_index = 0",
                [],
                |row| row.get(0),
            )
            .expect("restored note synthesis batch should read");
        assert_eq!(restored_snapshot, "不可变快照正文");
        assert_eq!(restored_batch_status, "completed");
        let restored_retrieval_counts = (
            table_count(&restored, "retrieval_documents")
                .expect("restored retrieval documents count")
                .row_count,
            table_count(&restored, "retrieval_index_profiles")
                .expect("restored profiles count")
                .row_count,
            table_count(&restored, "retrieval_embeddings")
                .expect("restored embeddings count")
                .row_count,
            table_count(&restored, "retrieval_documents_fts")
                .expect("restored fts count")
                .row_count,
        );
        assert_eq!(restored_retrieval_counts, (1, 0, 0, 1));
        let lexical_count: i64 = restored
            .query_row(
                "SELECT COUNT(*) FROM retrieval_documents_fts
                 WHERE retrieval_documents_fts MATCH '深度'",
                [],
                |row| row.get(0),
            )
            .expect("restored fts should be queryable");
        assert_eq!(lexical_count, 1);
        drop(restored);

        fs::remove_dir_all(temp_root).expect("temporary backup fixture should be removed");
    }

    #[test]
    fn backup_restore_validation_rejects_missing_database() {
        let error = validate_backup_manifest(&["manifest.json".to_string()])
            .expect_err("backup without database should be rejected");

        assert_eq!(error.user_message(), "备份包缺少本地数据库文件。");
    }

    #[test]
    fn backup_restore_validation_rejects_unsupported_files() {
        let error = validate_backup_manifest(&[
            "reading-cache.sqlite3".to_string(),
            "ai-credentials.hold".to_string(),
        ])
        .expect_err("backup with credential file should be rejected");

        assert_eq!(error.user_message(), "备份包包含不受支持的文件。");
    }

    #[test]
    fn custom_data_directory_validation_rejects_database_file_path() {
        let error = validate_custom_data_directory(Path::new("D:/data/reading-cache.sqlite3"))
            .expect_err("database file path should be rejected");

        assert_eq!(error.user_message(), "请选择一个文件夹作为数据目录。");
    }

    #[test]
    fn custom_data_directory_selection_uses_picker_when_input_is_empty() {
        let picked_dir = std::env::temp_dir().join(format!(
            "wxreadmaster-picked-data-dir-{}",
            current_unix_seconds()
        ));
        let _ = std::fs::remove_dir_all(&picked_dir);
        let selected = select_custom_data_directory(None, || Some(picked_dir.clone()))
            .expect("picked directory should be accepted")
            .expect("picker result should be returned");

        assert_eq!(selected, picked_dir);

        let _ = std::fs::remove_dir_all(&picked_dir);
    }

    #[test]
    fn custom_data_directory_selection_allows_picker_cancel() {
        let selected =
            select_custom_data_directory(None, || None).expect("cancelled picker should not fail");

        assert!(selected.is_none());
    }

    #[test]
    fn data_operation_state_round_trips_and_diagnostics_masks_secrets() {
        let temp_root = std::env::temp_dir().join(format!(
            "wxreadmaster-data-operation-state-test-{}",
            current_unix_seconds()
        ));
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        let state = DataOperationState {
            last_error: Some("迁移失败：apiKey=sk-e2e-secret 目标目录不可写".to_string()),
            last_error_at: Some("100".to_string()),
        };

        write_data_operation_state(&temp_root, &state).expect("state should write");
        let loaded = read_data_operation_state(&temp_root);
        let sanitized = sanitize_diagnostic_text(loaded.last_error.as_deref().unwrap_or_default());

        assert!(sanitized.contains("目标目录不可写"));
        assert!(!sanitized.contains("sk-"));
        assert!(!sanitized.contains("apiKey"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn export_location_state_marks_default_and_custom_paths() {
        let default_data_dir = Path::new("C:/Users/RHZ/AppData/Roaming/wxreadmaster");
        let default_export_dir = default_data_dir.join("exports");
        let custom_export_dir = Path::new("D:/ReadingExports");

        let default_state = build_export_data_state(default_data_dir, None);
        let custom_state = build_export_data_state(default_data_dir, Some(custom_export_dir));

        assert_eq!(
            default_state.export_dir,
            default_export_dir.display().to_string()
        );
        assert_eq!(
            default_state.default_export_dir,
            default_export_dir.display().to_string()
        );
        assert!(!default_state.is_custom_export_dir);
        assert_eq!(
            custom_state.export_dir,
            custom_export_dir.display().to_string()
        );
        assert!(custom_state.is_custom_export_dir);
    }

    #[test]
    fn migration_manifest_includes_only_sqlite_database_files() {
        let files = local_data_migration_file_manifest(&[
            "reading-cache.sqlite3",
            "reading-cache.sqlite3-wal",
            "reading-cache.sqlite3-shm",
            "stronghold-salt.txt",
            "weread-credentials.hold",
            "audit.log",
        ]);

        assert_eq!(
            files,
            vec![
                "reading-cache.sqlite3".to_string(),
                "reading-cache.sqlite3-wal".to_string(),
                "reading-cache.sqlite3-shm".to_string()
            ]
        );
    }

    #[test]
    fn custom_data_directory_config_round_trips() {
        let temp_root = std::env::temp_dir().join(format!(
            "wxreadmaster-settings-test-{}",
            current_unix_seconds()
        ));
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        let custom_dir = temp_root.join("custom-data");
        std::fs::create_dir_all(&custom_dir).expect("custom dir should be created");

        db::write_custom_data_directory_config(&temp_root, Some(&custom_dir))
            .expect("custom directory should be persisted");
        let loaded = db::read_custom_data_directory_config(&temp_root)
            .expect("custom directory should load")
            .expect("custom directory should be configured");

        assert_eq!(loaded, custom_dir);

        db::write_custom_data_directory_config(&temp_root, None)
            .expect("custom directory config should be cleared");
        assert!(db::read_custom_data_directory_config(&temp_root)
            .expect("custom directory config should load")
            .is_none());

        let _ = std::fs::remove_dir_all(&temp_root);
    }
}
