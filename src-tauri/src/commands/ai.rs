use serde::Serialize;
use tauri::AppHandle;

use crate::services::ai::{
    AiAssetDetail, AiAssetSummary, AiAssetVersionDetail, AiAssetVersionSummary,
    AiCachedOutputRecord, AiCredentialValidationResult, AiService, AiServiceError, AiSettingsState,
    AiReviewFeedbackExport, AiReviewFeedbackState, BookAiSummaryListItem, BookAiSummaryResponse,
    BookAiSummaryUpdateContext, BookDecisionCandidateInput, BookDecisionResponse,
    BookNotesSummariesExportOptions,
    ExportAiBulkMarkdownResponse, ExportAiMarkdownResponse, ReadingRouteRequest, ReadingRouteResponse,
    ReadingStatsAiReviewResponse,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCommandError {
    code: String,
    message: String,
}

impl From<AiServiceError> for AiCommandError {
    fn from(error: AiServiceError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

#[tauri::command]
pub fn get_ai_settings_state(app: AppHandle) -> Result<AiSettingsState, AiCommandError> {
    AiService::new(app).settings_state().map_err(Into::into)
}

#[tauri::command]
pub fn validate_ai_credential(
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
) -> AiCredentialValidationResult {
    AiService::validate_credential_input(&api_key, base_url.as_deref(), model.as_deref())
}

#[tauri::command]
pub fn save_ai_credential(
    app: AppHandle,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<AiSettingsState, AiCommandError> {
    AiService::new(app)
        .save_credential(&api_key, base_url.as_deref(), model.as_deref())
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_ai_settings(
    app: AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<AiSettingsState, AiCommandError> {
    AiService::new(app)
        .save_settings(api_key.as_deref(), base_url.as_deref(), model.as_deref())
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_ai_connection(
    app: AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<AiCredentialValidationResult, AiCommandError> {
    AiService::new(app)
        .test_connection(api_key.as_deref(), base_url.as_deref(), model.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn remove_ai_credential(
    app: AppHandle,
    confirm: bool,
) -> Result<AiSettingsState, AiCommandError> {
    AiService::new(app)
        .remove_credential(confirm)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_ai_cached_output(
    app: AppHandle,
    feature: String,
    scope_id: String,
    prompt_version: String,
    input_hash: String,
) -> Result<Option<AiCachedOutputRecord>, AiCommandError> {
    AiService::new(app)
        .get_cached_output(feature, scope_id, prompt_version, input_hash)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn summarize_book_notes(
    app: AppHandle,
    book_id: String,
    regenerate: Option<bool>,
    update_from: Option<BookAiSummaryUpdateContext>,
) -> Result<BookAiSummaryResponse, AiCommandError> {
    AiService::new(app)
        .summarize_book_notes(book_id, regenerate.unwrap_or(false), update_from)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_latest_book_notes_summary(
    app: AppHandle,
    book_id: String,
) -> Result<Option<BookAiSummaryResponse>, AiCommandError> {
    AiService::new(app)
        .get_latest_book_notes_summary(book_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_book_notes_summary_markdown(
    app: AppHandle,
    book_id: String,
    review_feedback: Option<AiReviewFeedbackExport>,
) -> Result<ExportAiMarkdownResponse, AiCommandError> {
    AiService::new(app)
        .export_book_notes_summary_markdown(book_id, review_feedback)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_book_notes_summaries_markdown(
    app: AppHandle,
    book_ids: Option<Vec<String>>,
    options: Option<BookNotesSummariesExportOptions>,
) -> Result<ExportAiBulkMarkdownResponse, AiCommandError> {
    AiService::new(app)
        .export_book_notes_summaries_markdown(book_ids, options)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_book_notes_summaries(
    app: AppHandle,
) -> Result<Vec<BookAiSummaryListItem>, AiCommandError> {
    AiService::new(app)
        .list_book_notes_summaries()
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_ai_asset_summaries(app: AppHandle) -> Result<Vec<AiAssetSummary>, AiCommandError> {
    AiService::new(app)
        .list_ai_asset_summaries()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_ai_asset_detail(
    app: AppHandle,
    book_id: String,
) -> Result<Option<AiAssetDetail>, AiCommandError> {
    AiService::new(app)
        .get_ai_asset_detail(book_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_ai_asset_version_detail(
    app: AppHandle,
    feature: String,
    scope_id: String,
    input_hash: String,
) -> Result<Option<AiAssetVersionDetail>, AiCommandError> {
    AiService::new(app)
        .get_ai_asset_version_detail(feature, scope_id, input_hash)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_ai_asset_version_history(
    app: AppHandle,
    feature: String,
    scope_id: String,
) -> Result<Vec<AiAssetVersionSummary>, AiCommandError> {
    AiService::new(app)
        .get_ai_asset_version_history(feature, scope_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_ai_review_feedback(
    app: AppHandle,
    feature: String,
    scope_id: String,
    input_hash: String,
) -> Result<AiReviewFeedbackState, AiCommandError> {
    AiService::new(app)
        .get_ai_review_feedback(feature, scope_id, input_hash)
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_ai_review_feedback(
    app: AppHandle,
    feature: String,
    scope_id: String,
    input_hash: String,
    feedback: AiReviewFeedbackState,
) -> Result<AiReviewFeedbackState, AiCommandError> {
    AiService::new(app)
        .save_ai_review_feedback(feature, scope_id, input_hash, feedback)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn summarize_reading_stats(
    app: AppHandle,
    mode: Option<String>,
    base_time: Option<i64>,
    regenerate: Option<bool>,
) -> Result<ReadingStatsAiReviewResponse, AiCommandError> {
    AiService::new(app)
        .summarize_reading_stats(mode, base_time, regenerate.unwrap_or(false))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_latest_reading_stats_review(
    app: AppHandle,
    mode: Option<String>,
    base_time: Option<i64>,
) -> Result<Option<ReadingStatsAiReviewResponse>, AiCommandError> {
    AiService::new(app)
        .get_latest_reading_stats_review(mode, base_time)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_reading_stats_review_markdown(
    app: AppHandle,
    mode: Option<String>,
    base_time: Option<i64>,
) -> Result<ExportAiMarkdownResponse, AiCommandError> {
    AiService::new(app)
        .export_reading_stats_review_markdown(mode, base_time)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn summarize_reading_route(
    app: AppHandle,
    request: ReadingRouteRequest,
    regenerate: Option<bool>,
) -> Result<ReadingRouteResponse, AiCommandError> {
    AiService::new(app)
        .summarize_reading_route(request, regenerate.unwrap_or(false))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_latest_reading_route(
    app: AppHandle,
    request: ReadingRouteRequest,
) -> Result<Option<ReadingRouteResponse>, AiCommandError> {
    AiService::new(app)
        .get_latest_reading_route(request)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_reading_route_markdown(
    app: AppHandle,
    request: ReadingRouteRequest,
) -> Result<ExportAiMarkdownResponse, AiCommandError> {
    AiService::new(app)
        .export_reading_route_markdown(request)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn summarize_book_decision(
    app: AppHandle,
    candidates: Vec<BookDecisionCandidateInput>,
    goal: Option<String>,
    regenerate: Option<bool>,
) -> Result<BookDecisionResponse, AiCommandError> {
    AiService::new(app)
        .summarize_book_decision(candidates, goal, regenerate.unwrap_or(false))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_latest_book_decision(
    app: AppHandle,
    candidates: Vec<BookDecisionCandidateInput>,
    goal: Option<String>,
) -> Result<Option<BookDecisionResponse>, AiCommandError> {
    AiService::new(app)
        .get_latest_book_decision(candidates, goal)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_book_decision_markdown(
    app: AppHandle,
    candidates: Vec<BookDecisionCandidateInput>,
    goal: Option<String>,
) -> Result<ExportAiMarkdownResponse, AiCommandError> {
    AiService::new(app)
        .export_book_decision_markdown(candidates, goal)
        .map_err(Into::into)
}
