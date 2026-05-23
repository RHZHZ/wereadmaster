use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    services::stats::{ReadingStatsResponse, StatsService},
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
pub async fn sync_reading_stats(
    app: AppHandle,
    mode: Option<String>,
    base_time: Option<i64>,
) -> Result<ReadingStatsResponse, AppCommandError> {
    StatsService::new(app)
        .sync_reading_stats(mode, base_time)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_reading_stats(
    app: AppHandle,
    mode: Option<String>,
    base_time: Option<i64>,
) -> Result<ReadingStatsResponse, AppCommandError> {
    StatsService::new(app)
        .get_reading_stats(mode, base_time)
        .await
        .map_err(Into::into)
}
