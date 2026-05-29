use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    services::settings::{
        ChooseDataDirectoryResponse, ChooseExportDirectoryResponse, ClearAiOutputCacheResponse,
        ClearLocalCacheResponse, ExportBackupResponse, ExportDiagnosticsResponse,
        ExportImageResponse, MigrateDataDirectoryResponse, RemoteAppUpdateManifestResponse,
        ResetExportDirectoryResponse, RestoreBackupResponse, SaveExportDirectoryResponse,
        SettingsService, SettingsStateResponse,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCommandError {
    code: String,
    message: String,
}

impl From<AppError> for AppCommandError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

#[tauri::command]
pub fn get_settings_state(app: AppHandle) -> Result<SettingsStateResponse, AppCommandError> {
    SettingsService::new(app)
        .settings_state()
        .map_err(Into::into)
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
pub fn save_custom_export_directory(
    app: AppHandle,
    target_dir: String,
) -> Result<SaveExportDirectoryResponse, AppCommandError> {
    SettingsService::new(app)
        .save_custom_export_directory(target_dir)
        .map_err(Into::into)
}

#[tauri::command]
pub fn reset_custom_export_directory(
    app: AppHandle,
) -> Result<ResetExportDirectoryResponse, AppCommandError> {
    SettingsService::new(app)
        .reset_custom_export_directory()
        .map_err(Into::into)
}
