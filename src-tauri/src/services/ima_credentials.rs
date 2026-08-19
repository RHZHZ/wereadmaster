use std::{
    fmt, fs,
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::platform::stronghold::{kdf::KeyDerivation, stronghold::Stronghold, Client};

const CLIENT_PATH: &[u8] = b"ima-export-credentials";
const CLIENT_ID_RECORD: &[u8] = b"ima-client-id";
const API_KEY_RECORD: &[u8] = b"ima-api-key";
const METADATA_RECORD: &[u8] = b"ima-credential-metadata";
const VAULT_PASSWORD: &str = "wxreadmaster-local-ima-credential-v1";
const CREDENTIAL_MUTATION_ACTIVE: usize = usize::MAX;
static IMA_CREDENTIAL_ACTIVITY: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImaCredentialStatus {
    pub has_credential: bool,
    pub last_validated_at: Option<String>,
    pub last_validation_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ImaCredentials {
    pub client_id: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CredentialMetadata {
    last_validated_at: Option<String>,
    last_validation_error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ImaCredentialError {
    InvalidCredential(String),
    MissingCredential,
    RemovalNotConfirmed,
    Busy,
    Storage(String),
}

impl ImaCredentialError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidCredential(_) => "invalid_ima_credential",
            Self::MissingCredential => "ima_credential_missing",
            Self::RemovalNotConfirmed => "removal_not_confirmed",
            Self::Busy => "IMA_CREDENTIAL_BUSY",
            Self::Storage(_) => "ima_credential_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidCredential(message) => message.clone(),
            Self::MissingCredential => "还没有保存 Ima Client ID 和 API Key。".to_string(),
            Self::RemovalNotConfirmed => "移除 Ima 凭据需要显式确认。".to_string(),
            Self::Busy => "Ima 正在写入，暂不能更换或移除凭据。".to_string(),
            Self::Storage(_) => "Ima 凭据存储暂时不可用，请稍后重试。".to_string(),
        }
    }

    fn storage(error: impl fmt::Display) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct ImaCredentialActivityGuard {
    mutation: bool,
}

impl Drop for ImaCredentialActivityGuard {
    fn drop(&mut self) {
        if self.mutation {
            IMA_CREDENTIAL_ACTIVITY.store(0, Ordering::Release);
        } else {
            IMA_CREDENTIAL_ACTIVITY.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

pub(crate) fn try_begin_ima_write() -> Result<ImaCredentialActivityGuard, ImaCredentialError> {
    loop {
        let active = IMA_CREDENTIAL_ACTIVITY.load(Ordering::Acquire);
        if active == CREDENTIAL_MUTATION_ACTIVE {
            return Err(ImaCredentialError::Busy);
        }
        if IMA_CREDENTIAL_ACTIVITY
            .compare_exchange_weak(active, active + 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return Ok(ImaCredentialActivityGuard { mutation: false });
        }
    }
}

pub(crate) fn try_begin_ima_credential_mutation(
) -> Result<ImaCredentialActivityGuard, ImaCredentialError> {
    IMA_CREDENTIAL_ACTIVITY
        .compare_exchange(
            0,
            CREDENTIAL_MUTATION_ACTIVE,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .map(|_| ImaCredentialActivityGuard { mutation: true })
        .map_err(|_| ImaCredentialError::Busy)
}

pub struct ImaCredentialService {
    app: AppHandle,
}

impl ImaCredentialService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn credential_status(&self) -> Result<ImaCredentialStatus, ImaCredentialError> {
        let (_stronghold, client) = self.open_client()?;
        let store = client.store();
        let has_client_id = store
            .get(CLIENT_ID_RECORD)
            .map_err(ImaCredentialError::storage)?
            .is_some();
        let has_api_key = store
            .get(API_KEY_RECORD)
            .map_err(ImaCredentialError::storage)?
            .is_some();
        let metadata = store
            .get(METADATA_RECORD)
            .map_err(ImaCredentialError::storage)?
            .and_then(|bytes| serde_json::from_slice::<CredentialMetadata>(&bytes).ok())
            .unwrap_or_default();
        Ok(ImaCredentialStatus {
            has_credential: has_client_id && has_api_key,
            last_validated_at: metadata.last_validated_at,
            last_validation_error: metadata.last_validation_error,
        })
    }

    pub fn save_credential(
        &self,
        client_id: &str,
        api_key: &str,
    ) -> Result<ImaCredentialStatus, ImaCredentialError> {
        let client_id = normalize_credential(client_id, "Ima Client ID")?;
        let api_key = normalize_credential(api_key, "Ima API Key")?;
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        store
            .insert(CLIENT_ID_RECORD.to_vec(), client_id.into_bytes(), None)
            .map_err(ImaCredentialError::storage)?;
        store
            .insert(API_KEY_RECORD.to_vec(), api_key.into_bytes(), None)
            .map_err(ImaCredentialError::storage)?;
        store
            .delete(METADATA_RECORD)
            .map_err(ImaCredentialError::storage)?;
        stronghold.save().map_err(ImaCredentialError::storage)?;
        Ok(ImaCredentialStatus {
            has_credential: true,
            ..ImaCredentialStatus::default()
        })
    }

    pub fn remove_credential(
        &self,
        confirm: bool,
    ) -> Result<ImaCredentialStatus, ImaCredentialError> {
        if !confirm {
            return Err(ImaCredentialError::RemovalNotConfirmed);
        }
        let (stronghold, client) = self.open_client()?;
        let store = client.store();
        store
            .delete(CLIENT_ID_RECORD)
            .map_err(ImaCredentialError::storage)?;
        store
            .delete(API_KEY_RECORD)
            .map_err(ImaCredentialError::storage)?;
        store
            .delete(METADATA_RECORD)
            .map_err(ImaCredentialError::storage)?;
        stronghold.save().map_err(ImaCredentialError::storage)?;
        Ok(ImaCredentialStatus::default())
    }

    pub(crate) fn read_credentials(&self) -> Result<ImaCredentials, ImaCredentialError> {
        let (_stronghold, client) = self.open_client()?;
        let store = client.store();
        let client_id = store
            .get(CLIENT_ID_RECORD)
            .map_err(ImaCredentialError::storage)?
            .ok_or(ImaCredentialError::MissingCredential)
            .and_then(|bytes| String::from_utf8(bytes).map_err(ImaCredentialError::storage))?;
        let api_key = store
            .get(API_KEY_RECORD)
            .map_err(ImaCredentialError::storage)?
            .ok_or(ImaCredentialError::MissingCredential)
            .and_then(|bytes| String::from_utf8(bytes).map_err(ImaCredentialError::storage))?;
        Ok(ImaCredentials { client_id, api_key })
    }

    pub(crate) fn write_validation_metadata(
        &self,
        last_validation_error: Option<String>,
    ) -> Result<(), ImaCredentialError> {
        let (stronghold, client) = self.open_client()?;
        let metadata = CredentialMetadata {
            last_validated_at: Some(current_unix_seconds()),
            last_validation_error,
        };
        client
            .store()
            .insert(
                METADATA_RECORD.to_vec(),
                serde_json::to_vec(&metadata).map_err(ImaCredentialError::storage)?,
                None,
            )
            .map_err(ImaCredentialError::storage)?;
        stronghold.save().map_err(ImaCredentialError::storage)
    }

    fn open_client(&self) -> Result<(Stronghold, Client), ImaCredentialError> {
        let data_dir = self
            .app
            .path()
            .app_local_data_dir()
            .map_err(ImaCredentialError::storage)?;
        fs::create_dir_all(&data_dir).map_err(ImaCredentialError::storage)?;
        let vault_path = data_dir.join("ima-credentials.hold");
        let salt_path = data_dir.join("stronghold-ima-salt.txt");
        let stronghold = Stronghold::new(
            &vault_path,
            KeyDerivation::argon2(VAULT_PASSWORD, &salt_path),
        )
        .map_err(ImaCredentialError::storage)?;
        let client = stronghold
            .load_client(CLIENT_PATH)
            .or_else(|_| stronghold.create_client(CLIENT_PATH))
            .map_err(ImaCredentialError::storage)?;
        Ok((stronghold, client))
    }
}

fn normalize_credential(value: &str, label: &str) -> Result<String, ImaCredentialError> {
    let value = value.trim();
    if value.len() < 8 || value.chars().any(char::is_whitespace) {
        return Err(ImaCredentialError::InvalidCredential(format!(
            "{label} 格式不正确。"
        )));
    }
    Ok(value.to_string())
}

fn current_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::{normalize_credential, try_begin_ima_credential_mutation, try_begin_ima_write};

    #[test]
    fn rejects_blank_or_whitespace_credentials() {
        assert!(normalize_credential("short", "Client ID").is_err());
        assert!(normalize_credential("client id value", "Client ID").is_err());
        assert!(normalize_credential("client_id_123", "Client ID").is_ok());
    }

    #[test]
    fn credential_mutation_and_writes_are_mutually_exclusive() {
        let write = try_begin_ima_write().expect("write lease should start");
        assert!(try_begin_ima_credential_mutation().is_err());
        let second_write = try_begin_ima_write().expect("parallel write lease should start");
        drop(second_write);
        drop(write);

        let mutation =
            try_begin_ima_credential_mutation().expect("mutation lease should start when idle");
        assert!(try_begin_ima_write().is_err());
        assert!(try_begin_ima_credential_mutation().is_err());
        drop(mutation);
        assert!(try_begin_ima_write().is_ok());
    }
}
