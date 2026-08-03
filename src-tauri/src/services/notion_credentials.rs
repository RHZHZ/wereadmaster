use std::{
    fmt, fs,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    export::notion::notion_client,
    platform::stronghold::{kdf::KeyDerivation, stronghold::Stronghold, Client},
};

const CLIENT_PATH: &[u8] = b"notion-export-credentials";
const API_TOKEN_RECORD: &[u8] = b"notion-api-token";
const METADATA_RECORD: &[u8] = b"notion-credential-metadata";
const VAULT_PASSWORD: &str = "wxreadmaster-local-notion-credential-v1";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotionCredentialStatus {
    pub has_credential: bool,
    pub last_validated_at: Option<String>,
    pub last_validation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CredentialMetadata {
    last_validated_at: Option<String>,
    last_validation_error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum NotionCredentialError {
    InvalidCredential(String),
    MissingCredential,
    RemovalNotConfirmed,
    Network(String),
    Storage(String),
}

impl NotionCredentialError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidCredential(_) => "invalid_notion_credential",
            Self::MissingCredential => "notion_credential_missing",
            Self::RemovalNotConfirmed => "removal_not_confirmed",
            Self::Network(_) => "notion_credential_network_error",
            Self::Storage(_) => "notion_credential_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidCredential(message) => message.clone(),
            Self::MissingCredential => "还没有保存 Notion Integration Token。".to_string(),
            Self::RemovalNotConfirmed => "移除 Notion 凭据需要显式确认。".to_string(),
            Self::Network(_) => {
                "无法连接 Notion API，请检查网络、系统代理或 VPN 后重试。".to_string()
            }
            Self::Storage(_) => "Notion 凭据存储暂时不可用，请稍后重试。".to_string(),
        }
    }

    fn storage(error: impl fmt::Display) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct NotionCredentialService {
    app: AppHandle,
}

impl NotionCredentialService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn credential_status(&self) -> Result<NotionCredentialStatus, NotionCredentialError> {
        let (_stronghold, client) = self.open_client()?;
        let store = client.store();
        let has_credential = store
            .get(API_TOKEN_RECORD)
            .map_err(NotionCredentialError::storage)?
            .is_some();
        let metadata = store
            .get(METADATA_RECORD)
            .map_err(NotionCredentialError::storage)?
            .and_then(|bytes| serde_json::from_slice::<CredentialMetadata>(&bytes).ok())
            .unwrap_or_default();
        Ok(NotionCredentialStatus {
            has_credential,
            last_validated_at: metadata.last_validated_at,
            last_validation_error: metadata.last_validation_error,
        })
    }

    pub fn save_credential(
        &self,
        token: &str,
    ) -> Result<NotionCredentialStatus, NotionCredentialError> {
        let token = token.trim();
        if !is_valid_token_input(token) {
            return Err(NotionCredentialError::InvalidCredential(
                "Notion Token 格式不正确。".to_string(),
            ));
        }
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        store
            .insert(API_TOKEN_RECORD.to_vec(), token.as_bytes().to_vec(), None)
            .map_err(NotionCredentialError::storage)?;
        let metadata = CredentialMetadata {
            last_validated_at: Some(current_unix_seconds()),
            last_validation_error: None,
        };
        store
            .insert(
                METADATA_RECORD.to_vec(),
                serde_json::to_vec(&metadata).map_err(NotionCredentialError::storage)?,
                None,
            )
            .map_err(NotionCredentialError::storage)?;
        stronghold.save().map_err(NotionCredentialError::storage)?;
        Ok(NotionCredentialStatus {
            has_credential: true,
            last_validated_at: metadata.last_validated_at,
            last_validation_error: None,
        })
    }

    pub fn remove_credential(
        &self,
        confirm: bool,
    ) -> Result<NotionCredentialStatus, NotionCredentialError> {
        if !confirm {
            return Err(NotionCredentialError::RemovalNotConfirmed);
        }
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        store
            .delete(API_TOKEN_RECORD)
            .map_err(NotionCredentialError::storage)?;
        store
            .delete(METADATA_RECORD)
            .map_err(NotionCredentialError::storage)?;
        stronghold.save().map_err(NotionCredentialError::storage)?;
        Ok(NotionCredentialStatus::default())
    }

    /// 用已保存的 Token 调用 Notion `/v1/users/me` 做真实校验，
    /// 并把校验时间与结果写入凭据元数据。
    pub async fn validate_credential(
        &self,
    ) -> Result<NotionCredentialStatus, NotionCredentialError> {
        let token = self.read_token()?;
        let response = notion_client()
            .map_err(NotionCredentialError::Network)?
            .get("https://api.notion.com/v1/users/me")
            .bearer_auth(&token)
            .header("Notion-Version", "2022-06-28")
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|error| NotionCredentialError::Network(error.to_string()))?;
        let status = response.status();
        if status.is_success() {
            self.write_validation_metadata(None)?;
            return self.credential_status();
        }

        let message = if status == reqwest::StatusCode::UNAUTHORIZED {
            "Notion Token 无效或已失效。".to_string()
        } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            "Notion API 请求过于频繁，请稍后再试。".to_string()
        } else {
            format!("Notion 校验失败：HTTP {status}。")
        };
        self.write_validation_metadata(Some(message.clone()))?;
        Err(NotionCredentialError::InvalidCredential(message))
    }

    fn write_validation_metadata(
        &self,
        last_validation_error: Option<String>,
    ) -> Result<(), NotionCredentialError> {
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        let metadata = CredentialMetadata {
            last_validated_at: Some(current_unix_seconds()),
            last_validation_error,
        };
        store
            .insert(
                METADATA_RECORD.to_vec(),
                serde_json::to_vec(&metadata).map_err(NotionCredentialError::storage)?,
                None,
            )
            .map_err(NotionCredentialError::storage)?;
        stronghold.save().map_err(NotionCredentialError::storage)?;
        Ok(())
    }

    pub(crate) fn read_token(&self) -> Result<String, NotionCredentialError> {
        let (_stronghold, client) = self.open_client()?;
        client
            .store()
            .get(API_TOKEN_RECORD)
            .map_err(NotionCredentialError::storage)?
            .ok_or(NotionCredentialError::MissingCredential)
            .and_then(|bytes| String::from_utf8(bytes).map_err(NotionCredentialError::storage))
    }

    fn open_client(&self) -> Result<(Stronghold, Client), NotionCredentialError> {
        let data_dir = self
            .app
            .path()
            .app_local_data_dir()
            .map_err(NotionCredentialError::storage)?;
        fs::create_dir_all(&data_dir).map_err(NotionCredentialError::storage)?;
        let vault_path = data_dir.join("notion-credentials.hold");
        let salt_path = data_dir.join("stronghold-notion-salt.txt");
        let stronghold = Stronghold::new(
            &vault_path,
            KeyDerivation::argon2(VAULT_PASSWORD, &salt_path),
        )
        .map_err(NotionCredentialError::storage)?;
        let client = stronghold
            .load_client(CLIENT_PATH)
            .or_else(|_| stronghold.create_client(CLIENT_PATH))
            .map_err(NotionCredentialError::storage)?;
        Ok((stronghold, client))
    }
}

fn current_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn is_valid_token_input(token: &str) -> bool {
    token.len() >= 20 && !token.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::{is_valid_token_input, NotionCredentialError};

    #[test]
    fn notion_credential_network_error_mentions_proxy_and_vpn() {
        let error = NotionCredentialError::Network("connection refused".to_string());
        assert_eq!(
            error.user_message(),
            "无法连接 Notion API，请检查网络、系统代理或 VPN 后重试。"
        );
    }

    #[test]
    fn notion_token_validation_rejects_short_values() {
        assert!(!is_valid_token_input("short"));
        assert!(!is_valid_token_input("secret with spaces 123456789"));
        assert!(is_valid_token_input("secret_1234567890abcdef"));
    }
}
