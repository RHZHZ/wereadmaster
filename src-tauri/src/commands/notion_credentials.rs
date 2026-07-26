use serde::Serialize;
use tauri::AppHandle;

use crate::services::notion_credentials::{
    NotionCredentialError, NotionCredentialService, NotionCredentialStatus,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionCredentialCommandError {
    code: String,
    message: String,
}

impl From<NotionCredentialError> for NotionCredentialCommandError {
    fn from(error: NotionCredentialError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

#[tauri::command]
pub async fn get_notion_credential_status(
    app: AppHandle,
) -> Result<NotionCredentialStatus, NotionCredentialCommandError> {
    run_blocking(move || NotionCredentialService::new(app).credential_status()).await
}

#[tauri::command]
pub async fn save_notion_credential(
    app: AppHandle,
    token: String,
) -> Result<NotionCredentialStatus, NotionCredentialCommandError> {
    run_blocking(move || NotionCredentialService::new(app).save_credential(&token)).await
}

#[tauri::command]
pub async fn remove_notion_credential(
    app: AppHandle,
    confirm: bool,
) -> Result<NotionCredentialStatus, NotionCredentialCommandError> {
    run_blocking(move || NotionCredentialService::new(app).remove_credential(confirm)).await
}

#[tauri::command]
pub async fn validate_notion_credential(
    app: AppHandle,
) -> Result<NotionCredentialStatus, NotionCredentialCommandError> {
    NotionCredentialService::new(app)
        .validate_credential()
        .await
        .map_err(Into::into)
}

async fn run_blocking<T>(
    task: impl FnOnce() -> Result<T, NotionCredentialError> + Send + 'static,
) -> Result<T, NotionCredentialCommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| NotionCredentialCommandError {
            code: "notion_credential_task_failed".to_string(),
            message: format!("Notion 凭据任务执行失败：{error}"),
        })?
        .map_err(Into::into)
}
