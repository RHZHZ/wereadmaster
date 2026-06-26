use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    fmt::{self, Write as _},
    fs,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::Datelike;
use reqwest::{Client as HttpClient, StatusCode};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use crate::{
    db,
    errors::AppError,
    export::markdown::{
        serialize_book_ai_summary_markdown, serialize_book_ai_summary_markdown_with_options,
        serialize_book_decision_markdown, serialize_reading_route_markdown,
        serialize_reading_stats_review_markdown, BookAiSummaryMarkdownOptions,
    },
    mappers::{
        notes::BookNotesRecord,
        stats::{ReadingCategoryRecord, ReadingStatsRecord},
    },
    platform::stronghold::{kdf::KeyDerivation, stronghold::Stronghold, Client},
    services::{notes::NotesService, stats::StatsService},
};

pub const BOOK_NOTES_SUMMARY_PROMPT_VERSION: &str = "book-notes-summary-v3";
pub const READING_STATS_REVIEW_PROMPT_VERSION: &str = "reading-stats-review-v2";
pub const READING_ROUTE_PROMPT_VERSION: &str = "reading-route-v2.1";
pub const BOOK_DECISION_PROMPT_VERSION: &str = "book-decision-v1";
pub const LOCAL_READER_SELECTION_QA_PROMPT_VERSION: &str = "local-reader-selection-qa-v2";

pub const BOOK_NOTES_SUMMARY_FEATURE: &str = "book-notes-summary";
const READING_STATS_REVIEW_FEATURE: &str = "reading-stats-review";
const READING_ROUTE_FEATURE: &str = "reading-route";
const BOOK_DECISION_FEATURE: &str = "book-decision";
const LOCAL_READER_SELECTION_QA_FEATURE: &str = "local-reader-selection-qa";
const AI_JSON_MAX_TOKENS: u16 = 4096;
const CLIENT_PATH: &[u8] = b"ai-credentials";
const API_KEY_RECORD: &[u8] = b"ai-api-key";
const METADATA_RECORD: &[u8] = b"ai-credential-metadata";
const PROVIDER_SETTINGS_RECORD: &[u8] = b"ai-provider-settings";
const VAULT_PASSWORD: &str = "wxreadmaster-local-ai-credential-v1";
const DEFAULT_AI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL: &str = "gpt-4o-mini";
const DEFAULT_AI_PROVIDER_PRESET_ID: &str = "openai";
const CUSTOM_AI_PROVIDER_PRESET_ID: &str = "custom";
const MAX_SUMMARY_HIGHLIGHTS: usize = 80;
const MAX_SUMMARY_THOUGHTS: usize = 80;
const MAX_SUMMARY_CHAPTER_GROUPS: usize = 80;
const MAX_NOTE_TEXT_CHARS: usize = 700;
const MAX_STATS_BUCKETS: usize = 90;
const MAX_STATS_RANK_ITEMS: usize = 12;
const MAX_STATS_CATEGORIES: usize = 12;
const MAX_ROUTE_CANDIDATES: usize = 8;
const MAX_BOOK_DECISION_CANDIDATES: usize = 8;
const MAX_LOCAL_READER_SELECTED_TEXT_CHARS: usize = 2_000;
const MAX_LOCAL_READER_CONTEXT_TEXT_CHARS: usize = 1_200;
const MAX_LOCAL_READER_QUESTION_CHARS: usize = 600;
const MAX_LOCAL_READER_ANSWER_CHARS: usize = 8_000;
const MAX_LOCAL_READER_LIST_ITEM_CHARS: usize = 500;
const MAX_LOCAL_READER_FOLLOW_UP_QUESTIONS: usize = 3;
const AI_REQUEST_TIMEOUT_SECONDS: u64 = 60;
static READING_PERSONA_CONFIG: OnceLock<ReadingPersonaConfig> = OnceLock::new();

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaConfig {
    basis_notice: String,
    fallback_label: String,
    definitions: HashMap<String, ReadingPersonaDefinitionConfig>,
    category_tokens: ReadingPersonaCategoryTokensConfig,
    thresholds: ReadingPersonaThresholdsConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaDefinitionConfig {
    label: String,
    palette_group: String,
    accent_tone: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaCategoryTokensConfig {
    practical: Vec<String>,
    conceptual: Vec<String>,
    analytical: Vec<String>,
    resonant: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaThresholdsConfig {
    stable_bucket_multiplier: f64,
    axis_bias_multiplier: f64,
    status: ReadingPersonaStatusThresholdsConfig,
    energy: ReadingPersonaEnergyThresholdsConfig,
    lifestyle: ReadingPersonaLifestyleThresholdsConfig,
    strength: ReadingPersonaStrengthThresholdsConfig,
    evidence: ReadingPersonaEvidenceThresholdsConfig,
    suggestion: ReadingPersonaSuggestionThresholdsConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaStatusThresholdsConfig {
    complete: ReadingPersonaCompleteStatusThresholdConfig,
    provisional: ReadingPersonaProvisionalStatusThresholdConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaCompleteStatusThresholdConfig {
    min_total_read_time_seconds: f64,
    min_read_days: i64,
    min_active_bucket_count: usize,
    min_category_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaProvisionalStatusThresholdConfig {
    min_total_read_time_seconds: f64,
    min_read_days: i64,
    min_stable_dimension_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaEnergyThresholdsConfig {
    introverted: ReadingPersonaIntrovertedThresholdConfig,
    breadth_strength: ReadingPersonaBreadthStrengthThresholdConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaIntrovertedThresholdConfig {
    min_top3_category_share: f64,
    min_author_concentration: f64,
    min_top_item_share: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaBreadthStrengthThresholdConfig {
    strong: ReadingPersonaBreadthStrongThresholdConfig,
    medium: ReadingPersonaBreadthMediumThresholdConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaBreadthStrongThresholdConfig {
    max_top3_category_share: f64,
    max_author_concentration: f64,
    max_top_item_share: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaBreadthMediumThresholdConfig {
    max_top3_category_share: f64,
    max_top_item_share: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaLifestyleThresholdsConfig {
    planned: ReadingPersonaPlannedThresholdConfig,
    exploratory: ReadingPersonaExploratoryThresholdConfig,
    judging_strength: ReadingPersonaJudgingStrengthThresholdConfig,
    perceiving_strength: ReadingPersonaPerceivingStrengthThresholdConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaPlannedThresholdConfig {
    min_read_days: i64,
    min_stable_bucket_share: f64,
    min_top_item_share: f64,
    min_compare: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaExploratoryThresholdConfig {
    max_read_days: i64,
    max_active_bucket_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaJudgingStrengthThresholdConfig {
    read_days_scale: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaPerceivingStrengthThresholdConfig {
    strong: ReadingPersonaPerceivingThresholdLevelConfig,
    medium: ReadingPersonaPerceivingThresholdLevelConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaPerceivingThresholdLevelConfig {
    max_read_days: i64,
    max_active_bucket_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaStrengthThresholdsConfig {
    ratio: ReadingPersonaStrengthRatioThresholdConfig,
    delta: ReadingPersonaStrengthDeltaThresholdConfig,
    confidence: ReadingPersonaStrengthConfidenceThresholdConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaStrengthRatioThresholdConfig {
    strong: f64,
    medium: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaStrengthDeltaThresholdConfig {
    strong: f64,
    medium: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaStrengthConfidenceThresholdConfig {
    strong: f64,
    medium: f64,
    light: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaEvidenceThresholdsConfig {
    provisional_max_items: usize,
    default_max_items: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaSuggestionThresholdsConfig {
    introverted_min_top_category_share: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialStatus {
    pub has_credential: bool,
    pub last_validated_at: Option<String>,
    pub last_validation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialValidationResult {
    pub is_valid: bool,
    pub checked_at: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderCapabilityStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCapabilityProbe {
    pub basic: AiProviderCapabilityStatus,
    pub json_object: AiProviderCapabilityStatus,
    pub json_schema: AiProviderCapabilityStatus,
    pub recommended_policy: AiResponseFormatPolicy,
    pub checked_at: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderModelListItem {
    pub id: String,
    pub owned_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderModelListResponse {
    pub models: Vec<AiProviderModelListItem>,
    pub fetched_at: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiResponseFormatPolicy {
    Auto,
    JsonSchemaFirst,
    JsonObjectFirst,
    NoResponseFormatFirst,
}

impl Default for AiResponseFormatPolicy {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSettings {
    pub base_url: String,
    pub model: String,
    #[serde(default = "default_stored_provider_preset_id")]
    pub preset_id: String,
    #[serde(default)]
    pub response_format_policy: AiResponseFormatPolicy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsState {
    pub credential: AiCredentialStatus,
    pub provider: AiProviderSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiCachedOutputRecord {
    pub feature: String,
    pub scope_id: String,
    pub prompt_version: String,
    pub input_hash: String,
    pub output: Value,
    pub source_count: Option<i64>,
    pub provider_model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookAiSummarySourceStats {
    pub highlight_count: usize,
    pub thought_count: usize,
    pub bookmark_count: i64,
    pub chapter_count: usize,
    pub included_highlight_count: usize,
    pub included_thought_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackOutcomeSummary {
    pub summary: String,
    #[serde(default)]
    pub applied_changes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookAiSummary {
    pub overview: String,
    pub key_ideas: Vec<String>,
    pub my_focus: Vec<String>,
    pub action_items: Vec<String>,
    pub theme_tags: Vec<String>,
    pub representative_quotes: Vec<BookAiRepresentativeQuote>,
    pub reflection_questions: Vec<String>,
    pub reading_stage: Option<ReadingStageSignal>,
    pub source_stats: BookAiSummarySourceStats,
    pub generated_at: String,
    pub prompt_version: String,
    pub response_format: Option<AiResponseFormatKind>,
    pub basis_notice: String,
    #[serde(default)]
    pub feedback_outcome_summary: Option<FeedbackOutcomeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookAiRepresentativeQuote {
    pub quote: String,
    pub reason: String,
    pub chapter: Option<String>,
    pub note_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BookAiSummarySource {
    Cache,
    Generated,
    StaleCache,
    Empty,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiResponseFormatKind {
    JsonSchema,
    JsonObject,
}

impl AiResponseFormatKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::JsonSchema => "json_schema",
            Self::JsonObject => "json_object",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProviderJsonResult {
    value: Value,
    response_format: Option<AiResponseFormatKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookAiSummaryResponse {
    pub book_id: String,
    pub prompt_version: String,
    pub input_hash: String,
    pub provider_model: Option<String>,
    pub source: BookAiSummarySource,
    pub summary: BookAiSummary,
    pub cached_updated_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookAiSummaryUpdateContext {
    pub feature: String,
    pub scope_id: String,
    pub input_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteUpdateContext {
    pub feature: String,
    pub scope_id: String,
    pub input_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStatsAiReviewSourceStats {
    pub mode: String,
    pub base_time: i64,
    pub read_days: Option<i64>,
    pub total_read_time_seconds: Option<i64>,
    pub day_average_read_time_seconds: Option<i64>,
    pub bucket_count: usize,
    pub longest_item_count: usize,
    pub category_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStatsAiReview {
    pub overview: String,
    pub rhythm_insights: Vec<String>,
    pub preference_insights: Vec<String>,
    pub focus_items: Vec<String>,
    pub next_actions: Vec<String>,
    pub reading_persona: Option<ReadingPersonaPatch>,
    pub source_stats: ReadingStatsAiReviewSourceStats,
    pub generated_at: String,
    pub prompt_version: String,
    pub response_format: Option<AiResponseFormatKind>,
    pub basis_notice: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPersonaPatch {
    pub summary: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPersonaDimension {
    pub axis: String,
    pub key: String,
    pub label: String,
    pub strength: String,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPersona {
    pub status: String,
    pub code: Option<String>,
    pub label: Option<String>,
    pub display_title: Option<String>,
    pub palette_group: Option<String>,
    pub accent_tone: Option<String>,
    pub basis_notice: String,
    pub dimensions: Vec<ReadingPersonaDimension>,
    pub evidence: Vec<String>,
    pub confidence: Option<f64>,
    pub summary: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStatsAiReviewResponse {
    pub mode: String,
    pub base_time: i64,
    pub prompt_version: String,
    pub input_hash: String,
    pub provider_model: Option<String>,
    pub source: BookAiSummarySource,
    pub review: ReadingStatsAiReview,
    pub cached_updated_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteBookInput {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub category: Option<String>,
    pub local_status: Option<String>,
    pub progress_percent: Option<i64>,
    pub is_finished: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteRequest {
    pub book: ReadingRouteBookInput,
    pub candidates: Vec<ReadingRouteBookInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteSourceStats {
    pub current_book_count: usize,
    pub candidate_count: usize,
    pub summary_count: usize,
    pub stats_signal_count: usize,
    pub local_status_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteBookStep {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub order: usize,
    pub role: String,
    pub reading_purpose: String,
    pub estimated_effort: String,
    pub local_status: Option<String>,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteDependency {
    pub from_book_id: String,
    pub to_book_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteCheckpoint {
    pub timing: String,
    pub question: String,
    pub suggested_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRoute {
    pub route_overview: String,
    pub books: Vec<ReadingRouteBookStep>,
    pub dependencies: Vec<ReadingRouteDependency>,
    pub review_checkpoints: Vec<ReadingRouteCheckpoint>,
    pub next_actions: Vec<String>,
    pub reading_stage: Option<ReadingStageSignal>,
    pub source_stats: ReadingRouteSourceStats,
    pub generated_at: String,
    pub prompt_version: String,
    pub response_format: Option<AiResponseFormatKind>,
    pub basis_notice: String,
    #[serde(default)]
    pub feedback_outcome_summary: Option<FeedbackOutcomeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRouteResponse {
    pub book_id: String,
    pub scope_id: String,
    pub prompt_version: String,
    pub input_hash: String,
    pub provider_model: Option<String>,
    pub source: BookAiSummarySource,
    pub route: ReadingRoute,
    pub cached_updated_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookDecisionCandidateInput {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub category: Option<String>,
    pub local_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookDecisionSourceStats {
    pub candidate_count: usize,
    pub summary_count: usize,
    pub stats_signal_count: usize,
    pub local_status_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookDecisionTopCandidate {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub rank: usize,
    pub why_now: String,
    pub tradeoff: String,
    pub estimated_effort: String,
    pub prerequisite_action: String,
    pub review_trigger: String,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookDecisionDeferredCandidate {
    pub book_id: String,
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookDecision {
    pub decision_overview: String,
    pub top_candidates: Vec<BookDecisionTopCandidate>,
    pub deferred_candidates: Vec<BookDecisionDeferredCandidate>,
    pub next_actions: Vec<String>,
    pub source_stats: BookDecisionSourceStats,
    pub generated_at: String,
    pub prompt_version: String,
    pub response_format: Option<AiResponseFormatKind>,
    pub basis_notice: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookDecisionResponse {
    pub scope_id: String,
    pub prompt_version: String,
    pub input_hash: String,
    pub provider_model: Option<String>,
    pub source: BookAiSummarySource,
    pub decision: BookDecision,
    pub cached_updated_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceItemInput {
    pub source: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReaderSelectionBookInput {
    pub title: String,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReaderSelectionContextInput {
    pub before_text: Option<String>,
    pub after_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReaderSelectionInput {
    pub text: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub context: Option<LocalReaderSelectionContextInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReaderSelectionQuestionInput {
    pub source_item: SourceItemInput,
    pub book: LocalReaderSelectionBookInput,
    pub selection: LocalReaderSelectionInput,
    pub question: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReaderSelectionAnswer {
    pub answer: String,
    pub key_points: Vec<String>,
    pub follow_up_questions: Vec<String>,
    pub generated_at: String,
    pub prompt_version: String,
    pub response_format: Option<AiResponseFormatKind>,
    pub basis_notice: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReaderSelectionQuestionResponse {
    pub source_item: SourceItemInput,
    pub prompt_version: String,
    pub input_hash: String,
    pub provider_model: Option<String>,
    pub source: BookAiSummarySource,
    pub answer: LocalReaderSelectionAnswer,
    pub cached_updated_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookAiSummaryListItem {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub overview: String,
    pub cached_updated_at: String,
    pub provider_model: Option<String>,
    pub feedback_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssetSummary {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub progress: Option<i64>,
    pub reading_stage: Option<String>,
    pub reading_stage_label: Option<String>,
    pub local_status: Option<String>,
    pub has_single_guide: bool,
    pub cross_route_count: usize,
    pub has_book_review: bool,
    pub refresh_state: String,
    pub refresh_reason: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetVersionRef {
    pub feature: String,
    pub scope_id: String,
    pub input_hash: String,
    pub prompt_version: String,
    pub generated_at: String,
    pub updated_at: String,
    pub source: String,
    pub title: Option<String>,
    pub provider_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssetDetail {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub progress: Option<i64>,
    pub reading_stage: Option<String>,
    pub reading_stage_label: Option<String>,
    pub local_status: Option<String>,
    pub refresh_state: String,
    pub refresh_reason: Option<String>,
    pub current_guide: Option<AssetVersionRef>,
    pub main_cross_routes: Vec<AssetVersionRef>,
    pub participant_cross_routes: Vec<AssetVersionRef>,
    pub current_book_review: Option<AssetVersionRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssetVersionDetail {
    pub feature: String,
    pub scope_id: String,
    pub input_hash: String,
    pub prompt_version: String,
    pub generated_at: String,
    pub updated_at: String,
    pub source: String,
    pub title: Option<String>,
    pub provider_model: Option<String>,
    pub reading_stage: Option<String>,
    pub reading_stage_label: Option<String>,
    pub progress: Option<i64>,
    pub refresh_reason: Option<String>,
    pub basis_notice: String,
    pub source_stats: Value,
    pub reading_route: Option<ReadingRoute>,
    pub book_summary: Option<BookAiSummary>,
    pub previous_version: Option<AssetVersionRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssetVersionSummary {
    pub feature: String,
    pub scope_id: String,
    pub input_hash: String,
    pub prompt_version: String,
    pub generated_at: String,
    pub updated_at: String,
    pub source: String,
    pub title: Option<String>,
    pub provider_model: Option<String>,
    pub reading_stage: Option<String>,
    pub reading_stage_label: Option<String>,
    pub progress: Option<i64>,
    pub refresh_reason: Option<String>,
    pub is_current: bool,
    pub previous_version: Option<AssetVersionRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAiMarkdownResponse {
    pub file_name: String,
    pub path: String,
    pub exported_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAiBulkMarkdownResponse {
    pub export_id: String,
    pub path: String,
    pub exported_at: String,
    pub files: Vec<String>,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookNotesSummariesExportOptions {
    #[serde(default = "default_true")]
    pub include_action_feedback: bool,
    #[serde(default = "default_true")]
    pub include_reflection_feedback: bool,
    #[serde(default = "default_true")]
    pub include_representative_quotes: bool,
}

impl Default for BookNotesSummariesExportOptions {
    fn default() -> Self {
        Self {
            include_action_feedback: true,
            include_reflection_feedback: true,
            include_representative_quotes: true,
        }
    }
}

impl From<BookNotesSummariesExportOptions> for BookAiSummaryMarkdownOptions {
    fn from(options: BookNotesSummariesExportOptions) -> Self {
        Self {
            include_action_feedback: options.include_action_feedback,
            include_reflection_feedback: options.include_reflection_feedback,
            include_representative_quotes: options.include_representative_quotes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiFeedbackExportRecord {
    pub status: String,
    pub note: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewFeedbackExport {
    pub action_items: HashMap<String, AiFeedbackExportRecord>,
    pub reflection_questions: HashMap<String, AiFeedbackExportRecord>,
}

pub type AiReviewFeedbackState = AiReviewFeedbackExport;

#[derive(Debug, Clone)]
struct AiFeedbackRecordDraft {
    item_kind: String,
    item_id: String,
    status: String,
    note: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BookSummaryExportItem {
    book_id: String,
    title: String,
    author: Option<String>,
    prompt_version: String,
    input_hash: String,
    provider_model: Option<String>,
    cached_updated_at: String,
    summary: BookAiSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AiCredentialMetadata {
    last_validated_at: Option<String>,
    last_validation_error: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct AiOutputUpsert {
    pub feature: String,
    pub scope_id: String,
    pub prompt_version: String,
    pub input_hash: String,
    pub output: Value,
    pub source_count: Option<i64>,
    pub provider_model: Option<String>,
}

#[derive(Debug, Clone)]
pub enum AiServiceError {
    InvalidCredential(String),
    InvalidProviderSettings(String),
    MissingCredential,
    RemovalNotConfirmed,
    InvalidCacheKey(String),
    SourceNotes(String),
    ProviderNetwork(String),
    ProviderResponse(String),
    InvalidProviderOutput(String),
    Storage(String),
}

impl AiServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidCredential(_) => "invalid_ai_credential",
            Self::InvalidProviderSettings(_) => "invalid_ai_provider_settings",
            Self::MissingCredential => "ai_credential_missing",
            Self::RemovalNotConfirmed => "ai_removal_not_confirmed",
            Self::InvalidCacheKey(_) => "invalid_ai_cache_key",
            Self::SourceNotes(_) => "ai_source_notes_error",
            Self::ProviderNetwork(_) => "ai_provider_network_error",
            Self::ProviderResponse(_) => "ai_provider_response_error",
            Self::InvalidProviderOutput(_) => "ai_provider_output_error",
            Self::Storage(_) => "ai_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidCredential(message)
            | Self::InvalidProviderSettings(message)
            | Self::InvalidCacheKey(message)
            | Self::SourceNotes(message)
            | Self::InvalidProviderOutput(message) => message.clone(),
            Self::MissingCredential => "还没有保存 AI API Key。".to_string(),
            Self::RemovalNotConfirmed => "移除 AI 凭据需要显式确认。".to_string(),
            Self::ProviderNetwork(message) => provider_network_user_message(message),
            Self::ProviderResponse(message) => message.clone(),
            Self::Storage(_) => "本地 AI 设置或缓存暂时不可用，请稍后重试。".to_string(),
        }
    }

    fn storage(error: impl fmt::Display) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct AiService {
    app: AppHandle,
}

impl AiService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn settings_state(&self) -> Result<AiSettingsState, AiServiceError> {
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        let has_credential = store
            .get(API_KEY_RECORD)
            .map_err(AiServiceError::storage)?
            .is_some();
        let metadata = read_metadata(
            store
                .get(METADATA_RECORD)
                .map_err(AiServiceError::storage)?,
        );
        let provider = read_provider_settings(
            store
                .get(PROVIDER_SETTINGS_RECORD)
                .map_err(AiServiceError::storage)?,
        );

        drop(stronghold);

        Ok(AiSettingsState {
            credential: AiCredentialStatus {
                has_credential,
                last_validated_at: metadata.last_validated_at,
                last_validation_error: metadata.last_validation_error,
            },
            provider,
        })
    }

    pub fn save_credential(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        model: Option<&str>,
        preset_id: Option<&str>,
        response_format_policy: Option<AiResponseFormatPolicy>,
    ) -> Result<AiSettingsState, AiServiceError> {
        self.save_settings(
            Some(api_key),
            base_url,
            model,
            preset_id,
            response_format_policy,
        )
    }

    pub fn save_settings(
        &self,
        api_key: Option<&str>,
        base_url: Option<&str>,
        model: Option<&str>,
        preset_id: Option<&str>,
        response_format_policy: Option<AiResponseFormatPolicy>,
    ) -> Result<AiSettingsState, AiServiceError> {
        let provider =
            normalize_provider_settings(base_url, model, preset_id, response_format_policy)?;
        let trimmed_key = api_key.map(str::trim).filter(|value| !value.is_empty());
        if let Some(next_key) = trimmed_key {
            let validation = Self::validate_credential_input(
                next_key,
                Some(&provider.base_url),
                Some(&provider.model),
                Some(&provider.preset_id),
                Some(provider.response_format_policy),
            );
            if !validation.is_valid {
                return Err(AiServiceError::InvalidCredential(
                    validation
                        .message
                        .unwrap_or_else(|| "AI API Key 或 Provider 设置格式不正确。".to_string()),
                ));
            }
        }

        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        let had_credential = store
            .get(API_KEY_RECORD)
            .map_err(AiServiceError::storage)?
            .is_some();
        let existing_metadata = read_metadata(
            store
                .get(METADATA_RECORD)
                .map_err(AiServiceError::storage)?,
        );

        if let Some(next_key) = trimmed_key {
            store
                .insert(API_KEY_RECORD.to_vec(), next_key.as_bytes().to_vec(), None)
                .map_err(AiServiceError::storage)?;
        }

        store
            .insert(
                PROVIDER_SETTINGS_RECORD.to_vec(),
                serde_json::to_vec(&provider).map_err(AiServiceError::storage)?,
                None,
            )
            .map_err(AiServiceError::storage)?;

        let metadata = if trimmed_key.is_some() {
            AiCredentialMetadata {
                last_validated_at: Some(current_unix_seconds()),
                last_validation_error: None,
            }
        } else {
            existing_metadata
        };
        store
            .insert(
                METADATA_RECORD.to_vec(),
                serde_json::to_vec(&metadata).map_err(AiServiceError::storage)?,
                None,
            )
            .map_err(AiServiceError::storage)?;
        stronghold.save().map_err(AiServiceError::storage)?;

        Ok(AiSettingsState {
            credential: AiCredentialStatus {
                has_credential: trimmed_key.is_some() || had_credential,
                last_validated_at: metadata.last_validated_at,
                last_validation_error: metadata.last_validation_error,
            },
            provider,
        })
    }

    pub fn remove_credential(&self, confirm: bool) -> Result<AiSettingsState, AiServiceError> {
        if !confirm {
            return Err(AiServiceError::RemovalNotConfirmed);
        }

        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        let provider = read_provider_settings(
            store
                .get(PROVIDER_SETTINGS_RECORD)
                .map_err(AiServiceError::storage)?,
        );
        store
            .delete(API_KEY_RECORD)
            .map_err(AiServiceError::storage)?;
        store
            .delete(METADATA_RECORD)
            .map_err(AiServiceError::storage)?;
        stronghold.save().map_err(AiServiceError::storage)?;

        Ok(AiSettingsState {
            credential: AiCredentialStatus {
                has_credential: false,
                last_validated_at: None,
                last_validation_error: None,
            },
            provider,
        })
    }

    pub(crate) fn read_api_key(&self) -> Result<String, AiServiceError> {
        let (_stronghold, client) = self.open_client()?;
        let store = client.store();
        match store.get(API_KEY_RECORD).map_err(AiServiceError::storage)? {
            Some(bytes) => String::from_utf8(bytes).map_err(AiServiceError::storage),
            None => Err(AiServiceError::MissingCredential),
        }
    }

    pub fn get_cached_output(
        &self,
        feature: String,
        scope_id: String,
        prompt_version: String,
        input_hash: String,
    ) -> Result<Option<AiCachedOutputRecord>, AiServiceError> {
        let key = normalize_cache_key(feature, scope_id, prompt_version, input_hash)?;
        let connection = self.open_connection()?;

        read_ai_output(
            &connection,
            &key.feature,
            &key.scope_id,
            &key.prompt_version,
            &key.input_hash,
        )
    }

    pub async fn summarize_book_notes(
        &self,
        book_id: String,
        regenerate: bool,
        update_from: Option<BookAiSummaryUpdateContext>,
    ) -> Result<BookAiSummaryResponse, AiServiceError> {
        let notes = NotesService::new(self.app.clone())
            .get_book_notes(book_id)
            .await
            .map_err(AiServiceError::from_source_notes)?;
        let update_context = if regenerate {
            self.book_summary_update_context(&notes.book_id, update_from)?
        } else {
            None
        };
        let summary_input = build_summary_input(&notes, update_context.as_ref())?;
        let input_hash = stable_hash_json(&summary_input.payload)?;
        let source_stats = summary_input.source_stats.clone();

        if notes.exportable_count == 0 {
            return Ok(empty_summary_response(
                &notes.book_id,
                &input_hash,
                source_stats,
            ));
        }

        if !regenerate {
            if let Some(cached) = self.get_cached_output(
                BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                notes.book_id.clone(),
                BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash.clone(),
            )? {
                return cached_summary_response(&notes.book_id, &input_hash, cached, None);
            }
        }

        let provider = self.settings_state()?.provider;
        let api_key = require_ai_credential_for_uncached_summary(self.read_api_key())?;
        let result = request_book_notes_summary(&api_key, &provider, &summary_input.payload).await;
        let generated_summary = match result {
            Ok(result) => normalize_summary_output(
                result.value,
                source_stats,
                current_unix_seconds(),
                BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                result.response_format,
            )?,
            Err(error) => {
                if let Some(cached) = self.latest_cached_output(
                    BOOK_NOTES_SUMMARY_FEATURE,
                    &notes.book_id,
                    BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                )? {
                    return cached_summary_response(
                        &notes.book_id,
                        &input_hash,
                        cached,
                        Some(error.user_message()),
                    );
                }

                return Err(error);
            }
        };

        let cached = self.upsert_cached_output(AiOutputUpsert {
            feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
            scope_id: notes.book_id.clone(),
            prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
            input_hash: input_hash.clone(),
            output: serde_json::to_value(&generated_summary).map_err(AiServiceError::storage)?,
            source_count: Some((notes.highlights.len() + notes.thoughts.len()) as i64),
            provider_model: Some(provider.model.clone()),
        })?;

        cached_summary_response(&notes.book_id, &input_hash, cached, None).map(|mut response| {
            response.source = BookAiSummarySource::Generated;
            response.provider_model = Some(provider.model);
            response
        })
    }

    fn book_summary_update_context(
        &self,
        book_id: &str,
        update_from: Option<BookAiSummaryUpdateContext>,
    ) -> Result<Option<BookSummaryUpdateContext>, AiServiceError> {
        let connection = self.open_connection()?;
        resolve_book_summary_update_context(&connection, book_id, update_from)
    }

    pub fn get_latest_book_notes_summary(
        &self,
        book_id: String,
    ) -> Result<Option<BookAiSummaryResponse>, AiServiceError> {
        let notes = read_local_book_notes(&self.open_connection()?, &book_id)?;
        let summary_input = build_summary_input(&notes, None)?;
        let input_hash = stable_hash_json(&summary_input.payload)?;

        if notes.exportable_count == 0 {
            return Ok(None);
        }

        if let Some(cached) = self.get_cached_output(
            BOOK_NOTES_SUMMARY_FEATURE.to_string(),
            notes.book_id.clone(),
            BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
            input_hash.clone(),
        )? {
            return cached_summary_response(&notes.book_id, &input_hash, cached, None).map(Some);
        }

        if let Some(cached) = self.latest_cached_output(
            BOOK_NOTES_SUMMARY_FEATURE,
            &notes.book_id,
            BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        )? {
            return cached_summary_response(
                &notes.book_id,
                &input_hash,
                cached,
                Some("当前笔记较上次复盘已有变化，已先展示本书最近一次缓存；如需更新，请点击重新生成。".to_string()),
            )
            .map(Some);
        }

        Ok(None)
    }

    pub fn list_book_notes_summaries(&self) -> Result<Vec<BookAiSummaryListItem>, AiServiceError> {
        let connection = self.open_connection()?;
        read_book_summary_list(&connection)
    }

    pub fn list_ai_asset_summaries(&self) -> Result<Vec<AiAssetSummary>, AiServiceError> {
        let connection = self.open_connection()?;
        read_ai_asset_summaries(&connection)
    }

    pub fn get_ai_asset_detail(
        &self,
        book_id: String,
    ) -> Result<Option<AiAssetDetail>, AiServiceError> {
        let connection = self.open_connection()?;
        read_ai_asset_detail(&connection, &book_id)
    }

    pub fn get_ai_asset_version_detail(
        &self,
        feature: String,
        scope_id: String,
        input_hash: String,
    ) -> Result<Option<AiAssetVersionDetail>, AiServiceError> {
        let connection = self.open_connection()?;
        read_ai_asset_version_detail(&connection, &feature, &scope_id, &input_hash)
    }

    pub fn get_ai_asset_version_history(
        &self,
        feature: String,
        scope_id: String,
    ) -> Result<Vec<AiAssetVersionSummary>, AiServiceError> {
        let connection = self.open_connection()?;
        read_ai_asset_version_history(&connection, &feature, &scope_id)
    }

    pub fn get_ai_review_feedback(
        &self,
        feature: String,
        scope_id: String,
        input_hash: String,
    ) -> Result<AiReviewFeedbackState, AiServiceError> {
        let connection = self.open_connection()?;
        read_ai_review_feedback(&connection, &feature, &scope_id, &input_hash)
    }

    pub fn save_ai_review_feedback(
        &self,
        feature: String,
        scope_id: String,
        input_hash: String,
        feedback: AiReviewFeedbackState,
    ) -> Result<AiReviewFeedbackState, AiServiceError> {
        let mut connection = self.open_connection()?;
        save_ai_review_feedback(&mut connection, &feature, &scope_id, &input_hash, feedback)
    }

    pub fn export_book_notes_summary_markdown(
        &self,
        book_id: String,
        review_feedback: Option<AiReviewFeedbackExport>,
    ) -> Result<ExportAiMarkdownResponse, AiServiceError> {
        let response = self
            .get_latest_book_notes_summary(book_id.clone())?
            .ok_or_else(|| {
                AiServiceError::InvalidProviderOutput(
                    "当前书还没有可导出的 AI 总结缓存，请先生成或读取缓存。".to_string(),
                )
            })?;
        let notes = read_local_book_notes(&self.open_connection()?, &book_id)?;
        let title = notes
            .book
            .as_ref()
            .map(|book| book.title.as_str())
            .unwrap_or(notes.book_id.as_str());
        let author = notes.book.as_ref().and_then(|book| book.author.as_deref());
        let exported_at = current_unix_seconds();
        let stored_feedback = read_ai_review_feedback(
            &self.open_connection()?,
            "book-review",
            &notes.book_id,
            &response.input_hash,
        )?;
        let merged_feedback = match review_feedback {
            Some(feedback) => merge_ai_review_feedback(stored_feedback, feedback),
            None => stored_feedback,
        };
        let markdown = serialize_book_ai_summary_markdown(
            &notes.book_id,
            title,
            author,
            &response,
            &exported_at,
            Some(&merged_feedback),
        );

        self.write_ai_markdown_export(
            &format!("{}-ai-summary", sanitize_file_stem(title, &notes.book_id)),
            &exported_at,
            markdown,
        )
    }

    pub fn export_book_notes_summaries_markdown(
        &self,
        book_ids: Option<Vec<String>>,
        options: Option<BookNotesSummariesExportOptions>,
    ) -> Result<ExportAiBulkMarkdownResponse, AiServiceError> {
        let connection = self.open_connection()?;
        let normalized_book_ids = normalize_optional_book_ids(book_ids);
        let export_items =
            read_book_summary_export_items(&connection, normalized_book_ids.as_deref())?;
        let markdown_options = BookAiSummaryMarkdownOptions::from(options.unwrap_or_default());

        if export_items.is_empty() {
            return Err(AiServiceError::InvalidProviderOutput(
                "没有可导出的书籍复盘缓存。请先在书籍复盘页生成至少一本复盘。".to_string(),
            ));
        }

        let exported_at = current_unix_seconds();
        let export_id = format!("wxreadmaster-book-reviews-{exported_at}");
        let export_dir = db::active_export_dir(&self.app)
            .map_err(AiServiceError::storage)?
            .join(&export_id);
        fs::create_dir_all(&export_dir).map_err(AiServiceError::storage)?;

        let mut files = Vec::with_capacity(export_items.len() + 1);
        let mut indexed_items = Vec::with_capacity(export_items.len());

        for item in export_items {
            let response = BookAiSummaryResponse {
                book_id: item.book_id.clone(),
                prompt_version: item.prompt_version.clone(),
                input_hash: item.input_hash.clone(),
                provider_model: item.provider_model.clone(),
                source: BookAiSummarySource::Cache,
                summary: item.summary.clone(),
                cached_updated_at: Some(item.cached_updated_at.clone()),
                error_message: None,
            };
            let review_feedback = read_ai_review_feedback(
                &connection,
                "book-review",
                &item.book_id,
                &item.input_hash,
            )?;
            let file_name = format!(
                "{}-ai-summary-{exported_at}.md",
                sanitize_file_stem(&item.title, &item.book_id)
            );
            let markdown = serialize_book_ai_summary_markdown_with_options(
                &item.book_id,
                &item.title,
                item.author.as_deref(),
                &response,
                &exported_at,
                Some(&review_feedback),
                markdown_options,
            );
            fs::write(export_dir.join(&file_name), markdown).map_err(AiServiceError::storage)?;
            files.push(file_name.clone());
            indexed_items.push((file_name, item));
        }

        let index_markdown =
            serialize_book_summary_export_index(&export_id, &exported_at, &indexed_items);
        fs::write(export_dir.join("index.md"), index_markdown).map_err(AiServiceError::storage)?;
        files.push("index.md".to_string());

        Ok(ExportAiBulkMarkdownResponse {
            export_id,
            path: export_dir.to_string_lossy().to_string(),
            exported_at,
            files,
            item_count: indexed_items.len(),
        })
    }

    pub async fn summarize_reading_stats(
        &self,
        mode: Option<String>,
        base_time: Option<i64>,
        regenerate: bool,
    ) -> Result<ReadingStatsAiReviewResponse, AiServiceError> {
        let stats_response = StatsService::new(self.app.clone())
            .get_reading_stats(mode, base_time)
            .await
            .map_err(AiServiceError::from_source_stats)?;
        let review_input = build_reading_stats_review_input(&stats_response.stats)?;
        let input_hash = stable_hash_json(&review_input.payload)?;
        let scope_id = reading_stats_scope_id(&stats_response.stats);
        let source_stats = review_input.source_stats.clone();

        if is_empty_reading_stats(&stats_response.stats) {
            return Ok(empty_reading_stats_review_response(
                &stats_response.stats,
                &input_hash,
                source_stats,
            ));
        }

        if !regenerate {
            if let Some(cached) = self.get_cached_output(
                READING_STATS_REVIEW_FEATURE.to_string(),
                scope_id.clone(),
                READING_STATS_REVIEW_PROMPT_VERSION.to_string(),
                input_hash.clone(),
            )? {
                return cached_reading_stats_review_response(
                    &stats_response.stats,
                    &input_hash,
                    cached,
                    None,
                );
            }

            if let Some(cached) = self.latest_cached_output(
                READING_STATS_REVIEW_FEATURE,
                &scope_id,
                READING_STATS_REVIEW_PROMPT_VERSION,
            )? {
                return cached_reading_stats_review_response(
                    &stats_response.stats,
                    &input_hash,
                    cached,
                    Some("当前统计数据较上次复盘有变化，已先展示同周期最近一次缓存；如需更新，请点击重新生成。".to_string()),
                );
            }
        }

        let provider = self.settings_state()?.provider;
        let api_key = self.read_api_key()?;
        let result = request_ai_json_with_schema_fallback(
            &api_key,
            &provider,
            reading_stats_review_system_prompt(),
            &review_input.payload,
            "reading_stats_review_response",
            reading_stats_review_json_schema(),
        )
        .await;
        let generated_review = match result {
            Ok(result) => normalize_reading_stats_review_output(
                result.value,
                source_stats,
                current_unix_seconds(),
                READING_STATS_REVIEW_PROMPT_VERSION,
                result.response_format,
            )?,
            Err(error) => {
                if let Some(cached) = self.latest_cached_output(
                    READING_STATS_REVIEW_FEATURE,
                    &scope_id,
                    READING_STATS_REVIEW_PROMPT_VERSION,
                )? {
                    return cached_reading_stats_review_response(
                        &stats_response.stats,
                        &input_hash,
                        cached,
                        Some(error.user_message()),
                    );
                }

                return Err(error);
            }
        };

        let cached = self.upsert_cached_output(AiOutputUpsert {
            feature: READING_STATS_REVIEW_FEATURE.to_string(),
            scope_id,
            prompt_version: READING_STATS_REVIEW_PROMPT_VERSION.to_string(),
            input_hash: input_hash.clone(),
            output: serde_json::to_value(&generated_review).map_err(AiServiceError::storage)?,
            source_count: Some(reading_stats_source_count(&stats_response.stats)),
            provider_model: Some(provider.model.clone()),
        })?;

        cached_reading_stats_review_response(&stats_response.stats, &input_hash, cached, None).map(
            |mut response| {
                response.source = BookAiSummarySource::Generated;
                response.provider_model = Some(provider.model);
                response
            },
        )
    }

    pub async fn get_latest_reading_stats_review(
        &self,
        mode: Option<String>,
        base_time: Option<i64>,
    ) -> Result<Option<ReadingStatsAiReviewResponse>, AiServiceError> {
        let stats_response = StatsService::new(self.app.clone())
            .get_reading_stats(mode, base_time)
            .await
            .map_err(AiServiceError::from_source_stats)?;
        let review_input = build_reading_stats_review_input(&stats_response.stats)?;
        let input_hash = stable_hash_json(&review_input.payload)?;
        let scope_id = reading_stats_scope_id(&stats_response.stats);

        if is_empty_reading_stats(&stats_response.stats) {
            return Ok(None);
        }

        if let Some(cached) = self.get_cached_output(
            READING_STATS_REVIEW_FEATURE.to_string(),
            scope_id.clone(),
            READING_STATS_REVIEW_PROMPT_VERSION.to_string(),
            input_hash.clone(),
        )? {
            return cached_reading_stats_review_response(
                &stats_response.stats,
                &input_hash,
                cached,
                None,
            )
            .map(Some);
        }

        if let Some(cached) = self.latest_cached_output(
            READING_STATS_REVIEW_FEATURE,
            &scope_id,
            READING_STATS_REVIEW_PROMPT_VERSION,
        )? {
            return cached_reading_stats_review_response(
                &stats_response.stats,
                &input_hash,
                cached,
                Some("当前统计数据较上次复盘有变化，已先展示同周期最近一次缓存；如需更新，请点击重新生成。".to_string()),
            )
            .map(Some);
        }

        Ok(None)
    }

    pub async fn export_reading_stats_review_markdown(
        &self,
        mode: Option<String>,
        base_time: Option<i64>,
    ) -> Result<ExportAiMarkdownResponse, AiServiceError> {
        let response = self
            .get_latest_reading_stats_review(mode, base_time)
            .await?
            .ok_or_else(|| {
                AiServiceError::InvalidProviderOutput(
                    "当前周期还没有可导出的 AI 复盘缓存，请先生成或读取缓存。".to_string(),
                )
            })?;
        let stats_response = StatsService::new(self.app.clone())
            .get_reading_stats(Some(response.mode.clone()), Some(response.base_time))
            .await
            .map_err(AiServiceError::from_source_stats)?;
        let resolved_persona = resolve_reading_persona(
            &stats_response.stats,
            response.review.reading_persona.as_ref(),
        );
        let exported_at = current_unix_seconds();
        let markdown = serialize_reading_stats_review_markdown(
            &response,
            Some(&resolved_persona),
            &exported_at,
        );
        let period_label = match response.mode.as_str() {
            "weekly" => "weekly-reading-review",
            "annually" => "annual-reading-review",
            "overall" => "overall-reading-review",
            _ => "monthly-reading-review",
        };

        self.write_ai_markdown_export(period_label, &exported_at, markdown)
    }

    pub async fn summarize_reading_route(
        &self,
        request: ReadingRouteRequest,
        regenerate: bool,
        update_from: Option<ReadingRouteUpdateContext>,
    ) -> Result<ReadingRouteResponse, AiServiceError> {
        let connection = self.open_connection()?;
        let base_route_input = build_reading_route_input(&connection, request.clone(), None)?;
        let update_context = reading_route_update_context(
            &connection,
            &base_route_input.scope_id,
            update_from,
            regenerate,
        )?;
        let route_input = if update_context.is_some() {
            build_reading_route_input(&connection, request, update_context.as_ref())?
        } else {
            base_route_input
        };
        let input_hash = stable_hash_json(&route_input.payload)?;

        if !regenerate {
            if let Some(cached) = self.get_cached_output(
                READING_ROUTE_FEATURE.to_string(),
                route_input.scope_id.clone(),
                READING_ROUTE_PROMPT_VERSION.to_string(),
                input_hash.clone(),
            )? {
                return cached_reading_route_response(
                    &route_input.book_id,
                    &route_input.scope_id,
                    &input_hash,
                    cached,
                    Some(route_input.current_stage.clone()),
                    None,
                );
            }

            if let Some(cached) = self.latest_cached_output(
                READING_ROUTE_FEATURE,
                &route_input.scope_id,
                READING_ROUTE_PROMPT_VERSION,
            )? {
                return cached_reading_route_response(
                    &route_input.book_id,
                    &route_input.scope_id,
                    &input_hash,
                    cached,
                    Some(route_input.current_stage.clone()),
                    Some("当前指南输入较上次生成有变化，已先展示最近一次缓存；如需更新，请点击重新生成。".to_string()),
                );
            }
        }

        let provider = self.settings_state()?.provider;
        let api_key = self.read_api_key()?;
        let result = request_ai_json_with_schema_fallback(
            &api_key,
            &provider,
            reading_route_system_prompt(),
            &route_input.payload,
            "reading_route_response",
            reading_route_json_schema(),
        )
        .await;
        let generated_route = match result {
            Ok(result) => normalize_reading_route_output(
                result.value,
                route_input.allowed_book_ids,
                route_input.source_stats.clone(),
                Some(route_input.current_stage.clone()),
                current_unix_seconds(),
                READING_ROUTE_PROMPT_VERSION,
                result.response_format,
            )?,
            Err(error) => {
                if let Some(cached) = self.latest_cached_output(
                    READING_ROUTE_FEATURE,
                    &route_input.scope_id,
                    READING_ROUTE_PROMPT_VERSION,
                )? {
                    return cached_reading_route_response(
                        &route_input.book_id,
                        &route_input.scope_id,
                        &input_hash,
                        cached,
                        Some(route_input.current_stage.clone()),
                        Some(error.user_message()),
                    );
                }

                return Err(error);
            }
        };

        let cached = self.upsert_cached_output(AiOutputUpsert {
            feature: READING_ROUTE_FEATURE.to_string(),
            scope_id: route_input.scope_id.clone(),
            prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
            input_hash: input_hash.clone(),
            output: serde_json::to_value(&generated_route).map_err(AiServiceError::storage)?,
            source_count: Some(reading_route_source_count(&route_input.source_stats)),
            provider_model: Some(provider.model.clone()),
        })?;

        cached_reading_route_response(
            &route_input.book_id,
            &route_input.scope_id,
            &input_hash,
            cached,
            Some(route_input.current_stage.clone()),
            None,
        )
        .map(|mut response| {
            response.source = BookAiSummarySource::Generated;
            response.provider_model = Some(provider.model);
            response
        })
    }

    pub fn get_latest_reading_route(
        &self,
        request: ReadingRouteRequest,
    ) -> Result<Option<ReadingRouteResponse>, AiServiceError> {
        let route_input = build_reading_route_input(&self.open_connection()?, request, None)?;
        let input_hash = stable_hash_json(&route_input.payload)?;

        if let Some(cached) = self.get_cached_output(
            READING_ROUTE_FEATURE.to_string(),
            route_input.scope_id.clone(),
            READING_ROUTE_PROMPT_VERSION.to_string(),
            input_hash.clone(),
        )? {
            return cached_reading_route_response(
                &route_input.book_id,
                &route_input.scope_id,
                &input_hash,
                cached,
                Some(route_input.current_stage.clone()),
                None,
            )
            .map(Some);
        }

        if let Some(cached) = self.latest_cached_output(
            READING_ROUTE_FEATURE,
            &route_input.scope_id,
            READING_ROUTE_PROMPT_VERSION,
        )? {
            return cached_reading_route_response(
                &route_input.book_id,
                &route_input.scope_id,
                &input_hash,
                cached,
                Some(route_input.current_stage.clone()),
                Some("当前指南输入较上次生成有变化，已先展示最近一次缓存；如需更新，请点击重新生成。".to_string()),
            )
            .map(Some);
        }

        Ok(None)
    }

    pub fn export_reading_route_markdown(
        &self,
        request: ReadingRouteRequest,
    ) -> Result<ExportAiMarkdownResponse, AiServiceError> {
        let response = self.get_latest_reading_route(request)?.ok_or_else(|| {
            AiServiceError::InvalidProviderOutput(
                "当前书还没有可导出的 AI 阅读指南缓存，请先生成或读取缓存。".to_string(),
            )
        })?;
        let exported_at = current_unix_seconds();
        let title = response
            .route
            .books
            .first()
            .map(|book| book.title.as_str())
            .unwrap_or(response.book_id.as_str());
        let markdown = serialize_reading_route_markdown(&response, &exported_at);

        self.write_ai_markdown_export(
            &format!(
                "{}-reading-route",
                sanitize_file_stem(title, &response.book_id)
            ),
            &exported_at,
            markdown,
        )
    }

    pub async fn summarize_book_decision(
        &self,
        candidates: Vec<BookDecisionCandidateInput>,
        goal: Option<String>,
        regenerate: bool,
    ) -> Result<BookDecisionResponse, AiServiceError> {
        let decision_input = build_book_decision_input(&self.open_connection()?, candidates, goal)?;
        let input_hash = stable_hash_json(&decision_input.payload)?;

        if !regenerate {
            if let Some(cached) = self.get_cached_output(
                BOOK_DECISION_FEATURE.to_string(),
                decision_input.scope_id.clone(),
                BOOK_DECISION_PROMPT_VERSION.to_string(),
                input_hash.clone(),
            )? {
                return cached_book_decision_response(
                    &decision_input.scope_id,
                    &input_hash,
                    cached,
                    None,
                );
            }

            if let Some(cached) = self.latest_cached_output(
                BOOK_DECISION_FEATURE,
                &decision_input.scope_id,
                BOOK_DECISION_PROMPT_VERSION,
            )? {
                return cached_book_decision_response(
                    &decision_input.scope_id,
                    &input_hash,
                    cached,
                    Some("当前候选书输入较上次生成有变化，已先展示最近一次缓存；如需更新，请点击重新生成。".to_string()),
                );
            }
        }

        let provider = self.settings_state()?.provider;
        let api_key = self.read_api_key()?;
        let result = request_ai_json_with_schema_fallback(
            &api_key,
            &provider,
            book_decision_system_prompt(),
            &decision_input.payload,
            "book_decision_response",
            book_decision_json_schema(),
        )
        .await;
        let generated_decision = match result {
            Ok(result) => normalize_book_decision_output(
                result.value,
                decision_input.allowed_book_ids,
                decision_input.source_stats.clone(),
                current_unix_seconds(),
                BOOK_DECISION_PROMPT_VERSION,
                result.response_format,
            )?,
            Err(error) => {
                if let Some(cached) = self.latest_cached_output(
                    BOOK_DECISION_FEATURE,
                    &decision_input.scope_id,
                    BOOK_DECISION_PROMPT_VERSION,
                )? {
                    return cached_book_decision_response(
                        &decision_input.scope_id,
                        &input_hash,
                        cached,
                        Some(error.user_message()),
                    );
                }

                return Err(error);
            }
        };

        let cached = self.upsert_cached_output(AiOutputUpsert {
            feature: BOOK_DECISION_FEATURE.to_string(),
            scope_id: decision_input.scope_id.clone(),
            prompt_version: BOOK_DECISION_PROMPT_VERSION.to_string(),
            input_hash: input_hash.clone(),
            output: serde_json::to_value(&generated_decision).map_err(AiServiceError::storage)?,
            source_count: Some(book_decision_source_count(&decision_input.source_stats)),
            provider_model: Some(provider.model.clone()),
        })?;

        cached_book_decision_response(&decision_input.scope_id, &input_hash, cached, None).map(
            |mut response| {
                response.source = BookAiSummarySource::Generated;
                response.provider_model = Some(provider.model);
                response
            },
        )
    }

    pub fn get_latest_book_decision(
        &self,
        candidates: Vec<BookDecisionCandidateInput>,
        goal: Option<String>,
    ) -> Result<Option<BookDecisionResponse>, AiServiceError> {
        let decision_input = build_book_decision_input(&self.open_connection()?, candidates, goal)?;
        let input_hash = stable_hash_json(&decision_input.payload)?;

        if let Some(cached) = self.get_cached_output(
            BOOK_DECISION_FEATURE.to_string(),
            decision_input.scope_id.clone(),
            BOOK_DECISION_PROMPT_VERSION.to_string(),
            input_hash.clone(),
        )? {
            return cached_book_decision_response(
                &decision_input.scope_id,
                &input_hash,
                cached,
                None,
            )
            .map(Some);
        }

        if let Some(cached) = self.latest_cached_output(
            BOOK_DECISION_FEATURE,
            &decision_input.scope_id,
            BOOK_DECISION_PROMPT_VERSION,
        )? {
            return cached_book_decision_response(
                &decision_input.scope_id,
                &input_hash,
                cached,
                Some("当前候选书输入较上次生成有变化，已先展示最近一次缓存；如需更新，请点击重新生成。".to_string()),
            )
            .map(Some);
        }

        Ok(None)
    }

    pub fn export_book_decision_markdown(
        &self,
        candidates: Vec<BookDecisionCandidateInput>,
        goal: Option<String>,
    ) -> Result<ExportAiMarkdownResponse, AiServiceError> {
        let response = self
            .get_latest_book_decision(candidates, goal)?
            .ok_or_else(|| {
                AiServiceError::InvalidProviderOutput(
                    "当前候选书还没有可导出的选书决策缓存，请先生成。".to_string(),
                )
            })?;
        let exported_at = current_unix_seconds();
        let title = response
            .decision
            .top_candidates
            .first()
            .map(|book| book.title.as_str())
            .unwrap_or("下一本书取舍");
        let markdown = serialize_book_decision_markdown(&response, &exported_at);

        self.write_ai_markdown_export(
            &format!(
                "{}-book-decision",
                sanitize_file_stem(title, &response.scope_id)
            ),
            &exported_at,
            markdown,
        )
    }

    pub async fn ask_local_reader_selection_question(
        &self,
        request: LocalReaderSelectionQuestionInput,
    ) -> Result<LocalReaderSelectionQuestionResponse, AiServiceError> {
        let question_input = build_local_reader_selection_question_input(request)?;
        let input_hash = stable_hash_json(&question_input.payload)?;

        if let Some(cached) = self.get_cached_output(
            LOCAL_READER_SELECTION_QA_FEATURE.to_string(),
            question_input.scope_id.clone(),
            LOCAL_READER_SELECTION_QA_PROMPT_VERSION.to_string(),
            input_hash.clone(),
        )? {
            return cached_local_reader_selection_question_response(
                question_input.source_item,
                &input_hash,
                cached,
                None,
            );
        }

        let provider = self.settings_state()?.provider;
        let api_key = self.read_api_key()?;
        let result = request_ai_json_with_schema_fallback(
            &api_key,
            &provider,
            local_reader_selection_question_system_prompt(),
            &question_input.payload,
            "local_reader_selection_question_response",
            local_reader_selection_question_json_schema(),
        )
        .await?;
        let generated_answer = normalize_local_reader_selection_answer_output(
            result.value,
            current_unix_seconds(),
            LOCAL_READER_SELECTION_QA_PROMPT_VERSION,
            result.response_format,
        )?;

        let cached = self.upsert_cached_output(AiOutputUpsert {
            feature: LOCAL_READER_SELECTION_QA_FEATURE.to_string(),
            scope_id: question_input.scope_id.clone(),
            prompt_version: LOCAL_READER_SELECTION_QA_PROMPT_VERSION.to_string(),
            input_hash: input_hash.clone(),
            output: serde_json::to_value(&generated_answer).map_err(AiServiceError::storage)?,
            source_count: Some(1),
            provider_model: Some(provider.model.clone()),
        })?;

        cached_local_reader_selection_question_response(
            question_input.source_item,
            &input_hash,
            cached,
            None,
        )
        .map(|mut response| {
            response.source = BookAiSummarySource::Generated;
            response.provider_model = Some(provider.model);
            response
        })
    }

    pub(crate) fn upsert_cached_output(
        &self,
        draft: AiOutputUpsert,
    ) -> Result<AiCachedOutputRecord, AiServiceError> {
        let key = normalize_cache_key(
            draft.feature,
            draft.scope_id,
            draft.prompt_version,
            draft.input_hash,
        )?;
        let updated_at = current_unix_seconds();
        let connection = self.open_connection()?;
        let normalized = AiOutputUpsert {
            feature: key.feature,
            scope_id: key.scope_id,
            prompt_version: key.prompt_version,
            input_hash: key.input_hash,
            output: draft.output,
            source_count: draft.source_count,
            provider_model: draft.provider_model,
        };

        upsert_ai_output(&connection, &normalized, &updated_at)?;
        read_ai_output(
            &connection,
            &normalized.feature,
            &normalized.scope_id,
            &normalized.prompt_version,
            &normalized.input_hash,
        )?
        .ok_or_else(|| AiServiceError::Storage("AI output was not persisted".to_string()))
    }

    pub fn validate_credential_input(
        api_key: &str,
        base_url: Option<&str>,
        model: Option<&str>,
        preset_id: Option<&str>,
        response_format_policy: Option<AiResponseFormatPolicy>,
    ) -> AiCredentialValidationResult {
        let checked_at = current_unix_seconds();
        if let Some(message) = Self::validate_api_key_input(api_key) {
            return AiCredentialValidationResult {
                is_valid: false,
                checked_at,
                message: Some(message),
            };
        }

        if let Err(error) =
            normalize_provider_settings(base_url, model, preset_id, response_format_policy)
        {
            return AiCredentialValidationResult {
                is_valid: false,
                checked_at,
                message: Some(error.user_message()),
            };
        }

        AiCredentialValidationResult {
            is_valid: true,
            checked_at,
            message: None,
        }
    }

    fn validate_api_key_input(api_key: &str) -> Option<String> {
        let trimmed_key = api_key.trim();

        if trimmed_key.is_empty() {
            return Some("AI API Key 不能为空。".to_string());
        }

        if trimmed_key.len() < 16 {
            return Some("AI API Key 长度过短。".to_string());
        }

        if trimmed_key.chars().any(char::is_whitespace) {
            return Some("AI API Key 不能包含空白字符。".to_string());
        }

        None
    }

    pub async fn test_connection(
        &self,
        api_key: Option<&str>,
        base_url: Option<&str>,
        model: Option<&str>,
        preset_id: Option<&str>,
        response_format_policy: Option<AiResponseFormatPolicy>,
    ) -> Result<AiCredentialValidationResult, AiServiceError> {
        let checked_at = current_unix_seconds();
        let provider =
            match normalize_provider_settings(base_url, model, preset_id, response_format_policy) {
                Ok(settings) => settings,
                Err(error) => {
                    return Ok(AiCredentialValidationResult {
                        is_valid: false,
                        checked_at,
                        message: Some(error.user_message()),
                    });
                }
            };
        let trimmed_input_key = api_key.map(str::trim).filter(|value| !value.is_empty());
        let key = match trimmed_input_key {
            Some(value) => value.to_string(),
            None => match self.read_api_key() {
                Ok(value) => value,
                Err(AiServiceError::MissingCredential) => {
                    return Ok(AiCredentialValidationResult {
                        is_valid: false,
                        checked_at,
                        message: Some(
                            "还没有保存 AI API Key，也没有输入新的 AI API Key。".to_string(),
                        ),
                    });
                }
                Err(error) => return Err(error),
            },
        };

        let validation = Self::validate_credential_input(
            &key,
            Some(&provider.base_url),
            Some(&provider.model),
            Some(&provider.preset_id),
            Some(provider.response_format_policy),
        );
        if !validation.is_valid {
            return Ok(AiCredentialValidationResult {
                is_valid: false,
                checked_at,
                message: validation.message,
            });
        }

        match request_ai_connection_test(&key, &provider).await {
            Ok(()) => Ok(AiCredentialValidationResult {
                is_valid: true,
                checked_at,
                message: Some("AI Provider 连通性测试通过。".to_string()),
            }),
            Err(error) => Ok(AiCredentialValidationResult {
                is_valid: false,
                checked_at,
                message: Some(error.user_message()),
            }),
        }
    }

    pub async fn probe_provider_capabilities(
        &self,
        api_key: Option<&str>,
        base_url: Option<&str>,
        model: Option<&str>,
        preset_id: Option<&str>,
        response_format_policy: Option<AiResponseFormatPolicy>,
    ) -> Result<AiProviderCapabilityProbe, AiServiceError> {
        let checked_at = current_unix_seconds();
        let provider =
            match normalize_provider_settings(base_url, model, preset_id, response_format_policy) {
                Ok(settings) => settings,
                Err(error) => {
                    return Ok(AiProviderCapabilityProbe {
                        basic: AiProviderCapabilityStatus::Failed,
                        json_object: AiProviderCapabilityStatus::Skipped,
                        json_schema: AiProviderCapabilityStatus::Skipped,
                        recommended_policy: AiResponseFormatPolicy::Auto,
                        checked_at,
                        message: Some(error.user_message()),
                    });
                }
            };
        let trimmed_input_key = api_key.map(str::trim).filter(|value| !value.is_empty());
        let key = match trimmed_input_key {
            Some(value) => value.to_string(),
            None => match self.read_api_key() {
                Ok(value) => value,
                Err(AiServiceError::MissingCredential) => {
                    return Ok(AiProviderCapabilityProbe {
                        basic: AiProviderCapabilityStatus::Failed,
                        json_object: AiProviderCapabilityStatus::Skipped,
                        json_schema: AiProviderCapabilityStatus::Skipped,
                        recommended_policy: provider.response_format_policy,
                        checked_at,
                        message: Some(
                            "还没有保存 AI API Key，也没有输入新的 AI API Key。".to_string(),
                        ),
                    });
                }
                Err(error) => return Err(error),
            },
        };

        let validation = Self::validate_credential_input(
            &key,
            Some(&provider.base_url),
            Some(&provider.model),
            Some(&provider.preset_id),
            Some(provider.response_format_policy),
        );
        if !validation.is_valid {
            return Ok(AiProviderCapabilityProbe {
                basic: AiProviderCapabilityStatus::Failed,
                json_object: AiProviderCapabilityStatus::Skipped,
                json_schema: AiProviderCapabilityStatus::Skipped,
                recommended_policy: provider.response_format_policy,
                checked_at,
                message: validation.message,
            });
        }

        Ok(probe_ai_provider_capabilities(&key, &provider, checked_at).await)
    }

    pub async fn list_provider_models(
        &self,
        api_key: Option<&str>,
        base_url: Option<&str>,
    ) -> Result<AiProviderModelListResponse, AiServiceError> {
        let fetched_at = current_unix_seconds();
        let base_url = normalize_provider_base_url(base_url)?;
        let trimmed_input_key = api_key.map(str::trim).filter(|value| !value.is_empty());
        let key = match trimmed_input_key {
            Some(value) => value.to_string(),
            None => self.read_api_key()?,
        };

        let validation = Self::validate_api_key_input(&key);
        if let Some(message) = validation {
            return Err(AiServiceError::InvalidCredential(message));
        }

        request_ai_provider_models(&key, &base_url, fetched_at).await
    }

    fn open_client(&self) -> Result<(Stronghold, Client), AiServiceError> {
        let data_dir = self
            .app
            .path()
            .app_local_data_dir()
            .map_err(AiServiceError::storage)?;
        fs::create_dir_all(&data_dir).map_err(AiServiceError::storage)?;

        let vault_path = data_dir.join("ai-credentials.hold");
        let salt_path = data_dir.join("stronghold-ai-salt.txt");
        let vault_key = KeyDerivation::argon2(VAULT_PASSWORD, &salt_path);
        let stronghold =
            Stronghold::new(&vault_path, vault_key).map_err(AiServiceError::storage)?;
        let client = stronghold
            .load_client(CLIENT_PATH)
            .or_else(|_| stronghold.create_client(CLIENT_PATH))
            .map_err(AiServiceError::storage)?;

        Ok((stronghold, client))
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AiServiceError> {
        db::open_connection(&self.app).map_err(AiServiceError::Storage)
    }

    fn latest_cached_output(
        &self,
        feature: &str,
        scope_id: &str,
        prompt_version: &str,
    ) -> Result<Option<AiCachedOutputRecord>, AiServiceError> {
        let connection = self.open_connection()?;
        read_latest_ai_output(&connection, feature, scope_id, prompt_version)
    }

    fn write_ai_markdown_export(
        &self,
        file_stem: &str,
        exported_at: &str,
        markdown: String,
    ) -> Result<ExportAiMarkdownResponse, AiServiceError> {
        let export_dir = db::active_export_dir(&self.app).map_err(AiServiceError::storage)?;
        fs::create_dir_all(&export_dir).map_err(AiServiceError::storage)?;

        let file_name = format!("{file_stem}-{exported_at}.md");
        let path = export_dir.join(&file_name);
        fs::write(&path, markdown).map_err(AiServiceError::storage)?;

        Ok(ExportAiMarkdownResponse {
            file_name,
            path: path.to_string_lossy().to_string(),
            exported_at: exported_at.to_string(),
        })
    }
}

impl AiServiceError {
    fn from_source_notes(error: AppError) -> Self {
        Self::SourceNotes(error.user_message())
    }

    fn from_source_stats(error: AppError) -> Self {
        Self::SourceNotes(error.user_message())
    }
}

#[derive(Debug, Clone)]
struct SummaryInput {
    payload: Value,
    source_stats: BookAiSummarySourceStats,
}

#[derive(Debug, Clone)]
struct BookSummaryUpdateContext {
    source_input_hash: String,
    feedback: AiReviewFeedbackState,
}

#[derive(Debug, Clone)]
struct ReadingRouteUpdateContextData {
    source_input_hash: String,
    feedback: AiReviewFeedbackState,
}

#[derive(Debug, Clone)]
struct ReadingStatsReviewInput {
    payload: Value,
    source_stats: ReadingStatsAiReviewSourceStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaInput {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    palette_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    accent_tone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    confidence: Option<f64>,
    basis_notice: String,
    dimensions: Vec<ReadingPersonaDimensionInput>,
    evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPersonaDimensionInput {
    axis: String,
    key: String,
    label: String,
    strength: String,
    basis: String,
}

#[derive(Debug, Clone)]
struct ReadingPersonaSignals {
    total_read_time_seconds: f64,
    read_days: i64,
    category_count: usize,
    active_bucket_count: usize,
    stable_bucket_share: f64,
    top_category_title: Option<String>,
    top_category_share: f64,
    top3_category_share: f64,
    top_item_title: Option<String>,
    top_item_share: f64,
    author_concentration: f64,
    compare: f64,
    practical_score: f64,
    conceptual_score: f64,
    analytical_score: f64,
    resonant_score: f64,
    top_signals_text: String,
}

#[derive(Debug, Clone)]
struct ReadingRouteInput {
    book_id: String,
    scope_id: String,
    payload: Value,
    source_stats: ReadingRouteSourceStats,
    allowed_book_ids: HashSet<String>,
    current_stage: ReadingStageSignal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStageSignal {
    stage: String,
    label: String,
    progress_percent: i64,
    refresh_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ChapterSignals {
    has_cached_chapters: bool,
    chapter_count: usize,
    current_chapter_uid: Option<i64>,
    current_chapter_title: Option<String>,
    fallback: String,
}

#[derive(Debug, Clone)]
struct BookDecisionInput {
    scope_id: String,
    payload: Value,
    source_stats: BookDecisionSourceStats,
    allowed_book_ids: HashSet<String>,
}

#[derive(Debug, Clone)]
struct LocalReaderSelectionQuestionBuildInput {
    source_item: SourceItemInput,
    scope_id: String,
    payload: Value,
}

async fn request_book_notes_summary(
    api_key: &str,
    provider: &AiProviderSettings,
    input: &Value,
) -> Result<ProviderJsonResult, AiServiceError> {
    request_ai_json_with_schema_fallback(
        api_key,
        provider,
        book_notes_summary_system_prompt(),
        input,
        "book_notes_summary_response",
        book_notes_summary_json_schema(),
    )
    .await
}

async fn request_ai_json(
    api_key: &str,
    provider: &AiProviderSettings,
    system_prompt: &str,
    input: &Value,
) -> Result<ProviderJsonResult, AiServiceError> {
    match request_ai_json_with_response_format(
        api_key,
        provider,
        system_prompt,
        input,
        default_json_object_response_format(),
        AiResponseFormatKind::JsonObject,
    )
    .await
    {
        Ok(value) => Ok(value),
        Err(AiServiceError::ProviderResponse(message))
            if is_unsupported_response_format_response(&message) =>
        {
            request_ai_json_without_response_format(api_key, provider, system_prompt, input).await
        }
        Err(error) => Err(error),
    }
}

async fn request_ai_json_with_schema_fallback(
    api_key: &str,
    provider: &AiProviderSettings,
    system_prompt: &str,
    input: &Value,
    schema_name: &str,
    schema: Value,
) -> Result<ProviderJsonResult, AiServiceError> {
    match provider.response_format_policy {
        AiResponseFormatPolicy::JsonObjectFirst => {
            return request_ai_json(api_key, provider, system_prompt, input).await;
        }
        AiResponseFormatPolicy::NoResponseFormatFirst => {
            return request_ai_json_without_response_format(
                api_key,
                provider,
                system_prompt,
                input,
            )
            .await;
        }
        AiResponseFormatPolicy::Auto | AiResponseFormatPolicy::JsonSchemaFirst => {}
    }

    let schema_response_format = json!({
        "type": "json_schema",
        "json_schema": {
            "name": schema_name,
            "strict": true,
            "schema": schema
        }
    });

    match request_ai_json_with_response_format(
        api_key,
        provider,
        system_prompt,
        input,
        schema_response_format,
        AiResponseFormatKind::JsonSchema,
    )
    .await
    {
        Ok(value) => Ok(value),
        Err(AiServiceError::ProviderResponse(message))
            if is_unsupported_json_schema_response(&message) =>
        {
            request_ai_json(api_key, provider, system_prompt, input).await
        }
        Err(error) => Err(error),
    }
}

async fn request_ai_json_without_response_format(
    api_key: &str,
    provider: &AiProviderSettings,
    system_prompt: &str,
    input: &Value,
) -> Result<ProviderJsonResult, AiServiceError> {
    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(AI_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(AiServiceError::storage)?;
    let response = client
        .post(chat_completions_url(&provider.base_url))
        .bearer_auth(api_key)
        .json(&build_chat_completion_payload_without_response_format(
            &provider.model,
            system_prompt,
            input,
        ))
        .send()
        .await
        .map_err(|error| AiServiceError::ProviderNetwork(error.to_string()))?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|error| {
        if status.is_success() {
            AiServiceError::ProviderResponse(safe_provider_decode_message(error))
        } else {
            AiServiceError::ProviderNetwork(format!("HTTP {}", status.as_u16()))
        }
    })?;

    extract_chat_completion_json(status, value).map(|value| ProviderJsonResult {
        value,
        response_format: None,
    })
}

async fn request_ai_json_with_response_format(
    api_key: &str,
    provider: &AiProviderSettings,
    system_prompt: &str,
    input: &Value,
    response_format: Value,
    response_format_kind: AiResponseFormatKind,
) -> Result<ProviderJsonResult, AiServiceError> {
    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(AI_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(AiServiceError::storage)?;
    let response = client
        .post(chat_completions_url(&provider.base_url))
        .bearer_auth(api_key)
        .json(&build_chat_completion_payload(
            &provider.model,
            system_prompt,
            input,
            response_format,
        ))
        .send()
        .await
        .map_err(|error| AiServiceError::ProviderNetwork(error.to_string()))?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|error| {
        if status.is_success() {
            AiServiceError::ProviderResponse(safe_provider_decode_message(error))
        } else {
            AiServiceError::ProviderNetwork(format!("HTTP {}", status.as_u16()))
        }
    })?;

    extract_chat_completion_json(status, value).map(|value| ProviderJsonResult {
        value,
        response_format: Some(response_format_kind),
    })
}

async fn request_ai_connection_test(
    api_key: &str,
    provider: &AiProviderSettings,
) -> Result<(), AiServiceError> {
    let payload = json!({
        "model": provider.model,
        "temperature": 0,
        "max_tokens": 20,
        "messages": [
            {
                "role": "user",
                "content": "请只回复 ok"
            }
        ]
    });

    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(AiServiceError::storage)?;
    let response = client
        .post(chat_completions_url(&provider.base_url))
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|error| AiServiceError::ProviderNetwork(error.to_string()))?;
    let status = response.status();

    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(AiServiceError::ProviderResponse(
            "AI API Key 无效或无权访问当前模型，请在设置中更新。".to_string(),
        ));
    }

    if status.is_success() {
        return Ok(());
    }

    let value = response.json::<Value>().await.ok();
    if let Some(value) = value {
        return Err(provider_response_status_error(status, &value));
    }

    Err(AiServiceError::ProviderNetwork(format!(
        "HTTP {}",
        status.as_u16()
    )))
}

fn provider_response_status_error(status: StatusCode, value: &Value) -> AiServiceError {
    if let Some(error_message) = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        return AiServiceError::ProviderResponse(format!(
            "AI Provider 返回 HTTP {}：{}",
            status.as_u16(),
            error_message.trim()
        ));
    }

    AiServiceError::ProviderNetwork(format!("HTTP {}", status.as_u16()))
}

async fn request_ai_provider_models(
    api_key: &str,
    base_url: &str,
    fetched_at: String,
) -> Result<AiProviderModelListResponse, AiServiceError> {
    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(AiServiceError::storage)?;
    let response = client
        .get(models_url(base_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| AiServiceError::ProviderNetwork(error.to_string()))?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|error| {
        if status.is_success() {
            AiServiceError::ProviderResponse(safe_provider_decode_message(error))
        } else {
            AiServiceError::ProviderNetwork(format!("HTTP {}", status.as_u16()))
        }
    })?;

    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(AiServiceError::ProviderResponse(
            "AI API Key 无效或无权读取模型列表，请在设置中更新。".to_string(),
        ));
    }

    if !status.is_success() {
        return Err(provider_response_status_error(status, &value));
    }

    let mut models = parse_provider_model_list(&value)?;
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    let message = if models.is_empty() {
        Some("Provider 未返回可用模型，仍可手动输入模型名。".to_string())
    } else {
        None
    };

    Ok(AiProviderModelListResponse {
        models,
        fetched_at,
        message,
    })
}

fn parse_provider_model_list(
    value: &Value,
) -> Result<Vec<AiProviderModelListItem>, AiServiceError> {
    let data = value.get("data").and_then(Value::as_array).ok_or_else(|| {
        AiServiceError::InvalidProviderOutput("模型列表响应缺少 data 数组。".to_string())
    })?;

    Ok(data
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?.trim();
            if id.is_empty() {
                return None;
            }

            Some(AiProviderModelListItem {
                id: id.to_string(),
                owned_by: item
                    .get("owned_by")
                    .or_else(|| item.get("ownedBy"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string),
            })
        })
        .collect())
}

async fn probe_ai_provider_capabilities(
    api_key: &str,
    provider: &AiProviderSettings,
    checked_at: String,
) -> AiProviderCapabilityProbe {
    let basic_result = request_ai_connection_test(api_key, provider).await;
    if let Err(error) = basic_result {
        return AiProviderCapabilityProbe {
            basic: AiProviderCapabilityStatus::Failed,
            json_object: AiProviderCapabilityStatus::Skipped,
            json_schema: AiProviderCapabilityStatus::Skipped,
            recommended_policy: AiResponseFormatPolicy::NoResponseFormatFirst,
            checked_at,
            message: Some(error.user_message()),
        };
    }

    let json_object_result =
        request_ai_response_format_probe(api_key, provider, default_json_object_response_format())
            .await;
    let json_schema_result = request_ai_response_format_probe(
        api_key,
        provider,
        json!({
            "type": "json_schema",
            "json_schema": {
                "name": "provider_capability_probe",
                "strict": true,
                "schema": provider_capability_probe_json_schema()
            }
        }),
    )
    .await;

    let json_object = status_from_probe_result(&json_object_result);
    let json_schema = status_from_probe_result(&json_schema_result);
    let recommended_policy = recommend_response_format_policy(json_object, json_schema);
    let message = build_provider_capability_probe_message(
        &json_object_result,
        &json_schema_result,
        recommended_policy,
    );

    AiProviderCapabilityProbe {
        basic: AiProviderCapabilityStatus::Passed,
        json_object,
        json_schema,
        recommended_policy,
        checked_at,
        message,
    }
}

async fn request_ai_response_format_probe(
    api_key: &str,
    provider: &AiProviderSettings,
    response_format: Value,
) -> Result<(), AiServiceError> {
    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(AiServiceError::storage)?;
    let response = client
        .post(chat_completions_url(&provider.base_url))
        .bearer_auth(api_key)
        .json(&build_chat_completion_probe_payload(
            &provider.model,
            Some(response_format),
        ))
        .send()
        .await
        .map_err(|error| AiServiceError::ProviderNetwork(error.to_string()))?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|error| {
        if status.is_success() {
            AiServiceError::ProviderResponse(safe_provider_decode_message(error))
        } else {
            AiServiceError::ProviderNetwork(format!("HTTP {}", status.as_u16()))
        }
    })?;

    extract_chat_completion_json(status, value).map(|_| ())
}

fn build_chat_completion_probe_payload(model: &str, response_format: Option<Value>) -> Value {
    let mut payload = json!({
        "model": model,
        "temperature": 0,
        "max_tokens": 30,
        "messages": [
            {
                "role": "system",
                "content": "只输出一个 JSON 对象，不要 Markdown。"
            },
            {
                "role": "user",
                "content": "请回复 {\"ok\":true}"
            }
        ]
    });

    if let Some(response_format) = response_format {
        payload["response_format"] = response_format;
    }

    payload
}

fn provider_capability_probe_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "ok": {
                "type": "boolean"
            }
        },
        "required": ["ok"]
    })
}

fn status_from_probe_result(result: &Result<(), AiServiceError>) -> AiProviderCapabilityStatus {
    match result {
        Ok(()) => AiProviderCapabilityStatus::Passed,
        Err(_) => AiProviderCapabilityStatus::Failed,
    }
}

fn recommend_response_format_policy(
    json_object: AiProviderCapabilityStatus,
    json_schema: AiProviderCapabilityStatus,
) -> AiResponseFormatPolicy {
    if json_schema == AiProviderCapabilityStatus::Passed {
        AiResponseFormatPolicy::JsonSchemaFirst
    } else if json_object == AiProviderCapabilityStatus::Passed {
        AiResponseFormatPolicy::JsonObjectFirst
    } else {
        AiResponseFormatPolicy::NoResponseFormatFirst
    }
}

fn build_provider_capability_probe_message(
    _json_object_result: &Result<(), AiServiceError>,
    _json_schema_result: &Result<(), AiServiceError>,
    recommended_policy: AiResponseFormatPolicy,
) -> Option<String> {
    match recommended_policy {
        AiResponseFormatPolicy::JsonSchemaFirst => {
            Some("当前模型支持严格结构化输出，可使用严格结构化模式。".to_string())
        }
        AiResponseFormatPolicy::JsonObjectFirst => {
            Some("当前模型不支持严格结构化输出，建议使用通用 JSON 模式。".to_string())
        }
        AiResponseFormatPolicy::NoResponseFormatFirst => {
            Some("结构化输出探测未通过，建议使用宽松兼容模式。".to_string())
        }
        AiResponseFormatPolicy::Auto => None,
    }
}

fn build_chat_completion_payload(
    model: &str,
    system_prompt: &str,
    input: &Value,
    response_format: Value,
) -> Value {
    json!({
        "model": model,
        "temperature": 0.2,
        "max_tokens": AI_JSON_MAX_TOKENS,
        "response_format": response_format,
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string())
            }
        ]
    })
}

fn build_chat_completion_payload_without_response_format(
    model: &str,
    system_prompt: &str,
    input: &Value,
) -> Value {
    json!({
        "model": model,
        "temperature": 0.2,
        "max_tokens": AI_JSON_MAX_TOKENS,
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string())
            }
        ]
    })
}

fn chat_completions_url(base_url: &str) -> String {
    let base_url = base_url.trim_end_matches('/');

    if base_url.ends_with("/chat/completions") {
        base_url.to_string()
    } else if base_url.ends_with("/v1") {
        format!("{base_url}/chat/completions")
    } else {
        format!("{base_url}/v1/chat/completions")
    }
}

fn models_url(base_url: &str) -> String {
    let base_url = base_url.trim_end_matches('/');

    if let Some(root) = base_url.strip_suffix("/chat/completions") {
        format!("{root}/models")
    } else if base_url.ends_with("/models") {
        base_url.to_string()
    } else if base_url.ends_with("/v1") {
        format!("{base_url}/models")
    } else {
        format!("{base_url}/v1/models")
    }
}

fn book_notes_summary_system_prompt() -> &'static str {
    "你是个人阅读复盘助手。只基于用户提供的当前书籍本地笔记生成总结，不补写未提供的书籍内容，不假装读过全文，不输出内部 ID。必须使用简体中文，只输出一个顶层 JSON 对象，不要 Markdown。顶层字段名必须使用英文 camelCase，且必须包含 overview、keyIdeas、myFocus、actionItems、themeTags、representativeQuotes、reflectionQuestions。overview 必须是字符串，写 3-5 句；keyIdeas 为 3-8 条字符串；myFocus 为字符串数组；actionItems 为字符串数组；themeTags 为 5-10 个短标签；representativeQuotes 为 3-6 条对象，每条包含 quote、reason、chapter、noteType，noteType 只能是“划线”或“想法”，quote 必须来自提供的划线或想法原文，可截短但不可改写；reflectionQuestions 为 3-6 个适合用户复盘的问题。如果输入里包含 updateContext，则必须优先参考上一版复盘的用户反馈，把已完成、暂不做、不适合和文字备注转化为新的总结依据，并避免重复生成已经明确完成或明确不适合的建议；可以额外返回 feedbackOutcomeSummary 对象，其中 summary 用 1-2 句整理上一版反馈沉淀出的阅读成果，appliedChanges 用 1-3 条说明本次如何调整建议，不得评价用户执行力、完成率或表现。如果笔记数量太少，必须在 overview 中说明总结依据有限。"
}

fn reading_stats_review_system_prompt() -> &'static str {
    "你是个人阅读数据复盘助手。只基于用户提供的微信读书结构化统计生成复盘，不编造未提供的阅读记录、书籍内容或评分，不输出内部 ID。必须使用简体中文，只输出一个顶层 JSON 对象，不要 Markdown。顶层字段名必须使用英文 camelCase，且必须包含 overview、rhythmInsights、preferenceInsights、focusItems、nextActions。overview 必须是字符串，写 2-4 句；rhythmInsights 为 2-5 条阅读节奏洞察；preferenceInsights 为 2-5 条偏好洞察；focusItems 为 2-5 条值得关注的书籍、类别或时间变化；nextActions 为 2-5 条可执行建议。如果输入中提供了 personaStatus、personaCode、personaLabel、personaDisplayTitle、personaPaletteGroup、personaAccentTone、personaConfidence、personaBasisNotice、personaDimensions、personaEvidence，这些字段已经由本地规则预先计算，你只能基于这些现成字段补充解释，不得重算、改写或否定本地给出的人格代码和证据。可以额外返回可选 readingPersona 对象；如果返回，该对象只能包含 summary 和 suggestion 两个字符串字段。readingPersona 里的 MBTI 表达只能作为阅读风格隐喻，不代表真实心理人格，不得输出心理诊断、真实性格定论、能力评价或人生建议；当 personaStatus 为 insufficient 或统计样本不足时，可以省略 readingPersona，或只说明依据有限。readingPersona.summary 建议写 1-2 句，描述这一周期更像怎样阅读；readingPersona.suggestion 只给 1 条温和建议，不要重复 nextActions。所有结论都必须能从统计字段推导，不能引用笔记正文，因为输入不包含笔记。严禁输出原始秒数字段名、原始秒数值或 Unix 时间戳；时间长度必须写成人类可读中文，例如“1小时58分钟”“6分钟”，日期必须写成“5月6日”“2026年5月”这类格式。优先使用输入里已经提供的 display 字段，不要复述 technical/raw 字段名。如果输入里提供了 displayPeriod，优先直接使用这个周期名称，不要改写成“本月”“今年”“当前周期”这类相对时间。"
}

fn reading_route_system_prompt() -> &'static str {
    "你是个人阅读指南规划助手。只基于用户提供的当前书、用户显式选择的候选书、已生成复盘摘要、结构化统计信号和本地状态生成建议，不编造未提供的书籍内容，不输出内部 ID 以外的隐私信息，不假装写回微信读书。必须使用简体中文，只输出一个顶层 JSON 对象，不要 Markdown。字段必须使用英文 camelCase，且必须包含 routeOverview、books、dependencies、reviewCheckpoints、nextActions、readingStage。readingStage 必须是对象，且必须包含 stage、label、progressPercent；其中 stage 和 label 必须与输入里的 currentBookStage 保持一致，progressPercent 必须使用当前书对应的进度值，不得自造新的阶段。routeOverview 必须是非空字符串，只写 1 句、60 字以内的主线结论，不写免责声明，不解释输入来源，不使用“目前只有/因此/由于缺少”这类过程说明；候选书为 0 时生成单本书阅读指南，必须像阅读处方：写清下一段先读哪里、带着什么问题读、读完交付什么；候选书大于 0 时生成跨书阅读路线图，聚焦多本书的先后关系。必须按输入里的 readingStage 进度阶段生成建议：starting/起步强调阅读目的和验证问题，framing/建立主线强调是否继续读和早期判断，deepening/深入推进强调核心问题和笔记沉淀，closing/收束整理强调复盘框架和输出产物，completed/完成归档强调生成复盘和归档。章节只能作为辅助依据；缺少章节、目录未缓存或 currentChapter 不可用时，必须回退到进度百分比、最近笔记、本地状态和已有复盘摘要继续生成，不得拒绝生成。不得生成逐章任务清单，不得承诺实时章节追踪，不得输出“每天自动读第 X 章”或后台自动安排。books 是推进步骤数组，每项必须包含 bookId、title、author、order、role、readingPurpose、estimatedEffort、localStatus、basis；只允许使用输入中出现的 bookId。单本书时 books[0].readingPurpose 必须是具体阅读任务，不写“建立习惯、沉淀模板、长期投入、可复用方法论”等空泛话术；estimatedEffort 必须包含明确时长或阅读时段；basis 优先写进度阶段、最近笔记、复盘依据和可用章节线索，能落到“当前进度/下一段/最近笔记章节”这类范围，但不能把章节作为强制任务。dependencies 是跨书依赖关系数组，每项包含 fromBookId、toBookId、reason；没有候选书或没有依赖返回空数组。reviewCheckpoints 是复盘点数组，每项包含 timing、question、suggestedOutput；单本书时 question 必须是一个可在阅读中验证的具体问题，suggestedOutput 必须包含数量或格式和验收标准，例如“写 3 条...并为每条...”。nextActions 是 2-5 条可执行下一步；每条以动词开头，并包含时间、范围或完成标准中的至少两项。所有依据必须来自输入里的摘要、候选书、统计或本地状态；如果候选书不足，把补充候选作为 nextActions，不要写进 routeOverview。如果输入里包含 updateContext，可以额外返回 feedbackOutcomeSummary 对象，其中 summary 用 1-2 句整理上一版反馈沉淀出的阅读成果，appliedChanges 用 1-3 条说明本次如何调整建议，不得评价用户执行力、完成率或表现。"
}

fn book_decision_system_prompt() -> &'static str {
    "你是个人选书决策助手。只基于用户提供的本地候选书、已生成复盘摘要、结构化统计信号和本地状态做取舍，不编造未提供的书籍内容，不推荐输入之外的书，不假装读取微信读书远端或写回微信读书。必须使用简体中文，只输出一个顶层 JSON 对象，不要 Markdown。字段必须使用英文 camelCase，且必须包含 decisionOverview、topCandidates、deferredCandidates、nextActions。输入里的 decisionGoal 是本次选书目标，必须影响 whyNow、tradeoff、estimatedEffort 和 nextActions 的侧重点，但不能扩大数据来源。decisionOverview 必须是 1-2 句，回答“下一本为什么先读它”。topCandidates 最多 3 本，每项必须包含 bookId、title、author、rank、whyNow、tradeoff、estimatedEffort、prerequisiteAction、reviewTrigger、basis；只允许使用输入中出现的 bookId。whyNow 必须说明为什么现在读，tradeoff 必须说明为什么暂缓其他选择或这个选择的代价，estimatedEffort 必须包含明确时长或阅读时段，prerequisiteAction 必须是读前动作，reviewTrigger 必须说明读到什么节点后产出什么复盘。deferredCandidates 是暂缓项数组，每项包含 bookId、title、reason。nextActions 是 2-5 条用户能直接照做的中文动作，必须包含打开详情、安排阅读时段、读后输出或复盘触发中的至少两类；每条必须是完整中文句子，不得输出 openDetails、scheduleReadingBlock、postReadReview 等内部动作码或驼峰命名 token。不要输出评分排行榜、年度计划、泛推荐书单或空泛话术。"
}

fn local_reader_selection_question_system_prompt() -> &'static str {
    "你是本地阅读器里的选区问答助手。只基于用户提供的 book、selection.text、selection.context.beforeText、selection.context.afterText 和 question 回答，不假装读过整本书，不补写未提供的上下文，不读取或输出本地路径、文件 hash、数据库路径、API Key、微信凭据或微信读书数据。必须使用简体中文，只输出一个顶层 JSON 对象，不要 Markdown。字段必须使用英文 camelCase，且必须包含 answer、keyPoints、followUpQuestions。answer 写 2-5 句，先直接回答用户问题，再说明依据来自选区或前后文；如果选区很短，例如人名、术语或半句话，必须优先结合前后文解释它在当前段落中的作用，不要只回复“无法判断”。只有当前选区和前后文都确实无法支持答案时，才说明“当前选区和前后文仍不足以判断”，并给出最小必要的不确定点。keyPoints 为 1-5 条要点，每条必须落到文本里的对象、动作、关系、转折或情绪，不写“信息不足”这类空要点。followUpQuestions 为 0-3 个可点击追问，必须是用户可以直接提交给 AI 的具体问题，避免“请选择更多文本”“请提供上下文”“包含某某的句子”这类操作说明；优先围绕当前段落继续追问人物关系、指代对象、作者态度、前后因果或概念含义。"
}

fn extract_chat_completion_json(status: StatusCode, value: Value) -> Result<Value, AiServiceError> {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(AiServiceError::ProviderResponse(
            "AI API Key 无效或无权访问当前模型，请在设置中更新。".to_string(),
        ));
    }

    if let Some(error_message) = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        if !status.is_success() {
            return Err(AiServiceError::ProviderResponse(format!(
                "AI Provider 返回 HTTP {}：{}",
                status.as_u16(),
                error_message.trim()
            )));
        }

        return Err(AiServiceError::ProviderResponse(error_message.to_string()));
    }

    if !status.is_success() {
        return Err(AiServiceError::ProviderNetwork(format!(
            "HTTP {}",
            status.as_u16()
        )));
    }

    if is_chat_completion_truncated(&value) {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 返回内容被模型截断，请重新生成或减少候选书数量。".to_string(),
        ));
    }

    let content = extract_chat_completion_content_text(&value).ok_or_else(|| {
        AiServiceError::ProviderResponse("AI 返回内容缺少可解析的 message.content。".to_string())
    })?;

    parse_provider_json_content(&content).map_err(|_| {
        AiServiceError::InvalidProviderOutput("AI 返回内容不是有效 JSON。".to_string())
    })
}

fn default_json_object_response_format() -> Value {
    json!({ "type": "json_object" })
}

fn book_notes_summary_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["overview", "keyIdeas", "myFocus", "actionItems", "themeTags", "representativeQuotes", "reflectionQuestions"],
        "properties": {
            "overview": { "type": "string" },
            "keyIdeas": {
                "type": "array",
                "items": { "type": "string" }
            },
            "myFocus": {
                "type": "array",
                "items": { "type": "string" }
            },
            "actionItems": {
                "type": "array",
                "items": { "type": "string" }
            },
            "themeTags": {
                "type": "array",
                "items": { "type": "string" }
            },
            "representativeQuotes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["quote", "reason", "noteType"],
                    "properties": {
                        "quote": { "type": "string" },
                        "reason": { "type": "string" },
                        "chapter": { "type": "string" },
                        "noteType": {
                            "type": "string",
                            "enum": ["划线", "想法"]
                        }
                    }
                }
            },
            "reflectionQuestions": {
                "type": "array",
                "items": { "type": "string" }
            },
            "feedbackOutcomeSummary": {
                "type": "object",
                "additionalProperties": false,
                "required": ["summary", "appliedChanges"],
                "properties": {
                    "summary": { "type": "string" },
                    "appliedChanges": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                }
            }
        }
    })
}

fn reading_stats_review_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["overview", "rhythmInsights", "preferenceInsights", "focusItems", "nextActions"],
        "properties": {
            "overview": { "type": "string" },
            "rhythmInsights": {
                "type": "array",
                "items": { "type": "string" }
            },
            "preferenceInsights": {
                "type": "array",
                "items": { "type": "string" }
            },
            "focusItems": {
                "type": "array",
                "items": { "type": "string" }
            },
            "nextActions": {
                "type": "array",
                "items": { "type": "string" }
            },
            "readingPersona": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "summary": { "type": "string" },
                    "suggestion": { "type": "string" }
                }
            }
        }
    })
}

fn reading_route_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["routeOverview", "books", "dependencies", "reviewCheckpoints", "nextActions", "readingStage"],
        "properties": {
            "routeOverview": { "type": "string" },
            "books": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["bookId", "title", "order", "role", "readingPurpose", "estimatedEffort", "basis"],
                    "properties": {
                        "bookId": { "type": "string" },
                        "title": { "type": "string" },
                        "author": { "type": "string" },
                        "order": { "type": "integer" },
                        "role": { "type": "string" },
                        "readingPurpose": { "type": "string" },
                        "estimatedEffort": { "type": "string" },
                        "localStatus": { "type": "string" },
                        "basis": { "type": "string" }
                    }
                }
            },
            "dependencies": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["fromBookId", "toBookId", "reason"],
                    "properties": {
                        "fromBookId": { "type": "string" },
                        "toBookId": { "type": "string" },
                        "reason": { "type": "string" }
                    }
                }
            },
            "reviewCheckpoints": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["timing", "question", "suggestedOutput"],
                    "properties": {
                        "timing": { "type": "string" },
                        "question": { "type": "string" },
                        "suggestedOutput": { "type": "string" }
                    }
                }
            },
            "nextActions": {
                "type": "array",
                "items": { "type": "string" }
            },
            "readingStage": {
                "type": "object",
                "additionalProperties": false,
                "required": ["stage", "label", "progressPercent"],
                "properties": {
                    "stage": {
                        "type": "string",
                        "enum": ["starting", "framing", "deepening", "closing", "completed"]
                    },
                    "label": { "type": "string" },
                    "progressPercent": { "type": "integer" },
                    "refreshReason": {
                        "type": "string",
                        "enum": ["stage_changed", "notes_changed", "stalled", "completed"]
                    }
                }
            },
            "feedbackOutcomeSummary": {
                "type": "object",
                "additionalProperties": false,
                "required": ["summary", "appliedChanges"],
                "properties": {
                    "summary": { "type": "string" },
                    "appliedChanges": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                }
            }
        }
    })
}

fn book_decision_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["decisionOverview", "topCandidates", "deferredCandidates", "nextActions"],
        "properties": {
            "decisionOverview": { "type": "string" },
            "topCandidates": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["bookId", "title", "rank", "whyNow", "tradeoff", "estimatedEffort", "prerequisiteAction", "reviewTrigger", "basis"],
                    "properties": {
                        "bookId": { "type": "string" },
                        "title": { "type": "string" },
                        "author": { "type": "string" },
                        "rank": { "type": "integer" },
                        "whyNow": { "type": "string" },
                        "tradeoff": { "type": "string" },
                        "estimatedEffort": { "type": "string" },
                        "prerequisiteAction": { "type": "string" },
                        "reviewTrigger": { "type": "string" },
                        "basis": { "type": "string" }
                    }
                }
            },
            "deferredCandidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["bookId", "title", "reason"],
                    "properties": {
                        "bookId": { "type": "string" },
                        "title": { "type": "string" },
                        "reason": { "type": "string" }
                    }
                }
            },
            "nextActions": {
                "type": "array",
                "items": { "type": "string" }
            }
        }
    })
}

fn local_reader_selection_question_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["answer", "keyPoints", "followUpQuestions"],
        "properties": {
            "answer": { "type": "string" },
            "keyPoints": {
                "type": "array",
                "items": { "type": "string" }
            },
            "followUpQuestions": {
                "type": "array",
                "items": { "type": "string" }
            }
        }
    })
}

fn is_unsupported_json_schema_response(message: &str) -> bool {
    is_unsupported_response_format_response(message)
}

fn is_unsupported_response_format_response(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    let mentions_schema = message.contains("json_schema")
        || message.contains("response_format")
        || message.contains("response format");
    let mentions_incompatibility = message.contains("unsupported")
        || message.contains("unavailable")
        || message.contains("not available")
        || message.contains("not supported")
        || message.contains("does not support")
        || message.contains("not support")
        || message.contains("invalid parameter")
        || message.contains("unknown parameter")
        || message.contains("invalid type")
        || message.contains("only supports");

    mentions_schema && mentions_incompatibility
}

fn parse_provider_json_content(content: &str) -> Result<Value, serde_json::Error> {
    let trimmed = content.trim();

    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => Ok(value),
        Err(error) => {
            let Some(json_text) = extract_first_json_value(trimmed) else {
                return Err(error);
            };

            serde_json::from_str::<Value>(json_text)
        }
    }
}

fn extract_first_json_value(content: &str) -> Option<&str> {
    let start = content.find(|character| character == '{' || character == '[')?;
    let opening = content[start..].chars().next()?;
    let closing = if opening == '{' { '}' } else { ']' };
    let mut depth = 0usize;
    let mut is_in_string = false;
    let mut is_escaped = false;

    for (offset, character) in content[start..].char_indices() {
        if is_in_string {
            if is_escaped {
                is_escaped = false;
                continue;
            }

            if character == '\\' {
                is_escaped = true;
            } else if character == '"' {
                is_in_string = false;
            }

            continue;
        }

        if character == '"' {
            is_in_string = true;
        } else if character == opening {
            depth += 1;
        } else if character == closing {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(&content[start..start + offset + character.len_utf8()]);
            }
        }
    }

    None
}

fn extract_chat_completion_content_text(value: &Value) -> Option<String> {
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))?;

    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(extract_chat_completion_content_part_text)
                .collect::<Vec<_>>()
                .join("");

            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

fn is_chat_completion_truncated(value: &Value) -> bool {
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(Value::as_str)
        == Some("length")
}

fn extract_chat_completion_content_part_text(part: &Value) -> Option<&str> {
    match part {
        Value::String(text) => Some(text.as_str()),
        Value::Object(_) => part.get("text").and_then(Value::as_str),
        _ => None,
    }
}

fn safe_provider_decode_message(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "AI 返回超时，请稍后重试。".to_string()
    } else {
        "AI 返回内容无法解析。".to_string()
    }
}

fn provider_network_user_message(message: &str) -> String {
    let trimmed = message.trim();

    if let Some(status) = trimmed.strip_prefix("HTTP ") {
        return format!(
            "AI Provider 请求失败（HTTP {status}）。请检查 Base URL 是否为 OpenAI-compatible 地址、模型是否可用，或稍后重试。"
        );
    }

    let lowercase = trimmed.to_ascii_lowercase();
    let reason = if lowercase.contains("timeout") || lowercase.contains("timed out") {
        "请求超时"
    } else if lowercase.contains("dns") || lowercase.contains("resolve") {
        "域名解析失败"
    } else if lowercase.contains("connection refused") || lowercase.contains("connect") {
        "连接被拒绝或无法建立连接"
    } else {
        "网络请求失败"
    };

    format!("AI Provider 无法连接（{reason}）。请检查 Base URL、网络代理、防火墙，或稍后重试。")
}

fn build_summary_input(
    notes: &BookNotesRecord,
    update_context: Option<&BookSummaryUpdateContext>,
) -> Result<SummaryInput, AiServiceError> {
    let source_stats = BookAiSummarySourceStats {
        highlight_count: notes.highlights.len(),
        thought_count: notes.thoughts.len(),
        bookmark_count: notes.bookmark_count,
        chapter_count: notes.chapters.len(),
        included_highlight_count: notes.highlights.len().min(MAX_SUMMARY_HIGHLIGHTS),
        included_thought_count: notes.thoughts.len().min(MAX_SUMMARY_THOUGHTS),
    };
    let reading_stage = notes
        .book
        .as_ref()
        .and_then(|book| book.reading_progress)
        .map(|progress| reading_stage_signal(progress, false));
    let book = notes.book.as_ref().map(|book| {
        json!({
            "bookId": notes.book_id,
            "title": book.title,
            "author": book.author,
            "readingProgress": book.reading_progress,
            "reviewCount": book.review_count,
            "noteCount": book.note_count,
            "bookmarkCount": book.bookmark_count,
            "totalNoteCount": book.total_note_count
        })
    });
    let highlights = notes
        .highlights
        .iter()
        .take(MAX_SUMMARY_HIGHLIGHTS)
        .map(|highlight| {
            json!({
                "type": "highlight",
                "chapterTitle": highlight.chapter_title,
                "text": truncate_text(&highlight.mark_text, MAX_NOTE_TEXT_CHARS),
                "createdAt": highlight.create_time
            })
        })
        .collect::<Vec<_>>();
    let thoughts = notes
        .thoughts
        .iter()
        .take(MAX_SUMMARY_THOUGHTS)
        .map(|thought| {
            json!({
                "type": "thought",
                "chapterTitle": thought.chapter_name,
                "text": truncate_text(&thought.content, MAX_NOTE_TEXT_CHARS),
                "abstractText": thought.abstract_text.as_deref().map(|text| truncate_text(text, MAX_NOTE_TEXT_CHARS)),
                "star": thought.star,
                "range": thought.range_text,
                "createdAt": thought.create_time
            })
        })
        .collect::<Vec<_>>();
    let chapter_groups = notes
        .chapter_groups
        .iter()
        .take(MAX_SUMMARY_CHAPTER_GROUPS)
        .map(|group| {
            json!({
                "title": group.title,
                "highlightCount": group.highlights.len(),
                "thoughtCount": group.thoughts.len()
            })
        })
        .collect::<Vec<_>>();
    let update_context_payload = update_context.map(book_summary_update_context_payload);
    let basis = if update_context_payload.is_some() {
        "基于当前书籍的本地划线和想法/点评，并参考上一版复盘的用户反馈生成。"
    } else {
        "基于当前书籍的本地划线和想法/点评生成，不包含全书全文。"
    };
    let mut payload = json!({
        "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        "basis": basis,
        "book": book.unwrap_or_else(|| json!({ "bookId": notes.book_id })),
        "sourceStats": source_stats,
        "readingStage": reading_stage,
        "bookmarkContentNotice": notes.bookmark_content_notice,
        "chapterGroups": chapter_groups,
        "notes": {
            "highlights": highlights,
            "thoughts": thoughts
        }
    });
    if let Some(update_context_payload) = update_context_payload {
        payload
            .as_object_mut()
            .expect("summary payload should be an object")
            .insert("updateContext".to_string(), update_context_payload);
    }

    Ok(SummaryInput {
        payload,
        source_stats,
    })
}

fn book_summary_update_context_payload(context: &BookSummaryUpdateContext) -> Value {
    json!({
        "sourceInputHash": context.source_input_hash,
        "instruction": "生成新版本时参考用户对上一版行动项和复盘问题的反馈：已完成可沉淀为进展，暂不做/不适合应减少重复建议，备注可作为新的反思输入。",
        "actionFeedback": feedback_records_payload(&context.feedback.action_items),
        "reflectionFeedback": feedback_records_payload(&context.feedback.reflection_questions)
    })
}

fn resolve_book_summary_update_context(
    connection: &rusqlite::Connection,
    book_id: &str,
    update_from: Option<BookAiSummaryUpdateContext>,
) -> Result<Option<BookSummaryUpdateContext>, AiServiceError> {
    let Some(update_from) = update_from else {
        return Ok(None);
    };

    if update_from.feature != "book-review" || update_from.scope_id != book_id {
        return Ok(None);
    }

    let feedback =
        read_ai_review_feedback(connection, "book-review", book_id, &update_from.input_hash)?;
    if !has_ai_review_or_reflection_feedback(&feedback) {
        return Ok(None);
    }

    Ok(Some(BookSummaryUpdateContext {
        source_input_hash: update_from.input_hash,
        feedback,
    }))
}

fn reading_route_update_context(
    connection: &rusqlite::Connection,
    scope_id: &str,
    update_from: Option<ReadingRouteUpdateContext>,
    regenerate: bool,
) -> Result<Option<ReadingRouteUpdateContextData>, AiServiceError> {
    let Some(update_from) = update_from else {
        return Ok(None);
    };

    if !regenerate || update_from.feature != "reading-route" || update_from.scope_id != scope_id {
        return Ok(None);
    }

    let feedback = read_ai_review_feedback(
        connection,
        "reading-route",
        scope_id,
        &update_from.input_hash,
    )?;
    if !has_ai_action_feedback(&feedback) {
        return Ok(None);
    }

    Ok(Some(ReadingRouteUpdateContextData {
        source_input_hash: update_from.input_hash,
        feedback,
    }))
}

fn reading_route_update_context_payload(context: &ReadingRouteUpdateContextData) -> Value {
    json!({
        "sourceInputHash": context.source_input_hash,
        "instruction": "生成新版本时参考用户对上一版阅读指南下一步行动的反馈：已完成可沉淀为进展，暂不做/不适合应减少重复建议，备注只作为用户阅读成果和路线调整依据。",
        "actionFeedback": feedback_records_payload(&context.feedback.action_items)
    })
}

fn feedback_records_payload(feedback: &HashMap<String, AiFeedbackExportRecord>) -> Vec<Value> {
    let mut records = feedback
        .iter()
        .map(|(item_id, record)| {
            json!({
                "itemId": item_id,
                "status": record.status,
                "note": record.note,
                "updatedAt": record.updated_at
            })
        })
        .collect::<Vec<_>>();

    records.sort_by(|left, right| {
        left.get("itemId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(
                right
                    .get("itemId")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
    });
    records
}

fn has_ai_review_or_reflection_feedback(feedback: &AiReviewFeedbackExport) -> bool {
    !feedback.action_items.is_empty() || !feedback.reflection_questions.is_empty()
}

fn has_ai_action_feedback(feedback: &AiReviewFeedbackExport) -> bool {
    !feedback.action_items.is_empty()
}

fn build_reading_stats_review_input(
    stats: &ReadingStatsRecord,
) -> Result<ReadingStatsReviewInput, AiServiceError> {
    let source_stats = ReadingStatsAiReviewSourceStats {
        mode: stats.mode.clone(),
        base_time: stats.base_time,
        read_days: stats.read_days,
        total_read_time_seconds: stats.total_read_time_seconds,
        day_average_read_time_seconds: stats.day_average_read_time_seconds,
        bucket_count: stats.buckets.len(),
        longest_item_count: stats.longest_items.len(),
        category_count: stats.categories.len(),
    };
    let buckets = stats
        .buckets
        .iter()
        .take(MAX_STATS_BUCKETS)
        .map(|bucket| {
            json!({
                "startTime": bucket.start_time,
                "readTimeSeconds": bucket.read_time_seconds,
                "displayDate": format_bucket_display_label(&stats.mode, bucket.start_time),
                "displayDuration": format_duration_readable(bucket.read_time_seconds)
            })
        })
        .collect::<Vec<_>>();
    let longest_items = stats
        .longest_items
        .iter()
        .take(MAX_STATS_RANK_ITEMS)
        .map(|item| {
            json!({
                "title": item.title,
                "author": item.author,
                "type": item.item_type,
                "readTimeSeconds": item.read_time_seconds,
                "displayDuration": format_duration_readable(item.read_time_seconds),
                "tags": item.tags
            })
        })
        .collect::<Vec<_>>();
    let categories = stats
        .categories
        .iter()
        .take(MAX_STATS_CATEGORIES)
        .map(|category| {
            json!({
                "title": category.title,
                "parentTitle": category.parent_title,
                "value": category.value,
                "readingTimeSeconds": category.reading_time_seconds,
                "readingCount": category.reading_count,
                "displayDuration": category.reading_time_seconds.map(format_duration_readable)
            })
        })
        .collect::<Vec<_>>();
    let persona = build_reading_persona_input(stats);
    let mut payload = json!({
        "promptVersion": READING_STATS_REVIEW_PROMPT_VERSION,
        "basis": "基于微信读书结构化阅读统计生成，不包含笔记正文、全书全文或原始 API 响应。",
        "mode": stats.mode,
        "baseTime": stats.base_time,
        "displayPeriod": format_stats_period(&stats.mode, stats.base_time),
        "summary": {
            "readDays": stats.read_days,
            "totalReadTimeSeconds": stats.total_read_time_seconds,
            "dayAverageReadTimeSeconds": stats.day_average_read_time_seconds,
            "compare": stats.compare,
            "displayTotalReadTime": stats.total_read_time_seconds.map(format_duration_readable),
            "displayDayAverageReadTime": stats
                .day_average_read_time_seconds
                .map(format_duration_readable)
        },
        "buckets": buckets,
        "longestItems": longest_items,
        "categories": categories
    });
    merge_reading_persona_into_payload(&mut payload, persona)?;

    Ok(ReadingStatsReviewInput {
        payload,
        source_stats,
    })
}

fn reading_persona_config() -> &'static ReadingPersonaConfig {
    READING_PERSONA_CONFIG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../src/reading-persona.config.json"))
            .expect("reading persona config should be valid JSON")
    })
}

fn reading_persona_basis_notice() -> &'static str {
    reading_persona_config().basis_notice.as_str()
}

fn reading_persona_thresholds() -> &'static ReadingPersonaThresholdsConfig {
    &reading_persona_config().thresholds
}

fn merge_reading_persona_into_payload(
    payload: &mut Value,
    persona: ReadingPersonaInput,
) -> Result<(), AiServiceError> {
    let Some(record) = payload.as_object_mut() else {
        return Err(AiServiceError::InvalidProviderOutput(
            "阅读复盘输入必须是 JSON 对象。".to_string(),
        ));
    };

    record.insert("personaStatus".to_string(), Value::String(persona.status));
    if let Some(code) = persona.code {
        record.insert("personaCode".to_string(), Value::String(code));
    }
    if let Some(label) = persona.label {
        record.insert("personaLabel".to_string(), Value::String(label));
    }
    if let Some(display_title) = persona.display_title {
        record.insert(
            "personaDisplayTitle".to_string(),
            Value::String(display_title),
        );
    }
    if let Some(palette_group) = persona.palette_group {
        record.insert(
            "personaPaletteGroup".to_string(),
            Value::String(palette_group),
        );
    }
    if let Some(accent_tone) = persona.accent_tone {
        record.insert("personaAccentTone".to_string(), Value::String(accent_tone));
    }
    if let Some(confidence) = persona.confidence {
        record.insert("personaConfidence".to_string(), json!(confidence));
    }
    record.insert(
        "personaBasisNotice".to_string(),
        Value::String(persona.basis_notice),
    );
    record.insert(
        "personaDimensions".to_string(),
        serde_json::to_value(persona.dimensions).map_err(AiServiceError::storage)?,
    );
    record.insert(
        "personaEvidence".to_string(),
        serde_json::to_value(persona.evidence).map_err(AiServiceError::storage)?,
    );

    Ok(())
}

pub fn resolve_reading_persona(
    stats: &ReadingStatsRecord,
    patch: Option<&ReadingPersonaPatch>,
) -> ReadingPersona {
    let mut persona = build_local_reading_persona(stats);
    let Some(patch) = patch else {
        return persona;
    };

    let summary = normalize_reading_persona_text(patch.summary.as_deref());
    let suggestion = normalize_reading_persona_text(patch.suggestion.as_deref());

    if persona.status == "insufficient" {
        persona.summary = summary;
        persona.suggestion = None;
        return persona;
    }

    if summary.is_some() {
        persona.summary = summary;
    }
    if suggestion.is_some() {
        persona.suggestion = suggestion;
    }

    persona
}

fn build_reading_persona_input(stats: &ReadingStatsRecord) -> ReadingPersonaInput {
    let persona = build_local_reading_persona(stats);

    ReadingPersonaInput {
        status: persona.status,
        code: persona.code,
        label: persona.label,
        display_title: persona.display_title,
        palette_group: persona.palette_group,
        accent_tone: persona.accent_tone,
        confidence: persona.confidence,
        basis_notice: persona.basis_notice,
        dimensions: persona
            .dimensions
            .into_iter()
            .map(reading_persona_dimension_to_input)
            .collect(),
        evidence: persona.evidence,
    }
}

fn build_local_reading_persona(stats: &ReadingStatsRecord) -> ReadingPersona {
    let signals = summarize_reading_persona_signals(stats);
    let dimensions = vec![
        build_reading_persona_energy_dimension(&signals),
        build_reading_persona_information_dimension(&signals),
        build_reading_persona_decision_dimension(&signals),
        build_reading_persona_lifestyle_dimension(&signals),
    ];
    let stable_dimension_count = dimensions
        .iter()
        .filter(|dimension| dimension.strength != "light")
        .count();
    let status = resolve_reading_persona_status(&signals, stable_dimension_count);

    if status == "insufficient" {
        return ReadingPersona {
            status: status.to_string(),
            code: None,
            label: None,
            display_title: None,
            palette_group: None,
            accent_tone: None,
            confidence: None,
            basis_notice: reading_persona_basis_notice().to_string(),
            dimensions: Vec::new(),
            evidence: Vec::new(),
            summary: Some("本期阅读样本较少，继续阅读后再生成阅读人格。".to_string()),
            suggestion: None,
        };
    }

    let code = dimensions
        .iter()
        .map(|dimension| dimension.key.as_str())
        .collect::<String>();
    let (label, palette_group, accent_tone) =
        reading_persona_definition(&code).unwrap_or_else(|| {
            let group = infer_reading_persona_palette_group(&code).to_string();
            let tone = accent_tone_for_reading_persona_group(&group).to_string();
            (reading_persona_config().fallback_label.clone(), group, tone)
        });
    let display_title = format!("{code} 型读者 · {label}");
    let exported_dimensions = dimensions
        .iter()
        .cloned()
        .map(reading_persona_dimension_from_input)
        .collect::<Vec<_>>();

    ReadingPersona {
        status: status.to_string(),
        code: Some(code.clone()),
        label: Some(label.clone()),
        display_title: Some(display_title),
        palette_group: Some(palette_group),
        accent_tone: Some(accent_tone),
        confidence: build_reading_persona_confidence(&dimensions, status),
        basis_notice: reading_persona_basis_notice().to_string(),
        dimensions: exported_dimensions.clone(),
        evidence: build_reading_persona_evidence(&signals, &dimensions, status),
        summary: Some(build_local_reading_persona_summary(
            &signals, &label, status,
        )),
        suggestion: build_local_reading_persona_suggestion(&signals, &exported_dimensions, status),
    }
}

fn reading_persona_dimension_from_input(
    dimension: ReadingPersonaDimensionInput,
) -> ReadingPersonaDimension {
    ReadingPersonaDimension {
        axis: dimension.axis,
        key: dimension.key,
        label: dimension.label,
        strength: dimension.strength,
        basis: dimension.basis,
    }
}

fn reading_persona_dimension_to_input(
    dimension: ReadingPersonaDimension,
) -> ReadingPersonaDimensionInput {
    ReadingPersonaDimensionInput {
        axis: dimension.axis,
        key: dimension.key,
        label: dimension.label,
        strength: dimension.strength,
        basis: dimension.basis,
    }
}

fn build_local_reading_persona_summary(
    signals: &ReadingPersonaSignals,
    persona_label: &str,
    status: &str,
) -> String {
    if status == "provisional" {
        return format!(
            "这段时间的阅读已经出现 {persona_label} 的倾向，但样本还不算充分，先把它当作当前阅读状态更合适。"
        );
    }

    if let Some(title) = signals.top_category_title.as_deref() {
        return format!(
            "这一周期的阅读更像围绕{title}主线持续推进，整体已经形成较稳定的阅读气质。"
        );
    }

    format!("这一周期的阅读已经形成较清晰的 {persona_label} 倾向。")
}

fn build_local_reading_persona_suggestion(
    signals: &ReadingPersonaSignals,
    dimensions: &[ReadingPersonaDimension],
    status: &str,
) -> Option<String> {
    if status == "insufficient" {
        return None;
    }

    if dimensions.first().map(|dimension| dimension.key.as_str()) == Some("I")
        && signals.top_category_share
            >= reading_persona_thresholds()
                .suggestion
                .introverted_min_top_category_share
    {
        return Some("下个周期可以补一本文学或社科短书，给当前主线增加一个横向参照。".to_string());
    }

    if dimensions.first().map(|dimension| dimension.key.as_str()) == Some("E") {
        return Some(
            "下个周期可以先锁定一条主线连续推进，避免多个方向同时展开后难以沉淀。".to_string(),
        );
    }

    if dimensions.get(3).map(|dimension| dimension.key.as_str()) == Some("P") {
        return Some("可以先固定 1 到 2 个阅读时段，再决定本月只重点推进哪一条主线。".to_string());
    }

    Some("继续保持当前节奏，并在读完重点内容后补一份短复盘，会更容易沉淀出稳定判断。".to_string())
}

fn normalize_reading_persona_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn summarize_reading_persona_signals(stats: &ReadingStatsRecord) -> ReadingPersonaSignals {
    let total_read_time_seconds = stats.total_read_time_seconds.unwrap_or(0).max(0) as f64;
    let read_days = stats.read_days.unwrap_or(0).max(0);
    let active_buckets = stats
        .buckets
        .iter()
        .filter(|bucket| bucket.read_time_seconds > 0)
        .collect::<Vec<_>>();
    let active_bucket_count = active_buckets.len();
    let bucket_average = if active_bucket_count > 0 {
        active_buckets
            .iter()
            .map(|bucket| bucket.read_time_seconds.max(0) as f64)
            .sum::<f64>()
            / active_bucket_count as f64
    } else {
        0.0
    };
    let stable_bucket_count = active_buckets
        .iter()
        .filter(|bucket| {
            bucket.read_time_seconds.max(0) as f64
                >= bucket_average * reading_persona_thresholds().stable_bucket_multiplier
        })
        .count();
    let stable_bucket_share =
        safe_reading_persona_ratio(stable_bucket_count as f64, active_bucket_count as f64);

    let mut categories = stats.categories.iter().collect::<Vec<_>>();
    categories.sort_by(|left, right| {
        category_value_for_reading_persona(right)
            .partial_cmp(&category_value_for_reading_persona(left))
            .unwrap_or(Ordering::Equal)
    });
    let category_total = categories
        .iter()
        .map(|category| category_value_for_reading_persona(category))
        .sum::<f64>();
    let top_category = categories.first().copied();
    let top_category_share = top_category.map_or(0.0, |category| {
        safe_reading_persona_ratio(category_value_for_reading_persona(category), category_total)
    });
    let top3_category_share = if category_total > 0.0 {
        safe_reading_persona_ratio(
            categories
                .iter()
                .take(3)
                .map(|category| category_value_for_reading_persona(category))
                .sum::<f64>(),
            category_total,
        )
    } else {
        0.0
    };

    let mut items = stats.longest_items.iter().collect::<Vec<_>>();
    items.sort_by(|left, right| right.read_time_seconds.cmp(&left.read_time_seconds));
    let item_total = items
        .iter()
        .map(|item| item.read_time_seconds.max(0) as f64)
        .sum::<f64>();
    let top_item = items.first().copied();
    let top_item_share = top_item.map_or(0.0, |item| {
        safe_reading_persona_ratio(item.read_time_seconds.max(0) as f64, item_total)
    });
    let mut author_map = HashMap::<String, f64>::new();
    for item in &items {
        let Some(author) = item
            .author
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        *author_map.entry(author.to_string()).or_insert(0.0) +=
            item.read_time_seconds.max(0) as f64;
    }
    let author_concentration = if item_total > 0.0 && !author_map.is_empty() {
        safe_reading_persona_ratio(author_map.values().copied().fold(0.0, f64::max), item_total)
    } else {
        0.0
    };

    let practical_score = sum_reading_persona_category_score(
        &stats.categories,
        &reading_persona_config().category_tokens.practical,
    );
    let conceptual_score = sum_reading_persona_category_score(
        &stats.categories,
        &reading_persona_config().category_tokens.conceptual,
    );
    let analytical_score = sum_reading_persona_category_score(
        &stats.categories,
        &reading_persona_config().category_tokens.analytical,
    );
    let resonant_score = sum_reading_persona_category_score(
        &stats.categories,
        &reading_persona_config().category_tokens.resonant,
    );
    let top_signals_text = [
        top_category.map(|category| category.title.as_str()),
        top_category.and_then(|category| category.parent_title.as_deref()),
        top_item.map(|item| item.title.as_str()),
    ]
    .into_iter()
    .flatten()
    .chain(
        top_item
            .map(|item| item.tags.iter().map(String::as_str).collect::<Vec<_>>())
            .unwrap_or_default(),
    )
    .filter(|value| !value.trim().is_empty())
    .collect::<Vec<_>>()
    .join("|");

    ReadingPersonaSignals {
        total_read_time_seconds,
        read_days,
        category_count: stats.categories.len(),
        active_bucket_count,
        stable_bucket_share,
        top_category_title: top_category.map(|category| category.title.clone()),
        top_category_share,
        top3_category_share,
        top_item_title: top_item.map(|item| item.title.clone()),
        top_item_share,
        author_concentration,
        compare: stats.compare.unwrap_or(0.0),
        practical_score,
        conceptual_score,
        analytical_score,
        resonant_score,
        top_signals_text,
    }
}

fn resolve_reading_persona_status(
    signals: &ReadingPersonaSignals,
    stable_dimension_count: usize,
) -> &'static str {
    let thresholds = &reading_persona_thresholds().status;

    if signals.total_read_time_seconds >= thresholds.complete.min_total_read_time_seconds
        && signals.read_days >= thresholds.complete.min_read_days
        && signals.active_bucket_count >= thresholds.complete.min_active_bucket_count
        && signals.category_count >= thresholds.complete.min_category_count
    {
        return "complete";
    }

    if signals.total_read_time_seconds >= thresholds.provisional.min_total_read_time_seconds
        && signals.read_days >= thresholds.provisional.min_read_days
        && stable_dimension_count >= thresholds.provisional.min_stable_dimension_count
    {
        return "provisional";
    }

    "insufficient"
}

fn build_reading_persona_energy_dimension(
    signals: &ReadingPersonaSignals,
) -> ReadingPersonaDimensionInput {
    let introverted = &reading_persona_thresholds().energy.introverted;
    let is_introverted = signals.top3_category_share >= introverted.min_top3_category_share
        || signals.author_concentration >= introverted.min_author_concentration
        || signals.top_item_share >= introverted.min_top_item_share;
    let key = if is_introverted { "I" } else { "E" };
    let strength = if is_introverted {
        strength_from_reading_persona_threshold_delta(
            (signals.top3_category_share - introverted.min_top3_category_share)
                .max(signals.author_concentration - introverted.min_author_concentration)
                .max(signals.top_item_share - introverted.min_top_item_share),
        )
    } else {
        strength_from_reading_persona_breadth(signals)
    };

    ReadingPersonaDimensionInput {
        axis: "energy".to_string(),
        key: key.to_string(),
        label: if key == "I" {
            "主题深度".to_string()
        } else {
            "探索广度".to_string()
        },
        strength: strength.to_string(),
        basis: if key == "I" {
            format!(
                "投入主要集中在{}与重点书目上，阅读更像围绕主线持续推进。",
                signals.top_category_title.as_deref().unwrap_or("少数主题")
            )
        } else {
            "主题分布更分散，阅读更像在多个方向之间主动探索和横向扩展。".to_string()
        },
    }
}

fn build_reading_persona_information_dimension(
    signals: &ReadingPersonaSignals,
) -> ReadingPersonaDimensionInput {
    let axis_bias_multiplier = reading_persona_thresholds().axis_bias_multiplier;
    let conceptual_wins =
        signals.conceptual_score >= signals.practical_score * axis_bias_multiplier;
    let practical_wins = signals.practical_score >= signals.conceptual_score * axis_bias_multiplier;
    let key = if conceptual_wins {
        "N"
    } else if practical_wins {
        "S"
    } else {
        resolve_reading_persona_text_bias(
            &signals.top_signals_text,
            &reading_persona_config().category_tokens.conceptual,
            &reading_persona_config().category_tokens.practical,
            "N",
            "S",
        )
    };
    let strength =
        strength_from_reading_persona_ratio(signals.conceptual_score, signals.practical_score);

    ReadingPersonaDimensionInput {
        axis: "information".to_string(),
        key: key.to_string(),
        label: if key == "N" {
            "概念想象".to_string()
        } else {
            "实用经验".to_string()
        },
        strength: strength.to_string(),
        basis: if key == "N" {
            format!(
                "这段时间更偏向{}，阅读重点更接近理解主题与建立联想。",
                signals
                    .top_category_title
                    .as_deref()
                    .unwrap_or("历史、文学或思想性内容")
            )
        } else {
            format!(
                "这段时间更偏向{}，阅读重点更接近获取可直接使用的方法。",
                signals
                    .top_category_title
                    .as_deref()
                    .unwrap_or("工具、管理或方法类内容")
            )
        },
    }
}

fn build_reading_persona_decision_dimension(
    signals: &ReadingPersonaSignals,
) -> ReadingPersonaDimensionInput {
    let axis_bias_multiplier = reading_persona_thresholds().axis_bias_multiplier;
    let analytical_wins = signals.analytical_score >= signals.resonant_score * axis_bias_multiplier;
    let resonant_wins = signals.resonant_score >= signals.analytical_score * axis_bias_multiplier;
    let key = if analytical_wins {
        "T"
    } else if resonant_wins {
        "F"
    } else {
        resolve_reading_persona_text_bias(
            &signals.top_signals_text,
            &reading_persona_config().category_tokens.analytical,
            &reading_persona_config().category_tokens.resonant,
            "T",
            "F",
        )
    };
    let strength =
        strength_from_reading_persona_ratio(signals.analytical_score, signals.resonant_score);

    ReadingPersonaDimensionInput {
        axis: "decision".to_string(),
        key: key.to_string(),
        label: if key == "T" {
            "分析取向".to_string()
        } else {
            "共鸣取向".to_string()
        },
        strength: strength.to_string(),
        basis: if key == "T" {
            "当前更容易被结构、方法和判断框架吸引，阅读时更关注可拆解、可比较的分析线索。"
                .to_string()
        } else {
            "当前更容易被人物、命运和社会现场吸引，阅读时更关注情绪、关系与经验共鸣。".to_string()
        },
    }
}

fn build_reading_persona_lifestyle_dimension(
    signals: &ReadingPersonaSignals,
) -> ReadingPersonaDimensionInput {
    let thresholds = &reading_persona_thresholds().lifestyle;
    let is_planned = (signals.read_days >= thresholds.planned.min_read_days
        && signals.stable_bucket_share >= thresholds.planned.min_stable_bucket_share)
        || (signals.top_item_share >= thresholds.planned.min_top_item_share
            && signals.compare >= thresholds.planned.min_compare);
    let clearly_exploratory = signals.read_days <= thresholds.exploratory.max_read_days
        || signals.active_bucket_count <= thresholds.exploratory.max_active_bucket_count;
    let key = if clearly_exploratory {
        "P"
    } else if is_planned {
        "J"
    } else {
        "P"
    };
    let strength = if key == "J" {
        strength_from_reading_persona_threshold_delta(
            (signals.stable_bucket_share - thresholds.planned.min_stable_bucket_share).max(
                (signals.read_days as f64 - thresholds.planned.min_read_days as f64)
                    / thresholds.judging_strength.read_days_scale,
            ),
        )
    } else if signals.read_days <= thresholds.perceiving_strength.strong.max_read_days
        || signals.active_bucket_count
            <= thresholds
                .perceiving_strength
                .strong
                .max_active_bucket_count
    {
        "strong"
    } else if signals.read_days <= thresholds.perceiving_strength.medium.max_read_days
        || signals.active_bucket_count
            <= thresholds
                .perceiving_strength
                .medium
                .max_active_bucket_count
    {
        "medium"
    } else {
        "light"
    };

    ReadingPersonaDimensionInput {
        axis: "lifestyle".to_string(),
        key: key.to_string(),
        label: if key == "J" {
            "稳定推进".to_string()
        } else {
            "即兴探索".to_string()
        },
        strength: strength.to_string(),
        basis: if key == "J" {
            "阅读天数和高活跃分桶更稳定，说明这段时间已经形成相对固定的推进节奏。".to_string()
        } else {
            "阅读更像阶段性集中或临时切换，说明这一周期更接近按兴趣和时间窗口灵活推进。".to_string()
        },
    }
}

fn build_reading_persona_evidence(
    signals: &ReadingPersonaSignals,
    dimensions: &[ReadingPersonaDimensionInput],
    status: &str,
) -> Vec<String> {
    let mut evidence = Vec::new();

    if let Some(title) = signals.top_category_title.as_deref() {
        evidence.push(format!(
            "{title} 是当前投入最多的主题，约占分类投入的 {}%。",
            reading_persona_percent(signals.top_category_share)
        ));
    }
    if let Some(title) = signals.top_item_title.as_deref() {
        evidence.push(format!(
            "《{title}》占重点内容时长约 {}%，说明注意力仍集中在少数主线。",
            reading_persona_percent(signals.top_item_share)
        ));
    }
    if signals.read_days > 0 {
        evidence.push(format!(
            "本周期活跃阅读 {} 天，稳定分布的高活跃时间段约占 {}%。",
            signals.read_days,
            reading_persona_percent(signals.stable_bucket_share)
        ));
    }
    if dimensions.first().map(|dimension| dimension.key.as_str()) == Some("E") {
        evidence.push(format!(
            "Top 3 分类投入约占 {}%，说明主题分布更分散。",
            reading_persona_percent(signals.top3_category_share)
        ));
    }

    let max_items = if status == "provisional" {
        reading_persona_thresholds().evidence.provisional_max_items
    } else {
        reading_persona_thresholds().evidence.default_max_items
    };
    evidence.truncate(max_items);
    evidence
}

fn build_reading_persona_confidence(
    dimensions: &[ReadingPersonaDimensionInput],
    status: &str,
) -> Option<f64> {
    if status == "insufficient" || dimensions.is_empty() {
        return None;
    }

    let total = dimensions
        .iter()
        .map(|dimension| confidence_for_reading_persona_strength(&dimension.strength))
        .sum::<f64>();
    Some(((total / dimensions.len() as f64) * 100.0).round() / 100.0)
}

fn category_value_for_reading_persona(category: &ReadingCategoryRecord) -> f64 {
    category
        .reading_time_seconds
        .map(|value| value.max(0) as f64)
        .or(category.value.map(|value| value.max(0.0)))
        .or(category.reading_count.map(|value| value.max(0) as f64))
        .unwrap_or(0.0)
}

fn safe_reading_persona_ratio(value: f64, total: f64) -> f64 {
    if !value.is_finite() || !total.is_finite() || total <= 0.0 {
        return 0.0;
    }

    value / total
}

fn sum_reading_persona_category_score(
    categories: &[ReadingCategoryRecord],
    tokens: &[String],
) -> f64 {
    categories.iter().fold(0.0, |sum, category| {
        let text = [
            Some(category.title.as_str()),
            category.parent_title.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("|");
        if contains_any_reading_persona_token(&text, tokens) {
            sum + category_value_for_reading_persona(category)
        } else {
            sum
        }
    })
}

fn resolve_reading_persona_text_bias<'a>(
    text: &str,
    left_tokens: &[String],
    right_tokens: &[String],
    left_key: &'a str,
    right_key: &'a str,
) -> &'a str {
    if contains_any_reading_persona_token(text, left_tokens) {
        return left_key;
    }
    if contains_any_reading_persona_token(text, right_tokens) {
        return right_key;
    }

    left_key
}

fn contains_any_reading_persona_token(text: &str, tokens: &[String]) -> bool {
    tokens.iter().any(|token| text.contains(token.as_str()))
}

fn strength_from_reading_persona_ratio(left: f64, right: f64) -> &'static str {
    let max = left.max(right);
    let min = left.min(right);
    let ratio = if min <= 0.0 {
        if max > 0.0 {
            2.0
        } else {
            1.0
        }
    } else {
        max / min
    };
    let thresholds = &reading_persona_thresholds().strength.ratio;

    if ratio >= thresholds.strong {
        "strong"
    } else if ratio >= thresholds.medium {
        "medium"
    } else {
        "light"
    }
}

fn strength_from_reading_persona_threshold_delta(delta: f64) -> &'static str {
    let thresholds = &reading_persona_thresholds().strength.delta;

    if delta >= thresholds.strong {
        "strong"
    } else if delta >= thresholds.medium {
        "medium"
    } else {
        "light"
    }
}

fn strength_from_reading_persona_breadth(signals: &ReadingPersonaSignals) -> &'static str {
    let thresholds = &reading_persona_thresholds().energy.breadth_strength;

    if signals.top3_category_share <= thresholds.strong.max_top3_category_share
        && signals.author_concentration <= thresholds.strong.max_author_concentration
        && signals.top_item_share <= thresholds.strong.max_top_item_share
    {
        "strong"
    } else if signals.top3_category_share <= thresholds.medium.max_top3_category_share
        && signals.top_item_share <= thresholds.medium.max_top_item_share
    {
        "medium"
    } else {
        "light"
    }
}

fn reading_persona_definition(code: &str) -> Option<(String, String, String)> {
    let definition = reading_persona_config().definitions.get(code)?;

    Some((
        definition.label.clone(),
        definition.palette_group.clone(),
        definition.accent_tone.clone(),
    ))
}

fn infer_reading_persona_palette_group(code: &str) -> &'static str {
    let chars = code.chars().collect::<Vec<_>>();
    if chars.len() < 4 {
        return "NT";
    }

    if chars[1] == 'N' {
        if chars[2] == 'F' {
            "NF"
        } else {
            "NT"
        }
    } else if chars[3] == 'P' {
        "SP"
    } else {
        "SJ"
    }
}

fn accent_tone_for_reading_persona_group(group: &str) -> &'static str {
    match group {
        "NF" => "rose",
        "SJ" => "moss",
        "SP" => "amber",
        _ => "bluegreen",
    }
}

fn confidence_for_reading_persona_strength(strength: &str) -> f64 {
    let confidence = &reading_persona_thresholds().strength.confidence;

    match strength {
        "strong" => confidence.strong,
        "medium" => confidence.medium,
        _ => confidence.light,
    }
}

fn reading_persona_percent(value: f64) -> i64 {
    ((value * 100.0).round() as i64).max(1)
}

fn build_reading_route_input(
    connection: &rusqlite::Connection,
    request: ReadingRouteRequest,
    update_context: Option<&ReadingRouteUpdateContextData>,
) -> Result<ReadingRouteInput, AiServiceError> {
    let current_book = normalize_route_book_input(request.book)?;
    let candidates = normalize_route_candidates(request.candidates, &current_book.book_id)?;
    let mut all_books = Vec::with_capacity(candidates.len() + 1);
    all_books.push(current_book.clone());
    all_books.extend(candidates.iter().cloned());

    let book_ids = all_books
        .iter()
        .map(|book| book.book_id.clone())
        .collect::<Vec<_>>();
    let states = read_route_item_states(connection, &book_ids)?;
    let summaries = read_route_book_summaries(connection, &book_ids)?;
    let progress_by_book = read_route_book_progress(connection, &book_ids)?;
    let chapter_signals_by_book = read_route_chapter_signals(connection, &book_ids)?;
    let latest_stats_review = read_route_latest_stats_review(connection)?;
    let latest_stats = read_route_latest_stats(connection)?;
    let route_books = all_books
        .iter()
        .map(|book| {
            let state = states.get(&book.book_id);
            let local_status = state
                .and_then(|value| string_value(value.get("status")))
                .or_else(|| book.local_status.clone());
            let progress = progress_by_book.get(&book.book_id);
            let progress_percent = book
                .progress_percent
                .or_else(|| progress.map(|item| item.progress_percent))
                .unwrap_or(0)
                .clamp(0, 100);
            let is_finished = book
                .is_finished
                .or_else(|| progress.map(|item| item.is_finished))
                .unwrap_or(false);
            let reading_stage = reading_stage_signal(progress_percent, is_finished);
            let chapter_signals = chapter_signals_by_book
                .get(&book.book_id)
                .cloned()
                .unwrap_or_else(|| {
                    default_chapter_signals(progress.and_then(|item| item.chapter_uid))
                });
            json!({
                "bookId": book.book_id,
                "title": book.title,
                "author": book.author,
                "category": book.category,
                "localStatus": local_status,
                "progressPercent": progress_percent,
                "readingStage": reading_stage,
                "chapterSignals": chapter_signals,
                "summary": summaries.get(&book.book_id)
            })
        })
        .collect::<Vec<_>>();
    let current_progress = progress_by_book.get(&current_book.book_id);
    let current_progress_percent = current_book
        .progress_percent
        .or_else(|| current_progress.map(|item| item.progress_percent))
        .unwrap_or(0)
        .clamp(0, 100);
    let current_is_finished = current_book
        .is_finished
        .or_else(|| current_progress.map(|item| item.is_finished))
        .unwrap_or(false);
    let current_stage = reading_stage_signal(current_progress_percent, current_is_finished);
    let current_chapter_signals = chapter_signals_by_book
        .get(&current_book.book_id)
        .cloned()
        .unwrap_or_else(|| {
            default_chapter_signals(current_progress.and_then(|item| item.chapter_uid))
        });
    let candidate_hash = stable_hash_json(&json!(candidates
        .iter()
        .map(|book| &book.book_id)
        .collect::<Vec<_>>()))?;
    let scope_id = if candidates.is_empty() {
        format!("book:{}", current_book.book_id)
    } else {
        format!(
            "book:{}:candidates:{}",
            current_book.book_id,
            candidate_hash.chars().take(12).collect::<String>()
        )
    };
    let summary_count = summaries.len();
    let local_status_count = states.len();
    let stats_signal_count = latest_stats
        .as_ref()
        .map(|stats| stats.buckets.len() + stats.longest_items.len() + stats.categories.len())
        .unwrap_or(0)
        + usize::from(latest_stats_review.is_some());
    let source_stats = ReadingRouteSourceStats {
        current_book_count: 1,
        candidate_count: candidates.len(),
        summary_count,
        stats_signal_count,
        local_status_count,
    };
    let allowed_book_ids = book_ids.iter().cloned().collect::<HashSet<_>>();
    let update_context_payload = update_context.map(reading_route_update_context_payload);
    let basis = if update_context_payload.is_some() {
        "基于当前书、用户显式选择的候选书、已生成复盘摘要、结构化统计信号、本地状态，并参考上一版阅读指南行动反馈生成，不包含其他书原始笔记或全量书架。"
    } else {
        "基于当前书、用户显式选择的候选书、已生成复盘摘要、结构化统计信号和本地状态生成，不包含其他书原始笔记或全量书架。"
    };
    let mut payload = json!({
        "promptVersion": READING_ROUTE_PROMPT_VERSION,
        "basis": basis,
        "chapterPolicy": {
            "usage": "章节只作为辅助依据，可用于章节分组、回跳、引用来源和最近笔记章节线索，不作为强制任务。",
            "fallback": "章节缺失或目录未缓存时，必须回退到阅读进度、最近笔记、本地状态和已有复盘摘要。",
            "forbidden": "不得生成逐章任务清单，不得承诺实时章节追踪，不得输出后台自动阅读安排。"
        },
        "currentBookId": current_book.book_id,
        "currentBookStage": current_stage,
        "currentBookChapterSignals": current_chapter_signals,
        "books": route_books,
        "latestStatsReview": latest_stats_review,
        "latestStatsSignals": latest_stats.map(route_stats_signal_payload),
        "sourceStats": source_stats
    });
    if let Some(update_context_payload) = update_context_payload {
        payload
            .as_object_mut()
            .expect("reading route payload should be an object")
            .insert("updateContext".to_string(), update_context_payload);
    }

    Ok(ReadingRouteInput {
        book_id: current_book.book_id,
        scope_id,
        payload,
        source_stats,
        allowed_book_ids,
        current_stage,
    })
}

fn build_book_decision_input(
    connection: &rusqlite::Connection,
    candidates: Vec<BookDecisionCandidateInput>,
    goal: Option<String>,
) -> Result<BookDecisionInput, AiServiceError> {
    let candidates = normalize_book_decision_candidates(candidates)?;
    if candidates.is_empty() {
        return Err(AiServiceError::InvalidProviderOutput(
            "至少需要 1 本本地候选书才能生成选书决策。".to_string(),
        ));
    }

    let book_ids = candidates
        .iter()
        .map(|book| book.book_id.clone())
        .collect::<Vec<_>>();
    let states = read_route_item_states(connection, &book_ids)?;
    let summaries = read_route_book_summaries(connection, &book_ids)?;
    let latest_stats_review = read_route_latest_stats_review(connection)?;
    let latest_stats = read_route_latest_stats(connection)?;
    let decision_candidates = candidates
        .iter()
        .map(|book| {
            let state = states.get(&book.book_id);
            let local_status = state
                .and_then(|value| string_value(value.get("status")))
                .or_else(|| book.local_status.clone());
            json!({
                "bookId": book.book_id,
                "title": book.title,
                "author": book.author,
                "category": book.category,
                "localStatus": local_status,
                "localNote": state.and_then(|value| string_value(value.get("note"))),
                "summary": summaries.get(&book.book_id)
            })
        })
        .collect::<Vec<_>>();
    let decision_goal = normalize_book_decision_goal(goal);
    let candidate_hash = stable_hash_json(&json!({
        "goal": decision_goal,
        "candidates": candidates
        .iter()
        .map(|book| &book.book_id)
        .collect::<Vec<_>>()
    }))?;
    let scope_id = format!(
        "candidates:{}",
        candidate_hash.chars().take(12).collect::<String>()
    );
    let stats_signal_count = latest_stats
        .as_ref()
        .map(|stats| stats.longest_items.len() + stats.categories.len())
        .unwrap_or(0)
        + usize::from(latest_stats_review.is_some());
    let source_stats = BookDecisionSourceStats {
        candidate_count: candidates.len(),
        summary_count: summaries.len(),
        stats_signal_count,
        local_status_count: states.len(),
    };
    let allowed_book_ids = book_ids.iter().cloned().collect::<HashSet<_>>();
    let payload = json!({
        "promptVersion": BOOK_DECISION_PROMPT_VERSION,
        "basis": "基于用户保存到本机的候选书、已生成复盘摘要、结构化统计信号和本地状态生成，不包含全量书架、原始笔记、远端同步结果或 API Key。",
        "decisionGoal": decision_goal,
        "candidates": decision_candidates,
        "latestStatsReview": latest_stats_review,
        "latestStatsSignals": latest_stats.map(book_decision_stats_signal_payload),
        "sourceStats": source_stats
    });

    Ok(BookDecisionInput {
        scope_id,
        payload,
        source_stats,
        allowed_book_ids,
    })
}

fn build_local_reader_selection_question_input(
    request: LocalReaderSelectionQuestionInput,
) -> Result<LocalReaderSelectionQuestionBuildInput, AiServiceError> {
    let source_item = normalize_local_reader_source_item(request.source_item)?;
    let title = normalize_local_reader_text("书名", &request.book.title, 160)?;
    let author = request
        .book
        .author
        .map(|value| value.trim().chars().take(120).collect::<String>())
        .filter(|value| !value.is_empty());
    let selected_text = normalize_local_reader_text(
        "选中文本",
        &request.selection.text,
        MAX_LOCAL_READER_SELECTED_TEXT_CHARS,
    )?;
    let question =
        normalize_local_reader_text("问题", &request.question, MAX_LOCAL_READER_QUESTION_CHARS)?;
    let start_offset = request.selection.start_offset;
    let end_offset = request.selection.end_offset;
    let context_before = request.selection.context.as_ref().and_then(|context| {
        normalize_local_reader_context_text(
            context.before_text.as_deref(),
            MAX_LOCAL_READER_CONTEXT_TEXT_CHARS,
            true,
        )
    });
    let context_after = request.selection.context.as_ref().and_then(|context| {
        normalize_local_reader_context_text(
            context.after_text.as_deref(),
            MAX_LOCAL_READER_CONTEXT_TEXT_CHARS,
            false,
        )
    });

    if start_offset < 0 || end_offset <= start_offset {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 提问选区位置无效，请重新选择文本。".to_string(),
        ));
    }

    let scope_id = format!(
        "{}:{}:{}-{}",
        source_item.source, source_item.source_id, start_offset, end_offset
    );
    let mut selection_payload = json!({
        "text": selected_text,
        "startOffset": start_offset,
        "endOffset": end_offset
    });
    if context_before.is_some() || context_after.is_some() {
        selection_payload["context"] = json!({
            "beforeText": context_before,
            "afterText": context_after
        });
    }
    let payload = json!({
        "promptVersion": LOCAL_READER_SELECTION_QA_PROMPT_VERSION,
        "basis": "仅基于用户在本地阅读器中手动选择的文本及其前后文回答，不包含整本书、本地文件路径、文件 hash、数据库路径、微信凭据或微信读书笔记。",
        "source": "local",
        "book": {
            "title": title,
            "author": author
        },
        "selection": selection_payload,
        "question": question
    });

    Ok(LocalReaderSelectionQuestionBuildInput {
        source_item,
        scope_id,
        payload,
    })
}

fn normalize_local_reader_source_item(
    source_item: SourceItemInput,
) -> Result<SourceItemInput, AiServiceError> {
    let source = source_item.source.trim();
    if source != "local" {
        return Err(AiServiceError::InvalidProviderOutput(
            "本地阅读器 AI 提问只允许处理本地图书选区。".to_string(),
        ));
    }

    let source_id = normalize_local_reader_text("本地图书 ID", &source_item.source_id, 160)?;
    Ok(SourceItemInput {
        source: source.to_string(),
        source_id,
    })
}

fn normalize_local_reader_text(
    field_name: &str,
    value: &str,
    max_chars: usize,
) -> Result<String, AiServiceError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AiServiceError::InvalidProviderOutput(format!(
            "AI 提问{field_name}不能为空。"
        )));
    }

    Ok(trimmed.chars().take(max_chars).collect())
}

fn normalize_local_reader_context_text(
    value: Option<&str>,
    max_chars: usize,
    prefer_tail: bool,
) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }

    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= max_chars {
        return Some(trimmed.to_string());
    }

    if prefer_tail {
        Some(
            chars[chars.len().saturating_sub(max_chars)..]
                .iter()
                .collect(),
        )
    } else {
        Some(chars[..max_chars].iter().collect())
    }
}

fn normalize_book_decision_goal(goal: Option<String>) -> String {
    let normalized = goal.unwrap_or_default().trim().to_string();
    match normalized.as_str() {
        "轻松读" | "延续当前主题" | "推进长期书" | "只有 30 分钟" | "读完能复盘" => {
            normalized
        }
        _ => "轻松读".to_string(),
    }
}

fn normalize_summary_output(
    value: Value,
    source_stats: BookAiSummarySourceStats,
    generated_at: String,
    prompt_version: &str,
    response_format: Option<AiResponseFormatKind>,
) -> Result<BookAiSummary, AiServiceError> {
    if !value.is_object() {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 总结必须是 JSON 对象。".to_string(),
        ));
    }

    let output = summary_output_root(&value);
    let overview = string_value_any(output, &["overview", "summary", "摘要", "概览"])
        .or_else(|| string_value_any(&value, &["overview", "summary", "摘要", "概览"]))
        .ok_or_else(|| {
            AiServiceError::InvalidProviderOutput(
                "AI 返回缺少 overview 概览字段，请重新生成。".to_string(),
            )
        })?;

    Ok(BookAiSummary {
        overview,
        key_ideas: string_list_any(output, &["keyIdeas", "key_ideas", "ideas", "关键观点"])
            .into_iter()
            .take(8)
            .collect(),
        my_focus: string_list_any(
            output,
            &["myFocus", "my_focus", "focus", "关注点", "我的关注点"],
        ),
        action_items: string_list_any(
            output,
            &["actionItems", "action_items", "actions", "行动项"],
        ),
        theme_tags: string_list_any(output, &["themeTags", "theme_tags", "tags", "主题标签"])
            .into_iter()
            .take(10)
            .collect(),
        representative_quotes: representative_quote_list(
            output
                .get("representativeQuotes")
                .or_else(|| output.get("representative_quotes"))
                .or_else(|| output.get("quotes"))
                .or_else(|| output.get("代表性摘录")),
        ),
        reflection_questions: string_list_any(
            output,
            &[
                "reflectionQuestions",
                "reflection_questions",
                "questions",
                "复盘问题",
            ],
        )
        .into_iter()
        .take(6)
        .collect(),
        reading_stage: reading_stage_value(
            output
                .get("readingStage")
                .or_else(|| value.get("readingStage")),
        ),
        source_stats,
        generated_at,
        prompt_version: prompt_version.to_string(),
        response_format,
        basis_notice: "基于本地笔记生成，不代表整本书全文内容。".to_string(),
        feedback_outcome_summary: feedback_outcome_summary_value(
            output
                .get("feedbackOutcomeSummary")
                .or_else(|| output.get("feedback_outcome_summary"))
                .or_else(|| value.get("feedbackOutcomeSummary"))
                .or_else(|| value.get("feedback_outcome_summary")),
        ),
    })
}

fn normalize_reading_stats_review_output(
    value: Value,
    source_stats: ReadingStatsAiReviewSourceStats,
    generated_at: String,
    prompt_version: &str,
    response_format: Option<AiResponseFormatKind>,
) -> Result<ReadingStatsAiReview, AiServiceError> {
    if !value.is_object() {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 阅读复盘必须是 JSON 对象。".to_string(),
        ));
    }

    let output = summary_output_root(&value);
    let overview = string_value_any(output, &["overview", "summary", "摘要", "概览"])
        .or_else(|| string_value_any(&value, &["overview", "summary", "摘要", "概览"]))
        .ok_or_else(|| {
            AiServiceError::InvalidProviderOutput(
                "AI 返回缺少 overview 概览字段，请重新生成。".to_string(),
            )
        })?;

    Ok(ReadingStatsAiReview {
        overview: humanize_review_text(&overview),
        rhythm_insights: string_list_any(
            output,
            &[
                "rhythmInsights",
                "rhythm_insights",
                "readingRhythm",
                "节奏洞察",
            ],
        )
        .into_iter()
        .map(|item| humanize_review_text(&item))
        .take(5)
        .collect(),
        preference_insights: string_list_any(
            output,
            &[
                "preferenceInsights",
                "preference_insights",
                "preferences",
                "偏好洞察",
            ],
        )
        .into_iter()
        .map(|item| humanize_review_text(&item))
        .take(5)
        .collect(),
        focus_items: string_list_any(output, &["focusItems", "focus_items", "focus", "关注项"])
            .into_iter()
            .map(|item| humanize_review_text(&item))
            .take(5)
            .collect(),
        next_actions: string_list_any(
            output,
            &[
                "nextActions",
                "next_actions",
                "actions",
                "nextSteps",
                "下一步",
            ],
        )
        .into_iter()
        .map(|item| humanize_review_text(&item))
        .take(5)
        .collect(),
        reading_persona: normalize_reading_persona_patch(
            output
                .get("readingPersona")
                .or_else(|| output.get("reading_persona"))
                .or_else(|| value.get("readingPersona"))
                .or_else(|| value.get("reading_persona")),
        ),
        source_stats,
        generated_at,
        prompt_version: prompt_version.to_string(),
        response_format,
        basis_notice: "基于结构化阅读统计生成，不包含笔记正文或书籍全文。".to_string(),
    })
}

fn normalize_reading_route_output(
    value: Value,
    allowed_book_ids: HashSet<String>,
    source_stats: ReadingRouteSourceStats,
    fallback_stage: Option<ReadingStageSignal>,
    generated_at: String,
    prompt_version: &str,
    response_format: Option<AiResponseFormatKind>,
) -> Result<ReadingRoute, AiServiceError> {
    if !value.is_object() {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 阅读指南必须是 JSON 对象。".to_string(),
        ));
    }

    let output = summary_output_root(&value);
    let books = reading_route_book_steps(
        output
            .get("books")
            .or_else(|| output.get("routeBooks"))
            .or_else(|| output.get("steps"))
            .or_else(|| output.get("阅读顺序")),
        &allowed_book_ids,
    );

    if books.is_empty() {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 返回的阅读指南没有可用书籍，请重新生成。".to_string(),
        ));
    }

    let route_overview = string_value_any(
        output,
        &[
            "routeOverview",
            "route_overview",
            "overview",
            "summary",
            "路线总览",
        ],
    )
    .or_else(|| {
        string_value_any(
            &value,
            &[
                "routeOverview",
                "route_overview",
                "overview",
                "summary",
                "路线总览",
            ],
        )
    })
    .unwrap_or_else(|| fallback_reading_route_overview(&books, &source_stats));

    let route = ReadingRoute {
        route_overview: humanize_route_text(&route_overview),
        books: books.into_iter().map(sanitize_reading_route_book).collect(),
        dependencies: reading_route_dependencies(
            output
                .get("dependencies")
                .or_else(|| output.get("依赖关系")),
            &allowed_book_ids,
        ),
        review_checkpoints: reading_route_checkpoints(
            output
                .get("reviewCheckpoints")
                .or_else(|| output.get("checkpoints"))
                .or_else(|| output.get("复盘点")),
        )
        .into_iter()
        .map(sanitize_reading_route_checkpoint)
        .collect(),
        next_actions: string_list_any(
            output,
            &["nextActions", "next_actions", "actions", "下一步", "行动建议"],
        )
        .into_iter()
        .map(|item| humanize_route_text(&item))
        .take(5)
        .collect(),
        reading_stage: reading_stage_value(
            output.get("readingStage").or_else(|| value.get("readingStage")),
        )
        .or(fallback_stage),
        source_stats,
        generated_at,
        prompt_version: prompt_version.to_string(),
        response_format,
        basis_notice:
            "基于本地缓存、已生成复盘和用户选择的候选书生成，不代表微信读书远端计划，也不会写回微信读书。"
                .to_string(),
        feedback_outcome_summary: feedback_outcome_summary_value(
            output
                .get("feedbackOutcomeSummary")
                .or_else(|| output.get("feedback_outcome_summary"))
                .or_else(|| value.get("feedbackOutcomeSummary"))
                .or_else(|| value.get("feedback_outcome_summary")),
        ),
    };

    validate_reading_route_quality(&route)?;

    Ok(route)
}

fn normalize_book_decision_output(
    value: Value,
    allowed_book_ids: HashSet<String>,
    source_stats: BookDecisionSourceStats,
    generated_at: String,
    prompt_version: &str,
    response_format: Option<AiResponseFormatKind>,
) -> Result<BookDecision, AiServiceError> {
    if !value.is_object() {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 选书决策必须是 JSON 对象。".to_string(),
        ));
    }

    let output = summary_output_root(&value);
    let decision_overview = string_value_any(
        output,
        &[
            "decisionOverview",
            "decision_overview",
            "overview",
            "summary",
            "决策总览",
        ],
    )
    .or_else(|| string_value_any(&value, &["decisionOverview", "overview", "summary"]))
    .ok_or_else(|| {
        AiServiceError::InvalidProviderOutput(
            "AI 返回缺少 decisionOverview 决策总览字段，请重新生成。".to_string(),
        )
    })?;
    let top_candidates = book_decision_top_candidates(
        output
            .get("topCandidates")
            .or_else(|| output.get("top_candidates"))
            .or_else(|| output.get("recommendations"))
            .or_else(|| output.get("推荐候选")),
        &allowed_book_ids,
    );

    if top_candidates.is_empty() {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 返回的选书决策没有可用候选书，请重新生成。".to_string(),
        ));
    }
    let primary_title = top_candidates
        .first()
        .map(|candidate| candidate.title.clone());

    Ok(BookDecision {
        decision_overview: humanize_route_text(&decision_overview),
        top_candidates: top_candidates
            .into_iter()
            .map(sanitize_book_decision_candidate)
            .collect(),
        deferred_candidates: book_decision_deferred_candidates(
            output
                .get("deferredCandidates")
                .or_else(|| output.get("deferred_candidates"))
                .or_else(|| output.get("deferred"))
                .or_else(|| output.get("暂缓项")),
            &allowed_book_ids,
        )
        .into_iter()
        .map(sanitize_book_decision_deferred)
        .collect(),
        next_actions: string_list_any(
            output,
            &["nextActions", "next_actions", "actions", "下一步", "行动建议"],
        )
        .into_iter()
        .map(|item| humanize_book_decision_action(&item, primary_title.as_deref()))
        .take(5)
        .collect(),
        source_stats,
        generated_at,
        prompt_version: prompt_version.to_string(),
        response_format,
        basis_notice:
            "基于本地候选、已生成复盘和结构化统计信号生成，不代表微信读书远端推荐，也不会写回微信读书。"
                .to_string(),
    })
}

fn normalize_local_reader_selection_answer_output(
    value: Value,
    generated_at: String,
    prompt_version: &str,
    response_format: Option<AiResponseFormatKind>,
) -> Result<LocalReaderSelectionAnswer, AiServiceError> {
    if !value.is_object() {
        return Err(AiServiceError::InvalidProviderOutput(
            "AI 选区回答必须是 JSON 对象。".to_string(),
        ));
    }

    let output = summary_output_root(&value);
    let answer = string_value_any(output, &["answer", "response", "summary", "回答"])
        .or_else(|| string_value_any(&value, &["answer", "response", "summary", "回答"]))
        .ok_or_else(|| {
            AiServiceError::InvalidProviderOutput(
                "AI 返回缺少 answer 回答字段，请重新提问。".to_string(),
            )
        })?;

    Ok(LocalReaderSelectionAnswer {
        answer: truncate_text(&humanize_route_text(&answer), MAX_LOCAL_READER_ANSWER_CHARS),
        key_points: string_list_any(
            output,
            &["keyPoints", "key_points", "points", "要点", "关键点"],
        )
        .into_iter()
        .map(|item| {
            truncate_text(
                &humanize_route_text(&item),
                MAX_LOCAL_READER_LIST_ITEM_CHARS,
            )
        })
        .take(5)
        .collect(),
        follow_up_questions: string_list_any(
            output,
            &[
                "followUpQuestions",
                "follow_up_questions",
                "questions",
                "追问",
                "后续问题",
            ],
        )
        .into_iter()
        .map(|item| {
            truncate_text(
                &humanize_route_text(&item),
                MAX_LOCAL_READER_LIST_ITEM_CHARS,
            )
        })
        .take(MAX_LOCAL_READER_FOLLOW_UP_QUESTIONS)
        .collect(),
        generated_at,
        prompt_version: prompt_version.to_string(),
        response_format,
        basis_notice:
            "仅基于本次选中文本及其前后文生成，不代表整本书全文，也不会读取或合并微信读书数据。"
                .to_string(),
    })
}

fn cached_summary_response(
    book_id: &str,
    current_input_hash: &str,
    cached: AiCachedOutputRecord,
    error_message: Option<String>,
) -> Result<BookAiSummaryResponse, AiServiceError> {
    let summary = serde_json::from_value::<BookAiSummary>(cached.output).map_err(|_| {
        AiServiceError::InvalidProviderOutput("本地 AI 总结缓存无法解析。".to_string())
    })?;
    let source = if error_message.is_some() {
        BookAiSummarySource::StaleCache
    } else {
        BookAiSummarySource::Cache
    };

    Ok(BookAiSummaryResponse {
        book_id: book_id.to_string(),
        prompt_version: cached.prompt_version,
        input_hash: current_input_hash.to_string(),
        provider_model: cached.provider_model,
        source,
        summary,
        cached_updated_at: Some(cached.updated_at),
        error_message,
    })
}

fn cached_reading_stats_review_response(
    stats: &ReadingStatsRecord,
    current_input_hash: &str,
    cached: AiCachedOutputRecord,
    error_message: Option<String>,
) -> Result<ReadingStatsAiReviewResponse, AiServiceError> {
    let mut review =
        serde_json::from_value::<ReadingStatsAiReview>(cached.output).map_err(|_| {
            AiServiceError::InvalidProviderOutput("本地 AI 阅读复盘缓存无法解析。".to_string())
        })?;
    review = sanitize_cached_reading_review(review);
    let source = if error_message.is_some() {
        BookAiSummarySource::StaleCache
    } else {
        BookAiSummarySource::Cache
    };

    Ok(ReadingStatsAiReviewResponse {
        mode: stats.mode.clone(),
        base_time: stats.base_time,
        prompt_version: cached.prompt_version,
        input_hash: current_input_hash.to_string(),
        provider_model: cached.provider_model,
        source,
        review,
        cached_updated_at: Some(cached.updated_at),
        error_message,
    })
}

fn cached_reading_route_response(
    book_id: &str,
    scope_id: &str,
    current_input_hash: &str,
    cached: AiCachedOutputRecord,
    fallback_stage: Option<ReadingStageSignal>,
    error_message: Option<String>,
) -> Result<ReadingRouteResponse, AiServiceError> {
    let mut route = serde_json::from_value::<ReadingRoute>(cached.output).map_err(|_| {
        AiServiceError::InvalidProviderOutput("本地 AI 阅读指南缓存无法解析。".to_string())
    })?;
    if route.reading_stage.is_none() {
        route.reading_stage = fallback_stage;
    }
    let source = if error_message.is_some() {
        BookAiSummarySource::StaleCache
    } else {
        BookAiSummarySource::Cache
    };

    Ok(ReadingRouteResponse {
        book_id: book_id.to_string(),
        scope_id: scope_id.to_string(),
        prompt_version: cached.prompt_version,
        input_hash: current_input_hash.to_string(),
        provider_model: cached.provider_model,
        source,
        route: sanitize_cached_reading_route(route),
        cached_updated_at: Some(cached.updated_at),
        error_message,
    })
}

fn cached_book_decision_response(
    scope_id: &str,
    current_input_hash: &str,
    cached: AiCachedOutputRecord,
    error_message: Option<String>,
) -> Result<BookDecisionResponse, AiServiceError> {
    let decision = serde_json::from_value::<BookDecision>(cached.output).map_err(|_| {
        AiServiceError::InvalidProviderOutput("本地 AI 选书决策缓存无法解析。".to_string())
    })?;
    let source = if error_message.is_some() {
        BookAiSummarySource::StaleCache
    } else {
        BookAiSummarySource::Cache
    };

    Ok(BookDecisionResponse {
        scope_id: scope_id.to_string(),
        prompt_version: cached.prompt_version,
        input_hash: current_input_hash.to_string(),
        provider_model: cached.provider_model,
        source,
        decision: sanitize_cached_book_decision(decision),
        cached_updated_at: Some(cached.updated_at),
        error_message,
    })
}

fn cached_local_reader_selection_question_response(
    source_item: SourceItemInput,
    current_input_hash: &str,
    cached: AiCachedOutputRecord,
    error_message: Option<String>,
) -> Result<LocalReaderSelectionQuestionResponse, AiServiceError> {
    let mut answer =
        serde_json::from_value::<LocalReaderSelectionAnswer>(cached.output).map_err(|_| {
            AiServiceError::InvalidProviderOutput("本地 AI 选区问答缓存无法解析。".to_string())
        })?;
    answer.answer = truncate_text(
        &humanize_route_text(&answer.answer),
        MAX_LOCAL_READER_ANSWER_CHARS,
    );
    answer.key_points = answer
        .key_points
        .into_iter()
        .map(|item| {
            truncate_text(
                &humanize_route_text(&item),
                MAX_LOCAL_READER_LIST_ITEM_CHARS,
            )
        })
        .take(5)
        .collect();
    answer.follow_up_questions = answer
        .follow_up_questions
        .into_iter()
        .map(|item| {
            truncate_text(
                &humanize_route_text(&item),
                MAX_LOCAL_READER_LIST_ITEM_CHARS,
            )
        })
        .take(MAX_LOCAL_READER_FOLLOW_UP_QUESTIONS)
        .collect();
    let source = if error_message.is_some() {
        BookAiSummarySource::StaleCache
    } else {
        BookAiSummarySource::Cache
    };

    Ok(LocalReaderSelectionQuestionResponse {
        source_item,
        prompt_version: cached.prompt_version,
        input_hash: current_input_hash.to_string(),
        provider_model: cached.provider_model,
        source,
        answer,
        cached_updated_at: Some(cached.updated_at),
        error_message,
    })
}

fn read_local_book_notes(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<BookNotesRecord, AiServiceError> {
    let normalized_book_id = book_id.trim();
    if normalized_book_id.is_empty() {
        return Err(AiServiceError::InvalidProviderOutput(
            "缺少书籍 ID，无法读取本地 AI 总结缓存。".to_string(),
        ));
    }

    let book = connection
        .query_row(
            "
            SELECT
                book_id,
                title,
                author,
                cover,
                review_count,
                note_count,
                bookmark_count,
                total_note_count,
                sort,
                raw_json
            FROM notebook_books
            WHERE book_id = ?1
            ",
            [normalized_book_id],
            |row| {
                Ok(crate::mappers::notes::NotebookBookRecord {
                    book_id: row.get(0)?,
                    title: row.get(1)?,
                    author: row.get(2)?,
                    cover: row.get(3)?,
                    review_count: row.get(4)?,
                    note_count: row.get(5)?,
                    bookmark_count: row.get(6)?,
                    total_note_count: row.get(7)?,
                    reading_progress: None,
                    marked_status: None,
                    sort: row.get(8)?,
                    raw_json: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(AiServiceError::storage)?;
    let highlights = read_local_highlights(connection, normalized_book_id)?;
    let thoughts = read_local_thoughts(connection, normalized_book_id)?;

    Ok(crate::mappers::notes::build_book_notes_record(
        normalized_book_id,
        book,
        highlights,
        thoughts,
        Vec::new(),
    ))
}

fn read_local_highlights(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Vec<crate::mappers::notes::HighlightRecord>, AiServiceError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                bookmark_id,
                book_id,
                chapter_uid,
                chapter_title,
                mark_text,
                create_time,
                range_text,
                raw_json
            FROM highlights
            WHERE book_id = ?1
            ORDER BY COALESCE(create_time, 0) ASC, bookmark_id ASC
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map([book_id], |row| {
            Ok(crate::mappers::notes::HighlightRecord {
                bookmark_id: row.get(0)?,
                book_id: row.get(1)?,
                chapter_uid: row.get(2)?,
                chapter_title: row.get(3)?,
                mark_text: row.get(4)?,
                create_time: row.get(5)?,
                range_text: row.get(6)?,
                deep_link: None,
                raw_json: row.get(7)?,
            })
        })
        .map_err(AiServiceError::storage)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AiServiceError::storage)
}

fn read_local_thoughts(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Vec<crate::mappers::notes::ThoughtRecord>, AiServiceError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                review_id,
                book_id,
                content,
                abstract_text,
                create_time,
                star,
                chapter_name,
                chapter_uid,
                range_text,
                deep_link,
                is_finish,
                raw_json
            FROM thoughts
            WHERE book_id = ?1
            ORDER BY COALESCE(create_time, 0) ASC, review_id ASC
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map([book_id], |row| {
            let is_finish: Option<i64> = row.get(10)?;
            Ok(crate::mappers::notes::ThoughtRecord {
                review_id: row.get(0)?,
                book_id: row.get(1)?,
                content: row.get(2)?,
                abstract_text: row.get(3)?,
                create_time: row.get(4)?,
                star: row.get(5)?,
                chapter_name: row.get(6)?,
                chapter_uid: row.get(7)?,
                range_text: row.get(8)?,
                deep_link: row.get(9)?,
                is_finish: is_finish.map(|value| value != 0),
                raw_json: row.get(11)?,
            })
        })
        .map_err(AiServiceError::storage)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AiServiceError::storage)
}

fn empty_summary_response(
    book_id: &str,
    input_hash: &str,
    source_stats: BookAiSummarySourceStats,
) -> BookAiSummaryResponse {
    BookAiSummaryResponse {
        book_id: book_id.to_string(),
        prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
        input_hash: input_hash.to_string(),
        provider_model: None,
        source: BookAiSummarySource::Empty,
        summary: BookAiSummary {
            overview: "这本书当前没有可用于 AI 总结的划线或想法/点评。".to_string(),
            key_ideas: Vec::new(),
            my_focus: Vec::new(),
            action_items: Vec::new(),
            theme_tags: Vec::new(),
            representative_quotes: Vec::new(),
            reflection_questions: Vec::new(),
            reading_stage: None,
            source_stats,
            generated_at: current_unix_seconds(),
            prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
            response_format: None,
            basis_notice: "基于本地笔记生成，不代表整本书全文内容。".to_string(),
            feedback_outcome_summary: None,
        },
        cached_updated_at: None,
        error_message: None,
    }
}

fn require_ai_credential_for_uncached_summary(
    api_key: Result<String, AiServiceError>,
) -> Result<String, AiServiceError> {
    api_key
}

fn empty_reading_stats_review_response(
    stats: &ReadingStatsRecord,
    input_hash: &str,
    source_stats: ReadingStatsAiReviewSourceStats,
) -> ReadingStatsAiReviewResponse {
    ReadingStatsAiReviewResponse {
        mode: stats.mode.clone(),
        base_time: stats.base_time,
        prompt_version: READING_STATS_REVIEW_PROMPT_VERSION.to_string(),
        input_hash: input_hash.to_string(),
        provider_model: None,
        source: BookAiSummarySource::Empty,
        review: ReadingStatsAiReview {
            overview: "当前周期还没有可用于 AI 阅读复盘的统计数据。".to_string(),
            rhythm_insights: Vec::new(),
            preference_insights: Vec::new(),
            focus_items: Vec::new(),
            next_actions: Vec::new(),
            reading_persona: None,
            source_stats,
            generated_at: current_unix_seconds(),
            prompt_version: READING_STATS_REVIEW_PROMPT_VERSION.to_string(),
            response_format: None,
            basis_notice: "基于结构化阅读统计生成，不包含笔记正文或书籍全文。".to_string(),
        },
        cached_updated_at: None,
        error_message: None,
    }
}

fn sanitize_cached_reading_review(mut review: ReadingStatsAiReview) -> ReadingStatsAiReview {
    review.overview = humanize_review_text(&review.overview);
    review.rhythm_insights = review
        .rhythm_insights
        .into_iter()
        .map(|item| humanize_review_text(&item))
        .collect();
    review.preference_insights = review
        .preference_insights
        .into_iter()
        .map(|item| humanize_review_text(&item))
        .collect();
    review.focus_items = review
        .focus_items
        .into_iter()
        .map(|item| humanize_review_text(&item))
        .collect();
    review.next_actions = review
        .next_actions
        .into_iter()
        .map(|item| humanize_review_text(&item))
        .collect();
    review.reading_persona = review.reading_persona.and_then(|patch| {
        let summary = patch
            .summary
            .as_deref()
            .map(humanize_review_text)
            .filter(|text| !text.trim().is_empty());
        let suggestion = patch
            .suggestion
            .as_deref()
            .map(humanize_review_text)
            .filter(|text| !text.trim().is_empty());

        if summary.is_none() && suggestion.is_none() {
            return None;
        }

        Some(ReadingPersonaPatch {
            summary,
            suggestion,
        })
    });
    review
}

fn normalize_route_book_input(
    book: ReadingRouteBookInput,
) -> Result<ReadingRouteBookInput, AiServiceError> {
    let book_id = normalize_route_text("bookId", &book.book_id, 128)?;
    let title = normalize_route_text("title", &book.title, 160)?;

    Ok(ReadingRouteBookInput {
        book_id,
        title,
        author: normalize_route_optional(book.author, 120),
        category: normalize_route_optional(book.category, 120),
        local_status: normalize_route_optional(book.local_status, 40),
        progress_percent: book.progress_percent.map(|value| value.clamp(0, 100)),
        is_finished: book.is_finished,
    })
}

fn normalize_route_candidates(
    candidates: Vec<ReadingRouteBookInput>,
    current_book_id: &str,
) -> Result<Vec<ReadingRouteBookInput>, AiServiceError> {
    let mut seen = HashSet::from([current_book_id.to_string()]);
    let mut normalized = Vec::new();

    for candidate in candidates {
        let candidate = normalize_route_book_input(candidate)?;
        if !seen.insert(candidate.book_id.clone()) {
            continue;
        }

        normalized.push(candidate);
        if normalized.len() >= MAX_ROUTE_CANDIDATES {
            break;
        }
    }

    Ok(normalized)
}

fn normalize_book_decision_candidates(
    candidates: Vec<BookDecisionCandidateInput>,
) -> Result<Vec<BookDecisionCandidateInput>, AiServiceError> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for candidate in candidates {
        let candidate = normalize_book_decision_candidate_input(candidate)?;
        if !seen.insert(candidate.book_id.clone()) {
            continue;
        }

        normalized.push(candidate);
        if normalized.len() >= MAX_BOOK_DECISION_CANDIDATES {
            break;
        }
    }

    Ok(normalized)
}

fn normalize_book_decision_candidate_input(
    book: BookDecisionCandidateInput,
) -> Result<BookDecisionCandidateInput, AiServiceError> {
    let book_id = normalize_route_text("bookId", &book.book_id, 128)?;
    let title = normalize_route_text("title", &book.title, 160)?;

    Ok(BookDecisionCandidateInput {
        book_id,
        title,
        author: normalize_route_optional(book.author, 120),
        category: normalize_route_optional(book.category, 120),
        local_status: normalize_route_optional(book.local_status, 40),
    })
}

fn normalize_route_text(
    field_name: &str,
    value: &str,
    max_len: usize,
) -> Result<String, AiServiceError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AiServiceError::InvalidProviderOutput(format!(
            "阅读指南输入 {field_name} 不能为空。"
        )));
    }

    if trimmed.chars().count() > max_len {
        return Err(AiServiceError::InvalidProviderOutput(format!(
            "阅读指南输入 {field_name} 过长。"
        )));
    }

    Ok(trimmed.to_string())
}

fn normalize_route_optional(value: Option<String>, max_len: usize) -> Option<String> {
    value
        .map(|item| item.trim().chars().take(max_len).collect::<String>())
        .filter(|item| !item.is_empty())
}

fn sanitize_cached_reading_route(mut route: ReadingRoute) -> ReadingRoute {
    route.route_overview = humanize_route_text(&route.route_overview);
    route.books = route
        .books
        .into_iter()
        .map(sanitize_reading_route_book)
        .collect();
    route.dependencies = route
        .dependencies
        .into_iter()
        .map(sanitize_reading_route_dependency)
        .collect();
    route.review_checkpoints = route
        .review_checkpoints
        .into_iter()
        .map(sanitize_reading_route_checkpoint)
        .collect();
    route.next_actions = route
        .next_actions
        .into_iter()
        .map(|item| humanize_route_text(&item))
        .collect();
    if let Some(summary) = route.feedback_outcome_summary.as_mut() {
        summary.summary = humanize_route_text(&summary.summary);
        summary.applied_changes = summary
            .applied_changes
            .iter()
            .map(|item| humanize_route_text(item))
            .filter(|item| !item.is_empty())
            .take(3)
            .collect();
    }
    route
}

fn reading_stage_value(value: Option<&Value>) -> Option<ReadingStageSignal> {
    value
        .cloned()
        .and_then(|item| serde_json::from_value::<ReadingStageSignal>(item).ok())
}

fn feedback_outcome_summary_value(value: Option<&Value>) -> Option<FeedbackOutcomeSummary> {
    let value = value?;
    let summary = string_value_any(value, &["summary", "overview", "成果回顾"])
        .map(|item| humanize_route_text(&item))
        .filter(|item| !item.is_empty())?;
    let applied_changes = string_list_any(
        value,
        &["appliedChanges", "applied_changes", "changes", "调整说明"],
    )
    .into_iter()
    .map(|item| humanize_route_text(&item))
    .filter(|item| !item.is_empty())
    .take(3)
    .collect();

    Some(FeedbackOutcomeSummary {
        summary,
        applied_changes,
    })
}

fn sanitize_cached_book_decision(mut decision: BookDecision) -> BookDecision {
    decision.decision_overview = humanize_route_text(&decision.decision_overview);
    decision.top_candidates = decision
        .top_candidates
        .into_iter()
        .map(sanitize_book_decision_candidate)
        .collect();
    decision.deferred_candidates = decision
        .deferred_candidates
        .into_iter()
        .map(sanitize_book_decision_deferred)
        .collect();
    let primary_title = decision
        .top_candidates
        .first()
        .map(|candidate| candidate.title.clone());
    decision.next_actions = decision
        .next_actions
        .into_iter()
        .map(|item| humanize_book_decision_action(&item, primary_title.as_deref()))
        .collect();
    decision
}

fn sanitize_book_decision_candidate(
    mut candidate: BookDecisionTopCandidate,
) -> BookDecisionTopCandidate {
    candidate.why_now = humanize_route_text(&candidate.why_now);
    candidate.tradeoff = humanize_route_text(&candidate.tradeoff);
    candidate.estimated_effort = humanize_route_text(&candidate.estimated_effort);
    candidate.prerequisite_action = humanize_route_text(&candidate.prerequisite_action);
    candidate.review_trigger = humanize_route_text(&candidate.review_trigger);
    candidate.basis = humanize_route_text(&candidate.basis);
    candidate
}

fn sanitize_book_decision_deferred(
    mut candidate: BookDecisionDeferredCandidate,
) -> BookDecisionDeferredCandidate {
    candidate.reason = humanize_route_text(&candidate.reason);
    candidate
}

fn sanitize_reading_route_book(mut book: ReadingRouteBookStep) -> ReadingRouteBookStep {
    book.role = humanize_route_text(&book.role);
    book.reading_purpose = humanize_route_text(&book.reading_purpose);
    book.estimated_effort = humanize_route_text(&book.estimated_effort);
    book.local_status = book
        .local_status
        .map(|local_status| humanize_route_text(&local_status));
    book.basis = humanize_route_text(&book.basis);
    book
}

fn sanitize_reading_route_checkpoint(
    mut checkpoint: ReadingRouteCheckpoint,
) -> ReadingRouteCheckpoint {
    checkpoint.timing = humanize_route_text(&checkpoint.timing);
    checkpoint.question = humanize_route_text(&checkpoint.question);
    checkpoint.suggested_output = humanize_route_text(&checkpoint.suggested_output);
    checkpoint
}

fn sanitize_reading_route_dependency(
    mut dependency: ReadingRouteDependency,
) -> ReadingRouteDependency {
    dependency.reason = humanize_route_text(&dependency.reason);
    dependency
}

fn validate_reading_route_quality(route: &ReadingRoute) -> Result<(), AiServiceError> {
    if route.source_stats.candidate_count > 0 || route.books.len() != 1 {
        return Ok(());
    }

    let Some(book) = route.books.first() else {
        return Ok(());
    };

    let checkpoint_text = route
        .review_checkpoints
        .iter()
        .map(|checkpoint| {
            format!(
                "{} {} {}",
                checkpoint.timing, checkpoint.question, checkpoint.suggested_output
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let actions_text = route.next_actions.join(" ");

    if has_concrete_reading_scope(book)
        && has_concrete_review_output(&checkpoint_text)
        && has_concrete_action_standard(&actions_text)
        && !is_generic_single_book_guidance(book, &checkpoint_text, &actions_text)
    {
        return Ok(());
    }

    Err(AiServiceError::InvalidProviderOutput(
        "AI 返回的单书阅读指南缺少具体阅读范围、复盘输出或验收标准，请重新生成。".to_string(),
    ))
}

fn has_concrete_reading_scope(book: &ReadingRouteBookStep) -> bool {
    let text = format!(
        "{} {} {}",
        book.reading_purpose, book.estimated_effort, book.basis
    );

    contains_any(
        &text,
        &[
            "第",
            "章",
            "节",
            "页",
            "%",
            "当前进度",
            "下一段",
            "本周",
            "今天",
            "分钟",
            "小时",
            "阅读时段",
        ],
    )
}

fn has_concrete_review_output(text: &str) -> bool {
    contains_any(
        text,
        &[
            "1", "2", "3", "一", "二", "三", "条", "个", "份", "页", "清单", "标准", "输出", "写",
        ],
    )
}

fn has_concrete_action_standard(text: &str) -> bool {
    contains_any(
        text,
        &[
            "完成标准",
            "验收",
            "分钟",
            "小时",
            "今天",
            "本周",
            "一周",
            "24小时",
            "记录",
            "保存",
            "输出",
            "写",
            "条",
        ],
    )
}

fn is_generic_single_book_guidance(
    book: &ReadingRouteBookStep,
    checkpoint_text: &str,
    actions_text: &str,
) -> bool {
    let text = format!(
        "{} {} {} {} {}",
        book.reading_purpose, book.estimated_effort, book.basis, checkpoint_text, actions_text
    );

    contains_any(
        &text,
        &[
            "建立稳定",
            "整书复盘沉淀",
            "沉淀模板",
            "长期投入",
            "可复用方法论",
            "持续推进",
        ],
    ) && !contains_any(
        &text,
        &["第", "章", "页", "%", "分钟", "小时", "完成标准", "验收"],
    )
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn read_route_item_states(
    connection: &rusqlite::Connection,
    book_ids: &[String],
) -> Result<HashMap<String, Value>, AiServiceError> {
    let mut states = HashMap::new();
    let mut statement = connection
        .prepare(
            "
            SELECT item_id, item_type, status, title, author, category, note, updated_at
            FROM reading_item_states
            WHERE item_id = ?1
            ",
        )
        .map_err(AiServiceError::storage)?;

    for book_id in book_ids {
        if let Some(state) = statement
            .query_row([book_id], |row| {
                Ok(json!({
                    "itemId": row.get::<_, String>(0)?,
                    "itemType": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "title": row.get::<_, Option<String>>(3)?,
                    "author": row.get::<_, Option<String>>(4)?,
                    "category": row.get::<_, Option<String>>(5)?,
                    "note": row.get::<_, Option<String>>(6)?,
                    "updatedAt": row.get::<_, String>(7)?
                }))
            })
            .optional()
            .map_err(AiServiceError::storage)?
        {
            states.insert(book_id.clone(), state);
        }
    }

    Ok(states)
}

fn read_route_book_summaries(
    connection: &rusqlite::Connection,
    book_ids: &[String],
) -> Result<HashMap<String, Value>, AiServiceError> {
    let mut summaries = HashMap::new();

    for book_id in book_ids {
        let Some(cached) = read_latest_ai_output(
            connection,
            BOOK_NOTES_SUMMARY_FEATURE,
            book_id,
            BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        )?
        else {
            continue;
        };
        let summary = serde_json::from_value::<BookAiSummary>(cached.output).map_err(|_| {
            AiServiceError::InvalidProviderOutput("本地 AI 总结缓存无法解析。".to_string())
        })?;

        summaries.insert(
            book_id.clone(),
            json!({
                "overview": summary.overview,
                "keyIdeas": summary.key_ideas,
                "myFocus": summary.my_focus,
                "actionItems": summary.action_items,
                "themeTags": summary.theme_tags,
                "sourceStats": summary.source_stats,
                "promptVersion": summary.prompt_version,
                "cachedUpdatedAt": cached.updated_at
            }),
        );
    }

    Ok(summaries)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RouteBookProgress {
    progress_percent: i64,
    chapter_uid: Option<i64>,
    is_finished: bool,
}

fn read_route_book_progress(
    connection: &rusqlite::Connection,
    book_ids: &[String],
) -> Result<HashMap<String, RouteBookProgress>, AiServiceError> {
    let mut progress_by_book = HashMap::new();
    let mut statement = connection
        .prepare(
            "
            SELECT progress_percent, chapter_uid, finish_time
            FROM book_progress
            WHERE book_id = ?1
            ",
        )
        .map_err(AiServiceError::storage)?;

    for book_id in book_ids {
        if let Some(progress) = statement
            .query_row([book_id], |row| {
                let progress_percent = row.get::<_, i64>(0)?.clamp(0, 100);
                let finish_time = row.get::<_, Option<i64>>(2)?;
                Ok(RouteBookProgress {
                    progress_percent,
                    chapter_uid: row.get(1)?,
                    is_finished: progress_percent == 100 && finish_time.unwrap_or(0) > 0,
                })
            })
            .optional()
            .map_err(AiServiceError::storage)?
        {
            progress_by_book.insert(book_id.clone(), progress);
        }
    }

    Ok(progress_by_book)
}

fn read_route_chapter_signals(
    connection: &rusqlite::Connection,
    book_ids: &[String],
) -> Result<HashMap<String, ChapterSignals>, AiServiceError> {
    let mut signals = HashMap::new();
    let mut count_statement = connection
        .prepare("SELECT COUNT(*) FROM chapters WHERE book_id = ?1")
        .map_err(AiServiceError::storage)?;
    let mut current_statement = connection
        .prepare(
            "
            SELECT title
            FROM chapters
            WHERE book_id = ?1 AND chapter_uid = (
                SELECT chapter_uid FROM book_progress WHERE book_id = ?1
            )
            ",
        )
        .map_err(AiServiceError::storage)?;
    let mut progress_statement = connection
        .prepare("SELECT chapter_uid FROM book_progress WHERE book_id = ?1")
        .map_err(AiServiceError::storage)?;

    for book_id in book_ids {
        let chapter_count = count_statement
            .query_row([book_id], |row| row.get::<_, i64>(0))
            .map_err(AiServiceError::storage)?
            .max(0) as usize;
        let current_chapter_uid = progress_statement
            .query_row([book_id], |row| row.get::<_, Option<i64>>(0))
            .optional()
            .map_err(AiServiceError::storage)?
            .flatten();
        let current_chapter_title = current_statement
            .query_row([book_id], |row| row.get::<_, String>(0))
            .optional()
            .map_err(AiServiceError::storage)?;

        signals.insert(
            book_id.clone(),
            ChapterSignals {
                has_cached_chapters: chapter_count > 0,
                chapter_count,
                current_chapter_uid,
                current_chapter_title,
                fallback:
                    "章节缺失或目录未缓存时，回退到阅读进度、最近笔记、本地状态和已有复盘摘要。"
                        .to_string(),
            },
        );
    }

    Ok(signals)
}

fn default_chapter_signals(current_chapter_uid: Option<i64>) -> ChapterSignals {
    ChapterSignals {
        has_cached_chapters: false,
        chapter_count: 0,
        current_chapter_uid,
        current_chapter_title: None,
        fallback: "章节缺失或目录未缓存时，回退到阅读进度、最近笔记、本地状态和已有复盘摘要。"
            .to_string(),
    }
}

fn reading_stage_signal(progress_percent: i64, is_finished: bool) -> ReadingStageSignal {
    let progress_percent = progress_percent.clamp(0, 100);
    let (stage, label, refresh_reason) = if is_finished || progress_percent >= 100 {
        ("completed", "完成归档", Some("completed"))
    } else if progress_percent >= 70 {
        ("closing", "收束整理", Some("stage_changed"))
    } else if progress_percent >= 40 {
        ("deepening", "深入推进", Some("stage_changed"))
    } else if progress_percent >= 15 {
        ("framing", "建立主线", Some("stage_changed"))
    } else {
        ("starting", "起步", None)
    };

    ReadingStageSignal {
        stage: stage.to_string(),
        label: label.to_string(),
        progress_percent,
        refresh_reason: refresh_reason.map(str::to_string),
    }
}

fn read_route_latest_stats_review(
    connection: &rusqlite::Connection,
) -> Result<Option<Value>, AiServiceError> {
    let Some(cached) = read_latest_feature_output(
        connection,
        READING_STATS_REVIEW_FEATURE,
        READING_STATS_REVIEW_PROMPT_VERSION,
    )?
    else {
        return Ok(None);
    };
    let review = serde_json::from_value::<ReadingStatsAiReview>(cached.output).map_err(|_| {
        AiServiceError::InvalidProviderOutput("本地 AI 阅读复盘缓存无法解析。".to_string())
    })?;

    Ok(Some(json!({
        "overview": review.overview,
        "rhythmInsights": review.rhythm_insights,
        "preferenceInsights": review.preference_insights,
        "focusItems": review.focus_items,
        "nextActions": review.next_actions,
        "sourceStats": review.source_stats,
        "promptVersion": review.prompt_version,
        "cachedUpdatedAt": cached.updated_at
    })))
}

fn read_route_latest_stats(
    connection: &rusqlite::Connection,
) -> Result<Option<ReadingStatsRecord>, AiServiceError> {
    connection
        .query_row(
            "
            SELECT mode, base_time, raw_json
            FROM reading_stats
            ORDER BY updated_at DESC
            LIMIT 1
            ",
            [],
            |row| {
                let mode: String = row.get(0)?;
                let base_time: i64 = row.get(1)?;
                let raw_json: String = row.get(2)?;
                let raw = serde_json::from_str::<Value>(&raw_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(crate::mappers::stats::map_reading_stats_response(
                    &mode,
                    &raw,
                    Some(base_time),
                ))
            },
        )
        .optional()
        .map_err(AiServiceError::storage)
}

fn route_stats_signal_payload(stats: ReadingStatsRecord) -> Value {
    let mode = stats.mode;
    let base_time = stats.base_time;
    let read_days = stats.read_days;
    let total_read_time_seconds = stats.total_read_time_seconds;
    let day_average_read_time_seconds = stats.day_average_read_time_seconds;
    let longest_items = stats
        .longest_items
        .into_iter()
        .take(5)
        .map(|item| {
            json!({
                "title": item.title,
                "author": item.author,
                "type": item.item_type,
                "displayDuration": format_duration_readable(item.read_time_seconds),
                "tags": item.tags
            })
        })
        .collect::<Vec<_>>();
    let categories = stats
        .categories
        .into_iter()
        .take(8)
        .map(|category| {
            json!({
                "title": category.title,
                "parentTitle": category.parent_title,
                "displayDuration": category.reading_time_seconds.map(format_duration_readable),
                "readingCount": category.reading_count
            })
        })
        .collect::<Vec<_>>();

    json!({
        "mode": mode,
        "baseTime": base_time,
        "displayPeriod": format_stats_period(&mode, base_time),
        "readDays": read_days,
        "displayTotalReadTime": total_read_time_seconds.map(format_duration_readable),
        "displayDayAverageReadTime": day_average_read_time_seconds.map(format_duration_readable),
        "longestItems": longest_items,
        "categories": categories
    })
}

fn book_decision_stats_signal_payload(stats: ReadingStatsRecord) -> Value {
    let mode = stats.mode;
    let base_time = stats.base_time;
    let longest_items = stats
        .longest_items
        .into_iter()
        .take(3)
        .map(|item| {
            json!({
                "title": item.title,
                "author": item.author,
                "type": item.item_type,
                "displayDuration": format_duration_readable(item.read_time_seconds),
                "tags": item.tags
            })
        })
        .collect::<Vec<_>>();
    let categories = stats
        .categories
        .into_iter()
        .take(5)
        .map(|category| {
            json!({
                "title": category.title,
                "parentTitle": category.parent_title,
                "displayDuration": category.reading_time_seconds.map(format_duration_readable),
                "readingCount": category.reading_count
            })
        })
        .collect::<Vec<_>>();

    json!({
        "mode": mode,
        "baseTime": base_time,
        "displayPeriod": format_stats_period(&mode, base_time),
        "longestItems": longest_items,
        "categories": categories
    })
}

fn reading_route_book_steps(
    value: Option<&Value>,
    allowed_book_ids: &HashSet<String>,
) -> Vec<ReadingRouteBookStep> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    let mut seen = HashSet::new();
    items
        .iter()
        .filter_map(|item| {
            let book_id = string_value_any(item, &["bookId", "book_id", "id", "书籍ID"])?;
            if !allowed_book_ids.contains(&book_id) || !seen.insert(book_id.clone()) {
                return None;
            }

            Some(ReadingRouteBookStep {
                book_id,
                title: string_value_any(item, &["title", "bookTitle", "书名"])
                    .unwrap_or_else(|| "未命名书籍".to_string()),
                author: string_value_any(item, &["author", "作者"]),
                order: positive_usize_value_any(item, &["order", "step", "sequence", "顺序"])
                    .unwrap_or(seen.len()),
                role: string_value_any(item, &["role", "定位", "角色"])
                    .unwrap_or_else(|| "路线节点".to_string()),
                reading_purpose: string_value_any(
                    item,
                    &["readingPurpose", "reading_purpose", "purpose", "阅读目的"],
                )
                .unwrap_or_else(|| "围绕当前主题继续阅读。".to_string()),
                estimated_effort: string_value_any(
                    item,
                    &["estimatedEffort", "estimated_effort", "effort", "预计投入"],
                )
                .unwrap_or_else(|| "按个人节奏安排".to_string()),
                local_status: string_value_any(item, &["localStatus", "local_status", "status"]),
                basis: string_value_any(item, &["basis", "reason", "依据", "理由"])
                    .unwrap_or_else(|| "基于输入中的书籍、复盘或本地状态。".to_string()),
            })
        })
        .take(MAX_ROUTE_CANDIDATES + 1)
        .collect()
}

fn book_decision_top_candidates(
    value: Option<&Value>,
    allowed_book_ids: &HashSet<String>,
) -> Vec<BookDecisionTopCandidate> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    let mut seen = HashSet::new();
    items
        .iter()
        .filter_map(|item| {
            let book_id = string_value_any(item, &["bookId", "book_id", "id", "书籍ID"])?;
            if !allowed_book_ids.contains(&book_id) || !seen.insert(book_id.clone()) {
                return None;
            }

            Some(BookDecisionTopCandidate {
                book_id,
                title: string_value_any(item, &["title", "bookTitle", "书名"])
                    .unwrap_or_else(|| "未命名书籍".to_string()),
                author: string_value_any(item, &["author", "作者"]),
                rank: positive_usize_value_any(item, &["rank", "order", "排序"])
                    .unwrap_or(seen.len()),
                why_now: string_value_any(item, &["whyNow", "why_now", "reason", "为什么现在读"])
                    .unwrap_or_else(|| "当前候选中最适合先推进。".to_string()),
                tradeoff: string_value_any(item, &["tradeoff", "tradeOff", "取舍理由"])
                    .unwrap_or_else(|| "先读这本意味着暂缓其他候选。".to_string()),
                estimated_effort: string_value_any(
                    item,
                    &["estimatedEffort", "estimated_effort", "effort", "预计投入"],
                )
                .unwrap_or_else(|| "按个人节奏安排".to_string()),
                prerequisite_action: string_value_any(
                    item,
                    &[
                        "prerequisiteAction",
                        "prerequisite_action",
                        "preAction",
                        "前置动作",
                    ],
                )
                .unwrap_or_else(|| "先打开详情确认阅读意图。".to_string()),
                review_trigger: string_value_any(
                    item,
                    &["reviewTrigger", "review_trigger", "trigger", "复盘触发点"],
                )
                .unwrap_or_else(|| "读完第一个关键节点后写一段简短复盘。".to_string()),
                basis: string_value_any(item, &["basis", "依据"])
                    .unwrap_or_else(|| "基于本地候选和结构化信号。".to_string()),
            })
        })
        .take(3)
        .collect()
}

fn book_decision_deferred_candidates(
    value: Option<&Value>,
    allowed_book_ids: &HashSet<String>,
) -> Vec<BookDecisionDeferredCandidate> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    let mut seen = HashSet::new();
    items
        .iter()
        .filter_map(|item| {
            let book_id = string_value_any(item, &["bookId", "book_id", "id", "书籍ID"])?;
            if !allowed_book_ids.contains(&book_id) || !seen.insert(book_id.clone()) {
                return None;
            }

            Some(BookDecisionDeferredCandidate {
                book_id,
                title: string_value_any(item, &["title", "bookTitle", "书名"])
                    .unwrap_or_else(|| "未命名书籍".to_string()),
                reason: string_value_any(item, &["reason", "basis", "暂缓理由", "理由"])
                    .unwrap_or_else(|| "当前不是最优先的下一本。".to_string()),
            })
        })
        .take(MAX_BOOK_DECISION_CANDIDATES)
        .collect()
}

fn fallback_reading_route_overview(
    books: &[ReadingRouteBookStep],
    source_stats: &ReadingRouteSourceStats,
) -> String {
    let Some(first_book) = books.first() else {
        return "这份阅读指南基于当前输入生成，建议先确认当前书的阅读目的，再决定下一步是否补充候选书。".to_string();
    };

    if source_stats.candidate_count == 0 || books.len() == 1 {
        return format!(
            "围绕《{}》先完成关键阅读、复盘输出和可执行沉淀。",
            first_book.title
        );
    }

    let last_title = books
        .last()
        .map(|book| book.title.as_str())
        .unwrap_or(first_book.title.as_str());

    format!(
        "从《{}》出发，先完成当前书复盘，再推进到《{}》等候选节点。",
        first_book.title, last_title
    )
}

fn reading_route_dependencies(
    value: Option<&Value>,
    allowed_book_ids: &HashSet<String>,
) -> Vec<ReadingRouteDependency> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let from_book_id =
                string_value_any(item, &["fromBookId", "from_book_id", "from", "前置书"])?;
            let to_book_id = string_value_any(item, &["toBookId", "to_book_id", "to", "后续书"])?;

            if !allowed_book_ids.contains(&from_book_id) || !allowed_book_ids.contains(&to_book_id)
            {
                return None;
            }

            Some(ReadingRouteDependency {
                from_book_id,
                to_book_id,
                reason: string_value_any(item, &["reason", "basis", "理由", "依赖原因"])
                    .unwrap_or_else(|| "阅读理解上的前后关系。".to_string()),
            })
        })
        .take(MAX_ROUTE_CANDIDATES)
        .collect()
}

fn reading_route_checkpoints(value: Option<&Value>) -> Vec<ReadingRouteCheckpoint> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            Some(ReadingRouteCheckpoint {
                timing: string_value_any(item, &["timing", "time", "触发时机"])
                    .unwrap_or_else(|| "读完一个节点后".to_string()),
                question: string_value_any(item, &["question", "prompt", "复盘问题"])?,
                suggested_output: string_value_any(
                    item,
                    &[
                        "suggestedOutput",
                        "suggested_output",
                        "output",
                        "建议输出物",
                    ],
                )
                .unwrap_or_else(|| "写一段简短复盘".to_string()),
            })
        })
        .take(6)
        .collect()
}

fn positive_usize_value_any(value: &Value, keys: &[&str]) -> Option<usize> {
    keys.iter().find_map(|key| match value.get(*key) {
        Some(Value::Number(number)) => number
            .as_u64()
            .and_then(|value| usize::try_from(value).ok()),
        Some(Value::String(text)) => text.trim().parse::<usize>().ok(),
        _ => None,
    })
}

fn reading_route_source_count(source_stats: &ReadingRouteSourceStats) -> i64 {
    (source_stats.current_book_count
        + source_stats.candidate_count
        + source_stats.summary_count
        + source_stats.stats_signal_count
        + source_stats.local_status_count) as i64
}

fn book_decision_source_count(source_stats: &BookDecisionSourceStats) -> i64 {
    (source_stats.candidate_count
        + source_stats.summary_count
        + source_stats.stats_signal_count
        + source_stats.local_status_count) as i64
}

fn humanize_review_text(text: &str) -> String {
    let mut normalized = text.to_string();

    for raw in [
        "totalReadTimeSeconds",
        "dayAverageReadTimeSeconds",
        "readTimeSeconds",
        "readingTimeSeconds",
    ] {
        normalized = normalized.replace(raw, "阅读时长");
    }

    normalized = normalized.replace("baseTime", "周期基准日");
    normalized = normalized.replace("startTime", "时间点");

    normalized = replace_unix_timestamps(&normalized);
    normalized = replace_duration_seconds(&normalized);
    normalized
}

fn humanize_route_text(text: &str) -> String {
    let mut normalized = text.to_string();

    for (raw, replacement) in [
        ("latestStatsReview.nextActions", "阅读统计中的下一步建议"),
        ("latestStatsReview.rhythmInsights", "阅读节奏洞察"),
        ("latestStatsReview.preferenceInsights", "阅读偏好洞察"),
        (
            "latestStatsSignals.sourceStats.candidateCount",
            "候选书数量",
        ),
        ("latestStatsSignals", "阅读统计"),
        ("latestStatsReview", "阅读复盘"),
        ("currentCore", "当前书信息"),
        ("candidateCount", "候选书数量"),
        ("sourceStats", "来源统计"),
        ("summary", "本书复盘"),
    ] {
        normalized = normalized.replace(raw, replacement);
    }

    normalized = remove_technical_parentheticals(&normalized);
    normalized = humanize_review_text(&normalized);
    collapse_spaces(&normalized)
}

fn humanize_book_decision_action(text: &str, primary_title: Option<&str>) -> String {
    let normalized = humanize_route_text(text);
    match normalized.trim() {
        "openDetails" => primary_title
            .map(|title| format!("打开《{}》详情，确认目录和试读入口。", title))
            .unwrap_or_else(|| "打开推荐书详情，确认目录和试读入口。".to_string()),
        "scheduleReadingBlock" => "安排一个 30-45 分钟阅读时段，先完成第一段试读。".to_string(),
        "postReadReview" => "读完后写 3 条复盘：收获、疑问、下一步。".to_string(),
        other if looks_like_internal_action_token(other) => primary_title
            .map(|title| format!("围绕《{}》完成一次可验证的阅读动作。", title))
            .unwrap_or_else(|| "完成一次可验证的阅读动作。".to_string()),
        _ => normalized,
    }
}

fn looks_like_internal_action_token(text: &str) -> bool {
    let mut has_lowercase = false;
    let mut has_uppercase_after_lowercase = false;

    for ch in text.chars() {
        if ch.is_ascii_lowercase() {
            has_lowercase = true;
        } else if ch.is_ascii_uppercase() && has_lowercase {
            has_uppercase_after_lowercase = true;
        } else if !ch.is_ascii_digit() {
            return false;
        }
    }

    has_lowercase && has_uppercase_after_lowercase
}

fn remove_technical_parentheticals(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '(' || ch == '（' {
            let closing = if ch == '(' { ')' } else { '）' };
            let mut inner = String::new();
            let mut found_closing = false;

            while let Some(next) = chars.next() {
                if next == closing {
                    found_closing = true;
                    break;
                }
                inner.push(next);
            }

            if found_closing && looks_like_technical_fragment(&inner) {
                continue;
            }

            result.push(ch);
            result.push_str(&inner);
            if found_closing {
                result.push(closing);
            }
            continue;
        }

        result.push(ch);
    }

    result
}

fn looks_like_technical_fragment(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    trimmed.contains('=')
        || trimmed.contains("latestStats")
        || trimmed.contains("currentCore")
        || trimmed.contains("sourceStats")
        || trimmed.contains("candidateCount")
        || trimmed.contains(".")
}

fn collapse_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn replace_duration_seconds(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut result = String::with_capacity(text.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index].is_ascii_digit() {
            let start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }

            let digits = &text[start..index];
            let next = text[index..].chars().next();
            if matches!(next, Some('秒')) {
                if let Ok(seconds) = digits.parse::<i64>() {
                    result.push_str(&format_duration_readable(seconds));
                } else {
                    result.push_str(digits);
                    result.push('秒');
                }
                index += '秒'.len_utf8();
                continue;
            }

            result.push_str(digits);
            continue;
        }

        let ch = text[index..].chars().next().unwrap_or_default();
        result.push(ch);
        index += ch.len_utf8();
    }

    result
}

fn replace_unix_timestamps(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut result = String::with_capacity(text.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index].is_ascii_digit() {
            let start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            let digits = &text[start..index];
            if digits.len() >= 10 {
                if let Ok(timestamp) = digits.parse::<i64>() {
                    if let Some(label) = format_timestamp_label(timestamp) {
                        result.push_str(&label);
                        continue;
                    }
                }
            }

            result.push_str(digits);
            continue;
        }

        let ch = text[index..].chars().next().unwrap_or_default();
        result.push(ch);
        index += ch.len_utf8();
    }

    result
}

fn format_duration_readable(total_seconds: i64) -> String {
    if total_seconds <= 0 {
        return "0分钟".to_string();
    }

    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;

    if hours > 0 && minutes > 0 {
        return format!("{hours}小时{minutes}分钟");
    }

    if hours > 0 {
        return format!("{hours}小时");
    }

    format!("{}分钟", minutes.max(1))
}

fn format_stats_period(mode: &str, base_time: i64) -> Option<String> {
    if base_time <= 0 {
        return if mode == "overall" {
            Some("全部历史".to_string())
        } else {
            None
        };
    }

    let (year, month, day) = timestamp_ymd(base_time)?;
    let label = match mode {
        "weekly" => format!("{month}月{day}日所在周期"),
        "monthly" => format!("{year}年{month}月"),
        "annually" => format!("{year}年"),
        "overall" => "全部历史".to_string(),
        _ => format!("{year}年{month}月{day}日"),
    };

    Some(label)
}

fn format_bucket_display_label(mode: &str, timestamp: i64) -> Option<String> {
    let (year, month, day) = timestamp_ymd(timestamp)?;
    let label = match mode {
        "overall" => format!("{year}年"),
        "annually" => format!("{month}月"),
        _ => format!("{month}月{day}日"),
    };

    Some(label)
}

fn format_timestamp_label(timestamp: i64) -> Option<String> {
    let (year, month, day) = timestamp_ymd(timestamp)?;
    Some(format!("{year}年{month}月{day}日"))
}

fn timestamp_ymd(timestamp: i64) -> Option<(i32, u32, u32)> {
    if !(0..=4_102_444_800).contains(&timestamp) {
        return None;
    }

    let datetime = chrono::DateTime::from_timestamp(timestamp, 0)?;
    let local = datetime.with_timezone(&chrono::Local);
    Some((local.year(), local.month(), local.day()))
}

fn reading_stats_scope_id(stats: &ReadingStatsRecord) -> String {
    format!("{}:{}", stats.mode, stats.base_time)
}

fn normalize_optional_book_ids(book_ids: Option<Vec<String>>) -> Option<Vec<String>> {
    book_ids
        .map(|ids| {
            ids.into_iter()
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|ids| !ids.is_empty())
}

fn serialize_book_summary_export_index(
    export_id: &str,
    exported_at: &str,
    items: &[(String, BookSummaryExportItem)],
) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# 书籍复盘导出索引");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 导出 ID：{export_id}");
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(markdown, "- 复盘数量：{} 本", items.len());
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "> 本导出只包含已经生成的书籍复盘缓存，不会自动生成复盘，也不会同步或读取远端笔记。"
    );
    let _ = writeln!(markdown);

    for (index, (file_name, item)) in items.iter().enumerate() {
        let _ = writeln!(markdown, "## {}. {}", index + 1, item.title);
        let _ = writeln!(markdown);
        let _ = writeln!(markdown, "- 书籍 ID：{}", item.book_id);
        let _ = writeln!(
            markdown,
            "- 作者：{}",
            item.author.as_deref().unwrap_or("未知作者")
        );
        let _ = writeln!(markdown, "- 文件：{file_name}");
        let _ = writeln!(markdown, "- 缓存更新：{}", item.cached_updated_at);
        let _ = writeln!(markdown, "- Prompt 版本：{}", item.prompt_version);
        if let Some(provider_model) = item.provider_model.as_deref() {
            let _ = writeln!(markdown, "- 模型：{provider_model}");
        }
        let _ = writeln!(markdown);
    }

    markdown
}

fn sanitize_file_stem(title: &str, fallback: &str) -> String {
    let sanitized = title
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim_matches(&[' ', '.'][..])
        .chars()
        .take(80)
        .collect::<String>();

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn is_empty_reading_stats(stats: &ReadingStatsRecord) -> bool {
    stats.total_read_time_seconds.unwrap_or(0) <= 0
        && stats.read_days.unwrap_or(0) <= 0
        && stats.buckets.is_empty()
        && stats.longest_items.is_empty()
        && stats.categories.is_empty()
}

fn reading_stats_source_count(stats: &ReadingStatsRecord) -> i64 {
    (stats.buckets.len() + stats.longest_items.len() + stats.categories.len()) as i64
}

fn stable_hash_json(value: &Value) -> Result<String, AiServiceError> {
    let canonical = canonicalize_json(value);
    let bytes = serde_json::to_vec(&canonical).map_err(AiServiceError::storage)?;
    let mut hash = 0xcbf29ce484222325_u64;

    for byte in bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }

    Ok(format!("{hash:016x}"))
}

fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = Map::new();
            for key in keys {
                if let Some(child) = object.get(key) {
                    canonical.insert(key.clone(), canonicalize_json(child));
                }
            }
            Value::Object(canonical)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_json).collect()),
        _ => value.clone(),
    }
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let truncated = trimmed.chars().take(max_chars).collect::<String>();

    if trimmed.chars().count() > max_chars {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value.and_then(|field| match field {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        _ => None,
    })
}

fn summary_output_root(value: &Value) -> &Value {
    value
        .get("summary")
        .filter(|field| field.is_object())
        .or_else(|| value.get("result").filter(|field| field.is_object()))
        .or_else(|| value.get("data").filter(|field| field.is_object()))
        .unwrap_or(value)
}

fn string_value_any(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_value(value.get(*key)))
}

fn string_list_any(value: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| {
            let items = string_list(value.get(*key));
            (!items.is_empty()).then_some(items)
        })
        .unwrap_or_default()
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| string_from_list_item(Some(item)))
            .collect(),
        Some(Value::String(text)) if !text.trim().is_empty() => vec![text.trim().to_string()],
        _ => Vec::new(),
    }
}

fn normalize_reading_persona_patch(value: Option<&Value>) -> Option<ReadingPersonaPatch> {
    let field = value?.as_object()?;
    let summary = string_value_any(
        &Value::Object(field.clone()),
        &["summary", "personaSummary"],
    )
    .map(|text| humanize_review_text(&text));
    let suggestion = string_value_any(
        &Value::Object(field.clone()),
        &["suggestion", "personaSuggestion"],
    )
    .map(|text| humanize_review_text(&text));

    if summary.is_none() && suggestion.is_none() {
        return None;
    }

    Some(ReadingPersonaPatch {
        summary,
        suggestion,
    })
}

fn string_from_list_item(value: Option<&Value>) -> Option<String> {
    let field = value?;

    match field {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Object(_) => string_value_any(
            field,
            &[
                "text", "content", "value", "title", "idea", "point", "action", "question",
            ],
        ),
        _ => None,
    }
}

fn representative_quote_list(value: Option<&Value>) -> Vec<BookAiRepresentativeQuote> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                let quote = string_value_any(
                    item,
                    &[
                        "quote", "text", "excerpt", "content", "markText", "原文", "摘录",
                    ],
                )?;
                Some(BookAiRepresentativeQuote {
                    quote,
                    reason: string_value_any(item, &["reason", "explanation", "rationale", "理由"])
                        .unwrap_or_else(|| "代表性笔记".to_string()),
                    chapter: string_value_any(
                        item,
                        &["chapter", "chapterTitle", "chapterName", "章节"],
                    ),
                    note_type: normalize_note_type(
                        string_value_any(
                            item,
                            &["noteType", "note_type", "type", "sourceType", "类型"],
                        )
                        .as_deref(),
                    ),
                })
            })
            .take(6)
            .collect(),
        _ => Vec::new(),
    }
}

fn normalize_note_type(value: Option<&str>) -> String {
    match value.map(str::trim).filter(|text| !text.is_empty()) {
        Some("highlight") | Some("Highlight") | Some("划线") => "划线".to_string(),
        Some("thought") | Some("Thought") | Some("review") | Some("Review") | Some("想法")
        | Some("点评") => "想法".to_string(),
        Some(text) => text.to_string(),
        None => "笔记".to_string(),
    }
}

#[derive(Debug, Clone)]
struct AiOutputCacheKey {
    feature: String,
    scope_id: String,
    prompt_version: String,
    input_hash: String,
}

fn read_metadata(bytes: Option<Vec<u8>>) -> AiCredentialMetadata {
    bytes
        .and_then(|value| serde_json::from_slice::<AiCredentialMetadata>(&value).ok())
        .unwrap_or_default()
}

fn read_provider_settings(bytes: Option<Vec<u8>>) -> AiProviderSettings {
    bytes
        .and_then(|value| serde_json::from_slice::<AiProviderSettings>(&value).ok())
        .unwrap_or_else(default_provider_settings)
}

fn default_stored_provider_preset_id() -> String {
    CUSTOM_AI_PROVIDER_PRESET_ID.to_string()
}

fn default_provider_settings() -> AiProviderSettings {
    AiProviderSettings {
        base_url: DEFAULT_AI_BASE_URL.to_string(),
        model: DEFAULT_AI_MODEL.to_string(),
        preset_id: DEFAULT_AI_PROVIDER_PRESET_ID.to_string(),
        response_format_policy: AiResponseFormatPolicy::JsonSchemaFirst,
    }
}

fn normalize_provider_settings(
    base_url: Option<&str>,
    model: Option<&str>,
    preset_id: Option<&str>,
    response_format_policy: Option<AiResponseFormatPolicy>,
) -> Result<AiProviderSettings, AiServiceError> {
    let base_url = normalize_provider_base_url(base_url)?;
    let model = match model {
        Some(value) => value.trim(),
        None => DEFAULT_AI_MODEL,
    };

    if model.is_empty() {
        return Err(AiServiceError::InvalidProviderSettings(
            "AI 模型名称不能为空。".to_string(),
        ));
    }

    if model.chars().any(char::is_whitespace) {
        return Err(AiServiceError::InvalidProviderSettings(
            "AI 模型名称不能包含空白字符。".to_string(),
        ));
    }
    let preset_id = normalize_provider_preset_id(preset_id)?;

    Ok(AiProviderSettings {
        base_url,
        model: model.to_string(),
        preset_id,
        response_format_policy: response_format_policy.unwrap_or_default(),
    })
}

fn normalize_provider_base_url(base_url: Option<&str>) -> Result<String, AiServiceError> {
    let base_url = match base_url {
        Some(value) => value.trim(),
        None => DEFAULT_AI_BASE_URL,
    };

    if base_url.is_empty() {
        return Err(AiServiceError::InvalidProviderSettings(
            "AI Base URL 不能为空。".to_string(),
        ));
    }

    if !base_url.starts_with("https://") && !base_url.starts_with("http://") {
        return Err(AiServiceError::InvalidProviderSettings(
            "AI Base URL 必须以 http:// 或 https:// 开头。".to_string(),
        ));
    }

    if base_url.chars().any(char::is_whitespace) {
        return Err(AiServiceError::InvalidProviderSettings(
            "AI Base URL 不能包含空白字符。".to_string(),
        ));
    }

    Ok(base_url.trim_end_matches('/').to_string())
}

fn normalize_provider_preset_id(preset_id: Option<&str>) -> Result<String, AiServiceError> {
    let preset_id = preset_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CUSTOM_AI_PROVIDER_PRESET_ID);

    if preset_id.len() > 64 {
        return Err(AiServiceError::InvalidProviderSettings(
            "AI Provider 预设标识过长。".to_string(),
        ));
    }

    if !preset_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err(AiServiceError::InvalidProviderSettings(
            "AI Provider 预设标识只能包含英文、数字、连字符或下划线。".to_string(),
        ));
    }

    Ok(preset_id.to_string())
}

fn normalize_cache_key(
    feature: String,
    scope_id: String,
    prompt_version: String,
    input_hash: String,
) -> Result<AiOutputCacheKey, AiServiceError> {
    Ok(AiOutputCacheKey {
        feature: normalize_cache_key_part("feature", &feature, 64)?,
        scope_id: normalize_cache_key_part("scopeId", &scope_id, 128)?,
        prompt_version: normalize_cache_key_part("promptVersion", &prompt_version, 80)?,
        input_hash: normalize_cache_key_part("inputHash", &input_hash, 128)?,
    })
}

fn normalize_cache_key_part(
    field_name: &str,
    value: &str,
    max_len: usize,
) -> Result<String, AiServiceError> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(AiServiceError::InvalidCacheKey(format!(
            "AI 缓存键 {field_name} 不能为空。"
        )));
    }

    if trimmed.len() > max_len {
        return Err(AiServiceError::InvalidCacheKey(format!(
            "AI 缓存键 {field_name} 过长。"
        )));
    }

    if !trimmed.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || character == '_'
            || character == '-'
            || character == '.'
            || character == ':'
    }) {
        return Err(AiServiceError::InvalidCacheKey(format!(
            "AI 缓存键 {field_name} 只能包含字母、数字、下划线、连字符、点或冒号。"
        )));
    }

    Ok(trimmed.to_string())
}

fn read_ai_output(
    connection: &rusqlite::Connection,
    feature: &str,
    scope_id: &str,
    prompt_version: &str,
    input_hash: &str,
) -> Result<Option<AiCachedOutputRecord>, AiServiceError> {
    connection
        .query_row(
            "
            SELECT
                feature,
                scope_id,
                prompt_version,
                input_hash,
                output_json,
                source_count,
                provider_model,
                created_at,
                updated_at
            FROM ai_outputs
            WHERE feature = ?1
                AND scope_id = ?2
                AND prompt_version = ?3
                AND input_hash = ?4
            ",
            params![feature, scope_id, prompt_version, input_hash],
            |row| {
                let output_json: String = row.get(4)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(AiCachedOutputRecord {
                    feature: row.get(0)?,
                    scope_id: row.get(1)?,
                    prompt_version: row.get(2)?,
                    input_hash: row.get(3)?,
                    output,
                    source_count: row.get(5)?,
                    provider_model: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AiServiceError::storage)
}

fn read_latest_ai_output(
    connection: &rusqlite::Connection,
    feature: &str,
    scope_id: &str,
    prompt_version: &str,
) -> Result<Option<AiCachedOutputRecord>, AiServiceError> {
    connection
        .query_row(
            "
            SELECT
                feature,
                scope_id,
                prompt_version,
                input_hash,
                output_json,
                source_count,
                provider_model,
                created_at,
                updated_at
            FROM ai_outputs
            WHERE feature = ?1
                AND scope_id = ?2
                AND prompt_version = ?3
            ORDER BY updated_at DESC
            LIMIT 1
            ",
            params![feature, scope_id, prompt_version],
            |row| {
                let output_json: String = row.get(4)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(AiCachedOutputRecord {
                    feature: row.get(0)?,
                    scope_id: row.get(1)?,
                    prompt_version: row.get(2)?,
                    input_hash: row.get(3)?,
                    output,
                    source_count: row.get(5)?,
                    provider_model: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AiServiceError::storage)
}

fn read_latest_feature_output(
    connection: &rusqlite::Connection,
    feature: &str,
    prompt_version: &str,
) -> Result<Option<AiCachedOutputRecord>, AiServiceError> {
    connection
        .query_row(
            "
            SELECT
                feature,
                scope_id,
                prompt_version,
                input_hash,
                output_json,
                source_count,
                provider_model,
                created_at,
                updated_at
            FROM ai_outputs
            WHERE feature = ?1
                AND prompt_version = ?2
            ORDER BY updated_at DESC
            LIMIT 1
            ",
            params![feature, prompt_version],
            |row| {
                let output_json: String = row.get(4)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(AiCachedOutputRecord {
                    feature: row.get(0)?,
                    scope_id: row.get(1)?,
                    prompt_version: row.get(2)?,
                    input_hash: row.get(3)?,
                    output,
                    source_count: row.get(5)?,
                    provider_model: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AiServiceError::storage)
}

fn read_book_summary_list(
    connection: &rusqlite::Connection,
) -> Result<Vec<BookAiSummaryListItem>, AiServiceError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                outputs.scope_id,
                outputs.output_json,
                outputs.provider_model,
                outputs.updated_at,
                books.title,
                books.author,
                books.cover,
                COALESCE(feedback.feedback_count, 0)
            FROM ai_outputs AS outputs
            INNER JOIN (
                SELECT scope_id, MAX(updated_at) AS updated_at
                FROM ai_outputs
                WHERE feature = ?1 AND prompt_version = ?2
                GROUP BY scope_id
            ) AS latest
                ON latest.scope_id = outputs.scope_id
                AND latest.updated_at = outputs.updated_at
            LEFT JOIN notebook_books AS books
                ON books.book_id = outputs.scope_id
            LEFT JOIN (
                SELECT scope_id, input_hash, COUNT(*) AS feedback_count
                FROM ai_feedback_records
                WHERE feature = 'book-review'
                GROUP BY scope_id, input_hash
            ) AS feedback
                ON feedback.scope_id = outputs.scope_id
                AND feedback.input_hash = outputs.input_hash
            WHERE outputs.feature = ?1 AND outputs.prompt_version = ?2
            ORDER BY outputs.updated_at DESC
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map(
            params![
                BOOK_NOTES_SUMMARY_FEATURE,
                BOOK_NOTES_SUMMARY_PROMPT_VERSION
            ],
            |row| {
                let scope_id: String = row.get(0)?;
                let output_json: String = row.get(1)?;
                let summary =
                    serde_json::from_str::<BookAiSummary>(&output_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                let title: Option<String> = row.get(4)?;

                Ok(BookAiSummaryListItem {
                    book_id: scope_id.clone(),
                    title: title.unwrap_or_else(|| scope_id.clone()),
                    author: row.get(5)?,
                    cover: row.get(6)?,
                    overview: summary.overview,
                    cached_updated_at: row.get(3)?,
                    provider_model: row.get(2)?,
                    feedback_count: row.get::<_, i64>(7)?.max(0) as usize,
                })
            },
        )
        .map_err(AiServiceError::storage)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AiServiceError::storage)
}

#[derive(Debug, Clone)]
struct AiAssetDraft {
    book_id: String,
    title: Option<String>,
    author: Option<String>,
    cover: Option<String>,
    progress: Option<i64>,
    is_finished: bool,
    local_status: Option<String>,
    has_single_guide: bool,
    cross_route_count: usize,
    has_book_review: bool,
    refresh_reason: Option<String>,
    cached_reading_stage: Option<String>,
    notebook_updated_at: Option<String>,
    last_read_at: Option<i64>,
    updated_at: Option<String>,
}

#[derive(Debug, Clone)]
struct AiAssetRouteRef {
    version: AssetVersionRef,
    book_ids: HashSet<String>,
}

impl AiAssetDraft {
    fn new(book_id: String) -> Self {
        Self {
            book_id,
            title: None,
            author: None,
            cover: None,
            progress: None,
            is_finished: false,
            local_status: None,
            has_single_guide: false,
            cross_route_count: 0,
            has_book_review: false,
            refresh_reason: None,
            cached_reading_stage: None,
            notebook_updated_at: None,
            last_read_at: None,
            updated_at: None,
        }
    }

    fn touch(&mut self, updated_at: String) {
        if self
            .updated_at
            .as_ref()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0)
            <= updated_at.parse::<i64>().unwrap_or(0)
        {
            self.updated_at = Some(updated_at);
        }
    }
}

fn read_ai_asset_summaries(
    connection: &rusqlite::Connection,
) -> Result<Vec<AiAssetSummary>, AiServiceError> {
    let mut drafts = HashMap::<String, AiAssetDraft>::new();
    read_ai_asset_route_outputs(connection, &mut drafts)?;
    read_ai_asset_book_review_outputs(connection, &mut drafts)?;

    if drafts.is_empty() {
        return Ok(Vec::new());
    }

    hydrate_ai_asset_book_metadata(connection, &mut drafts)?;
    hydrate_ai_asset_progress(connection, &mut drafts)?;
    hydrate_ai_asset_local_status(connection, &mut drafts)?;
    hydrate_ai_asset_last_read_at(connection, &mut drafts)?;

    let mut summaries = drafts
        .into_values()
        .map(ai_asset_summary_from_draft)
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.title.cmp(&right.title))
    });

    Ok(summaries)
}

fn read_ai_asset_route_outputs(
    connection: &rusqlite::Connection,
    drafts: &mut HashMap<String, AiAssetDraft>,
) -> Result<(), AiServiceError> {
    let mut statement = connection
        .prepare(
            "
            SELECT outputs.scope_id, outputs.updated_at, outputs.output_json
            FROM ai_outputs AS outputs
            INNER JOIN (
                SELECT scope_id, MAX(updated_at) AS updated_at
                FROM ai_outputs
                WHERE feature = ?1 AND prompt_version = ?2
                GROUP BY scope_id
            ) AS latest
                ON latest.scope_id = outputs.scope_id
                AND latest.updated_at = outputs.updated_at
            WHERE outputs.feature = ?1 AND outputs.prompt_version = ?2
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map(
            params![READING_ROUTE_FEATURE, READING_ROUTE_PROMPT_VERSION],
            |row| {
                let output_json: String = row.get(2)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    reading_stage_value(output.get("readingStage")).map(|item| item.stage),
                ))
            },
        )
        .map_err(AiServiceError::storage)?;

    for row in rows {
        let (scope_id, updated_at, cached_reading_stage) = row.map_err(AiServiceError::storage)?;
        let Some(book_id) = route_scope_current_book_id(&scope_id) else {
            continue;
        };
        let draft = drafts
            .entry(book_id.clone())
            .or_insert_with(|| AiAssetDraft::new(book_id));
        if scope_id == format!("book:{}", draft.book_id) {
            draft.has_single_guide = true;
            if draft
                .updated_at
                .as_ref()
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(0)
                <= updated_at.parse::<i64>().unwrap_or(0)
            {
                draft.cached_reading_stage = cached_reading_stage;
            }
        } else {
            draft.cross_route_count += 1;
        }
        draft.touch(updated_at);
    }

    Ok(())
}

fn read_ai_asset_book_review_outputs(
    connection: &rusqlite::Connection,
    drafts: &mut HashMap<String, AiAssetDraft>,
) -> Result<(), AiServiceError> {
    let mut statement = connection
        .prepare(
            "
            SELECT outputs.scope_id, outputs.updated_at, outputs.output_json
            FROM ai_outputs AS outputs
            INNER JOIN (
                SELECT scope_id, MAX(updated_at) AS updated_at
                FROM ai_outputs
                WHERE feature = ?1 AND prompt_version = ?2
                GROUP BY scope_id
            ) AS latest
                ON latest.scope_id = outputs.scope_id
                AND latest.updated_at = outputs.updated_at
            WHERE outputs.feature = ?1 AND outputs.prompt_version = ?2
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map(
            params![
                BOOK_NOTES_SUMMARY_FEATURE,
                BOOK_NOTES_SUMMARY_PROMPT_VERSION
            ],
            |row| {
                let output_json: String = row.get(2)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    reading_stage_value(output.get("readingStage")).map(|item| item.stage),
                ))
            },
        )
        .map_err(AiServiceError::storage)?;

    for row in rows {
        let (book_id, updated_at, cached_reading_stage) = row.map_err(AiServiceError::storage)?;
        let draft = drafts
            .entry(book_id.clone())
            .or_insert_with(|| AiAssetDraft::new(book_id));
        draft.has_book_review = true;
        if draft
            .updated_at
            .as_ref()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0)
            <= updated_at.parse::<i64>().unwrap_or(0)
        {
            draft.cached_reading_stage = cached_reading_stage;
        }
        draft.touch(updated_at);
    }

    Ok(())
}

fn hydrate_ai_asset_book_metadata(
    connection: &rusqlite::Connection,
    drafts: &mut HashMap<String, AiAssetDraft>,
) -> Result<(), AiServiceError> {
    let mut notebook_statement = connection
        .prepare("SELECT title, author, cover, updated_at FROM notebook_books WHERE book_id = ?1")
        .map_err(AiServiceError::storage)?;
    let mut detail_statement = connection
        .prepare("SELECT title, author, cover FROM book_details WHERE book_id = ?1")
        .map_err(AiServiceError::storage)?;

    for draft in drafts.values_mut() {
        if let Some((title, author, cover, updated_at)) = notebook_statement
            .query_row([&draft.book_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .optional()
            .map_err(AiServiceError::storage)?
        {
            draft.title = Some(title);
            draft.author = author;
            draft.cover = cover;
            draft.notebook_updated_at = Some(updated_at);
            continue;
        }

        if let Some((title, author, cover)) = detail_statement
            .query_row([&draft.book_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .optional()
            .map_err(AiServiceError::storage)?
        {
            draft.title = Some(title);
            draft.author = author;
            draft.cover = cover;
        }
    }

    Ok(())
}

fn hydrate_ai_asset_progress(
    connection: &rusqlite::Connection,
    drafts: &mut HashMap<String, AiAssetDraft>,
) -> Result<(), AiServiceError> {
    let mut statement = connection
        .prepare("SELECT progress_percent, finish_time FROM book_progress WHERE book_id = ?1")
        .map_err(AiServiceError::storage)?;

    for draft in drafts.values_mut() {
        if let Some((progress, finish_time)) = statement
            .query_row([&draft.book_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?))
            })
            .optional()
            .map_err(AiServiceError::storage)?
        {
            let progress = progress.clamp(0, 100);
            draft.progress = Some(progress);
            draft.is_finished = progress >= 100 || finish_time.unwrap_or(0) > 0;
        }
    }

    Ok(())
}

fn hydrate_ai_asset_local_status(
    connection: &rusqlite::Connection,
    drafts: &mut HashMap<String, AiAssetDraft>,
) -> Result<(), AiServiceError> {
    let mut statement = connection
        .prepare("SELECT status, title, author, cover FROM reading_item_states WHERE item_id = ?1")
        .map_err(AiServiceError::storage)?;

    for draft in drafts.values_mut() {
        if let Some((status, title, author, cover)) = statement
            .query_row([&draft.book_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .optional()
            .map_err(AiServiceError::storage)?
        {
            draft.local_status = Some(status);
            if draft.title.is_none() {
                draft.title = title;
            }
            if draft.author.is_none() {
                draft.author = author;
            }
            if draft.cover.is_none() {
                draft.cover = cover;
            }
        }
    }

    Ok(())
}

fn hydrate_ai_asset_last_read_at(
    connection: &rusqlite::Connection,
    drafts: &mut HashMap<String, AiAssetDraft>,
) -> Result<(), AiServiceError> {
    let mut statement = connection
        .prepare("SELECT last_read_at FROM shelf_entries WHERE id = ?1")
        .map_err(AiServiceError::storage)?;

    for draft in drafts.values_mut() {
        draft.last_read_at = statement
            .query_row([&draft.book_id], |row| row.get::<_, Option<i64>>(0))
            .optional()
            .map_err(AiServiceError::storage)?
            .flatten();
    }

    Ok(())
}

const AI_ASSET_STALLED_THRESHOLD_SECONDS: i64 = 30 * 24 * 60 * 60;

fn ai_asset_refresh_reason(
    draft: &AiAssetDraft,
    stage: Option<&ReadingStageSignal>,
) -> Option<String> {
    if let Some(reason) = draft.refresh_reason.clone() {
        return Some(reason);
    }

    if draft.is_finished {
        return Some("completed".to_string());
    }

    let latest_asset_updated_at = draft
        .updated_at
        .as_ref()
        .and_then(|value| value.parse::<i64>().ok());
    let notebook_updated_at = draft
        .notebook_updated_at
        .as_ref()
        .and_then(|value| value.parse::<i64>().ok());
    if notebook_updated_at
        .zip(latest_asset_updated_at)
        .is_some_and(|(notes, asset)| notes > asset)
    {
        return Some("notes_changed".to_string());
    }

    if draft
        .last_read_at
        .zip(latest_asset_updated_at)
        .is_some_and(|(last_read_at, asset)| {
            asset - last_read_at >= AI_ASSET_STALLED_THRESHOLD_SECONDS
        })
    {
        return Some("stalled".to_string());
    }

    if stage
        .zip(draft.cached_reading_stage.as_deref())
        .is_some_and(|(current_stage, cached_stage)| current_stage.stage != cached_stage)
    {
        return Some("stage_changed".to_string());
    }

    None
}

fn ai_asset_summary_from_draft(draft: AiAssetDraft) -> AiAssetSummary {
    let stage = draft
        .progress
        .map(|progress| reading_stage_signal(progress, draft.is_finished));
    let refresh_reason = ai_asset_refresh_reason(&draft, stage.as_ref());

    AiAssetSummary {
        book_id: draft.book_id.clone(),
        title: draft.title.unwrap_or_else(|| draft.book_id.clone()),
        author: draft.author,
        cover: draft.cover,
        progress: draft.progress,
        reading_stage: stage.as_ref().map(|item| item.stage.clone()),
        reading_stage_label: stage.as_ref().map(|item| item.label.clone()),
        local_status: draft.local_status,
        has_single_guide: draft.has_single_guide,
        cross_route_count: draft.cross_route_count,
        has_book_review: draft.has_book_review,
        refresh_state: if refresh_reason.is_some() {
            "suggested".to_string()
        } else {
            "none".to_string()
        },
        refresh_reason,
        updated_at: draft.updated_at,
    }
}

fn read_ai_asset_detail(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Option<AiAssetDetail>, AiServiceError> {
    let normalized_book_id = normalize_route_text("bookId", book_id, 128)?;
    let mut drafts = HashMap::<String, AiAssetDraft>::new();
    drafts.insert(
        normalized_book_id.clone(),
        AiAssetDraft::new(normalized_book_id.clone()),
    );
    read_ai_asset_route_outputs(connection, &mut drafts)?;
    read_ai_asset_book_review_outputs(connection, &mut drafts)?;
    hydrate_ai_asset_book_metadata(connection, &mut drafts)?;
    hydrate_ai_asset_progress(connection, &mut drafts)?;
    hydrate_ai_asset_local_status(connection, &mut drafts)?;
    hydrate_ai_asset_last_read_at(connection, &mut drafts)?;
    let draft = drafts
        .remove(&normalized_book_id)
        .unwrap_or_else(|| AiAssetDraft::new(normalized_book_id.clone()));
    let routes = read_ai_asset_route_refs(connection)?;
    let current_guide = routes
        .iter()
        .find(|item| item.version.scope_id == format!("book:{normalized_book_id}"))
        .map(|item| item.version.clone());
    let main_cross_routes = routes
        .iter()
        .filter(|item| {
            route_scope_current_book_id(&item.version.scope_id).as_deref()
                == Some(normalized_book_id.as_str())
                && item.version.scope_id.contains(":candidates:")
        })
        .map(|item| item.version.clone())
        .collect::<Vec<_>>();
    let participant_cross_routes = routes
        .iter()
        .filter(|item| {
            route_scope_current_book_id(&item.version.scope_id).as_deref()
                != Some(normalized_book_id.as_str())
                && item.book_ids.contains(&normalized_book_id)
        })
        .map(|item| item.version.clone())
        .collect::<Vec<_>>();
    let current_book_review = read_ai_asset_book_review_ref(connection, &normalized_book_id)?;

    if current_guide.is_none()
        && main_cross_routes.is_empty()
        && participant_cross_routes.is_empty()
        && current_book_review.is_none()
    {
        return Ok(None);
    }

    let stage = draft
        .progress
        .map(|progress| reading_stage_signal(progress, draft.is_finished));
    let refresh_reason = ai_asset_refresh_reason(&draft, stage.as_ref());

    Ok(Some(AiAssetDetail {
        book_id: normalized_book_id.clone(),
        title: draft.title.unwrap_or_else(|| normalized_book_id.clone()),
        author: draft.author,
        cover: draft.cover,
        progress: draft.progress,
        reading_stage: stage.as_ref().map(|item| item.stage.clone()),
        reading_stage_label: stage.as_ref().map(|item| item.label.clone()),
        local_status: draft.local_status,
        refresh_state: if refresh_reason.is_some() {
            "suggested".to_string()
        } else {
            "none".to_string()
        },
        refresh_reason,
        current_guide,
        main_cross_routes,
        participant_cross_routes,
        current_book_review,
    }))
}

fn read_ai_asset_version_detail(
    connection: &rusqlite::Connection,
    feature: &str,
    scope_id: &str,
    input_hash: &str,
) -> Result<Option<AiAssetVersionDetail>, AiServiceError> {
    let normalized_feature = normalize_route_text("feature", feature, 64)?;
    let normalized_scope_id = normalize_route_text("scopeId", scope_id, 256)?;
    let normalized_input_hash = normalize_route_text("inputHash", input_hash, 128)?;
    let prompt_version = match normalized_feature.as_str() {
        "reading-route" => READING_ROUTE_PROMPT_VERSION,
        "book-review" => BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        _ => {
            return Err(AiServiceError::InvalidProviderOutput(
                "暂不支持读取该 AI 资产版本详情。".to_string(),
            ))
        }
    };
    let cache_feature = if normalized_feature == "book-review" {
        BOOK_NOTES_SUMMARY_FEATURE
    } else {
        READING_ROUTE_FEATURE
    };
    let Some(cached) = read_ai_output(
        connection,
        cache_feature,
        &normalized_scope_id,
        prompt_version,
        &normalized_input_hash,
    )?
    else {
        return Ok(None);
    };

    let book_id = match normalized_feature.as_str() {
        "reading-route" => route_scope_current_book_id(&normalized_scope_id)
            .or_else(|| {
                cached
                    .output
                    .get("books")
                    .and_then(Value::as_array)
                    .and_then(|items| items.first())
                    .and_then(|item| string_value(item.get("bookId")))
            })
            .unwrap_or_else(|| normalized_scope_id.clone()),
        "book-review" => normalized_scope_id.clone(),
        _ => normalized_scope_id.clone(),
    };

    let mut drafts = HashMap::<String, AiAssetDraft>::new();
    drafts.insert(book_id.clone(), AiAssetDraft::new(book_id.clone()));
    hydrate_ai_asset_book_metadata(connection, &mut drafts)?;
    hydrate_ai_asset_progress(connection, &mut drafts)?;
    hydrate_ai_asset_local_status(connection, &mut drafts)?;
    hydrate_ai_asset_last_read_at(connection, &mut drafts)?;

    let mut draft = drafts
        .remove(&book_id)
        .unwrap_or_else(|| AiAssetDraft::new(book_id.clone()));
    draft.updated_at = Some(cached.updated_at.clone());
    draft.cached_reading_stage =
        reading_stage_value(cached.output.get("readingStage")).map(|item| item.stage);
    draft.refresh_reason = match normalized_feature.as_str() {
        "reading-route" => None,
        "book-review" if draft.is_finished => Some("completed".to_string()),
        _ => None,
    };

    let stage = draft
        .progress
        .map(|progress| reading_stage_signal(progress, draft.is_finished));
    let refresh_reason = ai_asset_refresh_reason(&draft, stage.as_ref());
    let reading_stage = reading_stage_value(cached.output.get("readingStage")).or(stage.clone());
    let title = match normalized_feature.as_str() {
        "reading-route" => route_ref_title(&normalized_scope_id, &cached.output),
        "book-review" => Some(book_review_ref_title(draft.title.as_deref())),
        _ => None,
    };
    let basis_notice = string_value(cached.output.get("basisNotice")).unwrap_or_else(|| {
        if normalized_feature == "book-review" {
            "基于本地笔记生成，不代表整本书全文内容。".to_string()
        } else {
            "基于本地缓存生成，不代表远端计划。".to_string()
        }
    });
    let source_stats = cached
        .output
        .get("sourceStats")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let previous_version = read_previous_ai_asset_version_ref(
        connection,
        &normalized_feature,
        &normalized_scope_id,
        &normalized_input_hash,
    )?;

    let (reading_route, book_summary) = if normalized_feature == "reading-route" {
        let route =
            serde_json::from_value::<ReadingRoute>(cached.output.clone()).map_err(|_| {
                AiServiceError::InvalidProviderOutput("本地 AI 阅读指南缓存无法解析。".to_string())
            })?;
        (Some(sanitize_cached_reading_route(route)), None)
    } else {
        let summary =
            serde_json::from_value::<BookAiSummary>(cached.output.clone()).map_err(|_| {
                AiServiceError::InvalidProviderOutput("本地 AI 复盘缓存无法解析。".to_string())
            })?;
        (None, Some(summary))
    };

    Ok(Some(AiAssetVersionDetail {
        feature: normalized_feature,
        scope_id: normalized_scope_id,
        input_hash: normalized_input_hash,
        prompt_version: cached.prompt_version,
        generated_at: string_value(cached.output.get("generatedAt"))
            .unwrap_or_else(|| cached.created_at.clone()),
        updated_at: cached.updated_at,
        source: "cache".to_string(),
        title,
        provider_model: cached.provider_model,
        reading_stage: reading_stage.as_ref().map(|item| item.stage.clone()),
        reading_stage_label: reading_stage.as_ref().map(|item| item.label.clone()),
        progress: draft.progress,
        refresh_reason,
        basis_notice,
        source_stats,
        reading_route,
        book_summary,
        previous_version,
    }))
}

fn read_previous_ai_asset_version_ref(
    connection: &rusqlite::Connection,
    feature: &str,
    scope_id: &str,
    input_hash: &str,
) -> Result<Option<AssetVersionRef>, AiServiceError> {
    let prompt_version = match feature {
        "reading-route" => READING_ROUTE_PROMPT_VERSION,
        "book-review" => BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        _ => return Ok(None),
    };
    let cache_feature = if feature == "book-review" {
        BOOK_NOTES_SUMMARY_FEATURE
    } else {
        READING_ROUTE_FEATURE
    };
    let current_updated_at = connection
        .query_row(
            "
            SELECT updated_at
            FROM ai_outputs
            WHERE feature = ?1
                AND scope_id = ?2
                AND prompt_version = ?3
                AND input_hash = ?4
            ORDER BY updated_at DESC
            LIMIT 1
            ",
            params![cache_feature, scope_id, prompt_version, input_hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AiServiceError::storage)?;

    let Some(current_updated_at) = current_updated_at else {
        return Ok(None);
    };

    let mut statement = connection
        .prepare(
            "
            SELECT
                outputs.scope_id,
                outputs.input_hash,
                outputs.prompt_version,
                outputs.output_json,
                outputs.provider_model,
                outputs.created_at,
                outputs.updated_at
            FROM ai_outputs AS outputs
            WHERE outputs.feature = ?1
                AND outputs.prompt_version = ?2
                AND outputs.scope_id = ?3
                AND outputs.updated_at < ?4
            ORDER BY outputs.updated_at DESC
            LIMIT 1
            ",
        )
        .map_err(AiServiceError::storage)?;
    let previous = statement
        .query_row(
            params![cache_feature, prompt_version, scope_id, current_updated_at],
            |row| {
                let output_json: String = row.get(3)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(AssetVersionRef {
                    feature: feature.to_string(),
                    scope_id: row.get(0)?,
                    input_hash: row.get(1)?,
                    prompt_version: row.get(2)?,
                    generated_at: string_value(output.get("generatedAt"))
                        .unwrap_or_else(|| row.get::<_, String>(5).unwrap_or_default()),
                    updated_at: row.get(6)?,
                    source: "cache".to_string(),
                    title: match feature {
                        "reading-route" => route_ref_title(scope_id, &output),
                        "book-review" => Some(book_review_ref_title(None)),
                        _ => None,
                    },
                    provider_model: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(AiServiceError::storage)?;

    Ok(previous)
}

fn read_ai_asset_version_history(
    connection: &rusqlite::Connection,
    feature: &str,
    scope_id: &str,
) -> Result<Vec<AiAssetVersionSummary>, AiServiceError> {
    let normalized_feature = normalize_route_text("feature", feature, 64)?;
    let normalized_scope_id = normalize_route_text("scopeId", scope_id, 256)?;
    let prompt_version = match normalized_feature.as_str() {
        "reading-route" => READING_ROUTE_PROMPT_VERSION,
        "book-review" => BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        _ => {
            return Err(AiServiceError::InvalidProviderOutput(
                "暂不支持读取该 AI 资产历史版本。".to_string(),
            ))
        }
    };
    let cache_feature = if normalized_feature == "book-review" {
        BOOK_NOTES_SUMMARY_FEATURE
    } else {
        READING_ROUTE_FEATURE
    };
    let mut statement = connection
        .prepare(
            "
            SELECT
                feature,
                scope_id,
                prompt_version,
                input_hash,
                output_json,
                provider_model,
                created_at,
                updated_at
            FROM ai_outputs
            WHERE feature = ?1
                AND scope_id = ?2
                AND prompt_version = ?3
            ORDER BY updated_at DESC
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map(
            params![cache_feature, normalized_scope_id, prompt_version],
            |row| {
                let output_json: String = row.get(4)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(AiCachedOutputRecord {
                    feature: row.get(0)?,
                    scope_id: row.get(1)?,
                    prompt_version: row.get(2)?,
                    input_hash: row.get(3)?,
                    output,
                    source_count: None,
                    provider_model: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .map_err(AiServiceError::storage)?;
    let cached_versions = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(AiServiceError::storage)?;

    if cached_versions.len() <= 1 {
        return Ok(Vec::new());
    }

    let latest_input_hash = cached_versions
        .first()
        .map(|item| item.input_hash.clone())
        .unwrap_or_default();

    let mut histories = Vec::with_capacity(cached_versions.len().saturating_sub(1));
    for (index, cached) in cached_versions.iter().enumerate().skip(1) {
        let previous_version = cached_versions.get(index + 1);
        histories.push(ai_asset_version_summary_from_cached(
            connection,
            &normalized_feature,
            &normalized_scope_id,
            cached.clone(),
            &latest_input_hash,
            previous_version,
        )?);
    }

    Ok(histories)
}

fn ai_asset_version_summary_from_cached(
    connection: &rusqlite::Connection,
    feature: &str,
    scope_id: &str,
    cached: AiCachedOutputRecord,
    latest_input_hash: &str,
    previous_cached: Option<&AiCachedOutputRecord>,
) -> Result<AiAssetVersionSummary, AiServiceError> {
    let book_id = match feature {
        "reading-route" => route_scope_current_book_id(scope_id)
            .or_else(|| {
                cached
                    .output
                    .get("books")
                    .and_then(Value::as_array)
                    .and_then(|items| items.first())
                    .and_then(|item| string_value(item.get("bookId")))
            })
            .unwrap_or_else(|| scope_id.to_string()),
        "book-review" => scope_id.to_string(),
        _ => scope_id.to_string(),
    };

    let mut drafts = HashMap::<String, AiAssetDraft>::new();
    drafts.insert(book_id.clone(), AiAssetDraft::new(book_id.clone()));
    hydrate_ai_asset_book_metadata(connection, &mut drafts)?;
    hydrate_ai_asset_progress(connection, &mut drafts)?;
    hydrate_ai_asset_local_status(connection, &mut drafts)?;
    hydrate_ai_asset_last_read_at(connection, &mut drafts)?;

    let mut draft = drafts
        .remove(&book_id)
        .unwrap_or_else(|| AiAssetDraft::new(book_id.clone()));
    draft.updated_at = Some(cached.updated_at.clone());
    draft.cached_reading_stage =
        reading_stage_value(cached.output.get("readingStage")).map(|item| item.stage);
    draft.refresh_reason = match feature {
        "book-review" if draft.is_finished => Some("completed".to_string()),
        _ => None,
    };

    let stage = draft
        .progress
        .map(|progress| reading_stage_signal(progress, draft.is_finished));
    let reading_stage = reading_stage_value(cached.output.get("readingStage")).or(stage.clone());
    let previous_version = previous_cached.map(|previous| AssetVersionRef {
        feature: feature.to_string(),
        scope_id: scope_id.to_string(),
        input_hash: previous.input_hash.clone(),
        prompt_version: previous.prompt_version.clone(),
        generated_at: string_value(previous.output.get("generatedAt"))
            .unwrap_or_else(|| previous.created_at.clone()),
        updated_at: previous.updated_at.clone(),
        source: "cache".to_string(),
        title: match feature {
            "reading-route" => route_ref_title(scope_id, &previous.output),
            "book-review" => Some(book_review_version_title(&draft.title)),
            _ => None,
        },
        provider_model: previous.provider_model.clone(),
    });
    let title = match feature {
        "reading-route" => route_ref_title(scope_id, &cached.output),
        "book-review" => Some(book_review_version_title(&draft.title)),
        _ => None,
    };

    Ok(AiAssetVersionSummary {
        feature: feature.to_string(),
        scope_id: scope_id.to_string(),
        input_hash: cached.input_hash.clone(),
        prompt_version: cached.prompt_version,
        generated_at: string_value(cached.output.get("generatedAt"))
            .unwrap_or_else(|| cached.created_at.clone()),
        updated_at: cached.updated_at,
        source: "cache".to_string(),
        title,
        provider_model: cached.provider_model,
        reading_stage: reading_stage.as_ref().map(|item| item.stage.clone()),
        reading_stage_label: reading_stage.as_ref().map(|item| item.label.clone()),
        progress: draft.progress,
        refresh_reason: ai_asset_refresh_reason(&draft, stage.as_ref()),
        is_current: cached.input_hash == latest_input_hash,
        previous_version,
    })
}

fn read_ai_review_feedback(
    connection: &rusqlite::Connection,
    feature: &str,
    scope_id: &str,
    input_hash: &str,
) -> Result<AiReviewFeedbackState, AiServiceError> {
    let identity = normalize_ai_feedback_identity(feature, scope_id, input_hash)?;
    let mut statement = connection
        .prepare(
            "
            SELECT item_kind, item_id, status, note, updated_at
            FROM ai_feedback_records
            WHERE feature = ?1
                AND scope_id = ?2
                AND input_hash = ?3
            ORDER BY item_kind ASC, item_id ASC
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map(params![identity.0, identity.1, identity.2], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                AiFeedbackExportRecord {
                    status: row.get(2)?,
                    note: row.get(3)?,
                    updated_at: row.get(4)?,
                },
            ))
        })
        .map_err(AiServiceError::storage)?;

    let mut feedback = AiReviewFeedbackState::default();
    for row in rows {
        let (item_kind, item_id, record) = row.map_err(AiServiceError::storage)?;
        match item_kind.as_str() {
            "actionItem" => {
                feedback.action_items.insert(item_id, record);
            }
            "reflectionQuestion" => {
                feedback.reflection_questions.insert(item_id, record);
            }
            _ => {}
        }
    }

    Ok(feedback)
}

fn save_ai_review_feedback(
    connection: &mut rusqlite::Connection,
    feature: &str,
    scope_id: &str,
    input_hash: &str,
    feedback: AiReviewFeedbackState,
) -> Result<AiReviewFeedbackState, AiServiceError> {
    let (feature, scope_id, input_hash) =
        normalize_ai_feedback_identity(feature, scope_id, input_hash)?;
    let drafts = normalize_ai_review_feedback(feedback)?;
    let transaction = connection.transaction().map_err(AiServiceError::storage)?;

    transaction
        .execute(
            "
            DELETE FROM ai_feedback_records
            WHERE feature = ?1
                AND scope_id = ?2
                AND input_hash = ?3
            ",
            params![&feature, &scope_id, &input_hash],
        )
        .map_err(AiServiceError::storage)?;

    for draft in drafts {
        let created_at = draft.updated_at.as_deref().unwrap_or("0");
        transaction
            .execute(
                "
                INSERT INTO ai_feedback_records (
                    feature,
                    scope_id,
                    input_hash,
                    item_kind,
                    item_id,
                    status,
                    note,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ",
                params![
                    &feature,
                    &scope_id,
                    &input_hash,
                    &draft.item_kind,
                    &draft.item_id,
                    &draft.status,
                    &draft.note,
                    created_at,
                    draft.updated_at.as_deref().unwrap_or(created_at)
                ],
            )
            .map_err(AiServiceError::storage)?;
    }

    transaction.commit().map_err(AiServiceError::storage)?;
    read_ai_review_feedback(connection, &feature, &scope_id, &input_hash)
}

fn normalize_ai_review_feedback(
    feedback: AiReviewFeedbackState,
) -> Result<Vec<AiFeedbackRecordDraft>, AiServiceError> {
    let mut drafts = Vec::new();
    append_ai_feedback_drafts(&mut drafts, "actionItem", feedback.action_items)?;
    append_ai_feedback_drafts(
        &mut drafts,
        "reflectionQuestion",
        feedback.reflection_questions,
    )?;

    Ok(drafts)
}

fn append_ai_feedback_drafts(
    drafts: &mut Vec<AiFeedbackRecordDraft>,
    item_kind: &str,
    feedback_by_item_id: HashMap<String, AiFeedbackExportRecord>,
) -> Result<(), AiServiceError> {
    for (item_id, record) in feedback_by_item_id {
        let item_id = normalize_ai_feedback_text("itemId", &item_id, 700)?;
        let status = normalize_ai_feedback_status(&record.status)?;
        let note = record
            .note
            .as_deref()
            .map(|note| normalize_ai_feedback_note(note))
            .filter(|note| !note.is_empty());

        if status == "todo" && note.is_none() {
            continue;
        }

        drafts.push(AiFeedbackRecordDraft {
            item_kind: item_kind.to_string(),
            item_id,
            status,
            note,
            updated_at: Some(normalize_ai_feedback_text(
                "updatedAt",
                &record.updated_at,
                80,
            )?),
        });
    }

    Ok(())
}

fn normalize_ai_feedback_identity(
    feature: &str,
    scope_id: &str,
    input_hash: &str,
) -> Result<(String, String, String), AiServiceError> {
    let feature = normalize_ai_feedback_text("feature", feature, 64)?;
    if feature != "book-review" && feature != "reading-route" {
        return Err(AiServiceError::InvalidCacheKey(
            "暂不支持保存该 AI 资产类型的反馈记录。".to_string(),
        ));
    }

    Ok((
        feature,
        normalize_ai_feedback_text("scopeId", scope_id, 256)?,
        normalize_ai_feedback_text("inputHash", input_hash, 128)?,
    ))
}

fn normalize_ai_feedback_text(
    field_name: &str,
    value: &str,
    max_len: usize,
) -> Result<String, AiServiceError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AiServiceError::InvalidCacheKey(format!(
            "AI 反馈字段 {field_name} 不能为空。"
        )));
    }

    if trimmed.chars().count() > max_len {
        return Err(AiServiceError::InvalidCacheKey(format!(
            "AI 反馈字段 {field_name} 过长。"
        )));
    }

    Ok(trimmed.to_string())
}

fn normalize_ai_feedback_status(status: &str) -> Result<String, AiServiceError> {
    match status {
        "todo" | "completed" | "skipped" | "notApplicable" => Ok(status.to_string()),
        _ => Err(AiServiceError::InvalidProviderOutput(
            "AI 反馈状态不支持。".to_string(),
        )),
    }
}

fn normalize_ai_feedback_note(note: &str) -> String {
    let mut normalized = note
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(|line| line.trim().split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n");

    while normalized.contains("\n\n\n") {
        normalized = normalized.replace("\n\n\n", "\n\n");
    }

    normalized.trim().chars().take(500).collect()
}

fn merge_ai_review_feedback(
    mut stored: AiReviewFeedbackExport,
    override_feedback: AiReviewFeedbackExport,
) -> AiReviewFeedbackExport {
    stored.action_items.extend(override_feedback.action_items);
    stored
        .reflection_questions
        .extend(override_feedback.reflection_questions);
    stored
}

fn read_ai_asset_route_refs(
    connection: &rusqlite::Connection,
) -> Result<Vec<AiAssetRouteRef>, AiServiceError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                outputs.scope_id,
                outputs.input_hash,
                outputs.prompt_version,
                outputs.output_json,
                outputs.provider_model,
                outputs.created_at,
                outputs.updated_at
            FROM ai_outputs AS outputs
            INNER JOIN (
                SELECT scope_id, MAX(updated_at) AS updated_at
                FROM ai_outputs
                WHERE feature = ?1 AND prompt_version = ?2
                GROUP BY scope_id
            ) AS latest
                ON latest.scope_id = outputs.scope_id
                AND latest.updated_at = outputs.updated_at
            WHERE outputs.feature = ?1 AND outputs.prompt_version = ?2
            ORDER BY outputs.updated_at DESC
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map(
            params![READING_ROUTE_FEATURE, READING_ROUTE_PROMPT_VERSION],
            |row| {
                let output_json: String = row.get(3)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                let scope_id: String = row.get(0)?;
                let title = route_ref_title(&scope_id, &output);
                let book_ids = route_ref_book_ids(&scope_id, &output);

                Ok(AiAssetRouteRef {
                    version: AssetVersionRef {
                        feature: READING_ROUTE_FEATURE.to_string(),
                        scope_id,
                        input_hash: row.get(1)?,
                        prompt_version: row.get(2)?,
                        generated_at: string_value(output.get("generatedAt"))
                            .unwrap_or_else(|| row.get::<_, String>(5).unwrap_or_default()),
                        updated_at: row.get(6)?,
                        source: "cache".to_string(),
                        title,
                        provider_model: row.get(4)?,
                    },
                    book_ids,
                })
            },
        )
        .map_err(AiServiceError::storage)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AiServiceError::storage)
}

fn read_ai_asset_book_review_ref(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Option<AssetVersionRef>, AiServiceError> {
    let book_title = connection
        .query_row(
            "SELECT title FROM notebook_books WHERE book_id = ?1",
            [book_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AiServiceError::storage)?;
    let ref_title = book_review_ref_title(book_title.as_deref());

    read_latest_ai_output(
        connection,
        BOOK_NOTES_SUMMARY_FEATURE,
        book_id,
        BOOK_NOTES_SUMMARY_PROMPT_VERSION,
    )
    .map(|cached| {
        cached.map(|item| AssetVersionRef {
            feature: "book-review".to_string(),
            scope_id: item.scope_id,
            input_hash: item.input_hash,
            prompt_version: item.prompt_version,
            generated_at: string_value(item.output.get("generatedAt"))
                .unwrap_or_else(|| item.created_at.clone()),
            updated_at: item.updated_at,
            source: "cache".to_string(),
            title: Some(ref_title.clone()),
            provider_model: item.provider_model,
        })
    })
}

fn book_review_ref_title(book_title: Option<&str>) -> String {
    let title = book_title.map(str::trim).filter(|value| !value.is_empty());
    if let Some(title) = title {
        format!("《{}》书籍复盘", title)
    } else {
        "当前书籍复盘".to_string()
    }
}

fn book_review_version_title(book_title: &Option<String>) -> String {
    book_review_ref_title(book_title.as_deref())
}

fn route_ref_title(scope_id: &str, output: &Value) -> Option<String> {
    let overview = string_value(output.get("routeOverview"));
    let books = output.get("books").and_then(Value::as_array);
    let title = if scope_id.contains(":candidates:") {
        let titles = books
            .into_iter()
            .flatten()
            .filter_map(|book| string_value(book.get("title")))
            .take(3)
            .collect::<Vec<_>>();
        (!titles.is_empty()).then(|| titles.join(" → "))
    } else {
        books
            .and_then(|items| items.first())
            .and_then(|book| string_value(book.get("title")))
            .map(|title| format!("{title} 阅读指南"))
    };

    title.or(overview)
}

fn route_ref_book_ids(scope_id: &str, output: &Value) -> HashSet<String> {
    let mut book_ids = HashSet::new();
    if let Some(book_id) = route_scope_current_book_id(scope_id) {
        book_ids.insert(book_id);
    }
    if let Some(books) = output.get("books").and_then(Value::as_array) {
        for book in books {
            if let Some(book_id) = string_value(book.get("bookId")) {
                book_ids.insert(book_id);
            }
        }
    }

    book_ids
}

fn route_scope_current_book_id(scope_id: &str) -> Option<String> {
    let rest = scope_id.strip_prefix("book:")?;
    let book_id = rest.split(":candidates:").next()?.trim();
    (!book_id.is_empty()).then(|| book_id.to_string())
}

fn read_book_summary_export_items(
    connection: &rusqlite::Connection,
    book_ids: Option<&[String]>,
) -> Result<Vec<BookSummaryExportItem>, AiServiceError> {
    let allowed_book_ids = book_ids.map(|ids| ids.iter().cloned().collect::<HashSet<_>>());
    let mut statement = connection
        .prepare(
            "
            SELECT
                outputs.scope_id,
                outputs.prompt_version,
                outputs.input_hash,
                outputs.output_json,
                outputs.provider_model,
                outputs.updated_at,
                books.title,
                books.author
            FROM ai_outputs AS outputs
            INNER JOIN (
                SELECT scope_id, MAX(updated_at) AS updated_at
                FROM ai_outputs
                WHERE feature = ?1 AND prompt_version = ?2
                GROUP BY scope_id
            ) AS latest
                ON latest.scope_id = outputs.scope_id
                AND latest.updated_at = outputs.updated_at
            LEFT JOIN notebook_books AS books
                ON books.book_id = outputs.scope_id
            WHERE outputs.feature = ?1 AND outputs.prompt_version = ?2
            ORDER BY outputs.updated_at DESC
            ",
        )
        .map_err(AiServiceError::storage)?;
    let rows = statement
        .query_map(
            params![
                BOOK_NOTES_SUMMARY_FEATURE,
                BOOK_NOTES_SUMMARY_PROMPT_VERSION
            ],
            |row| {
                let book_id: String = row.get(0)?;
                let output_json: String = row.get(3)?;
                let summary =
                    serde_json::from_str::<BookAiSummary>(&output_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                let title: Option<String> = row.get(6)?;

                Ok(BookSummaryExportItem {
                    book_id: book_id.clone(),
                    title: title.unwrap_or_else(|| book_id.clone()),
                    author: row.get(7)?,
                    prompt_version: row.get(1)?,
                    input_hash: row.get(2)?,
                    provider_model: row.get(4)?,
                    cached_updated_at: row.get(5)?,
                    summary,
                })
            },
        )
        .map_err(AiServiceError::storage)?;
    let mut items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(AiServiceError::storage)?;

    if let Some(allowed) = allowed_book_ids {
        items.retain(|item| allowed.contains(&item.book_id));
    }

    Ok(items)
}

fn upsert_ai_output(
    connection: &rusqlite::Connection,
    draft: &AiOutputUpsert,
    updated_at: &str,
) -> Result<(), AiServiceError> {
    let output_json = serde_json::to_string(&draft.output).map_err(AiServiceError::storage)?;
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
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
            ON CONFLICT(feature, scope_id, prompt_version, input_hash) DO UPDATE SET
                output_json = excluded.output_json,
                source_count = excluded.source_count,
                provider_model = excluded.provider_model,
                updated_at = excluded.updated_at
            ",
            params![
                &draft.feature,
                &draft.scope_id,
                &draft.prompt_version,
                &draft.input_hash,
                output_json,
                draft.source_count,
                &draft.provider_model,
                updated_at
            ],
        )
        .map_err(AiServiceError::storage)?;

    Ok(())
}

fn current_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use rusqlite::Connection;
    use serde::Deserialize;
    use serde_json::json;

    use crate::{
        db::initialize_schema,
        mappers::stats::{
            map_reading_stats_response, ReadingCategoryRecord, ReadingRankItemRecord,
            ReadingStatsRecord, ReadingTimeBucketRecord,
        },
    };

    use super::{
        book_decision_json_schema, book_notes_summary_json_schema, build_book_decision_input,
        build_chat_completion_payload, build_chat_completion_payload_without_response_format,
        build_chat_completion_probe_payload, build_local_reader_selection_question_input,
        build_reading_route_input, build_reading_stats_review_input, build_summary_input,
        cached_reading_route_response, cached_reading_stats_review_response, chat_completions_url,
        default_json_object_response_format, default_provider_settings,
        extract_chat_completion_json, humanize_review_text, is_empty_reading_stats,
        is_unsupported_json_schema_response, local_reader_selection_question_json_schema,
        local_reader_selection_question_system_prompt, models_url, normalize_book_decision_output,
        normalize_local_reader_selection_answer_output, normalize_provider_settings,
        normalize_reading_route_output, normalize_reading_stats_review_output,
        normalize_summary_output, parse_provider_model_list, provider_capability_probe_json_schema,
        provider_network_user_message, read_ai_asset_detail, read_ai_asset_summaries,
        read_ai_asset_version_detail, read_ai_asset_version_history, read_ai_output,
        read_ai_review_feedback, read_book_summary_export_items, read_book_summary_list,
        read_latest_ai_output, read_local_book_notes, read_provider_settings,
        reading_route_json_schema, reading_route_update_context, reading_stats_review_json_schema,
        recommend_response_format_policy, require_ai_credential_for_uncached_summary,
        resolve_book_summary_update_context, resolve_reading_persona, save_ai_review_feedback,
        serialize_book_summary_export_index, stable_hash_json, upsert_ai_output,
        AiCachedOutputRecord, AiFeedbackExportRecord, AiOutputUpsert, AiProviderCapabilityStatus,
        AiResponseFormatKind, AiResponseFormatPolicy, AiReviewFeedbackExport,
        AiReviewFeedbackState, AiService, AiServiceError, BookAiSummarySource,
        BookAiSummarySourceStats, BookAiSummaryUpdateContext, BookDecisionCandidateInput,
        BookDecisionSourceStats, BookSummaryExportItem, BookSummaryUpdateContext,
        LocalReaderSelectionBookInput, LocalReaderSelectionContextInput, LocalReaderSelectionInput,
        LocalReaderSelectionQuestionInput, ReadingPersonaPatch, ReadingRouteBookInput,
        ReadingRouteRequest, ReadingRouteSourceStats, ReadingRouteUpdateContext,
        ReadingRouteUpdateContextData, ReadingStageSignal, ReadingStatsAiReviewSourceStats,
        SourceItemInput, BOOK_DECISION_PROMPT_VERSION, BOOK_NOTES_SUMMARY_FEATURE,
        BOOK_NOTES_SUMMARY_PROMPT_VERSION, LOCAL_READER_SELECTION_QA_PROMPT_VERSION,
        MAX_LOCAL_READER_ANSWER_CHARS, MAX_LOCAL_READER_CONTEXT_TEXT_CHARS,
        MAX_LOCAL_READER_LIST_ITEM_CHARS, READING_ROUTE_FEATURE, READING_ROUTE_PROMPT_VERSION,
        READING_STATS_REVIEW_FEATURE, READING_STATS_REVIEW_PROMPT_VERSION,
    };

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReadingPersonaFixtureCase {
        id: String,
        stats: ReadingPersonaFixtureStats,
        expected: ReadingPersonaFixtureExpected,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReadingPersonaFixtureStats {
        mode: String,
        base_time: i64,
        read_days: Option<i64>,
        total_read_time_seconds: Option<i64>,
        day_average_read_time_seconds: Option<i64>,
        compare: Option<f64>,
        #[serde(default)]
        buckets: Vec<ReadingPersonaFixtureBucket>,
        #[serde(default)]
        longest_items: Vec<ReadingPersonaFixtureItem>,
        #[serde(default)]
        categories: Vec<ReadingPersonaFixtureCategory>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReadingPersonaFixtureBucket {
        start_time: i64,
        read_time_seconds: i64,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReadingPersonaFixtureItem {
        id: String,
        title: String,
        author: Option<String>,
        #[serde(rename = "type")]
        item_type: String,
        read_time_seconds: i64,
        #[serde(default)]
        tags: Vec<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReadingPersonaFixtureCategory {
        category_id: Option<String>,
        title: String,
        parent_title: Option<String>,
        reading_time_seconds: Option<i64>,
        reading_count: Option<i64>,
        value: Option<f64>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReadingPersonaFixtureExpected {
        status: String,
        code: Option<String>,
        label: Option<String>,
        display_title: Option<String>,
        palette_group: Option<String>,
        accent_tone: Option<String>,
        dimension_keys: Vec<String>,
        confidence: Option<f64>,
        evidence_count: usize,
    }

    fn load_reading_persona_fixture_cases() -> Vec<ReadingPersonaFixtureCase> {
        serde_json::from_str(include_str!("../../../src/reading-persona.fixtures.json"))
            .expect("reading persona fixtures should be valid JSON")
    }

    fn reading_stats_record_from_fixture(stats: &ReadingPersonaFixtureStats) -> ReadingStatsRecord {
        ReadingStatsRecord {
            mode: stats.mode.clone(),
            base_time: stats.base_time,
            read_days: stats.read_days,
            total_read_time_seconds: stats.total_read_time_seconds,
            day_average_read_time_seconds: stats.day_average_read_time_seconds,
            compare: stats.compare,
            buckets: stats
                .buckets
                .iter()
                .map(|bucket| ReadingTimeBucketRecord {
                    start_time: bucket.start_time,
                    read_time_seconds: bucket.read_time_seconds,
                })
                .collect(),
            longest_items: stats
                .longest_items
                .iter()
                .map(|item| ReadingRankItemRecord {
                    id: item.id.clone(),
                    title: item.title.clone(),
                    author: item.author.clone(),
                    cover: None,
                    item_type: item.item_type.clone(),
                    read_time_seconds: item.read_time_seconds,
                    record_reading_time_seconds: None,
                    tags: item.tags.clone(),
                })
                .collect(),
            categories: stats
                .categories
                .iter()
                .map(|category| ReadingCategoryRecord {
                    category_id: category.category_id.clone(),
                    title: category.title.clone(),
                    parent_category_id: None,
                    parent_title: category.parent_title.clone(),
                    value: category.value,
                    reading_time_seconds: category.reading_time_seconds,
                    reading_count: category.reading_count,
                    category_type: None,
                })
                .collect(),
            raw: serde_json::Value::Null,
        }
    }

    #[test]
    fn validate_ai_credential_rejects_empty_key() {
        let result = AiService::validate_credential_input("   ", None, None, None, None);

        assert!(!result.is_valid);
        assert_eq!(result.message, Some("AI API Key 不能为空。".to_string()));
    }

    #[test]
    fn validate_ai_credential_rejects_invalid_provider_url() {
        let result = AiService::validate_credential_input(
            "sk-1234567890abcdef",
            Some("api.example.com"),
            Some("gpt-4o-mini"),
            None,
            None,
        );

        assert!(!result.is_valid);
        assert_eq!(
            result.message,
            Some("AI Base URL 必须以 http:// 或 https:// 开头。".to_string())
        );
    }

    #[test]
    fn provider_settings_trim_trailing_slashes() {
        let settings = normalize_provider_settings(
            Some(" https://api.example.com/v1/ "),
            Some("gpt-4o-mini"),
            Some("deepseek"),
            Some(AiResponseFormatPolicy::NoResponseFormatFirst),
        )
        .expect("provider settings should normalize");

        assert_eq!(settings.base_url, "https://api.example.com/v1");
        assert_eq!(settings.model, "gpt-4o-mini");
        assert_eq!(settings.preset_id, "deepseek");
        assert_eq!(
            settings.response_format_policy,
            AiResponseFormatPolicy::NoResponseFormatFirst
        );
    }

    #[test]
    fn provider_settings_read_legacy_record_with_safe_defaults() {
        let bytes = serde_json::to_vec(&json!({
            "baseUrl": "https://api.example.com/v1",
            "model": "gpt-4o-mini"
        }))
        .expect("legacy provider settings should serialize");

        let settings = read_provider_settings(Some(bytes));

        assert_eq!(settings.base_url, "https://api.example.com/v1");
        assert_eq!(settings.model, "gpt-4o-mini");
        assert_eq!(settings.preset_id, "custom");
        assert_eq!(
            settings.response_format_policy,
            AiResponseFormatPolicy::Auto
        );
    }

    #[test]
    fn default_provider_settings_use_openai_json_schema_preset() {
        let settings = default_provider_settings();

        assert_eq!(settings.base_url, "https://api.openai.com/v1");
        assert_eq!(settings.model, "gpt-4o-mini");
        assert_eq!(settings.preset_id, "openai");
        assert_eq!(
            settings.response_format_policy,
            AiResponseFormatPolicy::JsonSchemaFirst
        );
    }

    #[test]
    fn reading_route_prompt_requires_concrete_single_book_prescription() {
        let prompt = super::reading_route_system_prompt();

        assert_eq!(READING_ROUTE_PROMPT_VERSION, "reading-route-v2.1");
        assert!(prompt.contains("单本书阅读指南"));
        assert!(prompt.contains("下一段先读哪里"));
        assert!(prompt.contains("带着什么问题读"));
        assert!(prompt.contains("读完交付什么"));
        assert!(prompt.contains("不写“建立习惯、沉淀模板、长期投入、可复用方法论”等空泛话术"));
        assert!(prompt.contains("suggestedOutput 必须包含数量或格式和验收标准"));
        assert!(prompt.contains("nextActions 是 2-5 条可执行下一步"));
        assert!(prompt.contains("readingStage"));
        assert!(prompt.contains("currentBookStage"));
        assert!(prompt.contains("进度阶段"));
        assert!(prompt.contains("章节只能作为辅助依据"));
        assert!(prompt.contains("缺少章节"));
        assert!(prompt.contains("不得生成逐章任务清单"));
        assert!(prompt.contains("不得承诺实时章节追踪"));
    }

    #[test]
    fn ai_review_feedback_round_trips_action_and_reflection_records() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let mut feedback = AiReviewFeedbackState::default();
        feedback.action_items.insert(
            "0:写一页复盘".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("第一段\r\n\r\n第二段".to_string()),
                updated_at: "2024-01-01T00:00:00.000Z".to_string(),
            },
        );
        feedback.action_items.insert(
            "1:空记录".to_string(),
            AiFeedbackExportRecord {
                status: "todo".to_string(),
                note: None,
                updated_at: "2024-01-02T00:00:00.000Z".to_string(),
            },
        );
        feedback.reflection_questions.insert(
            "0:你如何定义成功？".to_string(),
            AiFeedbackExportRecord {
                status: "skipped".to_string(),
                note: Some("暂时不答".to_string()),
                updated_at: "2024-01-03T00:00:00.000Z".to_string(),
            },
        );

        let saved = save_ai_review_feedback(
            &mut connection,
            "book-review",
            "book_1",
            "summary_hash",
            feedback,
        )
        .expect("feedback should save");
        let loaded = read_ai_review_feedback(&connection, "book-review", "book_1", "summary_hash")
            .expect("feedback should load");

        assert_eq!(saved, loaded);
        assert_eq!(loaded.action_items.len(), 1);
        assert_eq!(
            loaded.action_items["0:写一页复盘"].note.as_deref(),
            Some("第一段\n\n第二段")
        );
        assert_eq!(loaded.reflection_questions.len(), 1);
        assert_eq!(
            loaded.reflection_questions["0:你如何定义成功？"].status,
            "skipped"
        );
    }

    #[test]
    fn ai_review_feedback_save_replaces_current_scope_state() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let mut initial = AiReviewFeedbackState::default();
        initial.action_items.insert(
            "0:旧行动".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: None,
                updated_at: "2024-01-01T00:00:00.000Z".to_string(),
            },
        );
        save_ai_review_feedback(
            &mut connection,
            "book-review",
            "book_1",
            "summary_hash",
            initial,
        )
        .expect("initial feedback should save");

        let mut next = AiReviewFeedbackState::default();
        next.reflection_questions.insert(
            "0:新问题".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已回答".to_string()),
                updated_at: "2024-01-02T00:00:00.000Z".to_string(),
            },
        );
        save_ai_review_feedback(
            &mut connection,
            "book-review",
            "book_1",
            "summary_hash",
            next,
        )
        .expect("replacement feedback should save");

        let loaded = read_ai_review_feedback(&connection, "book-review", "book_1", "summary_hash")
            .expect("feedback should load");

        assert!(loaded.action_items.is_empty());
        assert_eq!(loaded.reflection_questions.len(), 1);
    }

    #[test]
    fn reading_route_input_includes_stage_and_chapter_fallback_policy() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, ?2, NULL, NULL, NULL, '{}', '100')
                ",
                rusqlite::params!["book_deep_work", 55],
            )
            .expect("progress should save");

        let input = build_reading_route_input(
            &connection,
            ReadingRouteRequest {
                book: ReadingRouteBookInput {
                    book_id: "book_deep_work".to_string(),
                    title: "深度工作".to_string(),
                    author: Some("卡尔".to_string()),
                    category: Some("效率".to_string()),
                    local_status: Some("reading".to_string()),
                    progress_percent: None,
                    is_finished: None,
                },
                candidates: Vec::new(),
            },
            None,
        )
        .expect("reading route input should build");

        assert_eq!(input.payload["promptVersion"], json!("reading-route-v2.1"));
        assert_eq!(
            input.payload["currentBookStage"]["stage"],
            json!("deepening")
        );
        assert_eq!(
            input.payload["currentBookStage"]["label"],
            json!("深入推进")
        );
        assert_eq!(
            input.payload["currentBookStage"]["progressPercent"],
            json!(55)
        );
        assert_eq!(
            input.payload["chapterPolicy"]["fallback"],
            json!("章节缺失或目录未缓存时，必须回退到阅读进度、最近笔记、本地状态和已有复盘摘要。")
        );
        assert_eq!(
            input.payload["books"][0]["readingStage"]["stage"],
            json!("deepening")
        );
        assert_eq!(
            input.payload["books"][0]["chapterSignals"]["hasCachedChapters"],
            json!(false)
        );
    }

    #[test]
    fn reading_route_input_includes_update_context_action_feedback() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let request = ReadingRouteRequest {
            book: ReadingRouteBookInput {
                book_id: "book_deep_work".to_string(),
                title: "深度工作".to_string(),
                author: Some("卡尔".to_string()),
                category: Some("效率".to_string()),
                local_status: Some("reading".to_string()),
                progress_percent: Some(55),
                is_finished: Some(false),
            },
            candidates: Vec::new(),
        };
        let without_context = build_reading_route_input(&connection, request.clone(), None)
            .expect("reading route input should build");
        let mut action_items = HashMap::new();
        action_items.insert(
            "0:今天安排45分钟读完第2章".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已整理成一页笔记".to_string()),
                updated_at: "2026-05-23T00:00:00Z".to_string(),
            },
        );
        let update_context = ReadingRouteUpdateContextData {
            source_input_hash: "route-hash-v1".to_string(),
            feedback: AiReviewFeedbackExport {
                action_items,
                reflection_questions: HashMap::new(),
            },
        };
        let with_context = build_reading_route_input(&connection, request, Some(&update_context))
            .expect("reading route input with update context should build");

        let without_hash = stable_hash_json(&without_context.payload).expect("hash should build");
        let with_hash = stable_hash_json(&with_context.payload).expect("hash should build");

        assert_ne!(without_hash, with_hash);
        assert_eq!(
            with_context.payload["updateContext"]["sourceInputHash"],
            json!("route-hash-v1")
        );
        assert_eq!(
            with_context.payload["updateContext"]["actionFeedback"][0]["status"],
            json!("completed")
        );
        assert_eq!(
            with_context.payload["updateContext"]["actionFeedback"][0]["note"],
            json!("已整理成一页笔记")
        );
        assert!(with_context.payload["basis"]
            .as_str()
            .expect("basis should be a string")
            .contains("上一版阅读指南行动反馈"));
    }

    #[test]
    fn reading_route_update_context_requires_regenerate_matching_route_scope() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let mut feedback = AiReviewFeedbackState::default();
        feedback.action_items.insert(
            "0:今天安排45分钟读完第2章".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已整理成一页笔记".to_string()),
                updated_at: "2026-05-23T00:00:00Z".to_string(),
            },
        );
        save_ai_review_feedback(
            &mut connection,
            "reading-route",
            "book:book_deep_work",
            "route-hash-v1",
            feedback,
        )
        .expect("feedback should save");

        let matching_update = ReadingRouteUpdateContext {
            feature: "reading-route".to_string(),
            scope_id: "book:book_deep_work".to_string(),
            input_hash: "route-hash-v1".to_string(),
        };

        assert!(reading_route_update_context(
            &connection,
            "book:book_deep_work",
            Some(matching_update.clone()),
            false,
        )
        .expect("update context should resolve")
        .is_none());
        assert!(reading_route_update_context(
            &connection,
            "book:other",
            Some(matching_update.clone()),
            true,
        )
        .expect("update context should resolve")
        .is_none());
        assert!(reading_route_update_context(
            &connection,
            "book:book_deep_work",
            Some(ReadingRouteUpdateContext {
                feature: "book-review".to_string(),
                ..matching_update.clone()
            }),
            true,
        )
        .expect("update context should resolve")
        .is_none());
        assert!(reading_route_update_context(
            &connection,
            "book:book_deep_work",
            Some(ReadingRouteUpdateContext {
                input_hash: "route-hash-empty".to_string(),
                ..matching_update.clone()
            }),
            true,
        )
        .expect("empty feedback should resolve")
        .is_none());

        let mut reflection_only = AiReviewFeedbackState::default();
        reflection_only.reflection_questions.insert(
            "0:这一段如何复盘？".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("这里只是历史兼容数据".to_string()),
                updated_at: "2026-05-24T00:00:00Z".to_string(),
            },
        );
        save_ai_review_feedback(
            &mut connection,
            "reading-route",
            "book:book_deep_work",
            "route-hash-reflection-only",
            reflection_only,
        )
        .expect("reflection-only feedback should save");
        assert!(reading_route_update_context(
            &connection,
            "book:book_deep_work",
            Some(ReadingRouteUpdateContext {
                input_hash: "route-hash-reflection-only".to_string(),
                ..matching_update.clone()
            }),
            true,
        )
        .expect("reflection-only feedback should resolve")
        .is_none());

        let context = reading_route_update_context(
            &connection,
            "book:book_deep_work",
            Some(matching_update),
            true,
        )
        .expect("update context should resolve")
        .expect("matching route update should include feedback");

        assert_eq!(context.source_input_hash, "route-hash-v1");
        assert_eq!(
            context.feedback.action_items["0:今天安排45分钟读完第2章"]
                .note
                .as_deref(),
            Some("已整理成一页笔记")
        );
    }

    #[test]
    fn book_decision_input_uses_only_local_candidates_and_structured_signals() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        insert_book_decision_fixture(&connection);

        let input = build_book_decision_input(
            &connection,
            vec![
                BookDecisionCandidateInput {
                    book_id: "candidate_moon".to_string(),
                    title: "月亮与六便士".to_string(),
                    author: Some("毛姆".to_string()),
                    category: Some("文学".to_string()),
                    local_status: Some("toRead".to_string()),
                },
                BookDecisionCandidateInput {
                    book_id: "candidate_focus".to_string(),
                    title: "专注力".to_string(),
                    author: Some("作者".to_string()),
                    category: Some("效率".to_string()),
                    local_status: Some("toRead".to_string()),
                },
            ],
            Some("推进长期书".to_string()),
        )
        .expect("decision input should build");
        let payload_text = input.payload.to_string();

        assert_eq!(input.source_stats.candidate_count, 2);
        assert_eq!(input.source_stats.summary_count, 1);
        assert_eq!(input.source_stats.local_status_count, 2);
        assert!(payload_text.contains("月亮与六便士"));
        assert!(payload_text.contains("复盘概览"));
        assert!(payload_text.contains("推进长期书"));
        assert!(!payload_text.contains("shelf_entries"));
        assert!(!payload_text.contains("raw_json"));
        assert!(!payload_text.contains("sk-"));
        assert!(!payload_text.contains("app.db"));
        assert!(!payload_text.contains("原始划线正文不应进入选书决策"));
    }

    #[test]
    fn local_reader_selection_question_input_uses_only_selection_payload() {
        let input =
            build_local_reader_selection_question_input(LocalReaderSelectionQuestionInput {
                source_item: SourceItemInput {
                    source: "local".to_string(),
                    source_id: "local_fnv1a64_sensitive_file_hash".to_string(),
                },
                book: LocalReaderSelectionBookInput {
                    title: "本地图书".to_string(),
                    author: Some("作者".to_string()),
                },
                selection: LocalReaderSelectionInput {
                    text: "这是一段用户手动选择的文本。".to_string(),
                    start_offset: 12,
                    end_offset: 28,
                    context: None,
                },
                question: "这段话如何理解？".to_string(),
            })
            .expect("local reader selection question input should build");
        let payload_text = input.payload.to_string();

        assert_eq!(
            input.payload["promptVersion"],
            json!(LOCAL_READER_SELECTION_QA_PROMPT_VERSION)
        );
        assert_eq!(input.payload["source"], json!("local"));
        assert_eq!(
            input.payload["selection"]["text"],
            json!("这是一段用户手动选择的文本。")
        );
        assert_eq!(input.payload["question"], json!("这段话如何理解？"));
        assert_eq!(
            input.scope_id,
            "local:local_fnv1a64_sensitive_file_hash:12-28"
        );
        assert!(!payload_text.contains("local_fnv1a64_sensitive_file_hash"));
        assert!(!payload_text.contains("storagePath"));
        assert!(!payload_text.contains("fileHash"));
        assert!(!payload_text.contains("app.db"));
        assert!(!payload_text.contains("sk-"));
        assert!(!payload_text.contains("wx_session"));
        assert!(!payload_text.contains("整本书正文不应进入选区提问"));
    }

    #[test]
    fn local_reader_selection_question_input_includes_bounded_context() {
        let input =
            build_local_reader_selection_question_input(LocalReaderSelectionQuestionInput {
                source_item: SourceItemInput {
                    source: "local".to_string(),
                    source_id: "local_book".to_string(),
                },
                book: LocalReaderSelectionBookInput {
                    title: "本地图书".to_string(),
                    author: None,
                },
                selection: LocalReaderSelectionInput {
                    text: "柴静".to_string(),
                    start_offset: 20,
                    end_offset: 22,
                    context: Some(LocalReaderSelectionContextInput {
                        before_text: Some(format!(
                            "敏感路径 C:/Books/private.txt {}",
                            "前".repeat(MAX_LOCAL_READER_CONTEXT_TEXT_CHARS + 20)
                        )),
                        after_text: Some(format!(
                            "{} wx_session",
                            "后".repeat(MAX_LOCAL_READER_CONTEXT_TEXT_CHARS + 20)
                        )),
                    }),
                },
                question: "这里的她是谁？".to_string(),
            })
            .expect("local reader selection question input should include context");
        let payload_text = input.payload.to_string();

        assert_eq!(input.payload["selection"]["text"], json!("柴静"));
        assert_eq!(
            input.payload["selection"]["context"]["beforeText"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            MAX_LOCAL_READER_CONTEXT_TEXT_CHARS
        );
        assert_eq!(
            input.payload["selection"]["context"]["afterText"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            MAX_LOCAL_READER_CONTEXT_TEXT_CHARS
        );
        assert!(!payload_text.contains("C:/Books/private.txt"));
        assert!(!payload_text.contains("wx_session"));
    }

    #[test]
    fn local_reader_selection_question_rejects_invalid_source_or_range() {
        let weread_result =
            build_local_reader_selection_question_input(LocalReaderSelectionQuestionInput {
                source_item: SourceItemInput {
                    source: "weread".to_string(),
                    source_id: "book_1".to_string(),
                },
                book: LocalReaderSelectionBookInput {
                    title: "微信书".to_string(),
                    author: None,
                },
                selection: LocalReaderSelectionInput {
                    text: "选区".to_string(),
                    start_offset: 0,
                    end_offset: 2,
                    context: None,
                },
                question: "问题".to_string(),
            });
        assert!(weread_result.is_err());

        let invalid_range =
            build_local_reader_selection_question_input(LocalReaderSelectionQuestionInput {
                source_item: SourceItemInput {
                    source: "local".to_string(),
                    source_id: "local_book".to_string(),
                },
                book: LocalReaderSelectionBookInput {
                    title: "本地图书".to_string(),
                    author: None,
                },
                selection: LocalReaderSelectionInput {
                    text: "选区".to_string(),
                    start_offset: 10,
                    end_offset: 10,
                    context: None,
                },
                question: "问题".to_string(),
            });
        assert!(invalid_range.is_err());
    }

    #[test]
    fn normalize_local_reader_selection_answer_limits_follow_ups() {
        let answer = normalize_local_reader_selection_answer_output(
            json!({
                "answer": "仅凭选中文本看，这段话强调阅读器应该围绕正文保持克制。",
                "keyPoints": ["围绕正文", "不读取整本书"],
                "followUpQuestions": ["还能选择哪段？", "作者前文如何铺垫？", "后文是否转折？", "多余问题"]
            }),
            "100".to_string(),
            LOCAL_READER_SELECTION_QA_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("selection answer should normalize");

        assert_eq!(answer.key_points.len(), 2);
        assert_eq!(
            answer.follow_up_questions,
            vec![
                "还能选择哪段？".to_string(),
                "作者前文如何铺垫？".to_string(),
                "后文是否转折？".to_string(),
            ]
        );
        assert_eq!(
            answer.response_format,
            Some(AiResponseFormatKind::JsonSchema)
        );
        assert!(answer.basis_notice.contains("选中文本"));
    }

    #[test]
    fn normalize_local_reader_selection_answer_limits_long_items() {
        let long_answer = "a".repeat(MAX_LOCAL_READER_ANSWER_CHARS + 20);
        let long_item = "b".repeat(MAX_LOCAL_READER_LIST_ITEM_CHARS + 20);
        let answer = normalize_local_reader_selection_answer_output(
            json!({
                "answer": long_answer,
                "keyPoints": [long_item, long_item, long_item, long_item, long_item, long_item],
                "followUpQuestions": [long_item, long_item, long_item, long_item]
            }),
            "100".to_string(),
            LOCAL_READER_SELECTION_QA_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("selection answer should normalize");

        assert_eq!(
            answer.answer.chars().count(),
            MAX_LOCAL_READER_ANSWER_CHARS + 3
        );
        assert_eq!(answer.key_points.len(), 5);
        assert_eq!(answer.follow_up_questions.len(), 3);
        assert_eq!(
            answer.key_points[0].chars().count(),
            MAX_LOCAL_READER_LIST_ITEM_CHARS + 3
        );
        assert!(answer.key_points[0].ends_with("..."));
        assert!(answer.follow_up_questions[0].ends_with("..."));
    }

    #[test]
    fn local_reader_selection_prompt_and_schema_lock_privacy_boundary() {
        let prompt = local_reader_selection_question_system_prompt();
        let schema = local_reader_selection_question_json_schema();

        assert!(prompt.contains("selection.context.beforeText"));
        assert!(prompt.contains("先直接回答用户问题"));
        assert!(prompt.contains("不假装读过整本书"));
        assert!(prompt.contains("文件 hash"));
        assert!(prompt.contains("微信凭据"));
        assert_eq!(
            schema["required"],
            json!(["answer", "keyPoints", "followUpQuestions"])
        );
    }

    #[test]
    fn normalize_book_decision_output_limits_candidates_and_requires_decision_fields() {
        let decision = normalize_book_decision_output(
            json!({
                "decisionOverview": "先读《月亮与六便士》，因为它能承接最近的文学主题，同时投入可控。",
                "topCandidates": [
                    {
                        "bookId": "candidate_moon",
                        "title": "月亮与六便士",
                        "author": "毛姆",
                        "rank": 1,
                        "whyNow": "最近文学主题较多，现在读能形成对个人选择的复盘。",
                        "tradeoff": "暂缓效率类书，避免连续读方法论造成输入单一。",
                        "estimatedEffort": "3 个 45 分钟阅读时段",
                        "prerequisiteAction": "先打开详情确认是否仍想读。",
                        "reviewTrigger": "读完第一章后写 3 条关于选择代价的问题。",
                        "basis": "来自本地候选和已生成复盘摘要。"
                    },
                    {
                        "bookId": "candidate_focus",
                        "title": "专注力",
                        "author": "作者",
                        "rank": 2,
                        "whyNow": "可补充当前效率主题。",
                        "tradeoff": "和近期《深度工作》主题接近，信息增量较小。",
                        "estimatedEffort": "2 个阅读时段",
                        "prerequisiteAction": "先看目录。",
                        "reviewTrigger": "读完后更新行动清单。",
                        "basis": "来自本地候选分类。"
                    },
                    {
                        "bookId": "candidate_extra",
                        "title": "应被截断",
                        "rank": 3,
                        "whyNow": "多余",
                        "tradeoff": "多余",
                        "estimatedEffort": "1 小时",
                        "prerequisiteAction": "多余",
                        "reviewTrigger": "多余",
                        "basis": "多余"
                    },
                    {
                        "bookId": "candidate_fourth",
                        "title": "第四本",
                        "rank": 4,
                        "whyNow": "多余",
                        "tradeoff": "多余",
                        "estimatedEffort": "1 小时",
                        "prerequisiteAction": "多余",
                        "reviewTrigger": "多余",
                        "basis": "多余"
                    }
                ],
                "deferredCandidates": [
                    {
                        "bookId": "candidate_focus",
                        "title": "专注力",
                        "reason": "与近期主题重复，先暂缓。"
                    }
                ],
                "nextActions": ["今天先打开《月亮与六便士》详情，确认是否继续读。", "读完第一章后写 3 条选择代价问题。"]
            }),
            HashSet::from(["candidate_moon".to_string(), "candidate_focus".to_string()]),
            BookDecisionSourceStats {
                candidate_count: 2,
                summary_count: 1,
                stats_signal_count: 1,
                local_status_count: 2,
            },
            "100".to_string(),
            BOOK_DECISION_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("decision should normalize");

        assert_eq!(decision.top_candidates.len(), 2);
        assert_eq!(decision.top_candidates[0].book_id, "candidate_moon");
        assert_eq!(
            decision.top_candidates[0].why_now,
            "最近文学主题较多，现在读能形成对个人选择的复盘。"
        );
        assert_eq!(decision.deferred_candidates.len(), 1);
        assert_eq!(decision.next_actions.len(), 2);
        assert_eq!(decision.prompt_version, "book-decision-v1");
        assert_eq!(
            decision.response_format,
            Some(AiResponseFormatKind::JsonSchema)
        );
        assert!(decision.basis_notice.contains("本地候选"));
    }

    #[test]
    fn normalize_book_decision_output_humanizes_internal_action_tokens() {
        let decision = normalize_book_decision_output(
            json!({
                "decisionOverview": "先读《月亮与六便士》，因为它能承接最近的文学主题。",
                "topCandidates": [
                    {
                        "bookId": "candidate_moon",
                        "title": "月亮与六便士",
                        "author": "毛姆",
                        "rank": 1,
                        "whyNow": "最近文学主题较多，现在读能形成对个人选择的复盘。",
                        "tradeoff": "暂缓其他长篇，避免阅读线过多。",
                        "estimatedEffort": "3 个 45 分钟阅读时段",
                        "prerequisiteAction": "先打开详情确认目录。",
                        "reviewTrigger": "读完第一章后写 3 条选择代价问题。",
                        "basis": "来自本地候选。"
                    }
                ],
                "deferredCandidates": [],
                "nextActions": ["openDetails", "scheduleReadingBlock", "postReadReview"]
            }),
            HashSet::from(["candidate_moon".to_string()]),
            BookDecisionSourceStats {
                candidate_count: 1,
                summary_count: 0,
                stats_signal_count: 0,
                local_status_count: 1,
            },
            "100".to_string(),
            BOOK_DECISION_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonObject),
        )
        .expect("decision should normalize");

        assert_eq!(
            decision.next_actions,
            vec![
                "打开《月亮与六便士》详情，确认目录和试读入口。".to_string(),
                "安排一个 30-45 分钟阅读时段，先完成第一段试读。".to_string(),
                "读完后写 3 条复盘：收获、疑问、下一步。".to_string(),
            ]
        );
        assert_eq!(
            decision.response_format,
            Some(AiResponseFormatKind::JsonObject)
        );
    }

    #[test]
    fn ai_output_cache_upserts_and_reads_json() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let draft = AiOutputUpsert {
            feature: "book-notes-summary".to_string(),
            scope_id: "book_1".to_string(),
            prompt_version: "book-notes-summary-v3".to_string(),
            input_hash: "abc123".to_string(),
            output: json!({ "summary": "初版" }),
            source_count: Some(3),
            provider_model: Some("gpt-4o-mini".to_string()),
        };

        upsert_ai_output(&connection, &draft, "100").expect("AI output should save");
        let mut updated = draft.clone();
        updated.output = json!({ "summary": "新版" });
        upsert_ai_output(&connection, &updated, "120").expect("AI output should update");

        let saved = read_ai_output(
            &connection,
            "book-notes-summary",
            "book_1",
            "book-notes-summary-v3",
            "abc123",
        )
        .expect("AI output should query")
        .expect("AI output should exist");

        assert_eq!(saved.output, json!({ "summary": "新版" }));
        assert_eq!(saved.source_count, Some(3));
        assert_eq!(saved.created_at, "100");
        assert_eq!(saved.updated_at, "120");
    }

    #[test]
    fn reading_stats_review_uses_latest_cache_when_input_hash_changes() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let output = json!({
            "overview": "旧缓存复盘",
            "rhythmInsights": ["旧节奏"],
            "preferenceInsights": ["旧偏好"],
            "focusItems": ["旧重点"],
            "nextActions": ["旧行动"],
            "sourceStats": {
                "mode": "overall",
                "baseTime": 0,
                "bucketCount": 1,
                "longestItemCount": 1,
                "categoryCount": 1
            },
            "generatedAt": "100",
            "promptVersion": READING_STATS_REVIEW_PROMPT_VERSION,
            "basisNotice": "基于结构化阅读统计生成，不包含笔记正文或书籍全文。"
        });
        let old_draft = AiOutputUpsert {
            feature: READING_STATS_REVIEW_FEATURE.to_string(),
            scope_id: "overall:0".to_string(),
            prompt_version: READING_STATS_REVIEW_PROMPT_VERSION.to_string(),
            input_hash: "old_hash".to_string(),
            output,
            source_count: Some(3),
            provider_model: Some("gpt-5.2".to_string()),
        };
        upsert_ai_output(&connection, &old_draft, "100").expect("old cache should save");

        let latest = read_latest_ai_output(
            &connection,
            READING_STATS_REVIEW_FEATURE,
            "overall:0",
            READING_STATS_REVIEW_PROMPT_VERSION,
        )
        .expect("latest cache should query")
        .expect("latest cache should exist");
        let stats = map_reading_stats_response(
            "overall",
            &json!({ "baseTime": 0, "totalReadTime": 120, "readDays": 2 }),
            Some(0),
        );
        let response = cached_reading_stats_review_response(
            &stats,
            "new_hash",
            latest,
            Some("统计已变化，使用最近缓存。".to_string()),
        )
        .expect("stale cache response should build");

        assert_eq!(response.source, BookAiSummarySource::StaleCache);
        assert_eq!(response.input_hash, "new_hash");
        assert_eq!(response.cached_updated_at, Some("100".to_string()));
        assert_eq!(response.review.overview, "旧缓存复盘");
        assert_eq!(response.review.response_format, None);
    }

    #[test]
    fn cached_reading_route_response_backfills_missing_stage_from_current_input() {
        let cached = AiCachedOutputRecord {
            feature: READING_ROUTE_FEATURE.to_string(),
            scope_id: "book:book_deep_work".to_string(),
            prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
            input_hash: "old_hash".to_string(),
            output: json!({
                "routeOverview": "先完成关键阅读，再输出 1 页复盘。",
                "books": [{
                    "bookId": "book_deep_work",
                    "title": "深度工作",
                    "author": "卡尔·纽波特",
                    "order": 1,
                    "role": "当前书",
                    "readingPurpose": "今天先读当前进度后的下一段，确认 1 个最难坚持的专注场景。",
                    "estimatedEffort": "1 个 45 分钟阅读时段",
                    "localStatus": "reading",
                    "basis": "当前进度 55%，已进入深入推进阶段。"
                }],
                "dependencies": [],
                "reviewCheckpoints": [{
                    "timing": "读完这一段后",
                    "question": "哪条专注规则最值得本周先试一次？",
                    "suggestedOutput": "写 3 条观察，并选 1 条作为本周实验。"
                }],
                "nextActions": ["今天读 45 分钟并写 3 条专注观察，完成标准：选出 1 条本周实验。"],
                "sourceStats": {
                    "currentBookCount": 1,
                    "candidateCount": 0,
                    "summaryCount": 0,
                    "statsSignalCount": 0,
                    "localStatusCount": 1
                },
                "generatedAt": "100",
                "promptVersion": READING_ROUTE_PROMPT_VERSION,
                "basisNotice": "基于本地缓存生成。"
            }),
            source_count: Some(2),
            provider_model: Some("deepseek-v3".to_string()),
            created_at: "100".to_string(),
            updated_at: "100".to_string(),
        };

        let response = cached_reading_route_response(
            "book_deep_work",
            "book:book_deep_work",
            "new_hash",
            cached,
            Some(ReadingStageSignal {
                stage: "deepening".to_string(),
                label: "深入推进".to_string(),
                progress_percent: 55,
                refresh_reason: None,
            }),
            None,
        )
        .expect("cached route should parse");

        assert_eq!(response.input_hash, "new_hash");
        assert_eq!(
            response.route.reading_stage,
            Some(ReadingStageSignal {
                stage: "deepening".to_string(),
                label: "深入推进".to_string(),
                progress_percent: 55,
                refresh_reason: None,
            })
        );
        assert_eq!(response.route.response_format, None);
    }

    #[test]
    fn book_summary_list_reads_latest_per_book() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 0, 0, 0, 0, 0, '{}', '100')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("book should save");

        for (hash, overview, updated_at) in [("old", "旧复盘", "100"), ("new", "新复盘", "120")]
        {
            upsert_ai_output(
                &connection,
                &AiOutputUpsert {
                    feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                    scope_id: "book_1".to_string(),
                    prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                    input_hash: hash.to_string(),
                    output: json!({
                        "overview": overview,
                        "keyIdeas": [],
                        "myFocus": [],
                        "actionItems": [],
                        "themeTags": [],
                        "representativeQuotes": [],
                        "reflectionQuestions": [],
                        "sourceStats": {
                            "highlightCount": 1,
                            "thoughtCount": 0,
                            "bookmarkCount": 0,
                            "chapterCount": 0,
                            "includedHighlightCount": 1,
                            "includedThoughtCount": 0
                        },
                        "generatedAt": updated_at,
                        "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                        "basisNotice": "基于本地笔记生成，不代表整本书全文内容。"
                    }),
                    source_count: Some(1),
                    provider_model: Some("gpt-5.2".to_string()),
                },
                updated_at,
            )
            .expect("summary cache should save");
        }

        let mut feedback = AiReviewFeedbackState::default();
        feedback.action_items.insert(
            "0:写一页复盘".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已完成".to_string()),
                updated_at: "2024-01-01T00:00:00.000Z".to_string(),
            },
        );
        save_ai_review_feedback(&mut connection, "book-review", "book_1", "new", feedback)
            .expect("feedback should save");

        let items = read_book_summary_list(&connection).expect("summary list should read");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].book_id, "book_1");
        assert_eq!(items[0].title, "深度工作");
        assert_eq!(items[0].overview, "新复盘");
        assert_eq!(items[0].cached_updated_at, "120");
        assert_eq!(items[0].feedback_count, 1);
    }

    #[test]
    fn ai_asset_summaries_group_guides_and_reviews_by_book() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 2, 3, 0, 5, 0, '{}', '100')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("notebook book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 72, NULL, NULL, NULL, '{}', '110')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");
        connection
            .execute(
                "
                INSERT INTO reading_item_states (
                    item_id, item_type, status, title, author, cover, category, note, created_at, updated_at
                ) VALUES (?1, 'book', 'reading', ?2, ?3, NULL, '效率', NULL, '100', '110')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("reading state should insert");

        for (scope_id, hash, updated_at) in [
            ("book:book_1", "single_hash", "120"),
            ("book:book_1:candidates:abc123", "cross_hash", "130"),
        ] {
            upsert_ai_output(
                &connection,
                &AiOutputUpsert {
                    feature: "reading-route".to_string(),
                    scope_id: scope_id.to_string(),
                    prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                    input_hash: hash.to_string(),
                    output: json!({ "asset": scope_id }),
                    source_count: Some(1),
                    provider_model: Some("gpt-5.2".to_string()),
                },
                updated_at,
            )
            .expect("route cache should save");
        }
        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                scope_id: "book_1".to_string(),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "summary_hash".to_string(),
                output: json!({
                    "overview": "book review",
                    "keyIdeas": [],
                    "myFocus": [],
                    "actionItems": [],
                    "themeTags": [],
                    "representativeQuotes": [],
                    "reflectionQuestions": [],
                    "readingStage": {
                        "stage": "deepening",
                        "label": "深入推进",
                        "progressPercent": 55
                    },
                    "sourceStats": {
                        "highlightCount": 1,
                        "thoughtCount": 0,
                        "bookmarkCount": 0,
                        "chapterCount": 0,
                        "includedHighlightCount": 1,
                        "includedThoughtCount": 0
                    },
                    "generatedAt": "140",
                    "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                    "basisNotice": "基于本地笔记生成。"
                }),
                source_count: Some(5),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "140",
        )
        .expect("summary cache should save");

        let summaries = read_ai_asset_summaries(&connection).expect("asset summaries should read");

        assert_eq!(summaries.len(), 1);
        let summary = &summaries[0];
        assert_eq!(summary.book_id, "book_1");
        assert_eq!(summary.title, "深度工作");
        assert_eq!(summary.author, Some("卡尔".to_string()));
        assert_eq!(summary.progress, Some(72));
        assert_eq!(summary.reading_stage.as_deref(), Some("closing"));
        assert_eq!(summary.local_status.as_deref(), Some("reading"));
        assert!(summary.has_single_guide);
        assert_eq!(summary.cross_route_count, 1);
        assert!(summary.has_book_review);
        assert_eq!(summary.refresh_state, "suggested");
        assert_eq!(summary.refresh_reason.as_deref(), Some("stage_changed"));
        assert_eq!(summary.updated_at.as_deref(), Some("140"));
    }

    #[test]
    fn ai_asset_summaries_do_not_suggest_stage_refresh_when_latest_route_stage_matches_current_stage(
    ) {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 2, 3, 0, 5, 0, '{}', '100')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("notebook book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 55, NULL, NULL, NULL, '{}', '110')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");

        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: "reading-route".to_string(),
                scope_id: "book:book_1".to_string(),
                prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                input_hash: "single_hash".to_string(),
                output: json!({
                    "routeOverview": "阅读路线",
                    "books": [{ "bookId": "book_1", "title": "深度工作" }],
                    "dependencies": [],
                    "reviewCheckpoints": [],
                    "nextActions": ["今天读 30 分钟并写 3 条记录。"],
                    "readingStage": {
                        "stage": "deepening",
                        "label": "深入推进",
                        "progressPercent": 55
                    },
                    "sourceStats": {
                        "currentBookCount": 1,
                        "candidateCount": 0,
                        "summaryCount": 0,
                        "statsSignalCount": 0,
                        "localStatusCount": 0
                    },
                    "generatedAt": "140",
                    "promptVersion": READING_ROUTE_PROMPT_VERSION,
                    "basisNotice": "基于本地输入生成。"
                }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "140",
        )
        .expect("route cache should save");

        let summaries = read_ai_asset_summaries(&connection).expect("asset summaries should read");

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].refresh_state, "none");
        assert_eq!(summaries[0].refresh_reason, None);
    }

    #[test]
    fn ai_asset_summaries_prefer_notes_changed_when_notebook_updates_after_latest_asset() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 4, 6, 0, 10, 0, '{}', '220')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("notebook book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 72, NULL, NULL, NULL, '{}', '110')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");
        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: "reading-route".to_string(),
                scope_id: "book:book_1".to_string(),
                prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                input_hash: "single_hash".to_string(),
                output: json!({ "asset": "book:book_1" }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "140",
        )
        .expect("route cache should save");

        let summaries = read_ai_asset_summaries(&connection).expect("asset summaries should read");

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].refresh_state, "suggested");
        assert_eq!(
            summaries[0].refresh_reason.as_deref(),
            Some("notes_changed")
        );
    }

    #[test]
    fn ai_asset_summaries_mark_stalled_when_last_read_is_long_ago() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let last_read_at = 1_700_000_000_i64;
        let asset_updated_at = (last_read_at + 30 * 24 * 60 * 60 + 10).to_string();
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 1, 1, 0, 2, 0, '{}', '100')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("notebook book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 10, NULL, NULL, NULL, '{}', '110')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");
        connection
            .execute(
                "
                INSERT INTO reading_item_states (
                    item_id, item_type, status, title, author, cover, category, note, created_at, updated_at
                ) VALUES (?1, 'book', 'reading', ?2, ?3, NULL, '效率', NULL, '100', '110')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("reading state should insert");
        connection
            .execute(
                "
                INSERT INTO shelf_entries (
                    id, type, title, author, cover, category, is_top, is_secret, is_finished,
                    last_read_at, raw_json, updated_at
                ) VALUES (?1, 'book', ?2, ?3, NULL, '效率', 0, 0, 0, 1, '{}', '110')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("shelf entry should insert");
        connection
            .execute(
                "UPDATE shelf_entries SET last_read_at = ?2 WHERE id = ?1",
                rusqlite::params!["book_1", last_read_at],
            )
            .expect("shelf entry last_read_at should update");
        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: "reading-route".to_string(),
                scope_id: "book:book_1".to_string(),
                prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                input_hash: "single_hash".to_string(),
                output: json!({ "asset": "book:book_1" }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            &asset_updated_at,
        )
        .expect("route cache should save");

        let summaries = read_ai_asset_summaries(&connection).expect("asset summaries should read");

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].refresh_state, "suggested");
        assert_eq!(summaries[0].refresh_reason.as_deref(), Some("stalled"));
    }

    #[test]
    fn ai_asset_detail_groups_current_refs_without_exposing_output_json() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES
                    ('book_1', '深度工作', '卡尔', NULL, 2, 3, 0, 5, 0, '{}', '100'),
                    ('book_2', '刻意练习', '作者', NULL, 1, 1, 0, 2, 0, '{}', '100')
                ",
                [],
            )
            .expect("books should insert");

        for (scope_id, hash, books, updated_at) in [
            (
                "book:book_1",
                "single_hash",
                json!([{ "bookId": "book_1", "title": "深度工作" }]),
                "120",
            ),
            (
                "book:book_1:candidates:abc123",
                "main_cross_hash",
                json!([
                    { "bookId": "book_1", "title": "深度工作" },
                    { "bookId": "book_2", "title": "刻意练习" }
                ]),
                "130",
            ),
            (
                "book:book_2:candidates:def456",
                "participant_cross_hash",
                json!([
                    { "bookId": "book_2", "title": "刻意练习" },
                    { "bookId": "book_1", "title": "深度工作" }
                ]),
                "135",
            ),
        ] {
            upsert_ai_output(
                &connection,
                &AiOutputUpsert {
                    feature: "reading-route".to_string(),
                    scope_id: scope_id.to_string(),
                    prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                    input_hash: hash.to_string(),
                    output: json!({
                        "routeOverview": "阅读路线",
                        "books": books,
                        "dependencies": [],
                        "reviewCheckpoints": [],
                        "nextActions": ["今天读 30 分钟并写 3 条记录。"],
                        "sourceStats": {
                            "currentBookCount": 1,
                            "candidateCount": 0,
                            "summaryCount": 0,
                            "statsSignalCount": 0,
                            "localStatusCount": 0
                        },
                        "generatedAt": updated_at,
                        "promptVersion": READING_ROUTE_PROMPT_VERSION,
                        "basisNotice": "基于本地输入生成。"
                    }),
                    source_count: Some(1),
                    provider_model: Some("gpt-5.2".to_string()),
                },
                updated_at,
            )
            .expect("route cache should save");
        }
        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                scope_id: "book_1".to_string(),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "summary_hash".to_string(),
                output: json!({
                    "overview": "复盘概览",
                    "keyIdeas": [],
                    "myFocus": [],
                    "actionItems": [],
                    "themeTags": [],
                    "representativeQuotes": [],
                    "reflectionQuestions": [],
                    "sourceStats": {
                        "highlightCount": 1,
                        "thoughtCount": 0,
                        "bookmarkCount": 0,
                        "chapterCount": 0,
                        "includedHighlightCount": 1,
                        "includedThoughtCount": 0
                    },
                    "generatedAt": "140",
                    "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                    "basisNotice": "基于本地笔记生成。"
                }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "140",
        )
        .expect("summary cache should save");

        let detail = read_ai_asset_detail(&connection, "book_1")
            .expect("detail should read")
            .expect("detail should exist");

        assert_eq!(detail.book_id, "book_1");
        assert_eq!(detail.title, "深度工作");
        assert_eq!(
            detail
                .current_guide
                .as_ref()
                .map(|item| item.scope_id.as_str()),
            Some("book:book_1")
        );
        assert_eq!(detail.main_cross_routes.len(), 1);
        assert_eq!(
            detail.main_cross_routes[0].scope_id,
            "book:book_1:candidates:abc123"
        );
        assert_eq!(detail.participant_cross_routes.len(), 1);
        assert_eq!(
            detail.participant_cross_routes[0].scope_id,
            "book:book_2:candidates:def456"
        );
        assert_eq!(
            detail
                .current_book_review
                .as_ref()
                .map(|item| item.scope_id.as_str()),
            Some("book_1")
        );
        assert_eq!(
            detail
                .current_book_review
                .as_ref()
                .map(|item| item.feature.as_str()),
            Some("book-review")
        );
        assert_eq!(detail.main_cross_routes[0].generated_at, "130");
    }

    #[test]
    fn ai_asset_detail_exposes_refresh_reason_for_current_book_assets() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 4, 6, 0, 10, 0, '{}', '220')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("notebook book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 72, NULL, NULL, NULL, '{}', '110')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");
        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: "reading-route".to_string(),
                scope_id: "book:book_1".to_string(),
                prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                input_hash: "single_hash".to_string(),
                output: json!({
                    "routeOverview": "阅读路线",
                    "books": [{ "bookId": "book_1", "title": "深度工作" }],
                    "dependencies": [],
                    "reviewCheckpoints": [],
                    "nextActions": ["今天读 30 分钟并写 3 条记录。"],
                    "sourceStats": {
                        "currentBookCount": 1,
                        "candidateCount": 0,
                        "summaryCount": 0,
                        "statsSignalCount": 0,
                        "localStatusCount": 0
                    },
                    "generatedAt": "140",
                    "promptVersion": READING_ROUTE_PROMPT_VERSION,
                    "basisNotice": "基于本地输入生成。"
                }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "140",
        )
        .expect("route cache should save");

        let detail = read_ai_asset_detail(&connection, "book_1")
            .expect("detail should read")
            .expect("detail should exist");

        assert_eq!(detail.refresh_state, "suggested");
        assert_eq!(detail.refresh_reason.as_deref(), Some("notes_changed"));
    }

    #[test]
    fn ai_asset_version_detail_reads_route_content_with_stage_and_basis_notice() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 1, 2, 0, 3, 0, '{}', '220')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("notebook book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 72, NULL, NULL, NULL, '{}', '110')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");

        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: "reading-route".to_string(),
                scope_id: "book:book_1".to_string(),
                prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                input_hash: "route_hash".to_string(),
                output: json!({
                    "routeOverview": "先收束主线，再整理方法论。",
                    "books": [{
                        "bookId": "book_1",
                        "title": "深度工作",
                        "author": "卡尔",
                        "order": 1,
                        "role": "当前主书",
                        "readingPurpose": "完成本书主线梳理",
                        "estimatedEffort": "2 天",
                        "localStatus": "reading",
                        "basis": "当前进度已进入收束整理阶段"
                    }],
                    "dependencies": [],
                    "reviewCheckpoints": [{
                        "timing": "读完最后两章后",
                        "question": "本书的方法论能否迁移到当前工作流？",
                        "suggestedOutput": "写 1 页复盘，并给出 2 个可执行动作"
                    }],
                    "nextActions": ["今天整理本书专注工作清单，输出 3 条本周可执行动作。"],
                    "sourceStats": {
                        "currentBookCount": 1,
                        "candidateCount": 0,
                        "summaryCount": 1,
                        "statsSignalCount": 0,
                        "localStatusCount": 1
                    },
                    "generatedAt": "140",
                    "promptVersion": READING_ROUTE_PROMPT_VERSION,
                    "basisNotice": "基于本地缓存、进度和已生成复盘得出，不代表远端计划。",
                    "readingStage": {
                        "stage": "closing",
                        "label": "收束整理",
                        "progressPercent": 72
                    }
                }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "140",
        )
        .expect("route cache should save");

        let detail =
            read_ai_asset_version_detail(&connection, "reading-route", "book:book_1", "route_hash")
                .expect("detail should read")
                .expect("detail should exist");

        assert_eq!(detail.feature, "reading-route");
        assert_eq!(detail.scope_id, "book:book_1");
        assert_eq!(detail.input_hash, "route_hash");
        assert_eq!(detail.prompt_version, READING_ROUTE_PROMPT_VERSION);
        assert_eq!(detail.generated_at, "140");
        assert_eq!(detail.updated_at, "140");
        assert_eq!(detail.provider_model.as_deref(), Some("gpt-5.2"));
        assert_eq!(detail.reading_stage.as_deref(), Some("closing"));
        assert_eq!(detail.reading_stage_label.as_deref(), Some("收束整理"));
        assert_eq!(detail.progress, Some(72));
        assert_eq!(detail.refresh_reason.as_deref(), Some("notes_changed"));
        assert_eq!(
            detail.basis_notice,
            "基于本地缓存、进度和已生成复盘得出，不代表远端计划。"
        );
        assert!(detail.book_summary.is_none());
        assert_eq!(
            detail
                .reading_route
                .as_ref()
                .map(|item| item.route_overview.as_str()),
            Some("先收束主线，再整理方法论。")
        );
        assert_eq!(
            detail
                .reading_route
                .as_ref()
                .and_then(|item| item.reading_stage.as_ref())
                .map(|item| item.stage.as_str()),
            Some("closing")
        );
    }

    #[test]
    fn ai_asset_version_detail_reads_book_review_content_with_source_stats_and_quotes() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 3, 5, 1, 9, 0, '{}', '220')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("notebook book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 100, NULL, NULL, 999, '{}', '210')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");

        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                scope_id: "book_1".to_string(),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "summary_hash".to_string(),
                output: json!({
                    "overview": "这本书最大的价值在于重建专注工作的执行边界。",
                    "keyIdeas": ["深度工作需要主动排除浅层干扰"],
                    "myFocus": ["把方法迁移到日常排期"],
                    "actionItems": ["本周固定两段无打扰时段"],
                    "themeTags": ["专注", "执行"],
                    "representativeQuotes": [{
                        "quote": "专注不是意志力，而是环境设计。",
                        "reason": "这句话直接对应当前工作流改造。",
                        "chapter": "第 8 章",
                        "noteType": "thought"
                    }],
                    "reflectionQuestions": ["如果只能保留一个动作，我会选哪一个？"],
                    "sourceStats": {
                        "highlightCount": 5,
                        "thoughtCount": 3,
                        "bookmarkCount": 1,
                        "chapterCount": 4,
                        "includedHighlightCount": 4,
                        "includedThoughtCount": 2
                    },
                    "generatedAt": "240",
                    "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                    "basisNotice": "仅基于本地笔记与划线生成，不代表整本书全文。 ",
                    "readingStage": {
                        "stage": "completed",
                        "label": "完成归档",
                        "progressPercent": 100
                    }
                }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "240",
        )
        .expect("summary cache should save");

        let detail =
            read_ai_asset_version_detail(&connection, "book-review", "book_1", "summary_hash")
                .expect("detail should read")
                .expect("detail should exist");

        assert_eq!(detail.feature, "book-review");
        assert_eq!(detail.scope_id, "book_1");
        assert_eq!(detail.input_hash, "summary_hash");
        assert_eq!(detail.prompt_version, BOOK_NOTES_SUMMARY_PROMPT_VERSION);
        assert_eq!(detail.generated_at, "240");
        assert_eq!(detail.updated_at, "240");
        assert_eq!(detail.reading_stage.as_deref(), Some("completed"));
        assert_eq!(detail.reading_stage_label.as_deref(), Some("完成归档"));
        assert_eq!(detail.progress, Some(100));
        assert_eq!(detail.refresh_reason.as_deref(), Some("completed"));
        assert_eq!(detail.reading_route, None);
        assert_eq!(
            detail
                .book_summary
                .as_ref()
                .map(|item| item.overview.as_str()),
            Some("这本书最大的价值在于重建专注工作的执行边界。")
        );
        assert_eq!(
            detail
                .book_summary
                .as_ref()
                .map(|item| item.source_stats.highlight_count),
            Some(5)
        );
        assert_eq!(
            detail
                .book_summary
                .as_ref()
                .and_then(|item| item.representative_quotes.first())
                .map(|item| item.chapter.as_deref()),
            Some(Some("第 8 章"))
        );
    }

    #[test]
    fn ai_asset_version_detail_returns_none_when_cache_record_missing() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let detail = read_ai_asset_version_detail(
            &connection,
            "reading-route",
            "book:missing",
            "missing_hash",
        )
        .expect("detail should read");

        assert!(detail.is_none());
    }

    #[test]
    fn ai_asset_version_history_lists_prior_route_versions_for_same_scope() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 2, 4, 0, 6, 0, '{}', '220')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 72, NULL, NULL, NULL, '{}', '210')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");

        for (input_hash, updated_at, stage, label, progress_percent) in [
            ("route_hash_v1", "120", "framing", "建立主线", 28),
            ("route_hash_v2", "140", "deepening", "深入推进", 55),
            ("route_hash_v3", "160", "closing", "收束整理", 72),
        ] {
            upsert_ai_output(
                &connection,
                &AiOutputUpsert {
                    feature: "reading-route".to_string(),
                    scope_id: "book:book_1".to_string(),
                    prompt_version: READING_ROUTE_PROMPT_VERSION.to_string(),
                    input_hash: input_hash.to_string(),
                    output: json!({
                        "routeOverview": format!("版本 {input_hash}"),
                        "books": [{
                            "bookId": "book_1",
                            "title": "深度工作",
                            "author": "卡尔",
                            "order": 1,
                            "role": "当前主书",
                            "readingPurpose": "推进主线",
                            "estimatedEffort": "2 天",
                            "localStatus": "reading",
                            "basis": "基于当前阶段生成"
                        }],
                        "dependencies": [],
                        "reviewCheckpoints": [],
                        "nextActions": ["今天继续读 45 分钟并写 3 条记录。"],
                        "sourceStats": {
                            "currentBookCount": 1,
                            "candidateCount": 0,
                            "summaryCount": 0,
                            "statsSignalCount": 0,
                            "localStatusCount": 1
                        },
                        "generatedAt": updated_at,
                        "promptVersion": READING_ROUTE_PROMPT_VERSION,
                        "basisNotice": "基于本地缓存生成。",
                        "readingStage": {
                            "stage": stage,
                            "label": label,
                            "progressPercent": progress_percent
                        }
                    }),
                    source_count: Some(1),
                    provider_model: Some("gpt-5.2".to_string()),
                },
                updated_at,
            )
            .expect("route cache should save");
        }

        let versions = read_ai_asset_version_history(&connection, "reading-route", "book:book_1")
            .expect("history should read");

        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].input_hash, "route_hash_v2");
        assert_eq!(versions[0].reading_stage.as_deref(), Some("deepening"));
        assert_eq!(versions[0].reading_stage_label.as_deref(), Some("深入推进"));
        assert_eq!(versions[0].progress, Some(72));
        assert_eq!(versions[0].refresh_reason.as_deref(), Some("notes_changed"));
        assert!(!versions[0].is_current);
        assert_eq!(
            versions[0]
                .previous_version
                .as_ref()
                .map(|version| version.input_hash.as_str()),
            Some("route_hash_v1")
        );
        assert_eq!(versions[1].input_hash, "route_hash_v1");
        assert!(versions[1].previous_version.is_none());
    }

    #[test]
    fn ai_asset_version_history_lists_prior_book_review_versions_for_same_book() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 3, 5, 0, 8, 0, '{}', '260')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("book should insert");
        connection
            .execute(
                "
                INSERT INTO book_progress (
                    book_id, progress_percent, chapter_uid,
                    record_reading_time_seconds, finish_time, raw_json, updated_at
                ) VALUES (?1, 100, NULL, NULL, 999, '{}', '250')
                ",
                rusqlite::params!["book_1"],
            )
            .expect("progress should insert");

        for (input_hash, updated_at, overview, stage, label, progress_percent) in [
            (
                "summary_hash_v1",
                "180",
                "第一版复盘",
                "deepening",
                "深入推进",
                60,
            ),
            (
                "summary_hash_v2",
                "220",
                "第二版复盘",
                "closing",
                "收束整理",
                88,
            ),
            (
                "summary_hash_v3",
                "240",
                "第三版复盘",
                "completed",
                "完成归档",
                100,
            ),
        ] {
            upsert_ai_output(
                &connection,
                &AiOutputUpsert {
                    feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                    scope_id: "book_1".to_string(),
                    prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                    input_hash: input_hash.to_string(),
                    output: json!({
                        "overview": overview,
                        "keyIdeas": [],
                        "myFocus": [],
                        "actionItems": [],
                        "themeTags": [],
                        "representativeQuotes": [],
                        "reflectionQuestions": [],
                        "sourceStats": {
                            "highlightCount": 5,
                            "thoughtCount": 3,
                            "bookmarkCount": 0,
                            "chapterCount": 4,
                            "includedHighlightCount": 4,
                            "includedThoughtCount": 2
                        },
                        "generatedAt": updated_at,
                        "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                        "basisNotice": "仅基于本地笔记生成。",
                        "readingStage": {
                            "stage": stage,
                            "label": label,
                            "progressPercent": progress_percent
                        }
                    }),
                    source_count: Some(1),
                    provider_model: Some("gpt-5.2".to_string()),
                },
                updated_at,
            )
            .expect("summary cache should save");
        }

        let versions = read_ai_asset_version_history(&connection, "book-review", "book_1")
            .expect("history should read");

        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].input_hash, "summary_hash_v2");
        assert_eq!(versions[0].title.as_deref(), Some("《深度工作》书籍复盘"));
        assert_eq!(versions[0].reading_stage.as_deref(), Some("closing"));
        assert_eq!(
            versions[0]
                .previous_version
                .as_ref()
                .map(|version| version.input_hash.as_str()),
            Some("summary_hash_v1")
        );
        assert_eq!(versions[1].input_hash, "summary_hash_v1");
        assert_eq!(versions[1].title.as_deref(), Some("《深度工作》书籍复盘"));
        assert!(versions[1].previous_version.is_none());
    }

    #[test]
    fn ai_asset_book_review_ref_uses_book_title_not_overview() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 3, 5, 0, 8, 0, '{}', '260')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("book should insert");
        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                scope_id: "book_1".to_string(),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "summary_hash_v1".to_string(),
                output: json!({
                    "overview": "这是一个很长的概要，不应该被当作标题。",
                    "keyIdeas": [],
                    "myFocus": [],
                    "actionItems": [],
                    "themeTags": [],
                    "representativeQuotes": [],
                    "reflectionQuestions": [],
                    "sourceStats": {
                        "highlightCount": 1,
                        "thoughtCount": 0,
                        "bookmarkCount": 0,
                        "chapterCount": 0,
                        "includedHighlightCount": 1,
                        "includedThoughtCount": 0
                    },
                    "generatedAt": "180",
                    "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                    "basisNotice": "基于本地笔记生成。"
                }),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "180",
        )
        .expect("summary cache should save");

        let version_detail =
            read_ai_asset_version_detail(&connection, "book-review", "book_1", "summary_hash_v1");
        assert_eq!(
            version_detail
                .expect("version detail should read")
                .expect("version detail should exist")
                .title
                .as_deref(),
            Some("《深度工作》书籍复盘")
        );
        assert_eq!(
            read_ai_asset_detail(&connection, "book_1")
                .expect("detail should read")
                .expect("detail should exist")
                .current_book_review
                .as_ref()
                .and_then(|item| item.title.as_deref()),
            Some("《深度工作》书籍复盘")
        );
    }

    #[test]
    fn book_summary_export_items_read_latest_cache_without_note_rows() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let output = json!({
            "overview": "缓存复盘",
            "keyIdeas": [],
            "myFocus": [],
            "actionItems": [],
            "themeTags": [],
            "representativeQuotes": [],
            "reflectionQuestions": [],
            "sourceStats": {
                "highlightCount": 1,
                "thoughtCount": 0,
                "bookmarkCount": 0,
                "chapterCount": 0,
                "includedHighlightCount": 1,
                "includedThoughtCount": 0
            },
            "generatedAt": "120",
            "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
            "basisNotice": "基于本地笔记生成，不代表整本书全文内容。"
        });
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, ?2, ?3, NULL, 0, 0, 0, 0, 0, '{}', '100')
                ",
                rusqlite::params!["book_1", "深度工作", "卡尔"],
            )
            .expect("book should save");

        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                scope_id: "book_1".to_string(),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "hash_1".to_string(),
                output: output.clone(),
                source_count: Some(1),
                provider_model: Some("gpt-5.2".to_string()),
            },
            "120",
        )
        .expect("summary cache should save");

        let items = read_book_summary_export_items(&connection, Some(&["book_1".to_string()]))
            .expect("export items should read");

        assert_eq!(
            items,
            vec![BookSummaryExportItem {
                book_id: "book_1".to_string(),
                title: "深度工作".to_string(),
                author: Some("卡尔".to_string()),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "hash_1".to_string(),
                provider_model: Some("gpt-5.2".to_string()),
                cached_updated_at: "120".to_string(),
                summary: serde_json::from_value(output).expect("summary should parse"),
            }]
        );
        let notes = read_local_book_notes(&connection, "book_1")
            .expect("book metadata can produce an empty note record");
        assert_eq!(notes.exportable_count, 0);
        assert!(notes.chapter_groups.is_empty());
    }

    #[test]
    fn book_summary_export_feedback_uses_latest_summary_input_hash() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let output = json!({
            "overview": "缓存复盘",
            "keyIdeas": [],
            "myFocus": [],
            "actionItems": ["写一页复盘"],
            "themeTags": [],
            "representativeQuotes": [],
            "reflectionQuestions": ["你如何定义成功？"],
            "sourceStats": {
                "highlightCount": 1,
                "thoughtCount": 0,
                "bookmarkCount": 0,
                "chapterCount": 0,
                "includedHighlightCount": 1,
                "includedThoughtCount": 0
            },
            "generatedAt": "120",
            "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
            "basisNotice": "基于本地笔记生成，不代表整本书全文内容。"
        });
        upsert_ai_output(
            &connection,
            &AiOutputUpsert {
                feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                scope_id: "book_1".to_string(),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "hash_1".to_string(),
                output,
                source_count: Some(1),
                provider_model: None,
            },
            "120",
        )
        .expect("summary cache should save");
        let mut feedback = AiReviewFeedbackState::default();
        feedback.action_items.insert(
            "0:写一页复盘".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已完成初稿".to_string()),
                updated_at: "2024-01-01T00:00:00.000Z".to_string(),
            },
        );
        save_ai_review_feedback(&mut connection, "book-review", "book_1", "hash_1", feedback)
            .expect("feedback should save");

        let item = read_book_summary_export_items(&connection, Some(&["book_1".to_string()]))
            .expect("export items should read")
            .pop()
            .expect("one export item should exist");
        let loaded_feedback =
            read_ai_review_feedback(&connection, "book-review", &item.book_id, &item.input_hash)
                .expect("feedback should load");

        assert_eq!(
            loaded_feedback.action_items["0:写一页复盘"].note.as_deref(),
            Some("已完成初稿")
        );
    }

    #[test]
    fn book_summary_export_index_includes_cache_metadata() {
        let item = BookSummaryExportItem {
            book_id: "book_1".to_string(),
            title: "深度工作".to_string(),
            author: Some("卡尔".to_string()),
            prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
            input_hash: "hash_1".to_string(),
            provider_model: Some("gpt-5.2".to_string()),
            cached_updated_at: "120".to_string(),
            summary: serde_json::from_value(json!({
                "overview": "缓存复盘",
                "keyIdeas": [],
                "myFocus": [],
                "actionItems": [],
                "themeTags": [],
                "representativeQuotes": [],
                "reflectionQuestions": [],
                "sourceStats": {
                    "highlightCount": 1,
                    "thoughtCount": 0,
                    "bookmarkCount": 0,
                    "chapterCount": 0,
                    "includedHighlightCount": 1,
                    "includedThoughtCount": 0
                },
                "generatedAt": "120",
                "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                "basisNotice": "基于本地笔记生成，不代表整本书全文内容。"
            }))
            .expect("summary should parse"),
        };

        let markdown = serialize_book_summary_export_index(
            "wxreadmaster-book-reviews-130",
            "130",
            &[("深度工作-ai-summary-130.md".to_string(), item)],
        );

        assert!(markdown.contains("# 书籍复盘导出索引"));
        assert!(markdown.contains("深度工作"));
        assert!(markdown.contains("深度工作-ai-summary-130.md"));
        assert!(markdown.contains("gpt-5.2"));
        assert!(markdown.contains("缓存更新：120"));
    }

    #[test]
    fn summarize_book_notes_requires_credential_after_cache_miss() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        insert_book_notes_fixture(&connection, "book_1");
        let notes =
            read_local_book_notes(&connection, "book_1").expect("local notes should be readable");
        let summary_input = build_summary_input(&notes, None).expect("summary input should build");
        let input_hash = stable_hash_json(&summary_input.payload).expect("hash should build");

        let cached = read_ai_output(
            &connection,
            BOOK_NOTES_SUMMARY_FEATURE,
            "book_1",
            BOOK_NOTES_SUMMARY_PROMPT_VERSION,
            &input_hash,
        )
        .expect("cache should query");
        assert!(cached.is_none());
        let error =
            require_ai_credential_for_uncached_summary(Err(AiServiceError::MissingCredential))
                .expect_err("missing credential should block uncached generation");

        assert_eq!(error.code(), "ai_credential_missing");
        assert_eq!(error.user_message(), "还没有保存 AI API Key。");
    }

    #[test]
    fn summarize_book_notes_update_context_changes_input_hash() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        insert_book_notes_fixture(&connection, "book_1");
        let notes =
            read_local_book_notes(&connection, "book_1").expect("local notes should be readable");

        let without_context =
            build_summary_input(&notes, None).expect("summary input should build");
        let mut action_items = HashMap::new();
        action_items.insert(
            "action-1".to_string(),
            AiFeedbackExportRecord {
                status: "已完成".to_string(),
                note: Some("已写完 500 字笔记".to_string()),
                updated_at: "2026-05-23T00:00:00Z".to_string(),
            },
        );
        let update_context = BookSummaryUpdateContext {
            source_input_hash: "source-hash-1".to_string(),
            feedback: AiReviewFeedbackExport {
                action_items,
                reflection_questions: HashMap::new(),
            },
        };
        let with_context = build_summary_input(&notes, Some(&update_context))
            .expect("summary input with update context should build");

        let without_hash = stable_hash_json(&without_context.payload).expect("hash should build");
        let with_hash = stable_hash_json(&with_context.payload).expect("hash should build");

        assert_ne!(without_hash, with_hash);
        assert!(with_context
            .payload
            .as_object()
            .expect("summary payload should be an object")
            .contains_key("updateContext"));
    }

    #[test]
    fn book_summary_update_context_requires_matching_scope_and_real_feedback() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let mut feedback = AiReviewFeedbackState::default();
        feedback.reflection_questions.insert(
            "0:这本书改变了什么判断？".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("明确了接下来先收敛输入源".to_string()),
                updated_at: "2026-05-23T00:00:00Z".to_string(),
            },
        );
        save_ai_review_feedback(
            &mut connection,
            "book-review",
            "book_1",
            "summary-hash-v1",
            feedback,
        )
        .expect("feedback should save");

        let matching_update = BookAiSummaryUpdateContext {
            feature: "book-review".to_string(),
            scope_id: "book_1".to_string(),
            input_hash: "summary-hash-v1".to_string(),
        };

        assert!(resolve_book_summary_update_context(
            &connection,
            "book_2",
            Some(matching_update.clone()),
        )
        .expect("update context should resolve")
        .is_none());
        assert!(resolve_book_summary_update_context(
            &connection,
            "book_1",
            Some(BookAiSummaryUpdateContext {
                feature: "reading-route".to_string(),
                ..matching_update.clone()
            }),
        )
        .expect("update context should resolve")
        .is_none());
        assert!(resolve_book_summary_update_context(
            &connection,
            "book_1",
            Some(BookAiSummaryUpdateContext {
                input_hash: "summary-hash-empty".to_string(),
                ..matching_update.clone()
            }),
        )
        .expect("empty feedback should resolve")
        .is_none());

        let context =
            resolve_book_summary_update_context(&connection, "book_1", Some(matching_update))
                .expect("update context should resolve")
                .expect("matching book summary update should include feedback");

        assert_eq!(context.source_input_hash, "summary-hash-v1");
        assert_eq!(
            context.feedback.reflection_questions["0:这本书改变了什么判断？"]
                .note
                .as_deref(),
            Some("明确了接下来先收敛输入源")
        );
    }

    #[test]
    fn humanize_review_text_rewrites_seconds_and_timestamps() {
        let text = "本月总阅读时长 7112秒，单次高峰时段出现在 1777996800 对应的时间（3739秒）。";
        let output = humanize_review_text(text);

        assert!(output.contains("1小时58分钟"));
        assert!(output.contains("1小时2分钟"));
        assert!(!output.contains("7112秒"));
        assert!(!output.contains("3739秒"));
        assert!(!output.contains("1777996800"));
    }

    #[test]
    fn chat_completions_url_accepts_root_v1_or_full_endpoint() {
        assert_eq!(
            chat_completions_url("https://api.example.com"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn models_url_accepts_root_v1_models_or_chat_endpoint() {
        assert_eq!(
            models_url("https://api.example.com"),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.example.com/v1/models"),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.example.com/v1/chat/completions"),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn parse_provider_model_list_reads_openai_compatible_response() {
        let models = parse_provider_model_list(&json!({
            "object": "list",
            "data": [
                { "id": "gpt-4o-mini", "owned_by": "openai" },
                { "id": "deepseek-chat", "ownedBy": "deepseek" },
                { "id": "" },
                { "object": "model" }
            ]
        }))
        .expect("model list should parse");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-4o-mini");
        assert_eq!(models[0].owned_by.as_deref(), Some("openai"));
        assert_eq!(models[1].id, "deepseek-chat");
        assert_eq!(models[1].owned_by.as_deref(), Some("deepseek"));
    }

    #[test]
    fn build_chat_completion_payload_allows_large_json_outputs() {
        let payload = build_chat_completion_payload(
            "deepseekv4pro",
            "system",
            &json!({ "books": [1, 2, 3, 4, 5, 6] }),
            default_json_object_response_format(),
        );

        assert!(
            payload["max_tokens"].as_i64().unwrap_or_default() >= 4000,
            "reading route JSON output must not be truncated by a small token cap"
        );
        assert_eq!(payload["response_format"]["type"], "json_object");
    }

    #[test]
    fn build_chat_completion_payload_accepts_json_schema_response_format() {
        let payload = build_chat_completion_payload(
            "deepseekv4pro",
            "system",
            &json!({ "book": "deep-work" }),
            json!({
                "type": "json_schema",
                "json_schema": {
                    "name": "reading_route_response",
                    "strict": true,
                    "schema": reading_route_json_schema()
                }
            }),
        );

        assert_eq!(payload["response_format"]["type"], "json_schema");
        assert_eq!(
            payload["response_format"]["json_schema"]["name"],
            "reading_route_response"
        );
        assert_eq!(
            payload["response_format"]["json_schema"]["schema"]["required"][5],
            "readingStage"
        );
    }

    #[test]
    fn build_chat_completion_payload_can_omit_response_format() {
        let payload = build_chat_completion_payload_without_response_format(
            "deepseek-v4-flash",
            "system",
            &json!({ "question": "她是谁？" }),
        );

        assert!(payload.get("response_format").is_none());
        assert_eq!(payload["model"], "deepseek-v4-flash");
    }

    #[test]
    fn build_chat_completion_probe_payload_uses_small_json_probe() {
        let payload = build_chat_completion_probe_payload(
            "deepseek-chat",
            Some(default_json_object_response_format()),
        );

        assert_eq!(payload["model"], "deepseek-chat");
        assert_eq!(payload["max_tokens"], 30);
        assert_eq!(payload["response_format"]["type"], "json_object");
        assert!(payload["messages"][1]["content"]
            .as_str()
            .unwrap_or_default()
            .contains("{\"ok\":true}"));
    }

    #[test]
    fn provider_capability_probe_schema_requires_ok_boolean() {
        let schema = provider_capability_probe_json_schema();

        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"][0], "ok");
        assert_eq!(schema["properties"]["ok"]["type"], "boolean");
    }

    #[test]
    fn provider_capability_probe_recommends_strictest_supported_policy() {
        assert_eq!(
            recommend_response_format_policy(
                AiProviderCapabilityStatus::Passed,
                AiProviderCapabilityStatus::Passed
            ),
            AiResponseFormatPolicy::JsonSchemaFirst
        );
        assert_eq!(
            recommend_response_format_policy(
                AiProviderCapabilityStatus::Passed,
                AiProviderCapabilityStatus::Failed
            ),
            AiResponseFormatPolicy::JsonObjectFirst
        );
        assert_eq!(
            recommend_response_format_policy(
                AiProviderCapabilityStatus::Failed,
                AiProviderCapabilityStatus::Failed
            ),
            AiResponseFormatPolicy::NoResponseFormatFirst
        );
    }

    #[test]
    fn book_notes_summary_json_schema_requires_quote_structure() {
        let schema = book_notes_summary_json_schema();

        assert_eq!(schema["required"][0], "overview");
        assert_eq!(schema["required"][5], "representativeQuotes");
        assert_eq!(
            schema["properties"]["representativeQuotes"]["items"]["required"][2],
            "noteType"
        );
        assert_eq!(
            schema["properties"]["representativeQuotes"]["items"]["properties"]["noteType"]["enum"]
                [1],
            "想法"
        );
    }

    #[test]
    fn reading_stats_review_json_schema_requires_core_sections() {
        let schema = reading_stats_review_json_schema();

        assert_eq!(schema["required"][0], "overview");
        assert_eq!(schema["required"][1], "rhythmInsights");
        assert_eq!(schema["required"][4], "nextActions");
        assert_eq!(schema["properties"]["readingPersona"]["type"], "object");
        assert_eq!(
            schema["properties"]["readingPersona"]["properties"]["summary"]["type"],
            "string"
        );
        assert!(!schema["required"]
            .as_array()
            .expect("required should be an array")
            .iter()
            .any(|item| item == "readingPersona"));
    }

    #[test]
    fn book_decision_json_schema_requires_ranked_candidates() {
        let schema = book_decision_json_schema();

        assert_eq!(schema["required"][0], "decisionOverview");
        assert_eq!(
            schema["properties"]["topCandidates"]["items"]["required"][5],
            "estimatedEffort"
        );
        assert_eq!(
            schema["properties"]["deferredCandidates"]["items"]["required"][2],
            "reason"
        );
    }

    #[test]
    fn detect_unsupported_json_schema_provider_response() {
        assert!(is_unsupported_json_schema_response(
            "AI Provider 返回 HTTP 400：response_format json_schema is not supported by this model."
        ));
        assert!(is_unsupported_json_schema_response(
            "AI Provider 返回 HTTP 400：Unknown parameter: response_format.json_schema.strict"
        ));
        assert!(is_unsupported_json_schema_response(
            "AI Provider 返回 HTTP 400：This response_format type is unavailable now"
        ));
        assert!(!is_unsupported_json_schema_response(
            "AI 返回内容不是有效 JSON。"
        ));
    }

    #[test]
    fn stable_hash_json_is_independent_of_object_key_order() {
        let left = stable_hash_json(&json!({ "b": 2, "a": { "d": 4, "c": 3 } }))
            .expect("hash should build");
        let right = stable_hash_json(&json!({ "a": { "c": 3, "d": 4 }, "b": 2 }))
            .expect("hash should build");

        assert_eq!(left, right);
    }

    #[test]
    fn extract_chat_completion_json_reads_message_content() {
        let value = extract_chat_completion_json(
            reqwest::StatusCode::OK,
            json!({
                "choices": [{
                    "message": {
                        "content": "{\"overview\":\"概览\",\"keyIdeas\":[\"观点\"]}"
                    }
                }]
            }),
        )
        .expect("content JSON should parse");

        assert_eq!(value["overview"], "概览");
    }

    #[test]
    fn extract_chat_completion_json_reads_message_content_text_parts() {
        let value = extract_chat_completion_json(
            reqwest::StatusCode::OK,
            json!({
                "choices": [{
                    "message": {
                        "content": [
                            {
                                "type": "text",
                                "text": "{\"overview\":\"概览\",\"keyIdeas\":[\"观点\"]}"
                            }
                        ]
                    }
                }]
            }),
        )
        .expect("content text parts JSON should parse");

        assert_eq!(value["overview"], "概览");
    }

    #[test]
    fn extract_chat_completion_json_reads_markdown_fenced_content() {
        let value = extract_chat_completion_json(
            reqwest::StatusCode::OK,
            json!({
                "choices": [{
                    "message": {
                        "content": "```json\n{\"overview\":\"概览\",\"keyIdeas\":[\"观点\"]}\n```"
                    }
                }]
            }),
        )
        .expect("fenced content JSON should parse");

        assert_eq!(value["overview"], "概览");
    }

    #[test]
    fn extract_chat_completion_json_reads_json_object_from_wrapped_content() {
        let value = extract_chat_completion_json(
            reqwest::StatusCode::OK,
            json!({
                "choices": [{
                    "message": {
                        "content": "下面是 JSON：\n{\"overview\":\"概览\",\"keyIdeas\":[\"观点\"]}\n请查收。"
                    }
                }]
            }),
        )
        .expect("wrapped content JSON should parse");

        assert_eq!(value["overview"], "概览");
    }

    #[test]
    fn extract_chat_completion_json_reports_truncated_provider_output() {
        let error = extract_chat_completion_json(
            reqwest::StatusCode::OK,
            json!({
                "choices": [{
                    "finish_reason": "length",
                    "message": {
                        "content": "{\"overview\":\"概览\",\"keyIdeas\":[\"观点\"]"
                    }
                }]
            }),
        )
        .expect_err("truncated provider output should be explicit");

        assert_eq!(
            error.user_message(),
            "AI 返回内容被模型截断，请重新生成或减少候选书数量。"
        );
    }

    #[test]
    fn extract_chat_completion_json_keeps_provider_error_message() {
        let error = extract_chat_completion_json(
            reqwest::StatusCode::BAD_REQUEST,
            json!({
                "error": {
                    "message": "model not found"
                }
            }),
        )
        .expect_err("provider error should be returned");

        assert_eq!(
            error.user_message(),
            "AI Provider 返回 HTTP 400：model not found"
        );
    }

    #[test]
    fn provider_network_user_message_includes_http_status() {
        assert_eq!(
            provider_network_user_message("HTTP 404"),
            "AI Provider 请求失败（HTTP 404）。请检查 Base URL 是否为 OpenAI-compatible 地址、模型是否可用，或稍后重试。"
        );
    }

    #[test]
    fn normalize_summary_output_adds_local_metadata() {
        let summary = normalize_summary_output(
            json!({
                "overview": "概览",
                "keyIdeas": ["观点一"],
                "myFocus": ["关注点"],
                "actionItems": ["行动"],
                "themeTags": ["专注"],
                "representativeQuotes": [{
                    "quote": "原文摘录",
                    "reason": "可以代表关注点",
                    "chapter": "第一章",
                    "noteType": "划线"
                }],
                "reflectionQuestions": ["我能如何应用？"],
                "feedbackOutcomeSummary": {
                    "summary": "上一版已完成观点整理，本次聚焦复盘输出。",
                    "appliedChanges": ["不再重复生成观点整理", "保留现实应用输出"]
                }
            }),
            BookAiSummarySourceStats {
                highlight_count: 1,
                thought_count: 1,
                bookmark_count: 0,
                chapter_count: 1,
                included_highlight_count: 1,
                included_thought_count: 1,
            },
            "100".to_string(),
            "book-notes-summary-v3",
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("summary should normalize");

        assert_eq!(summary.overview, "概览");
        assert_eq!(summary.key_ideas, vec!["观点一".to_string()]);
        assert_eq!(summary.generated_at, "100");
        assert_eq!(summary.prompt_version, "book-notes-summary-v3");
        assert_eq!(
            summary.response_format,
            Some(AiResponseFormatKind::JsonSchema)
        );
        assert_eq!(summary.theme_tags, vec!["专注".to_string()]);
        assert_eq!(summary.representative_quotes[0].quote, "原文摘录");
        assert_eq!(
            summary.reflection_questions,
            vec!["我能如何应用？".to_string()]
        );
        assert_eq!(
            summary
                .feedback_outcome_summary
                .as_ref()
                .map(|item| item.summary.as_str()),
            Some("上一版已完成观点整理，本次聚焦复盘输出。")
        );
        assert_eq!(
            summary
                .feedback_outcome_summary
                .as_ref()
                .map(|item| item.applied_changes.clone()),
            Some(vec![
                "不再重复生成观点整理".to_string(),
                "保留现实应用输出".to_string()
            ])
        );
    }

    #[test]
    fn normalize_summary_output_reads_common_provider_aliases() {
        let summary = normalize_summary_output(
            json!({
                "summary": {
                    "摘要": "别名概览",
                    "关键观点": [{ "text": "观点对象" }],
                    "我的关注点": ["关注点"],
                    "行动项": ["行动"],
                    "主题标签": ["标签"],
                    "代表性摘录": [{
                        "text": "原文摘录",
                        "explanation": "别名理由",
                        "chapterTitle": "第二章",
                        "type": "highlight"
                    }],
                    "复盘问题": [{ "question": "如何应用？" }]
                }
            }),
            BookAiSummarySourceStats {
                highlight_count: 1,
                thought_count: 1,
                bookmark_count: 0,
                chapter_count: 1,
                included_highlight_count: 1,
                included_thought_count: 1,
            },
            "100".to_string(),
            "book-notes-summary-v3",
            Some(AiResponseFormatKind::JsonObject),
        )
        .expect("summary aliases should normalize");

        assert_eq!(summary.overview, "别名概览");
        assert_eq!(summary.key_ideas, vec!["观点对象".to_string()]);
        assert_eq!(summary.theme_tags, vec!["标签".to_string()]);
        assert_eq!(
            summary.response_format,
            Some(AiResponseFormatKind::JsonObject)
        );
        assert_eq!(summary.representative_quotes[0].reason, "别名理由");
        assert_eq!(
            summary.representative_quotes[0].chapter,
            Some("第二章".to_string())
        );
        assert_eq!(summary.representative_quotes[0].note_type, "划线");
        assert_eq!(summary.reflection_questions, vec!["如何应用？".to_string()]);
    }

    #[test]
    fn normalize_outputs_ignore_invalid_feedback_outcome_summary() {
        let summary = normalize_summary_output(
            json!({
                "overview": "概览",
                "keyIdeas": ["观点一"],
                "myFocus": ["关注点"],
                "actionItems": ["行动"],
                "themeTags": ["专注"],
                "representativeQuotes": [{
                    "quote": "原文摘录",
                    "reason": "可以代表关注点",
                    "chapter": "第一章",
                    "noteType": "划线"
                }],
                "reflectionQuestions": ["我能如何应用？"],
                "feedbackOutcomeSummary": {
                    "appliedChanges": ["缺少 summary 时应忽略"]
                }
            }),
            BookAiSummarySourceStats {
                highlight_count: 1,
                thought_count: 1,
                bookmark_count: 0,
                chapter_count: 1,
                included_highlight_count: 1,
                included_thought_count: 1,
            },
            "100".to_string(),
            "book-notes-summary-v3",
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("summary should normalize without optional feedback outcome summary");

        assert_eq!(summary.overview, "概览");
        assert!(summary.feedback_outcome_summary.is_none());

        let route = normalize_reading_route_output(
            json!({
                "routeOverview": "围绕《深度工作》先完成关键阅读，再输出 1 页复盘。",
                "books": [{
                    "bookId": "book_deep_work",
                    "title": "深度工作",
                    "author": "卡尔·纽波特",
                    "order": 1,
                    "role": "当前书",
                    "readingPurpose": "今天先读当前进度后的下一段，确认专注工作最难坚持的 1 个场景。",
                    "estimatedEffort": "1 个 45 分钟阅读时段",
                    "localStatus": "reading",
                    "basis": "当前进度 55%，已进入深入推进阶段。"
                }],
                "dependencies": [],
                "reviewCheckpoints": [{
                    "timing": "读完这一段后",
                    "question": "哪条专注规则最值得本周先试一次？",
                    "suggestedOutput": "写 3 条观察，并选 1 条作为本周实验，完成标准：能落实到具体场景。"
                }],
                "nextActions": ["今天读 45 分钟并写 3 条专注观察，完成标准：选出 1 条本周实验。"],
                "feedbackOutcomeSummary": {
                    "summary": ""
                }
            }),
            HashSet::from(["book_deep_work".to_string()]),
            ReadingRouteSourceStats {
                current_book_count: 1,
                candidate_count: 0,
                summary_count: 0,
                stats_signal_count: 0,
                local_status_count: 1,
            },
            None,
            "100".to_string(),
            READING_ROUTE_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("route should normalize without optional feedback outcome summary");

        assert_eq!(route.books.len(), 1);
        assert!(route.feedback_outcome_summary.is_none());
    }

    #[test]
    fn normalize_summary_output_rejects_missing_overview() {
        let error = normalize_summary_output(
            json!({
                "keyIdeas": ["观点一"]
            }),
            BookAiSummarySourceStats {
                highlight_count: 1,
                thought_count: 0,
                bookmark_count: 0,
                chapter_count: 1,
                included_highlight_count: 1,
                included_thought_count: 0,
            },
            "100".to_string(),
            "book-notes-summary-v3",
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect_err("missing overview should fail");

        assert_eq!(
            error.user_message(),
            "AI 返回缺少 overview 概览字段，请重新生成。"
        );
    }

    #[test]
    fn normalize_reading_route_output_falls_back_when_route_overview_missing() {
        let route = normalize_reading_route_output(
            json!({
                "books": [{
                    "bookId": "book_deep_work",
                    "title": "深度工作",
                    "author": "卡尔·纽波特",
                    "order": 1,
                    "role": "方法基座",
                    "readingPurpose": "读完第2章并提炼专注训练方法。",
                    "estimatedEffort": "2 个 45 分钟深度阅读时段",
                    "localStatus": "reviewing",
                    "basis": "当前进度约25%，优先完成第2章到第3章。"
                }],
                "dependencies": [],
                "reviewCheckpoints": [{
                    "timing": "读完第3章后",
                    "question": "哪些专注方法可以在本周执行？",
                    "suggestedOutput": "写3条专注行动，并为每条补1个完成标准。"
                }],
                "nextActions": ["今天安排45分钟读完第2章，完成标准：输出3条专注行动。"],
                "feedbackOutcomeSummary": {
                    "summary": "上一版已完成基础整理，本次转为验证行动。",
                    "appliedChanges": ["跳过已完成整理", "保留验证问题", "压缩下一步行动", "忽略多余变化"]
                }
            }),
            HashSet::from(["book_deep_work".to_string()]),
            ReadingRouteSourceStats {
                current_book_count: 1,
                candidate_count: 0,
                summary_count: 1,
                stats_signal_count: 0,
                local_status_count: 1,
            },
            Some(ReadingStageSignal {
                stage: "framing".to_string(),
                label: "建立主线".to_string(),
                progress_percent: 25,
                refresh_reason: None,
            }),
            "100".to_string(),
            READING_ROUTE_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("route should normalize without routeOverview");

        assert!(route.route_overview.contains("《深度工作》"));
        assert!(route.route_overview.contains("关键阅读"));
        assert_eq!(route.books.len(), 1);
        assert_eq!(route.books[0].book_id, "book_deep_work");
        assert_eq!(route.review_checkpoints.len(), 1);
        assert_eq!(
            route.response_format,
            Some(AiResponseFormatKind::JsonSchema)
        );
        assert_eq!(
            route.next_actions,
            vec!["今天安排45分钟读完第2章，完成标准：输出3条专注行动。".to_string()]
        );
        assert_eq!(
            route
                .feedback_outcome_summary
                .as_ref()
                .map(|item| item.summary.as_str()),
            Some("上一版已完成基础整理，本次转为验证行动。")
        );
        assert_eq!(
            route
                .feedback_outcome_summary
                .as_ref()
                .map(|item| item.applied_changes.clone()),
            Some(vec![
                "跳过已完成整理".to_string(),
                "保留验证问题".to_string(),
                "压缩下一步行动".to_string()
            ])
        );
    }

    #[test]
    fn normalize_reading_route_output_removes_internal_signal_names() {
        let route = normalize_reading_route_output(
            json!({
                "routeOverview": "根据 latestStatsReview.nextActions 与 currentCore 安排本书阅读。",
                "books": [{
                    "bookId": "book_deep_work",
                    "title": "深度工作",
                    "author": "卡尔·纽波特",
                    "order": 1,
                    "role": "当前书",
                    "readingPurpose": "读完第2章并整理当前书的核心问题。",
                    "estimatedEffort": "2 个 45 分钟阅读时段，参考 latestStatsReview.nextActions。",
                    "localStatus": "reviewing",
                    "basis": "来自 latestStatsSignals 和 summary 为空的输入，当前范围为第2章到第3章。"
                }],
                "dependencies": [],
                "reviewCheckpoints": [{
                    "timing": "读到全书约25%时",
                    "question": "currentCore 提到的关键点是什么？",
                    "suggestedOutput": "写3条关键点，并为每条补1个完成标准，参考 latestStatsReview.rhythmInsights。"
                }],
                "nextActions": ["今天阅读45分钟并把 currentCore 写进计划，完成标准：输出3条关键点。", "参考 latestStatsReview.nextActions 安排短读。"]
            }),
            HashSet::from(["book_deep_work".to_string()]),
            ReadingRouteSourceStats {
                current_book_count: 1,
                candidate_count: 0,
                summary_count: 0,
                stats_signal_count: 1,
                local_status_count: 1,
            },
            None,
            "100".to_string(),
            READING_ROUTE_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("route should normalize");

        let mut visible_text = route.route_overview.clone();
        for book in &route.books {
            visible_text.push_str(&book.role);
            visible_text.push_str(&book.reading_purpose);
            visible_text.push_str(&book.estimated_effort);
            if let Some(local_status) = book.local_status.as_deref() {
                visible_text.push_str(local_status);
            }
            visible_text.push_str(&book.basis);
        }
        for checkpoint in &route.review_checkpoints {
            visible_text.push_str(&checkpoint.timing);
            visible_text.push_str(&checkpoint.question);
            visible_text.push_str(&checkpoint.suggested_output);
        }
        for action in &route.next_actions {
            visible_text.push_str(action);
        }

        assert!(!visible_text.contains("currentCore"));
        assert!(!visible_text.contains("latestStats"));
        assert!(!visible_text.contains("sourceStats"));
        assert!(!visible_text.contains("candidateCount"));
        assert!(!route.route_overview.contains("currentCore"));
        assert!(!route.route_overview.contains("latestStats"));
        assert!(!route.route_overview.contains("sourceStats"));
        assert_eq!(
            route.response_format,
            Some(AiResponseFormatKind::JsonSchema)
        );
        assert!(route.route_overview.contains("阅读"));
    }

    #[test]
    fn normalize_single_book_route_rejects_generic_guidance_without_concrete_output() {
        let error = normalize_reading_route_output(
            json!({
                "routeOverview": "建立稳定长读习惯并完成整书复盘沉淀。",
                "books": [{
                    "bookId": "book_deep_work",
                    "title": "深度工作",
                    "author": "卡尔·纽波特",
                    "order": 1,
                    "role": "当前书",
                    "readingPurpose": "建立稳定长读习惯并完成整书复盘沉淀。",
                    "estimatedEffort": "持续推进",
                    "localStatus": "reviewing",
                    "basis": "来自当前输入。"
                }],
                "dependencies": [],
                "reviewCheckpoints": [{
                    "timing": "读完后",
                    "question": "如何复盘这本书？",
                    "suggestedOutput": "整理一份复盘。"
                }],
                "nextActions": ["继续阅读并复盘"]
            }),
            HashSet::from(["book_deep_work".to_string()]),
            ReadingRouteSourceStats {
                current_book_count: 1,
                candidate_count: 0,
                summary_count: 0,
                stats_signal_count: 1,
                local_status_count: 1,
            },
            None,
            "100".to_string(),
            READING_ROUTE_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect_err("generic single-book guidance should fail");

        assert_eq!(
            error.user_message(),
            "AI 返回的单书阅读指南缺少具体阅读范围、复盘输出或验收标准，请重新生成。"
        );
    }

    #[test]
    fn normalize_reading_route_output_falls_back_to_current_book_stage_when_missing() {
        let route = normalize_reading_route_output(
            json!({
                "routeOverview": "围绕《深度工作》先完成关键阅读，再输出 1 页复盘。",
                "books": [{
                    "bookId": "book_deep_work",
                    "title": "深度工作",
                    "author": "卡尔·纽波特",
                    "order": 1,
                    "role": "当前书",
                    "readingPurpose": "今天先读当前进度后的下一段，确认专注工作最难坚持的 1 个场景。",
                    "estimatedEffort": "1 个 45 分钟阅读时段",
                    "localStatus": "reading",
                    "basis": "当前进度 55%，已进入深入推进阶段。"
                }],
                "dependencies": [],
                "reviewCheckpoints": [{
                    "timing": "读完这一段后",
                    "question": "哪条专注规则最值得本周先试一次？",
                    "suggestedOutput": "写 3 条观察，并选 1 条作为本周实验，完成标准：能落实到具体场景。"
                }],
                "nextActions": ["今天读 45 分钟并写 3 条专注观察，完成标准：选出 1 条本周实验。"]
            }),
            HashSet::from(["book_deep_work".to_string()]),
            ReadingRouteSourceStats {
                current_book_count: 1,
                candidate_count: 0,
                summary_count: 0,
                stats_signal_count: 0,
                local_status_count: 1,
            },
            Some(ReadingStageSignal {
                stage: "deepening".to_string(),
                label: "深入推进".to_string(),
                progress_percent: 55,
                refresh_reason: None,
            }),
            "100".to_string(),
            READING_ROUTE_PROMPT_VERSION,
            Some(AiResponseFormatKind::JsonObject),
        )
        .expect("route should normalize with fallback stage");

        assert_eq!(
            route.reading_stage,
            Some(ReadingStageSignal {
                stage: "deepening".to_string(),
                label: "深入推进".to_string(),
                progress_percent: 55,
                refresh_reason: None,
            })
        );
        assert_eq!(
            route.response_format,
            Some(AiResponseFormatKind::JsonObject)
        );
    }

    #[test]
    fn build_reading_stats_review_input_excludes_raw_response() {
        let stats = map_reading_stats_response(
            "monthly",
            &json!({
                "baseTime": 100,
                "readDays": 3,
                "totalReadTime": 3600,
                "dayAverageReadTime": 1200,
                "readTimes": { "100": 1200, "200": 2400 },
                "readLongest": [{
                    "book": { "bookId": "book_1", "title": "深度工作", "author": "作者" },
                    "readTime": 1800,
                    "tags": ["效率"]
                }],
                "preferCategory": [{
                    "categoryTitle": "效率",
                    "parentCategoryTitle": "非虚构",
                    "readingTime": 3600,
                    "readingCount": 1
                }],
                "privateField": "should-not-be-sent"
            }),
            None,
        );
        let input = build_reading_stats_review_input(&stats).expect("input should build");

        assert_eq!(input.source_stats.mode, "monthly");
        assert_eq!(input.source_stats.bucket_count, 2);
        assert!(input.payload.get("raw").is_none());
        assert!(input.payload.to_string().find("privateField").is_none());
        assert_eq!(input.payload["longestItems"][0]["title"], "深度工作");
        assert_eq!(input.payload["personaStatus"], "insufficient");
        assert_eq!(
            input.payload["personaBasisNotice"],
            super::reading_persona_basis_notice()
        );
    }

    #[test]
    fn reading_persona_shared_fixtures_match_rust_payload_contract() {
        for fixture in load_reading_persona_fixture_cases() {
            let stats = reading_stats_record_from_fixture(&fixture.stats);
            let input = build_reading_stats_review_input(&stats)
                .unwrap_or_else(|_| panic!("fixture {} should build", fixture.id));

            assert_eq!(input.payload["personaStatus"], fixture.expected.status);

            match fixture.expected.code.as_deref() {
                Some(code) => assert_eq!(input.payload["personaCode"], code),
                None => assert!(input.payload.get("personaCode").is_none()),
            }
            match fixture.expected.label.as_deref() {
                Some(label) => assert_eq!(input.payload["personaLabel"], label),
                None => assert!(input.payload.get("personaLabel").is_none()),
            }
            match fixture.expected.display_title.as_deref() {
                Some(title) => assert_eq!(input.payload["personaDisplayTitle"], title),
                None => assert!(input.payload.get("personaDisplayTitle").is_none()),
            }
            match fixture.expected.palette_group.as_deref() {
                Some(group) => assert_eq!(input.payload["personaPaletteGroup"], group),
                None => assert!(input.payload.get("personaPaletteGroup").is_none()),
            }
            match fixture.expected.accent_tone.as_deref() {
                Some(tone) => assert_eq!(input.payload["personaAccentTone"], tone),
                None => assert!(input.payload.get("personaAccentTone").is_none()),
            }

            let dimension_keys = input.payload["personaDimensions"]
                .as_array()
                .expect("personaDimensions should be an array")
                .iter()
                .map(|item| {
                    item["key"]
                        .as_str()
                        .expect("dimension key should be a string")
                        .to_string()
                })
                .collect::<Vec<_>>();
            assert_eq!(dimension_keys, fixture.expected.dimension_keys);
            assert_eq!(
                input.payload["personaEvidence"]
                    .as_array()
                    .expect("personaEvidence should be an array")
                    .len(),
                fixture.expected.evidence_count
            );

            match fixture.expected.confidence {
                Some(confidence) => {
                    let actual = input.payload["personaConfidence"]
                        .as_f64()
                        .expect("personaConfidence should be a float");
                    assert!((actual - confidence).abs() < 0.0001);
                }
                None => assert!(input.payload.get("personaConfidence").is_none()),
            }
        }
    }

    #[test]
    fn build_reading_stats_review_input_includes_local_persona_context() {
        let stats = map_reading_stats_response(
            "monthly",
            &json!({
                "baseTime": 1725955200i64,
                "readDays": 12,
                "totalReadTime": 18900,
                "dayAverageReadTime": 1575,
                "compare": 0.18,
                "readTimes": {
                    "1725696000": 1800,
                    "1725782400": 3600,
                    "1725868800": 2400
                },
                "readLongest": [{
                    "book": { "bookId": "book-deep-work", "title": "深度工作", "author": "卡尔·纽波特" },
                    "readTime": 7200,
                    "tags": ["效率", "专注"]
                }],
                "preferCategory": [{
                    "categoryId": "efficiency",
                    "categoryTitle": "效率",
                    "parentCategoryTitle": "非虚构",
                    "readingTime": 9000,
                    "readingCount": 3
                }, {
                    "categoryId": "sci-fi",
                    "categoryTitle": "科幻",
                    "parentCategoryTitle": "文学",
                    "readingTime": 5400,
                    "readingCount": 2
                }]
            }),
            None,
        );
        let input = build_reading_stats_review_input(&stats).expect("input should build");

        assert_eq!(input.payload["personaStatus"], "complete");
        assert_eq!(input.payload["personaCode"], "ISTJ");
        assert_eq!(input.payload["personaLabel"], "秩序型读者");
        assert_eq!(
            input.payload["personaDisplayTitle"],
            "ISTJ 型读者 · 秩序型读者"
        );
        assert_eq!(input.payload["personaPaletteGroup"], "SJ");
        assert_eq!(input.payload["personaAccentTone"], "moss");
        assert_eq!(input.payload["personaDimensions"][0]["axis"], "energy");
        assert_eq!(input.payload["personaDimensions"][3]["key"], "J");
        assert!(
            input.payload["personaEvidence"]
                .as_array()
                .expect("evidence should be an array")
                .len()
                >= 2
        );
    }

    #[test]
    fn resolve_reading_persona_prefers_ai_copy_without_overriding_local_identity() {
        let fixture = load_reading_persona_fixture_cases()
            .into_iter()
            .find(|case| case.id == "stable-istj")
            .expect("stable-istj fixture should exist");
        let stats = reading_stats_record_from_fixture(&fixture.stats);
        let persona = resolve_reading_persona(
            &stats,
            Some(&ReadingPersonaPatch {
                summary: Some("AI 改写后的主线总结。".to_string()),
                suggestion: Some("AI 改写后的温和建议。".to_string()),
            }),
        );

        assert_eq!(persona.status, "complete");
        assert_eq!(persona.code.as_deref(), Some("ISTJ"));
        assert_eq!(persona.label.as_deref(), Some("秩序型读者"));
        assert_eq!(persona.summary.as_deref(), Some("AI 改写后的主线总结。"));
        assert_eq!(persona.suggestion.as_deref(), Some("AI 改写后的温和建议。"));
    }

    #[test]
    fn resolve_reading_persona_keeps_insufficient_state_when_ai_patch_exists() {
        let fixture = load_reading_persona_fixture_cases()
            .into_iter()
            .find(|case| case.id == "insufficient-sample")
            .expect("insufficient-sample fixture should exist");
        let stats = reading_stats_record_from_fixture(&fixture.stats);
        let persona = resolve_reading_persona(
            &stats,
            Some(&ReadingPersonaPatch {
                summary: Some("依据还不多，先继续读。".to_string()),
                suggestion: Some("不要升级成完整人格。".to_string()),
            }),
        );

        assert_eq!(persona.status, "insufficient");
        assert!(persona.code.is_none());
        assert_eq!(persona.summary.as_deref(), Some("依据还不多，先继续读。"));
        assert!(persona.suggestion.is_none());
    }

    #[test]
    fn normalize_reading_stats_review_output_adds_local_metadata() {
        let review = normalize_reading_stats_review_output(
            json!({
                "overview": "本月阅读稳定。",
                "rhythmInsights": ["集中在周末"],
                "preferenceInsights": ["偏好效率类"],
                "focusItems": ["深度工作"],
                "nextActions": ["保持固定阅读时段"],
                "readingPersona": {
                    "summary": "这一周期更像围绕主线持续推进。",
                    "suggestion": "下个周期补一本文学短书。"
                }
            }),
            ReadingStatsAiReviewSourceStats {
                mode: "monthly".to_string(),
                base_time: 100,
                read_days: Some(3),
                total_read_time_seconds: Some(3600),
                day_average_read_time_seconds: Some(1200),
                bucket_count: 2,
                longest_item_count: 1,
                category_count: 1,
            },
            "200".to_string(),
            "reading-stats-review-v2",
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("review should normalize");

        assert_eq!(review.overview, "本月阅读稳定。");
        assert_eq!(review.rhythm_insights, vec!["集中在周末".to_string()]);
        assert_eq!(review.preference_insights, vec!["偏好效率类".to_string()]);
        assert_eq!(review.focus_items, vec!["深度工作".to_string()]);
        assert_eq!(review.next_actions, vec!["保持固定阅读时段".to_string()]);
        assert_eq!(review.prompt_version, "reading-stats-review-v2");
        assert_eq!(
            review.reading_persona,
            Some(ReadingPersonaPatch {
                summary: Some("这一周期更像围绕主线持续推进。".to_string()),
                suggestion: Some("下个周期补一本文学短书。".to_string()),
            })
        );
        assert_eq!(
            review.response_format,
            Some(AiResponseFormatKind::JsonSchema)
        );
    }

    #[test]
    fn normalize_reading_stats_review_output_ignores_invalid_reading_persona_patch() {
        let review = normalize_reading_stats_review_output(
            json!({
                "overview": "本月阅读稳定。",
                "rhythmInsights": ["集中在周末"],
                "preferenceInsights": ["偏好效率类"],
                "focusItems": ["深度工作"],
                "nextActions": ["保持固定阅读时段"],
                "readingPersona": {
                    "summary": 42,
                    "suggestion": ["bad"]
                }
            }),
            ReadingStatsAiReviewSourceStats {
                mode: "monthly".to_string(),
                base_time: 100,
                read_days: Some(3),
                total_read_time_seconds: Some(3600),
                day_average_read_time_seconds: Some(1200),
                bucket_count: 2,
                longest_item_count: 1,
                category_count: 1,
            },
            "200".to_string(),
            "reading-stats-review-v2",
            Some(AiResponseFormatKind::JsonSchema),
        )
        .expect("review should still normalize");

        assert_eq!(review.overview, "本月阅读稳定。");
        assert!(review.reading_persona.is_none());
    }

    #[test]
    fn empty_reading_stats_detection_requires_no_signal() {
        let empty = map_reading_stats_response("monthly", &json!({ "baseTime": 100 }), None);
        let active = map_reading_stats_response(
            "monthly",
            &json!({ "baseTime": 100, "totalReadTime": 60 }),
            None,
        );

        assert!(is_empty_reading_stats(&empty));
        assert!(!is_empty_reading_stats(&active));
    }

    fn insert_book_decision_fixture(connection: &Connection) {
        connection
            .execute(
                "
                INSERT INTO reading_item_states (
                    item_id, item_type, status, title, author, cover, category, note, created_at, updated_at
                ) VALUES
                    ('candidate_moon', 'candidate', 'toRead', '月亮与六便士', '毛姆', NULL, '文学', '本地候选', '100', '120'),
                    ('candidate_focus', 'candidate', 'toRead', '专注力', '作者', NULL, '效率', '本地候选', '100', '120')
                ",
                [],
            )
            .expect("candidate states should insert");
        connection
            .execute(
                "
                INSERT INTO shelf_entries (
                    id, type, title, author, cover, category, raw_json, updated_at
                ) VALUES (
                    'secret_shelf_book', 'book', '不应进入输入的书', '作者', NULL, '隐私',
                    '{\"apiKey\":\"sk-should-not-appear\",\"databasePath\":\"C:/tmp/app.db\"}',
                    '100'
                )
                ",
                [],
            )
            .expect("shelf fixture should insert");
        connection
            .execute(
                "
                INSERT INTO highlights (
                    bookmark_id, book_id, chapter_uid, chapter_title, mark_text,
                    create_time, range_text, raw_json, updated_at
                ) VALUES (
                    'raw_highlight_1', 'candidate_moon', 1, '第一章',
                    '原始划线正文不应进入选书决策', 100, NULL, '{}', '100'
                )
                ",
                [],
            )
            .expect("highlight fixture should insert");
        upsert_ai_output(
            connection,
            &AiOutputUpsert {
                feature: BOOK_NOTES_SUMMARY_FEATURE.to_string(),
                scope_id: "candidate_moon".to_string(),
                prompt_version: BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
                input_hash: "summary_hash".to_string(),
                output: json!({
                    "overview": "复盘概览",
                    "keyIdeas": ["选择与代价"],
                    "myFocus": ["个人选择"],
                    "actionItems": ["写一段选择复盘"],
                    "themeTags": ["文学", "选择"],
                    "representativeQuotes": [],
                    "reflectionQuestions": [],
                    "sourceStats": {
                        "highlightCount": 1,
                        "thoughtCount": 0,
                        "bookmarkCount": 0,
                        "chapterCount": 1,
                        "includedHighlightCount": 1,
                        "includedThoughtCount": 0
                    },
                    "generatedAt": "100",
                    "promptVersion": BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                    "basisNotice": "基于本地笔记生成，不代表整本书全文内容。"
                }),
                source_count: Some(1),
                provider_model: Some("gpt-4o-mini".to_string()),
            },
            "120",
        )
        .expect("summary output should insert");
        connection
            .execute(
                "
                INSERT INTO reading_stats (
                    mode, base_time, total_read_time_seconds, read_days, raw_json, updated_at
                ) VALUES (
                    'monthly', 100, 3600, 3,
                    '{\"baseTime\":100,\"preferCategory\":[{\"categoryTitle\":\"文学\",\"readingTime\":3600,\"readingCount\":2}]}',
                    '130'
                )
                ",
                [],
            )
            .expect("stats fixture should insert");
    }

    fn insert_book_notes_fixture(connection: &Connection, book_id: &str) {
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id, title, author, cover, review_count, note_count,
                    bookmark_count, total_note_count, sort, raw_json, updated_at
                ) VALUES (?1, '深度工作', '卡尔', NULL, 1, 1, 0, 1, 0, '{}', '100')
                ",
                rusqlite::params![book_id],
            )
            .expect("book should insert");
        connection
            .execute(
                "
                INSERT INTO highlights (
                    bookmark_id, book_id, chapter_uid, chapter_title, mark_text,
                    create_time, range_text, raw_json, updated_at
                ) VALUES ('mark_1', ?1, 1, '第一章', '深度工作需要无干扰时间。', 100, NULL, '{}', '100')
                ",
                rusqlite::params![book_id],
            )
            .expect("highlight should insert");
    }
}
