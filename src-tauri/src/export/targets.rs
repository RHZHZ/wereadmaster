use serde::{Deserialize, Serialize};

use super::document::ExportSourceKind;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalExportTarget {
    Markdown,
    Obsidian,
    Notion,
    Ima,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MultiTargetExportRequest {
    pub targets: Vec<ExternalExportTarget>,
    pub obsidian: Option<ObsidianExportOverrides>,
    pub notion: Option<NotionExportOverrides>,
    pub ima: Option<ImaExportOverrides>,
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
pub struct ImaExportOverrides {
    pub note_folder_id: Option<String>,
    pub knowledge_base_id: Option<String>,
    pub knowledge_base_folder_id: Option<String>,
    pub publish_to_knowledge_base: Option<bool>,
    #[serde(default)]
    pub confirm_body_export: Option<bool>,
    #[serde(default)]
    pub force_new_snapshot: Option<bool>,
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
    pub operation_id: Option<String>,
    pub operation_stage: Option<String>,
    pub resource_id: Option<String>,
    pub file_count: Option<usize>,
    pub warning: Option<String>,
    pub error: Option<ExportTargetError>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportTargetStatus {
    Succeeded,
    Partial,
    Failed,
    Skipped,
    Unknown,
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

        if self
            .targets
            .iter()
            .any(|target| *target == ExternalExportTarget::Ima)
        {
            let overrides = self.ima.as_ref();
            for (value, label) in [
                (
                    overrides.and_then(|value| value.note_folder_id.as_deref()),
                    "Ima 笔记本 ID",
                ),
                (
                    overrides.and_then(|value| value.knowledge_base_id.as_deref()),
                    "Ima 知识库 ID",
                ),
                (
                    overrides.and_then(|value| value.knowledge_base_folder_id.as_deref()),
                    "Ima 知识库文件夹 ID",
                ),
            ] {
                if value.is_some_and(|value| value.trim().is_empty()) {
                    return Err(format!("{label} 不能为空。"));
                }
            }
            if overrides
                .and_then(|value| value.note_folder_id.as_deref())
                .is_some_and(|value| value.trim() == "0")
            {
                return Err("Ima 笔记本 ID 不能使用分页游标 0。".to_string());
            }
            let publish_override = overrides.and_then(|value| value.publish_to_knowledge_base);
            let has_knowledge_base = overrides
                .and_then(|value| value.knowledge_base_id.as_deref())
                .is_some_and(|value| !value.trim().is_empty());
            let has_knowledge_base_folder = overrides
                .and_then(|value| value.knowledge_base_folder_id.as_deref())
                .is_some_and(|value| !value.trim().is_empty());
            if has_knowledge_base_folder && !has_knowledge_base {
                return Err("选择 Ima 知识库文件夹时必须同时选择目标知识库。".to_string());
            }
            let has_knowledge_base_overrides = overrides.is_some_and(|value| {
                value
                    .knowledge_base_id
                    .as_deref()
                    .is_some_and(|id| !id.trim().is_empty())
                    || value
                        .knowledge_base_folder_id
                        .as_deref()
                        .is_some_and(|id| !id.trim().is_empty())
            });
            if publish_override == Some(false) && has_knowledge_base_overrides {
                return Err("关闭 Ima 知识库发布时不能指定知识库或文件夹。".to_string());
            }
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
            ima: None,
        };

        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_knowledge_base_overrides_when_ima_publish_is_disabled() {
        for ima in [
            ImaExportOverrides {
                note_folder_id: None,
                knowledge_base_id: Some("knowledge-base-1".to_string()),
                knowledge_base_folder_id: None,
                publish_to_knowledge_base: Some(false),
                confirm_body_export: None,
                force_new_snapshot: None,
            },
            ImaExportOverrides {
                note_folder_id: None,
                knowledge_base_id: Some("knowledge-base-1".to_string()),
                knowledge_base_folder_id: Some("folder-1".to_string()),
                publish_to_knowledge_base: Some(false),
                confirm_body_export: None,
                force_new_snapshot: None,
            },
        ] {
            let request = MultiTargetExportRequest {
                targets: vec![ExternalExportTarget::Ima],
                obsidian: None,
                notion: None,
                ima: Some(ima),
            };

            assert_eq!(
                request.validate().unwrap_err(),
                "关闭 Ima 知识库发布时不能指定知识库或文件夹。"
            );
        }
    }

    #[test]
    fn allows_knowledge_base_override_when_publish_inherits_saved_setting() {
        let request = MultiTargetExportRequest {
            targets: vec![ExternalExportTarget::Ima],
            obsidian: None,
            notion: None,
            ima: Some(ImaExportOverrides {
                note_folder_id: None,
                knowledge_base_id: Some("knowledge-base-1".to_string()),
                knowledge_base_folder_id: Some("folder-1".to_string()),
                publish_to_knowledge_base: None,
                confirm_body_export: None,
                force_new_snapshot: None,
            }),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn allows_publish_override_to_use_saved_knowledge_base() {
        let request = MultiTargetExportRequest {
            targets: vec![ExternalExportTarget::Ima],
            obsidian: None,
            notion: None,
            ima: Some(ImaExportOverrides {
                note_folder_id: None,
                knowledge_base_id: None,
                knowledge_base_folder_id: None,
                publish_to_knowledge_base: Some(true),
                confirm_body_export: None,
                force_new_snapshot: None,
            }),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn rejects_knowledge_base_folder_without_knowledge_base() {
        let request = MultiTargetExportRequest {
            targets: vec![ExternalExportTarget::Ima],
            obsidian: None,
            notion: None,
            ima: Some(ImaExportOverrides {
                note_folder_id: None,
                knowledge_base_id: None,
                knowledge_base_folder_id: Some("folder-1".to_string()),
                publish_to_knowledge_base: None,
                confirm_body_export: None,
                force_new_snapshot: None,
            }),
        };

        assert_eq!(
            request.validate().unwrap_err(),
            "选择 Ima 知识库文件夹时必须同时选择目标知识库。"
        );
    }
}
