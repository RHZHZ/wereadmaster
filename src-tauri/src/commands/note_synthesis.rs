use serde::Serialize;
use tauri::AppHandle;

use crate::services::{
    ai::AiService,
    note_synthesis::{
        stable_provider_hash, NoteSynthesisError, NoteSynthesisJob, NoteSynthesisJobSummary,
        NoteSynthesisPreview, NoteSynthesisService, StartNoteSynthesisRequest,
        StartNoteSynthesisResult,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSynthesisCommandError {
    code: String,
    message: String,
}

impl From<NoteSynthesisError> for NoteSynthesisCommandError {
    fn from(error: NoteSynthesisError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

#[tauri::command]
pub async fn preview_note_synthesis(
    app: AppHandle,
    book_id: String,
) -> Result<NoteSynthesisPreview, NoteSynthesisCommandError> {
    run_blocking(move || {
        let settings = AiService::new(app.clone())
            .settings_state()
            .map_err(|error| NoteSynthesisError::Storage(error.user_message()))?;
        NoteSynthesisService::new(app).preview(
            &book_id,
            settings.provider.model,
            settings.provider.preset_id,
        )
    })
    .await
}

#[tauri::command]
pub async fn start_note_synthesis(
    app: AppHandle,
    book_id: String,
    consent_confirmed_at: String,
) -> Result<StartNoteSynthesisResult, NoteSynthesisCommandError> {
    run_blocking(move || {
        let settings = AiService::new(app.clone())
            .settings_state()
            .map_err(|error| NoteSynthesisError::Storage(error.user_message()))?;
        NoteSynthesisService::new(app).start(StartNoteSynthesisRequest {
            book_id,
            provider_base_url_hash: stable_provider_hash(&settings.provider.base_url),
            provider_model: settings.provider.model,
            provider_label: settings.provider.preset_id,
            consent_confirmed_at,
        })
    })
    .await
}

#[tauri::command]
pub async fn get_note_synthesis_job(
    app: AppHandle,
    job_id: String,
) -> Result<NoteSynthesisJob, NoteSynthesisCommandError> {
    run_blocking(move || NoteSynthesisService::new(app).get(&job_id)).await
}

#[tauri::command]
pub async fn get_active_note_synthesis_job(
    app: AppHandle,
    book_id: String,
) -> Result<Option<NoteSynthesisJob>, NoteSynthesisCommandError> {
    run_blocking(move || NoteSynthesisService::new(app).get_active(&book_id)).await
}

#[tauri::command]
pub async fn get_note_synthesis_job_summary(
    app: AppHandle,
    book_id: String,
) -> Result<NoteSynthesisJobSummary, NoteSynthesisCommandError> {
    run_blocking(move || NoteSynthesisService::new(app).get_summary(&book_id)).await
}

#[tauri::command]
pub async fn continue_note_synthesis(
    app: AppHandle,
    job_id: String,
) -> Result<NoteSynthesisJob, NoteSynthesisCommandError> {
    NoteSynthesisService::new(app)
        .continue_job(&job_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn retry_failed_note_synthesis_batches(
    app: AppHandle,
    job_id: String,
) -> Result<NoteSynthesisJob, NoteSynthesisCommandError> {
    NoteSynthesisService::new(app)
        .retry_failed_batches(&job_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cancel_note_synthesis(
    app: AppHandle,
    job_id: String,
) -> Result<NoteSynthesisJob, NoteSynthesisCommandError> {
    run_blocking(move || NoteSynthesisService::new(app).request_cancel(&job_id)).await
}

async fn run_blocking<T>(
    task: impl FnOnce() -> Result<T, NoteSynthesisError> + Send + 'static,
) -> Result<T, NoteSynthesisCommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| NoteSynthesisCommandError {
            code: "note_synthesis_task_failed".to_string(),
            message: format!("全量归纳本地任务执行失败：{error}"),
        })?
        .map_err(Into::into)
}
