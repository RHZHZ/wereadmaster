use serde::Serialize;
use tauri::AppHandle;

use crate::{
    db,
    export::ima_client::{
        ImaClient, ImaClientError, ImaKnowledgeBase, ImaKnowledgeList, ImaNoteFolder,
    },
    export::{
        ima::{self, ImaRemoteDriftReport, ImaUnknownResolution},
        targets::ExportTargetResult,
    },
    services::{
        ima_credentials::{
            try_begin_ima_credential_mutation, ImaCredentialError, ImaCredentialService,
            ImaCredentialStatus,
        },
        settings::{SettingsService, SettingsStateResponse},
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImaCommandError {
    code: String,
    message: String,
    detail: Option<String>,
}

impl From<ImaCredentialError> for ImaCommandError {
    fn from(error: ImaCredentialError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
            detail: None,
        }
    }
}

impl From<ImaClientError> for ImaCommandError {
    fn from(error: ImaClientError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            detail: error.detail,
        }
    }
}

#[tauri::command]
pub async fn get_ima_credential_status(
    app: AppHandle,
) -> Result<ImaCredentialStatus, ImaCommandError> {
    run_blocking(move || ImaCredentialService::new(app).credential_status()).await
}

#[tauri::command]
pub async fn save_ima_credential(
    app: AppHandle,
    client_id: String,
    api_key: String,
) -> Result<ImaCredentialStatus, ImaCommandError> {
    let activity = try_begin_ima_credential_mutation().map_err(ImaCommandError::from)?;
    run_blocking(move || {
        let _activity = activity;
        let status =
            ImaCredentialService::new(app.clone()).save_credential(&client_id, &api_key)?;
        let config_dir = db::default_data_dir(&app).map_err(ImaCredentialError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(ImaCredentialError::Storage)?;
        integration.ima_update_checked_date = None;
        integration.ima_update_checked_adapter_version = None;
        integration.ima_update_last_attempt_at = None;
        integration.ima_update_last_success_at = None;
        integration.ima_latest_version = None;
        integration.ima_release_desc = None;
        integration.ima_update_instruction = None;
        db::write_integration_config(&config_dir, &integration)
            .map_err(ImaCredentialError::Storage)?;
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn refresh_ima_adapter_compatibility(
    app: AppHandle,
) -> Result<SettingsStateResponse, ImaCommandError> {
    ImaClient::from_saved_credentials(app.clone())?
        .refresh_adapter_compatibility()
        .await?;
    SettingsService::new(app)
        .settings_state()
        .map_err(|error| ImaCommandError {
            code: error.code().to_string(),
            message: error.user_message(),
            detail: error.diagnostic_message(),
        })
}

#[tauri::command]
pub async fn remove_ima_credential(
    app: AppHandle,
    confirm: bool,
) -> Result<ImaCredentialStatus, ImaCommandError> {
    let activity = try_begin_ima_credential_mutation().map_err(ImaCommandError::from)?;
    run_blocking(move || {
        let _activity = activity;
        ImaCredentialService::new(app).remove_credential(confirm)
    })
    .await
}

#[tauri::command]
pub async fn validate_ima_credential(
    app: AppHandle,
) -> Result<ImaCredentialStatus, ImaCommandError> {
    let service = ImaCredentialService::new(app.clone());
    let client = ImaClient::from_saved_credentials(app).map_err(ImaCommandError::from)?;
    match client.list_addable_knowledge_bases().await {
        Ok(_) => {
            service
                .write_validation_metadata(None)
                .map_err(ImaCommandError::from)?;
            service.credential_status().map_err(Into::into)
        }
        Err(error) => {
            let _ = service.write_validation_metadata(Some(error.message.clone()));
            Err(error.into())
        }
    }
}

#[tauri::command]
pub async fn list_ima_note_folders(app: AppHandle) -> Result<Vec<ImaNoteFolder>, ImaCommandError> {
    ImaClient::from_saved_credentials(app)?
        .list_note_folders()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_ima_addable_knowledge_bases(
    app: AppHandle,
) -> Result<Vec<ImaKnowledgeBase>, ImaCommandError> {
    ImaClient::from_saved_credentials(app)?
        .list_addable_knowledge_bases()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_ima_knowledge_items(
    app: AppHandle,
    knowledge_base_id: String,
    folder_id: Option<String>,
) -> Result<ImaKnowledgeList, ImaCommandError> {
    let knowledge_base_id = knowledge_base_id.trim();
    if knowledge_base_id.is_empty() {
        return Err(ImaCommandError {
            code: "IMA_KNOWLEDGE_BASE_MISSING".to_string(),
            message: "Ima 知识库 ID 不能为空。".to_string(),
            detail: None,
        });
    }
    ImaClient::from_saved_credentials(app)?
        .list_knowledge_items(knowledge_base_id, folder_id.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn retry_ima_export_attempt(
    app: AppHandle,
    operation_id: String,
) -> Result<ExportTargetResult, ImaCommandError> {
    Ok(ima::retry_export_attempt(&app, operation_id.trim()).await)
}

#[tauri::command]
pub async fn retarget_ima_knowledge_association(
    app: AppHandle,
    operation_id: String,
    knowledge_base_id: String,
    knowledge_base_folder_id: Option<String>,
    confirm: bool,
) -> Result<ExportTargetResult, ImaCommandError> {
    let knowledge_base_id = knowledge_base_id.trim().to_string();
    let knowledge_base_folder_id = knowledge_base_folder_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(ima::retarget_knowledge_association(
        &app,
        operation_id.trim(),
        &knowledge_base_id,
        knowledge_base_folder_id.as_deref(),
        confirm,
    )
    .await)
}

#[tauri::command]
pub async fn check_ima_export_drift(
    app: AppHandle,
    operation_id: String,
) -> Result<ImaRemoteDriftReport, ImaCommandError> {
    ima::check_remote_drift(&app, operation_id.trim())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn resolve_ima_unknown_attempt(
    app: AppHandle,
    operation_id: String,
    action: ImaUnknownResolution,
    confirm: bool,
) -> Result<Option<ExportTargetResult>, ImaCommandError> {
    ima::resolve_unknown_attempt(&app, operation_id.trim(), action, confirm)
        .await
        .map_err(|error| ImaCommandError {
            code: "ima_unknown_resolution_failed".to_string(),
            message: error,
            detail: None,
        })
}

async fn run_blocking<T>(
    task: impl FnOnce() -> Result<T, ImaCredentialError> + Send + 'static,
) -> Result<T, ImaCommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| ImaCommandError {
            code: "ima_credential_task_failed".to_string(),
            message: format!("Ima 凭据任务执行失败：{error}"),
            detail: None,
        })?
        .map_err(Into::into)
}
