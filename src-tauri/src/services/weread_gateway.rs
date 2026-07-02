use std::{collections::BTreeSet, time::Duration};

use reqwest::{Client as HttpClient, Proxy, StatusCode, Url};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::{
    config::{WEREAD_GATEWAY_URL, WEREAD_SKILL_VERSION},
    errors::{AppError, UpgradeInfo},
    services::credentials::CredentialService,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum WereadApi {
    ValidateCredential,
    SyncShelf,
    BookInfo,
    BookProgress,
    BookChapters,
    NotebookOverview,
    BookBookmarks,
    MineReviews,
    ReadingStats,
    SearchBooks,
    Recommendations,
    SimilarBooks,
    PublicReviews,
}

impl WereadApi {
    pub fn api_name(self) -> &'static str {
        match self {
            Self::ValidateCredential | Self::SyncShelf => "/shelf/sync",
            Self::BookInfo => "/book/info",
            Self::BookProgress => "/book/getprogress",
            Self::BookChapters => "/book/chapterinfo",
            Self::NotebookOverview => "/user/notebooks",
            Self::BookBookmarks => "/book/bookmarklist",
            Self::MineReviews => "/review/list/mine",
            Self::ReadingStats => "/readdata/detail",
            Self::SearchBooks => "/store/search",
            Self::Recommendations => "/book/recommend",
            Self::SimilarBooks => "/book/similar",
            Self::PublicReviews => "/review/list",
        }
    }

    fn supported_names() -> BTreeSet<&'static str> {
        [
            Self::SyncShelf,
            Self::BookInfo,
            Self::BookProgress,
            Self::BookChapters,
            Self::NotebookOverview,
            Self::BookBookmarks,
            Self::MineReviews,
            Self::ReadingStats,
            Self::SearchBooks,
            Self::Recommendations,
            Self::SimilarBooks,
            Self::PublicReviews,
        ]
        .into_iter()
        .map(Self::api_name)
        .collect()
    }
}

pub struct WereadGateway {
    http_client: HttpClient,
    credential_service: CredentialService,
}

impl WereadGateway {
    pub fn new(app: AppHandle) -> Result<Self, AppError> {
        let http_client = build_http_client(&app)?;

        Ok(Self {
            http_client,
            credential_service: CredentialService::new(app),
        })
    }

    pub fn build_payload(api: WereadApi, params: Value) -> Result<Value, AppError> {
        let mut payload = flatten_params(params)?;
        payload.insert("api_name".to_string(), json!(api.api_name()));
        payload.insert("skill_version".to_string(), json!(WEREAD_SKILL_VERSION));

        Ok(Value::Object(payload))
    }

    pub fn build_payload_by_name(api_name: &str, params: Value) -> Result<Value, AppError> {
        if !WereadApi::supported_names().contains(api_name) {
            return Err(AppError::UnsupportedApi(api_name.to_string()));
        }

        let mut payload = flatten_params(params)?;
        payload.insert("api_name".to_string(), json!(api_name));
        payload.insert("skill_version".to_string(), json!(WEREAD_SKILL_VERSION));

        Ok(Value::Object(payload))
    }

    pub async fn call(&self, api: WereadApi, params: Value) -> Result<Value, AppError> {
        let api_key = self.credential_service.read_api_key()?;
        let payload = Self::build_payload(api, params)?;
        self.send_payload(&api_key, payload).await
    }

    async fn send_payload(&self, api_key: &str, payload: Value) -> Result<Value, AppError> {
        let response = self
            .http_client
            .post(WEREAD_GATEWAY_URL)
            .bearer_auth(api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Network(error.to_string()))?;

        let status = response.status();
        let value = response
            .json::<Value>()
            .await
            .map_err(|error| AppError::Decode(error.to_string()))?;

        normalize_gateway_response(status, value)
    }
}

fn build_http_client(app: &AppHandle) -> Result<HttpClient, AppError> {
    let mut builder = HttpClient::builder().timeout(Duration::from_secs(20));

    if let Some(proxy_url) = read_weread_proxy_url(app)? {
        let proxy = Proxy::all(&proxy_url).map_err(|error| {
            AppError::InvalidPayload(format!("微信读书代理地址无效：{error}。"))
        })?;
        builder = builder.proxy(proxy);
    }

    builder
        .build()
        .map_err(|error| AppError::Network(format!("无法初始化微信读书 HTTP 客户端：{error}")))
}

fn read_weread_proxy_url(app: &AppHandle) -> Result<Option<String>, AppError> {
    let config_dir = crate::db::default_data_dir(app).map_err(AppError::Storage)?;
    crate::db::read_weread_proxy_url_config(&config_dir).map_err(AppError::Storage)
}

pub(crate) fn normalize_weread_proxy_url(value: &str) -> Result<Option<String>, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let url = Url::parse(trimmed)
        .map_err(|_| AppError::InvalidPayload("微信读书代理地址格式不正确。".to_string()))?;
    let is_supported_scheme = matches!(
        url.scheme(),
        "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h"
    );
    if !is_supported_scheme {
        return Err(AppError::InvalidPayload(
            "微信读书代理仅支持 http、https 或 socks 代理地址。".to_string(),
        ));
    }

    if url.host_str().is_none() {
        return Err(AppError::InvalidPayload(
            "微信读书代理地址缺少主机。".to_string(),
        ));
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::InvalidPayload(
            "微信读书代理地址暂不支持在 URL 中保存用户名或密码。".to_string(),
        ));
    }

    Ok(Some(trimmed.to_string()))
}

fn flatten_params(params: Value) -> Result<Map<String, Value>, AppError> {
    match params {
        Value::Object(mut object) => {
            for reserved_key in ["api_name", "skill_version"] {
                if object.contains_key(reserved_key) {
                    return Err(AppError::InvalidPayload(format!(
                        "业务参数不能包含保留字段：{reserved_key}。"
                    )));
                }
            }

            for nested_key in ["params", "data", "body"] {
                if object.contains_key(nested_key) {
                    return Err(AppError::InvalidPayload(format!(
                        "业务参数必须平铺在顶层，不能放入 {nested_key}。"
                    )));
                }
            }

            Ok(std::mem::take(&mut object))
        }
        Value::Null => Ok(Map::new()),
        _ => Err(AppError::InvalidPayload(
            "网关业务参数必须是 JSON 对象。".to_string(),
        )),
    }
}

fn normalize_gateway_response(status: StatusCode, value: Value) -> Result<Value, AppError> {
    if let Some(info) = extract_upgrade_info(&value) {
        return Err(AppError::UpgradeRequired(info));
    }

    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(AppError::Authentication(
            "微信读书 API Key 无效或已失效，请在设置中更新。".to_string(),
        ));
    }

    if !status.is_success() {
        return Err(AppError::Network(format!("HTTP {status}")));
    }

    if let Some(errcode) = value.get("errcode").and_then(Value::as_i64) {
        if errcode != 0 {
            let message = value
                .get("errmsg")
                .or_else(|| value.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("微信读书接口返回错误。")
                .to_string();

            if looks_like_auth_error(errcode, &message) {
                return Err(AppError::Authentication(message));
            }

            return Err(AppError::Gateway(message));
        }
    }

    Ok(value)
}

fn extract_upgrade_info(value: &Value) -> Option<UpgradeInfo> {
    let info = value.get("upgrade_info")?;
    let message = info
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("微信读书能力需要升级后才能继续同步。")
        .to_string();

    Some(UpgradeInfo { message })
}

fn looks_like_auth_error(errcode: i64, message: &str) -> bool {
    errcode == 401
        || errcode == 403
        || message.contains("token")
        || message.contains("鉴权")
        || message.contains("认证")
        || message.contains("授权")
        || message.contains("登录")
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;
    use serde_json::json;

    use super::{normalize_gateway_response, normalize_weread_proxy_url, WereadApi, WereadGateway};
    use crate::{
        config::WEREAD_SKILL_VERSION,
        errors::{AppError, UpgradeInfo},
    };

    #[test]
    fn build_payload_flattens_business_fields_at_top_level() {
        let payload = WereadGateway::build_payload(
            WereadApi::SearchBooks,
            json!({ "keyword": "三体", "count": 10 }),
        )
        .expect("payload should build");

        assert_eq!(payload["api_name"], "/store/search");
        assert_eq!(payload["skill_version"], WEREAD_SKILL_VERSION);
        assert_eq!(payload["keyword"], "三体");
        assert_eq!(payload["count"], 10);
        assert!(payload.get("params").is_none());
    }

    #[test]
    fn runtime_skill_version_matches_local_skill_document() {
        let skill_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("weread")
            .join("SKILL.md");
        let skill = std::fs::read_to_string(skill_path).expect("local weread skill should exist");
        let document_version = skill
            .lines()
            .find_map(|line| line.strip_prefix("version:"))
            .map(str::trim)
            .expect("skill frontmatter should include version");

        assert_eq!(document_version, WEREAD_SKILL_VERSION);
    }

    #[test]
    fn build_payload_rejects_nested_params() {
        let error = WereadGateway::build_payload(
            WereadApi::NotebookOverview,
            json!({ "params": { "count": 20 } }),
        )
        .expect_err("nested params should fail");

        assert_eq!(error.code(), "invalid_gateway_payload");
    }

    #[test]
    fn build_payload_rejects_reserved_fields() {
        let error =
            WereadGateway::build_payload(WereadApi::SyncShelf, json!({ "api_name": "/_list" }))
                .expect_err("reserved api_name should fail");

        assert_eq!(error.code(), "invalid_gateway_payload");
    }

    #[test]
    fn build_payload_by_name_rejects_unsupported_api() {
        let error = WereadGateway::build_payload_by_name("/_list", json!({}))
            .expect_err("arbitrary gateway call should fail");

        assert_eq!(error.code(), "unsupported_api");
    }

    #[test]
    fn build_payload_by_name_allows_supported_discovery_api() {
        let payload = WereadGateway::build_payload_by_name(
            "/book/similar",
            json!({ "bookId": "b1", "count": 12 }),
        )
        .expect("supported discovery payload should build");

        assert_eq!(payload["api_name"], "/book/similar");
        assert_eq!(payload["skill_version"], WEREAD_SKILL_VERSION);
        assert_eq!(payload["bookId"], "b1");
        assert_eq!(payload["count"], 12);
    }

    #[test]
    fn normalize_response_stops_on_upgrade_info() {
        let error = normalize_gateway_response(
            StatusCode::OK,
            json!({ "upgrade_info": { "message": "请升级能力文档" } }),
        )
        .expect_err("upgrade info should stop flow");

        assert!(matches!(
            error,
            AppError::UpgradeRequired(UpgradeInfo { message }) if message == "请升级能力文档"
        ));
    }

    #[test]
    fn normalize_response_maps_auth_http_status() {
        let error = normalize_gateway_response(StatusCode::UNAUTHORIZED, json!({}))
            .expect_err("unauthorized status should fail");

        assert_eq!(error.code(), "gateway_authentication_failed");
    }

    #[test]
    fn normalize_response_maps_gateway_errcode() {
        let error = normalize_gateway_response(
            StatusCode::OK,
            json!({ "errcode": 1001, "errmsg": "请求失败" }),
        )
        .expect_err("non-zero errcode should fail");

        assert_eq!(error.code(), "gateway_error");
        assert_eq!(error.user_message(), "请求失败");
    }

    #[test]
    fn normalize_weread_proxy_url_accepts_http_and_socks() {
        assert_eq!(
            normalize_weread_proxy_url(" http://127.0.0.1:7890 ")
                .expect("http proxy should be valid"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            normalize_weread_proxy_url("socks5://127.0.0.1:1080")
                .expect("socks proxy should be valid"),
            Some("socks5://127.0.0.1:1080".to_string())
        );
        assert_eq!(
            normalize_weread_proxy_url("   ").expect("blank proxy should clear"),
            None
        );
    }

    #[test]
    fn normalize_weread_proxy_url_rejects_credentials() {
        let error = normalize_weread_proxy_url("http://user:pass@127.0.0.1:7890")
            .expect_err("proxy credentials should not be persisted");

        assert_eq!(error.code(), "invalid_gateway_payload");
    }
}
