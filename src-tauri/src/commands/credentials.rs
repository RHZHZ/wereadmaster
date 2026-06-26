use serde::Serialize;
use tauri::AppHandle;

use crate::services::credentials::{
    CredentialService, CredentialServiceError, CredentialStatus, CredentialValidationResult,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialCommandError {
    code: String,
    message: String,
}

impl From<CredentialServiceError> for CredentialCommandError {
    fn from(error: CredentialServiceError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

#[tauri::command]
pub async fn get_credential_status(
    app: AppHandle,
) -> Result<CredentialStatus, CredentialCommandError> {
    run_blocking(move || CredentialService::new(app).credential_status()).await
}

#[tauri::command]
pub fn validate_credential(api_key: String) -> CredentialValidationResult {
    CredentialService::validate_api_key_input(&api_key)
}

#[tauri::command]
pub async fn save_credential(
    app: AppHandle,
    api_key: String,
) -> Result<CredentialStatus, CredentialCommandError> {
    run_blocking(move || CredentialService::new(app).save_credential(&api_key)).await
}

#[tauri::command]
pub async fn remove_credential(
    app: AppHandle,
    confirm: bool,
) -> Result<CredentialStatus, CredentialCommandError> {
    run_blocking(move || CredentialService::new(app).remove_credential(confirm)).await
}

async fn run_blocking<T>(
    task: impl FnOnce() -> Result<T, CredentialServiceError> + Send + 'static,
) -> Result<T, CredentialCommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| CredentialCommandError {
            code: "credential_task_failed".to_string(),
            message: format!("本地凭据任务执行失败：{error}"),
        })?
        .map_err(Into::into)
}
