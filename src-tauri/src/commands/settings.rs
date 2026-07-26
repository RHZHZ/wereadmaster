use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    export::targets::NotionParentType,
    services::settings::{
        ChooseDataDirectoryResponse, ChooseExportDirectoryResponse,
        ChooseObsidianVaultDirectoryResponse, ClearAiOutputCacheResponse, ClearLocalCacheResponse,
        CreateNotionReadingLibraryTemplateResponse, CreateNotionReadingWorkspaceTemplateResponse,
        ExportBackupResponse, ExportDiagnosticsResponse, ExportImageResponse,
        MigrateDataDirectoryResponse, NotionCoverMode, ObsidianAttachmentMode,
        RemoteAppUpdateManifestResponse, ResetExportDirectoryResponse, ResetWereadProxyResponse,
        RestoreBackupResponse, SaveExportDirectoryResponse, SaveWereadProxyResponse,
        SettingsService, SettingsStateResponse,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCommandError {
    code: String,
    message: String,
    detail: Option<String>,
}

impl From<AppError> for AppCommandError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
            detail: error.diagnostic_message(),
        }
    }
}

#[tauri::command]
pub async fn get_settings_state(app: AppHandle) -> Result<SettingsStateResponse, AppCommandError> {
    run_blocking(move || SettingsService::new(app).settings_state()).await
}

#[tauri::command]
pub async fn get_remote_app_update_manifest(
) -> Result<RemoteAppUpdateManifestResponse, AppCommandError> {
    SettingsService::remote_app_update_manifest()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn clear_local_cache(
    app: AppHandle,
    confirm: bool,
) -> Result<ClearLocalCacheResponse, AppCommandError> {
    SettingsService::new(app)
        .clear_local_cache(confirm)
        .map_err(Into::into)
}

#[tauri::command]
pub fn clear_ai_output_cache(
    app: AppHandle,
    confirm: bool,
) -> Result<ClearAiOutputCacheResponse, AppCommandError> {
    SettingsService::new(app)
        .clear_ai_output_cache(confirm)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_diagnostics(app: AppHandle) -> Result<ExportDiagnosticsResponse, AppCommandError> {
    SettingsService::new(app)
        .export_diagnostics()
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_report_image(
    app: AppHandle,
    file_name: String,
    png_base64: String,
) -> Result<ExportImageResponse, AppCommandError> {
    SettingsService::new(app)
        .export_report_image(file_name, png_base64)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_local_data_backup(app: AppHandle) -> Result<ExportBackupResponse, AppCommandError> {
    SettingsService::new(app)
        .export_local_data_backup()
        .map_err(Into::into)
}

#[tauri::command]
pub fn restore_local_data_backup(
    app: AppHandle,
    backup_path: String,
    confirm: bool,
) -> Result<RestoreBackupResponse, AppCommandError> {
    SettingsService::new(app)
        .restore_local_data_backup(backup_path, confirm)
        .map_err(Into::into)
}

#[tauri::command]
pub fn choose_custom_data_directory(
    app: AppHandle,
    target_dir: Option<String>,
) -> Result<ChooseDataDirectoryResponse, AppCommandError> {
    SettingsService::new(app)
        .choose_custom_data_directory(target_dir)
        .map_err(Into::into)
}

#[tauri::command]
pub fn migrate_local_data_directory(
    app: AppHandle,
    target_dir: String,
    confirm: bool,
) -> Result<MigrateDataDirectoryResponse, AppCommandError> {
    SettingsService::new(app)
        .migrate_local_data_directory(target_dir, confirm)
        .map_err(Into::into)
}

#[tauri::command]
pub fn choose_custom_export_directory(
    app: AppHandle,
) -> Result<ChooseExportDirectoryResponse, AppCommandError> {
    SettingsService::new(app)
        .choose_custom_export_directory()
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_custom_export_directory(
    app: AppHandle,
    target_dir: String,
) -> Result<SaveExportDirectoryResponse, AppCommandError> {
    run_blocking(move || SettingsService::new(app).save_custom_export_directory(target_dir)).await
}

#[tauri::command]
pub async fn reset_custom_export_directory(
    app: AppHandle,
) -> Result<ResetExportDirectoryResponse, AppCommandError> {
    run_blocking(move || SettingsService::new(app).reset_custom_export_directory()).await
}

#[tauri::command]
pub async fn save_weread_proxy_url(
    app: AppHandle,
    proxy_url: String,
) -> Result<SaveWereadProxyResponse, AppCommandError> {
    run_blocking(move || SettingsService::new(app).save_weread_proxy_url(proxy_url)).await
}

#[tauri::command]
pub async fn reset_weread_proxy_url(
    app: AppHandle,
) -> Result<ResetWereadProxyResponse, AppCommandError> {
    run_blocking(move || SettingsService::new(app).reset_weread_proxy_url()).await
}

#[tauri::command]
pub fn choose_obsidian_vault_directory(
    app: AppHandle,
) -> Result<ChooseObsidianVaultDirectoryResponse, AppCommandError> {
    SettingsService::new(app)
        .choose_obsidian_vault_directory()
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_obsidian_export_settings(
    app: AppHandle,
    vault_dir: String,
    attachment_mode: ObsidianAttachmentMode,
    open_after_export: bool,
) -> Result<SettingsStateResponse, AppCommandError> {
    run_blocking(move || {
        SettingsService::new(app).save_obsidian_export_settings(
            vault_dir,
            attachment_mode,
            open_after_export,
        )
    })
    .await
}

#[tauri::command]
pub async fn save_notion_export_settings(
    app: AppHandle,
    parent_id: Option<String>,
    parent_type: Option<NotionParentType>,
    cover_mode: NotionCoverMode,
) -> Result<SettingsStateResponse, AppCommandError> {
    run_blocking(move || {
        SettingsService::new(app).save_notion_export_settings(parent_id, parent_type, cover_mode)
    })
    .await
}

#[tauri::command]
pub async fn create_notion_reading_library_template(
    app: AppHandle,
    parent_page_id: String,
) -> Result<CreateNotionReadingLibraryTemplateResponse, AppCommandError> {
    SettingsService::new(app)
        .create_notion_reading_library_template(parent_page_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn create_notion_reading_workspace_template(
    app: AppHandle,
    parent_page_id: String,
) -> Result<CreateNotionReadingWorkspaceTemplateResponse, AppCommandError> {
    SettingsService::new(app)
        .create_notion_reading_workspace_template(parent_page_id)
        .await
        .map_err(Into::into)
}

async fn run_blocking<T>(
    task: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppCommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppCommandError {
            code: "settings_task_failed".to_string(),
            message: format!("本地设置任务执行失败：{error}"),
            detail: None,
        })?
        .map_err(Into::into)
}
