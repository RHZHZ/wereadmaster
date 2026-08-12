use std::{fmt, fs, time::Duration};

use reqwest::{Client as HttpClient, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::platform::stronghold::{kdf::KeyDerivation, stronghold::Stronghold, Client};

const CLIENT_PATH: &[u8] = b"embedding-credentials";
const API_KEY_RECORD: &[u8] = b"embedding-api-key";
const SETTINGS_RECORD: &[u8] = b"embedding-provider-settings";
const VAULT_PASSWORD: &str = "wxreadmaster-local-embedding-credential-v1";
const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL: &str = "text-embedding-3-small";
const DEFAULT_PROVIDER_LABEL: &str = "OpenAI-compatible";
const DEFAULT_BATCH_SIZE: usize = 32;
const MAX_BATCH_SIZE: usize = 128;
const MAX_BATCH_CHARACTERS: usize = 120_000;
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const MAX_VECTOR_DIMENSIONS: usize = 65_536;
const REQUEST_TIMEOUT_SECONDS: u64 = 60;
const CONNECTION_PROBE_TEXT: &str = "embedding connection probe";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingProviderSettings {
    pub base_url: String,
    pub model: String,
    pub provider_label: String,
    pub batch_size: usize,
    #[serde(default)]
    pub remote_note_embedding_enabled: bool,
    pub consent_confirmed_at: Option<String>,
}

impl Default for EmbeddingProviderSettings {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.to_string(),
            model: DEFAULT_MODEL.to_string(),
            provider_label: DEFAULT_PROVIDER_LABEL.to_string(),
            batch_size: DEFAULT_BATCH_SIZE,
            remote_note_embedding_enabled: false,
            consent_confirmed_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingCredentialState {
    pub has_credential: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSettingsState {
    pub credential: EmbeddingCredentialState,
    pub provider: EmbeddingProviderSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveEmbeddingSettingsRequest {
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
    pub provider_label: Option<String>,
    pub batch_size: Option<usize>,
    pub remote_note_embedding_enabled: bool,
    pub consent_confirmed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConnectionProbe {
    pub is_valid: bool,
    pub model: String,
    pub dimensions: usize,
    pub checked_at: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RemoteEmbeddingBatch {
    pub model: String,
    pub vectors: Vec<Vec<f32>>,
}

#[derive(Debug, Clone)]
pub enum EmbeddingServiceError {
    InvalidCredential(String),
    MissingCredential,
    InvalidSettings(String),
    RemovalNotConfirmed,
    ConsentRequired,
    ProviderNetwork(String),
    ProviderResponse(String),
    InvalidProviderOutput(String),
    Storage(String),
}

impl EmbeddingServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidCredential(_) => "invalid_embedding_credential",
            Self::MissingCredential => "embedding_credential_missing",
            Self::InvalidSettings(_) => "invalid_embedding_settings",
            Self::RemovalNotConfirmed => "embedding_removal_not_confirmed",
            Self::ConsentRequired => "embedding_remote_consent_required",
            Self::ProviderNetwork(_) => "embedding_provider_network_error",
            Self::ProviderResponse(_) => "embedding_provider_response_error",
            Self::InvalidProviderOutput(_) => "embedding_provider_output_error",
            Self::Storage(_) => "embedding_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidCredential(message)
            | Self::InvalidSettings(message)
            | Self::InvalidProviderOutput(message) => message.clone(),
            Self::MissingCredential => "还没有保存独立的 Embedding API Key。".to_string(),
            Self::RemovalNotConfirmed => "移除 Embedding 凭据需要显式确认。".to_string(),
            Self::ConsentRequired => {
                "请先明确允许向所配置的远程 Provider 发送笔记正文。".to_string()
            }
            Self::ProviderNetwork(_) => {
                "Embedding Provider 暂时无法连接，请检查网络、代理和服务地址。".to_string()
            }
            Self::ProviderResponse(message) => message.clone(),
            Self::Storage(_) => "本地语义索引设置暂时不可用，请稍后重试。".to_string(),
        }
    }

    fn storage(error: impl fmt::Display) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct EmbeddingService {
    app: AppHandle,
}

impl EmbeddingService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn settings_state(&self) -> Result<EmbeddingSettingsState, EmbeddingServiceError> {
        let (_stronghold, client) = self.open_client()?;
        let store = client.store();
        let has_credential = store
            .get(API_KEY_RECORD)
            .map_err(EmbeddingServiceError::storage)?
            .is_some();
        let provider = read_settings(
            store
                .get(SETTINGS_RECORD)
                .map_err(EmbeddingServiceError::storage)?,
        );
        Ok(EmbeddingSettingsState {
            credential: EmbeddingCredentialState { has_credential },
            provider,
        })
    }

    pub fn save_settings(
        &self,
        request: SaveEmbeddingSettingsRequest,
    ) -> Result<EmbeddingSettingsState, EmbeddingServiceError> {
        let settings = normalize_settings(&request)?;
        let api_key = request
            .api_key
            .as_deref()
            .map(validate_api_key)
            .transpose()?;
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        if let Some(api_key) = api_key {
            store
                .insert(API_KEY_RECORD.to_vec(), api_key.into_bytes(), None)
                .map_err(EmbeddingServiceError::storage)?;
        } else if store
            .get(API_KEY_RECORD)
            .map_err(EmbeddingServiceError::storage)?
            .is_none()
        {
            return Err(EmbeddingServiceError::MissingCredential);
        }
        store
            .insert(
                SETTINGS_RECORD.to_vec(),
                serde_json::to_vec(&settings).map_err(EmbeddingServiceError::storage)?,
                None,
            )
            .map_err(EmbeddingServiceError::storage)?;
        stronghold.save().map_err(EmbeddingServiceError::storage)?;
        Ok(EmbeddingSettingsState {
            credential: EmbeddingCredentialState {
                has_credential: true,
            },
            provider: settings,
        })
    }

    pub fn remove_credential(
        &self,
        confirm: bool,
    ) -> Result<EmbeddingSettingsState, EmbeddingServiceError> {
        if !confirm {
            return Err(EmbeddingServiceError::RemovalNotConfirmed);
        }
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        store
            .delete(API_KEY_RECORD)
            .map_err(EmbeddingServiceError::storage)?;
        let mut provider = read_settings(
            store
                .get(SETTINGS_RECORD)
                .map_err(EmbeddingServiceError::storage)?,
        );
        provider.remote_note_embedding_enabled = false;
        provider.consent_confirmed_at = None;
        store
            .insert(
                SETTINGS_RECORD.to_vec(),
                serde_json::to_vec(&provider).map_err(EmbeddingServiceError::storage)?,
                None,
            )
            .map_err(EmbeddingServiceError::storage)?;
        stronghold.save().map_err(EmbeddingServiceError::storage)?;
        Ok(EmbeddingSettingsState {
            credential: EmbeddingCredentialState {
                has_credential: false,
            },
            provider,
        })
    }

    pub fn read_api_key(&self) -> Result<String, EmbeddingServiceError> {
        let (_stronghold, client) = self.open_client()?;
        let store = client.store();
        let bytes = store
            .get(API_KEY_RECORD)
            .map_err(EmbeddingServiceError::storage)?
            .ok_or(EmbeddingServiceError::MissingCredential)?;
        String::from_utf8(bytes).map_err(EmbeddingServiceError::storage)
    }

    pub async fn test_connection(
        &self,
        api_key: Option<&str>,
        settings: Option<EmbeddingProviderSettings>,
    ) -> Result<EmbeddingConnectionProbe, EmbeddingServiceError> {
        let state = self.settings_state()?;
        let settings = settings.unwrap_or(state.provider);
        validate_provider_settings(&settings)?;
        let api_key = match api_key.map(str::trim).filter(|value| !value.is_empty()) {
            Some(value) => validate_api_key(value)?,
            None => self.read_api_key()?,
        };
        let result =
            request_embeddings(&api_key, &settings, &[CONNECTION_PROBE_TEXT.to_string()]).await?;
        let dimensions = result.vectors.first().map(Vec::len).unwrap_or_default();
        Ok(EmbeddingConnectionProbe {
            is_valid: true,
            model: result.model,
            dimensions,
            checked_at: current_unix_seconds(),
            message: format!("Embedding Provider 连接成功，向量维度为 {dimensions}。"),
        })
    }

    pub(crate) async fn embed_query(
        &self,
        expected_settings: &EmbeddingProviderSettings,
        query: &str,
    ) -> Result<Vec<f32>, EmbeddingServiceError> {
        let state = self.settings_state()?;
        if &state.provider != expected_settings {
            return Err(EmbeddingServiceError::InvalidSettings(
                "Embedding Provider 或模型设置已变化，请重新建立语义索引。".to_string(),
            ));
        }
        let query = query.trim();
        if query.is_empty() {
            return Err(EmbeddingServiceError::InvalidSettings(
                "Embedding 查询不能为空。".to_string(),
            ));
        }
        let api_key = self.read_api_key()?;
        let result = request_embeddings(&api_key, &state.provider, &[query.to_string()]).await?;
        result.vectors.into_iter().next().ok_or_else(|| {
            EmbeddingServiceError::InvalidProviderOutput(
                "Embedding Provider 未返回查询向量。".to_string(),
            )
        })
    }

    pub(crate) async fn embed_authorized_notes(
        &self,
        expected_settings: &EmbeddingProviderSettings,
        inputs: &[String],
    ) -> Result<RemoteEmbeddingBatch, EmbeddingServiceError> {
        let state = self.settings_state()?;
        require_remote_consent(&state.provider)?;
        if &state.provider != expected_settings {
            return Err(EmbeddingServiceError::InvalidSettings(
                "Embedding Provider、模型或授权在构建期间发生变化，请重新开始索引任务。"
                    .to_string(),
            ));
        }
        let api_key = self.read_api_key()?;
        request_embeddings(&api_key, &state.provider, inputs).await
    }

    fn open_client(&self) -> Result<(Stronghold, Client), EmbeddingServiceError> {
        let data_dir = self
            .app
            .path()
            .app_local_data_dir()
            .map_err(EmbeddingServiceError::storage)?;
        fs::create_dir_all(&data_dir).map_err(EmbeddingServiceError::storage)?;
        let vault_path = data_dir.join("embedding-credentials.hold");
        let salt_path = data_dir.join("stronghold-salt.txt");
        let vault_key = KeyDerivation::argon2(VAULT_PASSWORD, &salt_path);
        let stronghold =
            Stronghold::new(&vault_path, vault_key).map_err(EmbeddingServiceError::storage)?;
        let client = stronghold
            .load_client(CLIENT_PATH)
            .or_else(|_| stronghold.create_client(CLIENT_PATH))
            .map_err(EmbeddingServiceError::storage)?;
        Ok((stronghold, client))
    }
}

fn normalize_settings(
    request: &SaveEmbeddingSettingsRequest,
) -> Result<EmbeddingProviderSettings, EmbeddingServiceError> {
    let settings = EmbeddingProviderSettings {
        base_url: request.base_url.trim().to_string(),
        model: request.model.trim().to_string(),
        provider_label: request
            .provider_label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_PROVIDER_LABEL)
            .to_string(),
        batch_size: request.batch_size.unwrap_or(DEFAULT_BATCH_SIZE),
        remote_note_embedding_enabled: request.remote_note_embedding_enabled,
        consent_confirmed_at: request
            .remote_note_embedding_enabled
            .then(|| {
                request
                    .consent_confirmed_at
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .flatten(),
    };
    validate_provider_settings(&settings)?;
    if settings.remote_note_embedding_enabled && settings.consent_confirmed_at.is_none() {
        return Err(EmbeddingServiceError::ConsentRequired);
    }
    Ok(settings)
}

fn validate_provider_settings(
    settings: &EmbeddingProviderSettings,
) -> Result<(), EmbeddingServiceError> {
    embeddings_url(&settings.base_url)?;
    if settings.model.trim().is_empty() {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding 模型不能为空。".to_string(),
        ));
    }
    if settings.provider_label.trim().is_empty() {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding Provider 名称不能为空。".to_string(),
        ));
    }
    if !(1..=MAX_BATCH_SIZE).contains(&settings.batch_size) {
        return Err(EmbeddingServiceError::InvalidSettings(format!(
            "Embedding 批量大小必须在 1 到 {MAX_BATCH_SIZE} 之间。"
        )));
    }
    Ok(())
}

fn require_remote_consent(
    settings: &EmbeddingProviderSettings,
) -> Result<(), EmbeddingServiceError> {
    if !settings.remote_note_embedding_enabled || settings.consent_confirmed_at.is_none() {
        return Err(EmbeddingServiceError::ConsentRequired);
    }
    Ok(())
}

fn validate_api_key(value: &str) -> Result<String, EmbeddingServiceError> {
    let trimmed = value.trim();
    if trimmed.len() < 8 {
        return Err(EmbeddingServiceError::InvalidCredential(
            "Embedding API Key 长度过短。".to_string(),
        ));
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err(EmbeddingServiceError::InvalidCredential(
            "Embedding API Key 不能包含空白字符。".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn embeddings_url(base_url: &str) -> Result<Url, EmbeddingServiceError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let mut url = Url::parse(trimmed).map_err(|_| {
        EmbeddingServiceError::InvalidSettings("Embedding Base URL 格式无效。".to_string())
    })?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding Base URL 必须是有效的 HTTP(S) 地址。".to_string(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding Base URL 不能包含凭据或查询参数。".to_string(),
        ));
    }
    let path = url.path().trim_end_matches('/');
    let next_path = if path.ends_with("/embeddings") {
        path.to_string()
    } else if path.ends_with("/v1") {
        format!("{path}/embeddings")
    } else if path.is_empty() || path == "/" {
        "/v1/embeddings".to_string()
    } else {
        format!("{path}/v1/embeddings")
    };
    url.set_path(&next_path);
    url.set_fragment(None);
    Ok(url)
}

pub(crate) async fn request_embeddings(
    api_key: &str,
    settings: &EmbeddingProviderSettings,
    inputs: &[String],
) -> Result<RemoteEmbeddingBatch, EmbeddingServiceError> {
    validate_provider_settings(settings)?;
    validate_embedding_inputs(inputs, settings.batch_size)?;
    let api_key = validate_api_key(api_key)?;
    let response = HttpClient::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| EmbeddingServiceError::ProviderNetwork(error.to_string()))?
        .post(embeddings_url(&settings.base_url)?)
        .bearer_auth(api_key)
        .json(&json!({ "model": settings.model, "input": inputs }))
        .send()
        .await
        .map_err(|error| EmbeddingServiceError::ProviderNetwork(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(provider_status_error(status, ""));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(EmbeddingServiceError::InvalidProviderOutput(
            "Embedding Provider 返回数据过大。".to_string(),
        ));
    }
    let body = response
        .bytes()
        .await
        .map_err(|error| EmbeddingServiceError::ProviderNetwork(error.to_string()))?;
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(EmbeddingServiceError::InvalidProviderOutput(
            "Embedding Provider 返回数据过大。".to_string(),
        ));
    }
    let body = std::str::from_utf8(&body).map_err(|_| {
        EmbeddingServiceError::InvalidProviderOutput(
            "Embedding Provider 返回了非 UTF-8 响应。".to_string(),
        )
    })?;
    parse_embedding_response(body, inputs.len(), &settings.model)
}

fn validate_embedding_inputs(
    inputs: &[String],
    batch_size: usize,
) -> Result<(), EmbeddingServiceError> {
    if inputs.is_empty() {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding 输入不能为空。".to_string(),
        ));
    }
    if inputs.len() > batch_size || inputs.len() > MAX_BATCH_SIZE {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding 输入超过当前批量大小。".to_string(),
        ));
    }
    if inputs.iter().any(|input| input.trim().is_empty()) {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding 输入不能包含空正文。".to_string(),
        ));
    }
    let total_chars = inputs
        .iter()
        .map(|input| input.chars().count())
        .sum::<usize>();
    if total_chars > MAX_BATCH_CHARACTERS {
        return Err(EmbeddingServiceError::InvalidSettings(
            "Embedding 单批正文过长，请减小批量大小。".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    model: Option<String>,
    data: Vec<EmbeddingResponseItem>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponseItem {
    index: usize,
    embedding: Vec<f32>,
}

pub(crate) fn parse_embedding_response(
    body: &str,
    expected_count: usize,
    configured_model: &str,
) -> Result<RemoteEmbeddingBatch, EmbeddingServiceError> {
    let response = serde_json::from_str::<EmbeddingResponse>(body).map_err(|_| {
        EmbeddingServiceError::InvalidProviderOutput(
            "Embedding Provider 返回了无法解析的响应。".to_string(),
        )
    })?;
    if response.data.len() != expected_count {
        return Err(EmbeddingServiceError::InvalidProviderOutput(format!(
            "Embedding 返回数量不一致：期望 {expected_count}，实际 {}。",
            response.data.len()
        )));
    }
    let mut ordered = vec![None; expected_count];
    for item in response.data {
        if item.index >= expected_count || ordered[item.index].is_some() {
            return Err(EmbeddingServiceError::InvalidProviderOutput(
                "Embedding 响应包含无效或重复索引。".to_string(),
            ));
        }
        if item.embedding.is_empty()
            || item.embedding.iter().any(|value| !value.is_finite())
            || item.embedding.iter().all(|value| *value == 0.0)
        {
            return Err(EmbeddingServiceError::InvalidProviderOutput(
                "Embedding 响应包含空向量、零向量或非有限数值。".to_string(),
            ));
        }
        ordered[item.index] = Some(item.embedding);
    }
    let vectors = ordered
        .into_iter()
        .map(|vector| {
            vector.ok_or_else(|| {
                EmbeddingServiceError::InvalidProviderOutput("Embedding 响应缺少索引。".to_string())
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let dimensions = vectors.first().map(Vec::len).unwrap_or_default();
    if dimensions == 0
        || dimensions > MAX_VECTOR_DIMENSIONS
        || vectors.iter().any(|vector| vector.len() != dimensions)
    {
        return Err(EmbeddingServiceError::InvalidProviderOutput(
            "Embedding 响应向量维度无效或不一致。".to_string(),
        ));
    }
    Ok(RemoteEmbeddingBatch {
        model: response
            .model
            .filter(|model| !model.trim().is_empty())
            .unwrap_or_else(|| configured_model.to_string()),
        vectors,
    })
}

fn provider_status_error(status: StatusCode, _body: &str) -> EmbeddingServiceError {
    let message = if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        "Embedding Provider 拒绝了凭据，请检查独立的 Embedding API Key。".to_string()
    } else if status == StatusCode::NOT_FOUND {
        "Embedding 接口或模型不存在，请检查 Base URL 和模型名。".to_string()
    } else if status == StatusCode::TOO_MANY_REQUESTS {
        "Embedding Provider 请求过于频繁，请稍后继续构建。".to_string()
    } else if status.is_server_error() {
        "Embedding Provider 服务暂时不可用，请稍后继续构建。".to_string()
    } else {
        format!("Embedding Provider 返回 HTTP {}。", status.as_u16())
    };
    EmbeddingServiceError::ProviderResponse(message)
}

fn read_settings(bytes: Option<Vec<u8>>) -> EmbeddingProviderSettings {
    bytes
        .and_then(|bytes| serde_json::from_slice::<EmbeddingProviderSettings>(&bytes).ok())
        .unwrap_or_default()
}

fn current_unix_seconds() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        thread,
        time::Duration,
    };

    use super::{
        embeddings_url, normalize_settings, parse_embedding_response, provider_status_error,
        request_embeddings, require_remote_consent, EmbeddingProviderSettings,
        EmbeddingServiceError, SaveEmbeddingSettingsRequest,
    };

    fn request(enabled: bool, consent: Option<&str>) -> SaveEmbeddingSettingsRequest {
        SaveEmbeddingSettingsRequest {
            api_key: Some("embedding-test-key".to_string()),
            base_url: "https://api.example.com/v1".to_string(),
            model: "embed-v1".to_string(),
            provider_label: Some("Example".to_string()),
            batch_size: Some(16),
            remote_note_embedding_enabled: enabled,
            consent_confirmed_at: consent.map(str::to_string),
        }
    }

    fn read_http_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("read timeout should configure");
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 1024];
        let mut expected_length = None;
        loop {
            let read = stream.read(&mut buffer).expect("request should read");
            assert!(read > 0, "request closed before body completed");
            bytes.extend_from_slice(&buffer[..read]);
            if expected_length.is_none() {
                if let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    let headers = String::from_utf8_lossy(&bytes[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.split_once(':').and_then(|(name, value)| {
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())
                                    .flatten()
                            })
                        })
                        .expect("content length should exist");
                    expected_length = Some((header_end + 4, content_length));
                }
            }
            if let Some((body_start, body_length)) = expected_length {
                if bytes.len() >= body_start + body_length {
                    break;
                }
            }
        }
        String::from_utf8(bytes).expect("request should be utf-8")
    }

    #[test]
    fn embedding_url_normalizes_compatible_endpoints() {
        assert_eq!(
            embeddings_url("https://api.example.com/v1")
                .unwrap()
                .as_str(),
            "https://api.example.com/v1/embeddings"
        );
        assert_eq!(
            embeddings_url("https://api.example.com/embeddings")
                .unwrap()
                .as_str(),
            "https://api.example.com/embeddings"
        );
        assert_eq!(
            embeddings_url("https://gateway.example.com/openai")
                .unwrap()
                .as_str(),
            "https://gateway.example.com/openai/v1/embeddings"
        );
        assert!(embeddings_url("file:///tmp/provider").is_err());
        assert!(embeddings_url("https://user:secret@example.com/v1").is_err());
    }

    #[test]
    fn remote_note_consent_is_independent_and_explicit() {
        let disabled = normalize_settings(&request(false, Some("old-consent"))).unwrap();
        assert!(disabled.consent_confirmed_at.is_none());
        assert!(matches!(
            require_remote_consent(&disabled),
            Err(EmbeddingServiceError::ConsentRequired)
        ));
        assert!(matches!(
            normalize_settings(&request(true, None)),
            Err(EmbeddingServiceError::ConsentRequired)
        ));
        let enabled = normalize_settings(&request(true, Some("100"))).unwrap();
        assert!(require_remote_consent(&enabled).is_ok());
    }

    #[test]
    fn embedding_response_is_reordered_and_dimension_checked() {
        let response = parse_embedding_response(
            r#"{"model":"embed-v1","data":[{"index":1,"embedding":[0.0,1.0]},{"index":0,"embedding":[1.0,0.0]}]}"#,
            2,
            "configured",
        )
        .unwrap();
        assert_eq!(response.model, "embed-v1");
        assert_eq!(response.vectors, vec![vec![1.0, 0.0], vec![0.0, 1.0]]);

        assert!(parse_embedding_response(
            r#"{"data":[{"index":0,"embedding":[1.0]},{"index":1,"embedding":[0.0,1.0]}]}"#,
            2,
            "configured",
        )
        .is_err());
        assert!(parse_embedding_response(
            r#"{"data":[{"index":0,"embedding":[1.0]},{"index":0,"embedding":[1.0]}]}"#,
            2,
            "configured",
        )
        .is_err());
        assert!(parse_embedding_response(
            r#"{"data":[{"index":0,"embedding":[0.0,0.0]}]}"#,
            1,
            "configured",
        )
        .is_err());
    }

    #[tokio::test]
    async fn remote_embedding_request_sends_compatible_contract_and_reorders_output() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("mock server should bind");
        let address = listener.local_addr().expect("mock address should exist");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("mock request should arrive");
            let request = read_http_request(&mut stream);
            let (headers, body) = request
                .split_once("\r\n\r\n")
                .expect("request should contain headers");
            assert!(headers.starts_with("POST /v1/embeddings HTTP/1.1"));
            assert!(headers
                .lines()
                .any(|line| line.eq_ignore_ascii_case("authorization: Bearer embedding-test-key")));
            assert!(headers.lines().any(|line| {
                line.to_ascii_lowercase()
                    .starts_with("content-type: application/json")
            }));
            let payload: serde_json::Value =
                serde_json::from_str(body).expect("request body should be json");
            assert_eq!(payload["model"], "embed-v1");
            assert_eq!(payload["input"], serde_json::json!(["第一条", "第二条"]));

            let response_body = r#"{"model":"embed-v1","data":[{"index":1,"embedding":[0.0,1.0]},{"index":0,"embedding":[1.0,0.0]}]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .expect("mock response should write");
        });
        let settings = EmbeddingProviderSettings {
            base_url: format!("http://{address}/v1"),
            model: "embed-v1".to_string(),
            provider_label: "Mock".to_string(),
            batch_size: 2,
            remote_note_embedding_enabled: true,
            consent_confirmed_at: Some("100".to_string()),
        };
        let result = request_embeddings(
            "embedding-test-key",
            &settings,
            &["第一条".to_string(), "第二条".to_string()],
        )
        .await
        .expect("remote request should succeed");
        server.join().expect("mock server should finish");

        assert_eq!(result.model, "embed-v1");
        assert_eq!(result.vectors, vec![vec![1.0, 0.0], vec![0.0, 1.0]]);
    }

    #[test]
    fn provider_error_messages_do_not_echo_arbitrary_bodies() {
        let error = provider_status_error(
            reqwest::StatusCode::UNAUTHORIZED,
            r#"{"error":{"message":"secret provider detail"}}"#,
        );
        assert_eq!(error.code(), "embedding_provider_response_error");
        assert!(!error.user_message().contains("secret provider detail"));

        let generic = provider_status_error(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error":{"message":"provider echoed private note text"}}"#,
        );
        assert_eq!(generic.user_message(), "Embedding Provider 返回 HTTP 400。");
        assert!(!generic.user_message().contains("private note text"));
    }

    #[test]
    fn default_settings_do_not_authorize_remote_notes() {
        let settings = EmbeddingProviderSettings::default();
        assert!(!settings.remote_note_embedding_enabled);
        assert!(settings.consent_confirmed_at.is_none());
    }
}
