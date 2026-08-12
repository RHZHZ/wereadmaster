use serde::Serialize;
use tauri::AppHandle;

use crate::services::{
    embedding::{
        EmbeddingConnectionProbe, EmbeddingProviderSettings, EmbeddingService,
        EmbeddingServiceError, EmbeddingSettingsState, SaveEmbeddingSettingsRequest,
    },
    embedding_index::{
        EmbeddingIndexError, EmbeddingIndexProfile, EmbeddingIndexService, EmbeddingIndexState,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingCommandError {
    code: String,
    message: String,
}

impl From<EmbeddingServiceError> for EmbeddingCommandError {
    fn from(error: EmbeddingServiceError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

impl From<EmbeddingIndexError> for EmbeddingCommandError {
    fn from(error: EmbeddingIndexError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

#[tauri::command]
pub async fn get_embedding_settings_state(
    app: AppHandle,
) -> Result<EmbeddingSettingsState, EmbeddingCommandError> {
    run_embedding_blocking(move || EmbeddingService::new(app).settings_state()).await
}

#[tauri::command]
pub async fn save_embedding_settings(
    app: AppHandle,
    request: SaveEmbeddingSettingsRequest,
) -> Result<EmbeddingSettingsState, EmbeddingCommandError> {
    run_embedding_blocking(move || EmbeddingService::new(app).save_settings(request)).await
}

#[tauri::command]
pub async fn test_embedding_connection(
    app: AppHandle,
    api_key: Option<String>,
    settings: Option<EmbeddingProviderSettings>,
) -> Result<EmbeddingConnectionProbe, EmbeddingCommandError> {
    EmbeddingService::new(app)
        .test_connection(api_key.as_deref(), settings)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn remove_embedding_credential(
    app: AppHandle,
    confirm: bool,
) -> Result<EmbeddingSettingsState, EmbeddingCommandError> {
    run_embedding_blocking(move || EmbeddingService::new(app).remove_credential(confirm)).await
}

#[tauri::command]
pub async fn get_embedding_index_state(
    app: AppHandle,
) -> Result<EmbeddingIndexState, EmbeddingCommandError> {
    run_index_blocking(move || EmbeddingIndexService::new(app).state()).await
}

#[tauri::command]
pub async fn start_embedding_index(
    app: AppHandle,
) -> Result<EmbeddingIndexProfile, EmbeddingCommandError> {
    EmbeddingIndexService::new(app)
        .start()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn resume_embedding_index(
    app: AppHandle,
    profile_id: String,
) -> Result<EmbeddingIndexProfile, EmbeddingCommandError> {
    EmbeddingIndexService::new(app)
        .resume(&profile_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cancel_embedding_index(
    app: AppHandle,
    profile_id: String,
) -> Result<EmbeddingIndexProfile, EmbeddingCommandError> {
    run_index_blocking(move || EmbeddingIndexService::new(app).request_cancel(&profile_id)).await
}

#[tauri::command]
pub async fn clear_embedding_index(
    app: AppHandle,
    profile_id: Option<String>,
    confirm: bool,
) -> Result<EmbeddingIndexState, EmbeddingCommandError> {
    run_index_blocking(move || {
        EmbeddingIndexService::new(app).clear(profile_id.as_deref(), confirm)
    })
    .await
}

async fn run_embedding_blocking<T>(
    task: impl FnOnce() -> Result<T, EmbeddingServiceError> + Send + 'static,
) -> Result<T, EmbeddingCommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| EmbeddingCommandError {
            code: "embedding_task_failed".to_string(),
            message: format!("本地 Embedding 设置任务执行失败：{error}"),
        })?
        .map_err(Into::into)
}

async fn run_index_blocking<T>(
    task: impl FnOnce() -> Result<T, EmbeddingIndexError> + Send + 'static,
) -> Result<T, EmbeddingCommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| EmbeddingCommandError {
            code: "embedding_index_task_failed".to_string(),
            message: format!("本地语义索引任务执行失败：{error}"),
        })?
        .map_err(Into::into)
}
