use serde::{Deserialize, Serialize};

use super::document::ExportSourceKind;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalExportTarget {
    Markdown,
    Obsidian,
    Notion,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MultiTargetExportRequest {
    pub targets: Vec<ExternalExportTarget>,
    pub obsidian: Option<ObsidianExportOverrides>,
    pub notion: Option<NotionExportOverrides>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianExportOverrides {
    pub vault_dir: Option<String>,
    pub open_after_export: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionParentType {
    Page,
    Database,
}

impl NotionParentType {
    pub fn as_config_value(self) -> &'static str {
        match self {
            Self::Page => "page",
            Self::Database => "database",
        }
    }

    pub fn from_config_value(value: Option<&str>) -> Option<Self> {
        match value {
            Some("page") => Some(Self::Page),
            Some("database") => Some(Self::Database),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionExportOverrides {
    pub parent_id: Option<String>,
    pub parent_type: Option<NotionParentType>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MultiTargetExportResponse {
    pub export_id: String,
    pub source_kind: ExportSourceKind,
    pub source_id: String,
    pub exported_at: String,
    pub results: Vec<ExportTargetResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportTargetResult {
    pub target: ExternalExportTarget,
    pub status: ExportTargetStatus,
    pub title: Option<String>,
    pub path: Option<String>,
    pub url: Option<String>,
    pub page_id: Option<String>,
    pub file_count: Option<usize>,
    pub warning: Option<String>,
    pub error: Option<ExportTargetError>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportTargetStatus {
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportTargetError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

impl MultiTargetExportRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.targets.is_empty() {
            return Err("至少选择一个导出目标。".to_string());
        }

        if self
            .targets
            .iter()
            .any(|target| *target == ExternalExportTarget::Obsidian)
            && self
                .obsidian
                .as_ref()
                .and_then(|value| value.vault_dir.as_deref())
                .is_some_and(|value| value.trim().is_empty())
        {
            return Err("Obsidian Vault 路径不能为空。".to_string());
        }

        if self
            .targets
            .iter()
            .any(|target| *target == ExternalExportTarget::Notion)
            && self
                .notion
                .as_ref()
                .and_then(|value| value.parent_id.as_deref())
                .is_some_and(|value| value.trim().is_empty())
        {
            return Err("Notion 目标 ID 不能为空。".to_string());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_target_list() {
        let request = MultiTargetExportRequest {
            targets: vec![],
            obsidian: None,
            notion: None,
        };

        assert!(request.validate().is_err());
    }
}
