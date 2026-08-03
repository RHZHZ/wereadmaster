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
            Self::Network(message) if is_notion_network_detail(message) => {
                "无法连接 Notion API，请检查网络、系统代理或 VPN 后重试。".to_string()
            }
            Self::Network(_) => "微信读书接口暂时无法连接，请稍后重试。".to_string(),
            Self::Decode(_) => "微信读书返回内容无法解析，请稍后重试。".to_string(),
            Self::Storage(_) => "本地阅读数据暂时无法读取或写入，请稍后重试。".to_string(),
        }
    }

    pub fn diagnostic_message(&self) -> Option<String> {
        match self {
            Self::Network(message) | Self::Decode(message) | Self::Storage(message) => {
                sanitize_diagnostic_detail(message)
            }
            Self::Credential(error) => error.diagnostic_message(),
            _ => None,
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

fn is_notion_network_detail(message: &str) -> bool {
    message.to_ascii_lowercase().contains("notion")
}

fn sanitize_diagnostic_detail(message: &str) -> Option<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut detail = trimmed
        .replace('\r', " ")
        .replace('\n', " ")
        .replace("apiKey", "credential")
        .replace("APIKEY", "credential");
    detail.truncate(480);

    Some(detail)
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn network_error_keeps_user_message_friendly_and_detail_diagnostic() {
        let error = AppError::Network(
            "error sending request for url (https://i.weread.qq.com/api/agent/gateway): operation timed out"
                .to_string(),
        );

        assert_eq!(
            error.user_message(),
            "微信读书接口暂时无法连接，请稍后重试。"
        );
        assert_eq!(
            error.diagnostic_message(),
            Some(
                "error sending request for url (https://i.weread.qq.com/api/agent/gateway): operation timed out"
                    .to_string()
            )
        );
    }

    #[test]
    fn notion_network_error_has_service_specific_guidance() {
        let error = AppError::Network(
            "检查 Notion 数据库失败：无法连接 Notion API（无法建立网络连接）。请检查网络、系统代理或 VPN 后重试。"
                .to_string(),
        );

        assert_eq!(
            error.user_message(),
            "无法连接 Notion API，请检查网络、系统代理或 VPN 后重试。"
        );
        assert!(error
            .diagnostic_message()
            .as_deref()
            .is_some_and(|detail| detail.contains("检查 Notion 数据库失败")));
    }

    #[test]
    fn diagnostic_message_masks_api_key_labels_and_line_breaks() {
        let error = AppError::Storage("apiKey failed\nsecond line".to_string());

        assert_eq!(
            error.diagnostic_message(),
            Some("credential failed second line".to_string())
        );
    }
}
