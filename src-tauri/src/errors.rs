use serde::Serialize;

use crate::services::credentials::CredentialServiceError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeInfo {
    pub message: String,
}

#[derive(Debug)]
pub enum AppError {
    Credential(CredentialServiceError),
    UnsupportedApi(String),
    InvalidPayload(String),
    UpgradeRequired(UpgradeInfo),
    Authentication(String),
    Gateway(String),
    Network(String),
    Decode(String),
    Storage(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Credential(error) => error.code(),
            Self::UnsupportedApi(_) => "unsupported_api",
            Self::InvalidPayload(_) => "invalid_gateway_payload",
            Self::UpgradeRequired(_) => "upgrade_required",
            Self::Authentication(_) => "gateway_authentication_failed",
            Self::Gateway(_) => "gateway_error",
            Self::Network(_) => "gateway_network_error",
            Self::Decode(_) => "gateway_decode_error",
            Self::Storage(_) => "local_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::Credential(error) => error.user_message(),
            Self::UnsupportedApi(api_name) => format!("暂不支持调用接口：{api_name}。"),
            Self::InvalidPayload(message) => message.clone(),
            Self::UpgradeRequired(info) => info.message.clone(),
            Self::Authentication(message) => message.clone(),
            Self::Gateway(message) => message.clone(),
            Self::Network(_) => "微信读书接口暂时无法连接，请稍后重试。".to_string(),
            Self::Decode(_) => "微信读书返回内容无法解析，请稍后重试。".to_string(),
            Self::Storage(_) => "本地阅读数据暂时无法读取或写入，请稍后重试。".to_string(),
        }
    }
}

impl From<CredentialServiceError> for AppError {
    fn from(error: CredentialServiceError) -> Self {
        Self::Credential(error)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.to_string())
    }
}
