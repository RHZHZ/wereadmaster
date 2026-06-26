use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::{
    db,
    errors::AppError,
    mappers::discovery::{
        map_public_reviews_response, map_recommendations_response, map_search_books_response,
        map_similar_books_response, PublicReviewsRecord, RecommendationRecord, SearchBooksRecord,
        SimilarBooksRecord,
    },
    repositories::{
        cache::RawCacheRepository,
        sync_state::{SyncStateRecord, SyncStateRepository},
    },
    services::weread_gateway::{WereadApi, WereadGateway},
};

const DISCOVERY_SECTION: &str = "discovery";
const DISCOVERY_CACHE_NAMESPACE: &str = "discovery";
const DEFAULT_SEARCH_SCOPE: i64 = 0;
const DEFAULT_REVIEW_LIST_TYPE: i64 = 0;
const MAX_COUNT: i64 = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchBooksResponse {
    pub result: SearchBooksRecord,
    pub sync_state: Option<SyncStateRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationsResponse {
    pub result: RecommendationRecord,
    pub sync_state: Option<SyncStateRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarBooksResponse {
    pub result: SimilarBooksRecord,
    pub sync_state: Option<SyncStateRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicReviewsResponse {
    pub result: PublicReviewsRecord,
    pub sync_state: Option<SyncStateRecord>,
}

pub struct DiscoveryService {
    app: AppHandle,
}

impl DiscoveryService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn search_books(
        &self,
        keyword: String,
        scope: Option<i64>,
        max_idx: Option<i64>,
        count: Option<i64>,
    ) -> Result<SearchBooksResponse, AppError> {
        let keyword = normalize_keyword(&keyword)?;
        let scope = normalize_search_scope(scope)?;
        let params = build_search_params(&keyword, scope, max_idx, count)?;
        let raw = self
            .call_and_cache(WereadApi::SearchBooks, params, || {
                format!(
                    "search:{scope}:{}:{}:{}",
                    cache_safe_key(&keyword),
                    max_idx.unwrap_or(0),
                    count.unwrap_or(0)
                )
            })
            .await?;
        let result = map_search_books_response(scope, &raw);

        Ok(SearchBooksResponse {
            result,
            sync_state: self.discovery_sync_state()?,
        })
    }

    pub async fn get_recommendations(
        &self,
        count: Option<i64>,
        max_idx: Option<i64>,
    ) -> Result<RecommendationsResponse, AppError> {
        let params = build_optional_paging_params(count, max_idx)?;
        let raw = self
            .call_and_cache(WereadApi::Recommendations, params, || {
                format!("recommend:{}:{}", max_idx.unwrap_or(0), count.unwrap_or(0))
            })
            .await?;
        let result = map_recommendations_response(&raw);

        Ok(RecommendationsResponse {
            result,
            sync_state: self.discovery_sync_state()?,
        })
    }

    pub async fn get_similar_books(
        &self,
        book_id: String,
        count: Option<i64>,
        max_idx: Option<i64>,
        session_id: Option<String>,
    ) -> Result<SimilarBooksResponse, AppError> {
        let book_id = normalize_book_id(&book_id)?;
        let session_id = normalize_optional_text(session_id);
        let params = build_similar_params(&book_id, count, max_idx, session_id.as_deref())?;
        let raw = self
            .call_and_cache(WereadApi::SimilarBooks, params, || {
                format!(
                    "similar:{}:{}:{}:{}",
                    book_id,
                    max_idx.unwrap_or(0),
                    count.unwrap_or(0),
                    session_id.as_deref().unwrap_or("first")
                )
            })
            .await?;
        let result = map_similar_books_response(&raw);

        Ok(SimilarBooksResponse {
            result,
            sync_state: self.discovery_sync_state()?,
        })
    }

    pub async fn get_public_reviews(
        &self,
        book_id: String,
        review_list_type: Option<i64>,
        count: Option<i64>,
        max_idx: Option<i64>,
        synckey: Option<i64>,
    ) -> Result<PublicReviewsResponse, AppError> {
        let book_id = normalize_book_id(&book_id)?;
        let review_list_type = normalize_review_list_type(review_list_type)?;
        let params =
            build_public_reviews_params(&book_id, review_list_type, count, max_idx, synckey)?;
        let raw = self
            .call_and_cache(WereadApi::PublicReviews, params, || {
                format!(
                    "reviews:{}:{}:{}:{}:{}",
                    book_id,
                    review_list_type,
                    max_idx.unwrap_or(0),
                    synckey.unwrap_or(0),
                    count.unwrap_or(0)
                )
            })
            .await?;
        let result = map_public_reviews_response(&book_id, review_list_type, &raw);

        Ok(PublicReviewsResponse {
            result,
            sync_state: self.discovery_sync_state()?,
        })
    }

    async fn call_and_cache(
        &self,
        api: WereadApi,
        params: Value,
        cache_key: impl FnOnce() -> String,
    ) -> Result<Value, AppError> {
        let started_at = current_unix_seconds();
        let mut connection = self.open_connection()?;
        SyncStateRepository::new(&connection)
            .mark_syncing(DISCOVERY_SECTION, &started_at)
            .map_err(AppError::from)?;

        let result = match WereadGateway::new(self.app.clone()) {
            Ok(gateway) => gateway.call(api, params).await,
            Err(error) => Err(error),
        };

        match result {
            Ok(raw) => {
                let completed_at = current_unix_seconds();
                let transaction = connection.transaction().map_err(AppError::from)?;
                RawCacheRepository::new(&transaction)
                    .put_json(DISCOVERY_CACHE_NAMESPACE, &cache_key(), &raw, &completed_at)
                    .map_err(AppError::from)?;
                SyncStateRepository::new(&transaction)
                    .mark_success(DISCOVERY_SECTION, &completed_at)
                    .map_err(AppError::from)?;
                transaction.commit().map_err(AppError::from)?;

                Ok(raw)
            }
            Err(error) => {
                let attempted_at = current_unix_seconds();
                let error_message = error
                    .diagnostic_message()
                    .unwrap_or_else(|| error.user_message());
                SyncStateRepository::new(&connection)
                    .mark_failed(
                        DISCOVERY_SECTION,
                        &attempted_at,
                        error.code(),
                        &error_message,
                    )
                    .map_err(AppError::from)?;

                Err(error)
            }
        }
    }

    fn discovery_sync_state(&self) -> Result<Option<SyncStateRecord>, AppError> {
        let connection = self.open_connection()?;
        SyncStateRepository::new(&connection)
            .get(DISCOVERY_SECTION)
            .map_err(AppError::from)
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AppError> {
        db::open_connection(&self.app).map_err(AppError::Storage)
    }
}

fn build_search_params(
    keyword: &str,
    scope: i64,
    max_idx: Option<i64>,
    count: Option<i64>,
) -> Result<Value, AppError> {
    let mut params = Map::new();
    params.insert("keyword".to_string(), json!(keyword));
    params.insert("scope".to_string(), json!(scope));
    insert_optional_paging(&mut params, count, max_idx)?;

    Ok(Value::Object(params))
}

fn build_optional_paging_params(
    count: Option<i64>,
    max_idx: Option<i64>,
) -> Result<Value, AppError> {
    let mut params = Map::new();
    insert_optional_paging(&mut params, count, max_idx)?;

    Ok(Value::Object(params))
}

fn build_similar_params(
    book_id: &str,
    count: Option<i64>,
    max_idx: Option<i64>,
    session_id: Option<&str>,
) -> Result<Value, AppError> {
    let mut params = Map::new();
    params.insert("bookId".to_string(), json!(book_id));
    insert_optional_paging(&mut params, count, max_idx)?;

    if let Some(session_id) = session_id {
        params.insert("sessionId".to_string(), json!(session_id));
    }

    Ok(Value::Object(params))
}

fn build_public_reviews_params(
    book_id: &str,
    review_list_type: i64,
    count: Option<i64>,
    max_idx: Option<i64>,
    synckey: Option<i64>,
) -> Result<Value, AppError> {
    let mut params = Map::new();
    params.insert("bookId".to_string(), json!(book_id));
    params.insert("reviewListType".to_string(), json!(review_list_type));
    insert_optional_paging(&mut params, count, max_idx)?;

    if let Some(synckey) = validate_non_negative(synckey, "synckey")? {
        params.insert("synckey".to_string(), json!(synckey));
    }

    Ok(Value::Object(params))
}

fn insert_optional_paging(
    params: &mut Map<String, Value>,
    count: Option<i64>,
    max_idx: Option<i64>,
) -> Result<(), AppError> {
    if let Some(count) = normalize_count(count)? {
        params.insert("count".to_string(), json!(count));
    }

    if let Some(max_idx) = validate_non_negative(max_idx, "maxIdx")? {
        params.insert("maxIdx".to_string(), json!(max_idx));
    }

    Ok(())
}

fn normalize_keyword(keyword: &str) -> Result<String, AppError> {
    let trimmed = keyword.trim();

    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload("搜索关键词不能为空。".to_string()));
    }

    Ok(trimmed.chars().take(120).collect())
}

fn normalize_search_scope(scope: Option<i64>) -> Result<i64, AppError> {
    let scope = scope.unwrap_or(DEFAULT_SEARCH_SCOPE);

    if matches!(scope, 0 | 2 | 4 | 6 | 10 | 12 | 13 | 14 | 16) {
        Ok(scope)
    } else {
        Err(AppError::InvalidPayload(
            "搜索 scope 仅支持 0、2、4、6、10、12、13、14、16。".to_string(),
        ))
    }
}

fn normalize_review_list_type(value: Option<i64>) -> Result<i64, AppError> {
    let value = value.unwrap_or(DEFAULT_REVIEW_LIST_TYPE);

    if (0..=4).contains(&value) {
        Ok(value)
    } else {
        Err(AppError::InvalidPayload(
            "点评筛选类型仅支持 0=全部、1=推荐、2=不行、3=最新、4=一般。".to_string(),
        ))
    }
}

fn normalize_count(value: Option<i64>) -> Result<Option<i64>, AppError> {
    match value {
        Some(value) if value <= 0 => {
            Err(AppError::InvalidPayload("count 必须是正整数。".to_string()))
        }
        Some(value) => Ok(Some(value.min(MAX_COUNT))),
        None => Ok(None),
    }
}

fn validate_non_negative(value: Option<i64>, field: &str) -> Result<Option<i64>, AppError> {
    match value {
        Some(value) if value < 0 => Err(AppError::InvalidPayload(format!(
            "{field} 必须是非负整数。"
        ))),
        _ => Ok(value),
    }
}

fn normalize_book_id(book_id: &str) -> Result<String, AppError> {
    let trimmed = book_id.trim();

    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload("bookId 不能为空。".to_string()));
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(AppError::InvalidPayload(
            "bookId 只能包含字母、数字、下划线或连字符。".to_string(),
        ));
    }

    Ok(trimmed.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().chars().take(160).collect::<String>())
        .filter(|text| !text.is_empty())
}

fn cache_safe_key(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect()
}

fn current_unix_seconds() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{
        build_public_reviews_params, build_search_params, normalize_count, normalize_keyword,
        normalize_review_list_type, normalize_search_scope,
    };

    #[test]
    fn discovery_validates_supported_search_scope() {
        assert_eq!(normalize_search_scope(None).expect("default scope"), 0);
        assert_eq!(normalize_search_scope(Some(10)).expect("book scope"), 10);
        assert!(normalize_search_scope(Some(99)).is_err());
    }

    #[test]
    fn discovery_rejects_unsupported_review_filters() {
        assert_eq!(normalize_review_list_type(None).expect("default filter"), 0);
        assert_eq!(
            normalize_review_list_type(Some(4)).expect("general filter"),
            4
        );
        assert!(normalize_review_list_type(Some(9)).is_err());
    }

    #[test]
    fn discovery_count_is_optional_and_clamped() {
        assert_eq!(normalize_count(None).expect("count optional"), None);
        assert_eq!(normalize_count(Some(80)).expect("count clamped"), Some(50));
        assert!(normalize_count(Some(0)).is_err());
    }

    #[test]
    fn search_params_are_flattened_and_trimmed() {
        let params = build_search_params(
            &normalize_keyword(" 三体 ").expect("keyword"),
            10,
            Some(7),
            Some(20),
        )
        .expect("params should build");
        let Value::Object(params) = params else {
            panic!("params should be object");
        };

        assert_eq!(params.get("keyword").and_then(Value::as_str), Some("三体"));
        assert_eq!(params.get("scope").and_then(Value::as_i64), Some(10));
        assert_eq!(params.get("maxIdx").and_then(Value::as_i64), Some(7));
        assert!(params.get("params").is_none());
    }

    #[test]
    fn review_params_keep_supported_filter_and_synckey() {
        let params = build_public_reviews_params("b1", 3, Some(20), Some(5), Some(99))
            .expect("params should build");
        let Value::Object(params) = params else {
            panic!("params should be object");
        };

        assert_eq!(params.get("bookId").and_then(Value::as_str), Some("b1"));
        assert_eq!(
            params.get("reviewListType").and_then(Value::as_i64),
            Some(3)
        );
        assert_eq!(params.get("synckey").and_then(Value::as_i64), Some(99));
    }
}
