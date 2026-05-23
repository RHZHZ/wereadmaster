use serde::Serialize;
use tauri::AppHandle;

use crate::services::credentials::{
    CredentialService, CredentialServiceError, CredentialStatus, CredentialValidationResult,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialCommandError {
    code: String,
    message: String,
}

impl From<CredentialServiceError> for CredentialCommandError {
    fn from(error: CredentialServiceError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
        }
    }
}

#[tauri::command]
pub fn get_credential_status(app: AppHandle) -> Result<CredentialStatus, CredentialCommandError> {
    CredentialService::new(app)
        .credential_status()
        .map_err(Into::into)
}

#[tauri::command]
pub fn validate_credential(api_key: String) -> CredentialValidationResult {
    CredentialService::validate_api_key_input(&api_key)
}

#[tauri::command]
pub fn save_credential(
    app: AppHandle,
    api_key: String,
) -> Result<CredentialStatus, CredentialCommandError> {
    CredentialService::new(app)
        .save_credential(&api_key)
        .map_err(Into::into)
}

#[tauri::command]
pub fn remove_credential(
    app: AppHandle,
    confirm: bool,
) -> Result<CredentialStatus, CredentialCommandError> {
    CredentialService::new(app)
        .remove_credential(confirm)
        .map_err(Into::into)
}
