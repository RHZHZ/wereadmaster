use std::{
    fmt, fs,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::platform::stronghold::{kdf::KeyDerivation, stronghold::Stronghold, Client};

const CLIENT_PATH: &[u8] = b"weread-credentials";
const API_KEY_RECORD: &[u8] = b"weread-api-key";
const METADATA_RECORD: &[u8] = b"weread-credential-metadata";
const VAULT_PASSWORD: &str = "wxreadmaster-local-credential-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub has_credential: bool,
    pub last_validated_at: Option<String>,
    pub last_validation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialValidationResult {
    pub is_valid: bool,
    pub checked_at: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CredentialMetadata {
    last_validated_at: Option<String>,
    last_validation_error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum CredentialServiceError {
    InvalidCredential(String),
    MissingCredential,
    RemovalNotConfirmed,
    Storage(String),
}

impl CredentialServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidCredential(_) => "invalid_credential",
            Self::MissingCredential => "credential_missing",
            Self::RemovalNotConfirmed => "removal_not_confirmed",
            Self::Storage(_) => "credential_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidCredential(message) => message.clone(),
            Self::MissingCredential => "还没有保存微信读书 API Key。".to_string(),
            Self::RemovalNotConfirmed => "移除凭据需要显式确认。".to_string(),
            Self::Storage(_) => "本地凭据存储暂时不可用，请稍后重试。".to_string(),
        }
    }

    fn storage(error: impl fmt::Display) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct CredentialService {
    app: AppHandle,
}

impl CredentialService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn credential_status(&self) -> Result<CredentialStatus, CredentialServiceError> {
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        let has_credential = store
            .get(API_KEY_RECORD)
            .map_err(CredentialServiceError::storage)?
            .is_some();
        let metadata = load_credential_metadata(
            store
                .get(METADATA_RECORD)
                .map_err(CredentialServiceError::storage)?,
        );

        drop(stronghold);

        Ok(CredentialStatus {
            has_credential,
            last_validated_at: metadata.last_validated_at,
            last_validation_error: metadata.last_validation_error,
        })
    }

    pub fn save_credential(
        &self,
        api_key: &str,
    ) -> Result<CredentialStatus, CredentialServiceError> {
        let validation = Self::validate_api_key_input(api_key);
        if !validation.is_valid {
            return Err(CredentialServiceError::InvalidCredential(
                validation
                    .message
                    .unwrap_or_else(|| "API Key 格式不正确。".to_string()),
            ));
        }

        let trimmed_key = api_key.trim();
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        store
            .insert(
                API_KEY_RECORD.to_vec(),
                trimmed_key.as_bytes().to_vec(),
                None,
            )
            .map_err(CredentialServiceError::storage)?;

        let metadata = CredentialMetadata {
            last_validated_at: Some(validation.checked_at),
            last_validation_error: None,
        };
        let metadata_bytes =
            serde_json::to_vec(&metadata).map_err(CredentialServiceError::storage)?;
        store
            .insert(METADATA_RECORD.to_vec(), metadata_bytes, None)
            .map_err(CredentialServiceError::storage)?;
        stronghold.save().map_err(CredentialServiceError::storage)?;

        Ok(CredentialStatus {
            has_credential: true,
            last_validated_at: metadata.last_validated_at,
            last_validation_error: metadata.last_validation_error,
        })
    }

    pub fn remove_credential(
        &self,
        confirm: bool,
    ) -> Result<CredentialStatus, CredentialServiceError> {
        if !confirm {
            return Err(CredentialServiceError::RemovalNotConfirmed);
        }

        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        store
            .delete(API_KEY_RECORD)
            .map_err(CredentialServiceError::storage)?;
        store
            .delete(METADATA_RECORD)
            .map_err(CredentialServiceError::storage)?;
        stronghold.save().map_err(CredentialServiceError::storage)?;

        Ok(CredentialStatus {
            has_credential: false,
            last_validated_at: None,
            last_validation_error: None,
        })
    }

    pub(crate) fn read_api_key(&self) -> Result<String, CredentialServiceError> {
        let (_stronghold, client) = self.open_client()?;
        let store = client.store();
        match store
            .get(API_KEY_RECORD)
            .map_err(CredentialServiceError::storage)?
        {
            Some(bytes) => String::from_utf8(bytes).map_err(CredentialServiceError::storage),
            None => Err(CredentialServiceError::MissingCredential),
        }
    }

    pub fn validate_api_key_input(api_key: &str) -> CredentialValidationResult {
        let checked_at = current_unix_seconds();
        let trimmed_key = api_key.trim();

        if trimmed_key.is_empty() {
            return CredentialValidationResult {
                is_valid: false,
                checked_at,
                message: Some("API Key 不能为空。".to_string()),
            };
        }

        if trimmed_key.len() < 16 {
            return CredentialValidationResult {
                is_valid: false,
                checked_at,
                message: Some("API Key 长度过短。".to_string()),
            };
        }

        if trimmed_key.chars().any(char::is_whitespace) {
            return CredentialValidationResult {
                is_valid: false,
                checked_at,
                message: Some("API Key 不能包含空白字符。".to_string()),
            };
        }

        CredentialValidationResult {
            is_valid: true,
            checked_at,
            message: None,
        }
    }

    fn open_client(&self) -> Result<(Stronghold, Client), CredentialServiceError> {
        let data_dir = self
            .app
            .path()
            .app_local_data_dir()
            .map_err(CredentialServiceError::storage)?;
        fs::create_dir_all(&data_dir).map_err(CredentialServiceError::storage)?;

        let vault_path = data_dir.join("weread-credentials.hold");
        let salt_path = data_dir.join("stronghold-salt.txt");
        let vault_key = KeyDerivation::argon2(VAULT_PASSWORD, &salt_path);
        let stronghold =
            Stronghold::new(&vault_path, vault_key).map_err(CredentialServiceError::storage)?;
        let client = stronghold
            .load_client(CLIENT_PATH)
            .or_else(|_| stronghold.create_client(CLIENT_PATH))
            .map_err(CredentialServiceError::storage)?;

        Ok((stronghold, client))
    }
}

fn current_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn load_credential_metadata(bytes: Option<Vec<u8>>) -> CredentialMetadata {
    bytes
        .and_then(|bytes| serde_json::from_slice::<CredentialMetadata>(&bytes).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::CredentialService;

    #[test]
    fn validate_api_key_rejects_empty_input() {
        let result = CredentialService::validate_api_key_input("   ");

        assert!(!result.is_valid);
        assert_eq!(result.message, Some("API Key 不能为空。".to_string()));
    }

    #[test]
    fn validate_api_key_rejects_short_input() {
        let result = CredentialService::validate_api_key_input("short-key");

        assert!(!result.is_valid);
        assert_eq!(result.message, Some("API Key 长度过短。".to_string()));
    }

    #[test]
    fn validate_api_key_rejects_embedded_whitespace() {
        let result = CredentialService::validate_api_key_input("sk-valid-looking key");

        assert!(!result.is_valid);
        assert_eq!(
            result.message,
            Some("API Key 不能包含空白字符。".to_string())
        );
    }

    #[test]
    fn validate_api_key_accepts_trimmed_secret_like_input() {
        let result = CredentialService::validate_api_key_input("  sk-1234567890abcdef  ");

        assert!(result.is_valid);
        assert_eq!(result.message, None);
    }
}
