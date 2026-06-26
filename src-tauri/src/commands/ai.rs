use serde::Serialize;
use tauri::AppHandle;

use crate::services::ai::{
    AiAssetDetail, AiAssetSummary, AiAssetVersionDetail, AiAssetVersionSummary,
    AiCachedOutputRecord, AiCredentialValidationResult, AiProviderCapabilityProbe,
    AiProviderModelListResponse, AiResponseFormatPolicy, AiReviewFeedbackExport,
    AiReviewFeedbackState, AiService, AiServiceError, AiSettingsState, BookAiSummaryListItem,
    BookAiSummaryResponse, BookAiSummaryUpdateContext, BookDecisionCandidateInput,
    BookDecisionResponse, BookNotesSummariesExportOptions, ExportAiBulkMarkdownResponse,
    ExportAiMarkdownResponse, LocalReaderSelectionQuestionInput,
    LocalReaderSelectionQuestionResponse, ReadingRouteRequest, ReadingRouteResponse,
    ReadingRouteUpdateContext, ReadingStatsAiReviewResponse,
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
    preset_id: Option<String>,
    response_format_policy: Option<AiResponseFormatPolicy>,
) -> AiCredentialValidationResult {
    AiService::validate_credential_input(
        &api_key,
        base_url.as_deref(),
        model.as_deref(),
        preset_id.as_deref(),
        response_format_policy,
    )
}

#[tauri::command]
pub fn save_ai_credential(
    app: AppHandle,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
    preset_id: Option<String>,
    response_format_policy: Option<AiResponseFormatPolicy>,
) -> Result<AiSettingsState, AiCommandError> {
    AiService::new(app)
        .save_credential(
            &api_key,
            base_url.as_deref(),
            model.as_deref(),
            preset_id.as_deref(),
            response_format_policy,
        )
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_ai_settings(
    app: AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    preset_id: Option<String>,
    response_format_policy: Option<AiResponseFormatPolicy>,
) -> Result<AiSettingsState, AiCommandError> {
    AiService::new(app)
        .save_settings(
            api_key.as_deref(),
            base_url.as_deref(),
            model.as_deref(),
            preset_id.as_deref(),
            response_format_policy,
        )
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_ai_connection(
    app: AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    preset_id: Option<String>,
    response_format_policy: Option<AiResponseFormatPolicy>,
) -> Result<AiCredentialValidationResult, AiCommandError> {
    AiService::new(app)
        .test_connection(
            api_key.as_deref(),
            base_url.as_deref(),
            model.as_deref(),
            preset_id.as_deref(),
            response_format_policy,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn probe_ai_provider_capabilities(
    app: AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    preset_id: Option<String>,
    response_format_policy: Option<AiResponseFormatPolicy>,
) -> Result<AiProviderCapabilityProbe, AiCommandError> {
    AiService::new(app)
        .probe_provider_capabilities(
            api_key.as_deref(),
            base_url.as_deref(),
            model.as_deref(),
            preset_id.as_deref(),
            response_format_policy,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_ai_provider_models(
    app: AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<AiProviderModelListResponse, AiCommandError> {
    AiService::new(app)
        .list_provider_models(api_key.as_deref(), base_url.as_deref())
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
pub async fn get_latest_reading_stats_review(
    app: AppHandle,
    mode: Option<String>,
    base_time: Option<i64>,
) -> Result<Option<ReadingStatsAiReviewResponse>, AiCommandError> {
    AiService::new(app)
        .get_latest_reading_stats_review(mode, base_time)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn export_reading_stats_review_markdown(
    app: AppHandle,
    mode: Option<String>,
    base_time: Option<i64>,
) -> Result<ExportAiMarkdownResponse, AiCommandError> {
    AiService::new(app)
        .export_reading_stats_review_markdown(mode, base_time)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn summarize_reading_route(
    app: AppHandle,
    request: ReadingRouteRequest,
    regenerate: Option<bool>,
    update_from: Option<ReadingRouteUpdateContext>,
) -> Result<ReadingRouteResponse, AiCommandError> {
    AiService::new(app)
        .summarize_reading_route(request, regenerate.unwrap_or(false), update_from)
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

#[tauri::command]
pub async fn ask_local_reader_selection_question(
    app: AppHandle,
    request: LocalReaderSelectionQuestionInput,
) -> Result<LocalReaderSelectionQuestionResponse, AiCommandError> {
    AiService::new(app)
        .ask_local_reader_selection_question(request)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    const AI_SETTINGS_COMMANDS: &[&str] = &[
        "get_ai_settings_state",
        "validate_ai_credential",
        "save_ai_credential",
        "save_ai_settings",
        "test_ai_connection",
        "probe_ai_provider_capabilities",
        "list_ai_provider_models",
        "remove_ai_credential",
    ];

    #[test]
    fn ai_settings_commands_are_registered_and_permitted() {
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let lib_rs = read_manifest_file(manifest_dir, "src/lib.rs");
        let build_rs = read_manifest_file(manifest_dir, "build.rs");
        let capability = read_manifest_file(manifest_dir, "capabilities/default.json");

        for command in AI_SETTINGS_COMMANDS {
            assert!(
                lib_rs.contains(&format!("commands::ai::{command}")),
                "{command} should be registered in tauri invoke_handler"
            );
            assert!(
                build_rs.contains(&format!("\"{command}\"")),
                "{command} should be listed in Tauri build manifest"
            );

            let permission_id = format!("allow-{}", command.replace('_', "-"));
            assert!(
                capability.contains(&format!("\"{permission_id}\"")),
                "{permission_id} should be enabled in default capability"
            );

            let permission_file = manifest_dir
                .join("permissions")
                .join("autogenerated")
                .join(format!("{command}.toml"));
            assert!(
                permission_file.is_file(),
                "{command} should have an autogenerated permission file"
            );

            let permission_text = std::fs::read_to_string(&permission_file)
                .expect("permission file should be readable");
            assert!(
                permission_text.contains(&format!("commands.allow = [\"{command}\"]")),
                "{command} permission should allow the matching command"
            );
        }
    }

    fn read_manifest_file(manifest_dir: &std::path::Path, relative_path: &str) -> String {
        std::fs::read_to_string(manifest_dir.join(relative_path))
            .unwrap_or_else(|error| panic!("{relative_path} should be readable: {error}"))
    }
}
