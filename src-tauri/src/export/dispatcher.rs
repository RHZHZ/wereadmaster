use std::{fs, path::PathBuf};

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::{
    db,
    services::{notion_credentials::NotionCredentialService, settings::ObsidianAttachmentMode},
};

use super::{
    document::ExportDocument,
    notion::{
        export_document as export_notion_document, NotionExportOptions, NotionPropertyMapping,
    },
    obsidian::{export_document as export_obsidian_document, ObsidianExportOptions},
    targets::{
        ExportTargetError, ExportTargetResult, ExportTargetStatus, ExternalExportTarget,
        MultiTargetExportRequest, NotionExportOverrides, ObsidianExportOverrides,
    },
};

pub async fn export_document_targets(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    file_stem: &str,
    request: &MultiTargetExportRequest,
) -> Vec<ExportTargetResult> {
    export_document_targets_with_notion_blocks(app, document, markdown, file_stem, request, None)
        .await
}

/// 与 `export_document_targets` 相同，但允许为 Notion 目标提供预构建的
/// 原生块正文（如书籍笔记的结构化块），替代 Markdown 直译。
pub async fn export_document_targets_with_notion_blocks(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    file_stem: &str,
    request: &MultiTargetExportRequest,
    notion_blocks: Option<&[Value]>,
) -> Vec<ExportTargetResult> {
    export_document_targets_with_context(
        app,
        document,
        markdown,
        file_stem,
        request,
        notion_blocks,
        None,
    )
    .await
}

/// 在普通多目标导出基础上接受已成功的 Obsidian 文件路径。
/// 批量精确重试 Notion 时可保留首次导出的关联元数据，而无需重复执行 Obsidian。
pub async fn export_document_targets_with_context(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    file_stem: &str,
    request: &MultiTargetExportRequest,
    notion_blocks: Option<&[Value]>,
    known_obsidian_path: Option<&str>,
) -> Vec<ExportTargetResult> {
    let mut results = vec![None; request.targets.len()];
    let mut obsidian_path = known_obsidian_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string);

    if let Some(obsidian_index) = obsidian_index_to_run_before_notion(request) {
        let result = export_single_target(
            app,
            document,
            markdown,
            file_stem,
            request,
            ExternalExportTarget::Obsidian,
            None,
            notion_blocks,
        )
        .await;
        if result.status == ExportTargetStatus::Succeeded {
            obsidian_path = result.path.clone();
        }
        results[obsidian_index] = Some(result);
    }

    for (index, target) in request.targets.iter().copied().enumerate() {
        if results[index].is_some() {
            continue;
        }
        let result = export_single_target(
            app,
            document,
            markdown,
            file_stem,
            request,
            target,
            obsidian_path.as_deref(),
            notion_blocks,
        )
        .await;
        if target == ExternalExportTarget::Obsidian
            && result.status == ExportTargetStatus::Succeeded
        {
            obsidian_path = result.path.clone();
        }
        results[index] = Some(result);
    }

    results.into_iter().flatten().collect()
}

async fn export_single_target(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    file_stem: &str,
    request: &MultiTargetExportRequest,
    target: ExternalExportTarget,
    obsidian_path: Option<&str>,
    notion_blocks: Option<&[Value]>,
) -> ExportTargetResult {
    match target {
        ExternalExportTarget::Markdown => {
            export_markdown_target(app, document, markdown, file_stem)
        }
        ExternalExportTarget::Obsidian => {
            export_obsidian_target(
                app,
                document,
                markdown,
                file_stem,
                request.obsidian.as_ref(),
            )
            .await
        }
        ExternalExportTarget::Notion => {
            let notion_document = document_for_notion_target(document, obsidian_path);
            export_notion_target(
                app,
                &notion_document,
                markdown,
                request.notion.as_ref(),
                notion_blocks,
            )
            .await
        }
        ExternalExportTarget::Ima => {
            super::ima::export_document(app, document, markdown, request.ima.as_ref()).await
        }
    }
}

fn obsidian_index_to_run_before_notion(request: &MultiTargetExportRequest) -> Option<usize> {
    let notion_index = request
        .targets
        .iter()
        .position(|target| *target == ExternalExportTarget::Notion)?;
    let obsidian_index = request
        .targets
        .iter()
        .position(|target| *target == ExternalExportTarget::Obsidian)?;

    (notion_index < obsidian_index).then_some(obsidian_index)
}

fn document_for_notion_target(
    document: &ExportDocument,
    obsidian_path: Option<&str>,
) -> ExportDocument {
    match obsidian_path.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => document
            .clone()
            .with_front_matter("obsidianPath", path.to_string()),
        None => document.clone(),
    }
}

fn export_markdown_target(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    file_stem: &str,
) -> ExportTargetResult {
    let result = (|| -> Result<PathBuf, String> {
        let export_dir = db::active_export_dir(app)?;
        fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
        let path = export_dir.join(format!("{file_stem}.md"));
        fs::write(&path, markdown).map_err(|error| error.to_string())?;
        Ok(path)
    })();

    match result {
        Ok(path) => ExportTargetResult {
            target: ExternalExportTarget::Markdown,
            status: ExportTargetStatus::Succeeded,
            title: Some(document.title.clone()),
            path: Some(path.to_string_lossy().to_string()),
            url: None,
            page_id: None,
            operation_id: None,
            operation_stage: None,
            resource_id: None,
            file_count: Some(1),
            warning: None,
            error: None,
        },
        Err(error) => target_failure(
            ExternalExportTarget::Markdown,
            "markdown_write_failed",
            "Markdown 文件写入失败。",
            Some(error),
        ),
    }
}

async fn export_obsidian_target(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    file_stem: &str,
    overrides: Option<&ObsidianExportOverrides>,
) -> ExportTargetResult {
    let integration = match read_integration_config(app, ExternalExportTarget::Obsidian) {
        Ok(value) => value,
        Err(result) => return result,
    };
    let vault_dir = overrides
        .and_then(|value| value.vault_dir.as_deref())
        .or(integration.obsidian_vault_dir.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(vault_dir) = vault_dir else {
        return target_failure(
            ExternalExportTarget::Obsidian,
            "obsidian_vault_missing",
            "请先在设置中选择 Obsidian Vault。",
            None,
        );
    };
    let open_after_export = overrides
        .and_then(|value| value.open_after_export)
        .unwrap_or(integration.obsidian_open_after_export);
    let options = ObsidianExportOptions {
        vault_dir: PathBuf::from(vault_dir),
        attachment_mode: ObsidianAttachmentMode::from_config_value(
            integration.obsidian_attachment_mode.as_deref(),
        ),
    };

    match export_obsidian_document(document, markdown, file_stem, &options).await {
        Ok(output) => {
            let mut warning = output.warning;
            if open_after_export {
                if let Err(error) = app
                    .opener()
                    .open_path(output.path.to_string_lossy(), None::<&str>)
                {
                    warning = Some(match warning {
                        Some(existing) => format!("{existing}；导出后打开失败：{error}"),
                        None => format!("导出成功，但自动打开失败：{error}"),
                    });
                }
            }
            ExportTargetResult {
                target: ExternalExportTarget::Obsidian,
                status: ExportTargetStatus::Succeeded,
                title: Some(document.title.clone()),
                path: Some(output.path.to_string_lossy().to_string()),
                url: None,
                page_id: None,
                operation_id: None,
                operation_stage: None,
                resource_id: None,
                file_count: Some(output.file_count),
                warning,
                error: None,
            }
        }
        Err(error) => target_failure(
            ExternalExportTarget::Obsidian,
            "obsidian_export_failed",
            "导出到 Obsidian 失败。",
            Some(error),
        ),
    }
}

async fn export_notion_target(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    overrides: Option<&NotionExportOverrides>,
    notion_blocks: Option<&[Value]>,
) -> ExportTargetResult {
    let integration = match read_integration_config(app, ExternalExportTarget::Notion) {
        Ok(value) => value,
        Err(result) => return result,
    };
    let parent_id = overrides
        .and_then(|value| value.parent_id.as_deref())
        .or(integration.notion_parent_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let parent_type = overrides.and_then(|value| value.parent_type).or_else(|| {
        super::targets::NotionParentType::from_config_value(
            integration.notion_parent_type.as_deref(),
        )
    });
    let (Some(parent_id), Some(parent_type)) = (parent_id, parent_type) else {
        return target_failure(
            ExternalExportTarget::Notion,
            "notion_parent_missing",
            "请先设置 Notion 目标页面或数据库。",
            None,
        );
    };
    let token = match NotionCredentialService::new(app.clone()).read_token() {
        Ok(value) => value,
        Err(error) => {
            return target_failure(
                ExternalExportTarget::Notion,
                error.code(),
                &error.user_message(),
                None,
            )
        }
    };
    let options = NotionExportOptions {
        token,
        parent_id: parent_id.to_string(),
        parent_type,
        use_page_cover: integration.notion_cover_mode.as_deref() != Some("contentImageOnly"),
        property_mappings: if parent_type == super::targets::NotionParentType::Database
            && integration.notion_parent_id.as_deref() == Some(parent_id)
        {
            integration
                .notion_database_connection
                .as_ref()
                .filter(|connection| connection.database_id == parent_id)
                .map(|connection| {
                    connection
                        .mappings
                        .iter()
                        .map(|mapping| NotionPropertyMapping {
                            logical_field: mapping.logical_field.clone(),
                            property_id: mapping.property_id.clone(),
                            property_name_snapshot: mapping.property_name_snapshot.clone(),
                            property_type: mapping.property_type.clone(),
                            enabled: mapping.enabled,
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        },
    };

    match export_notion_document(document, markdown, &options, notion_blocks).await {
        Ok(output) => ExportTargetResult {
            target: ExternalExportTarget::Notion,
            status: ExportTargetStatus::Succeeded,
            title: Some(document.title.clone()),
            path: None,
            url: Some(output.url),
            page_id: Some(output.page_id),
            operation_id: None,
            operation_stage: None,
            resource_id: None,
            file_count: None,
            warning: output.warning,
            error: None,
        },
        Err(error) => target_failure(
            ExternalExportTarget::Notion,
            "notion_export_failed",
            "导入到 Notion 失败。",
            Some(error),
        ),
    }
}

fn read_integration_config(
    app: &AppHandle,
    target: ExternalExportTarget,
) -> Result<db::IntegrationConfig, ExportTargetResult> {
    let config_dir = db::default_data_dir(app).map_err(|error| {
        target_failure(
            target,
            config_unavailable_code(target),
            config_unavailable_message(target),
            Some(error),
        )
    })?;
    db::read_integration_config(&config_dir).map_err(|error| {
        target_failure(
            target,
            config_unavailable_code(target),
            config_unavailable_message(target),
            Some(error),
        )
    })
}

fn config_unavailable_code(target: ExternalExportTarget) -> &'static str {
    match target {
        ExternalExportTarget::Markdown => "markdown_config_unavailable",
        ExternalExportTarget::Obsidian => "obsidian_config_unavailable",
        ExternalExportTarget::Notion => "notion_config_unavailable",
        ExternalExportTarget::Ima => "ima_config_unavailable",
    }
}

fn config_unavailable_message(target: ExternalExportTarget) -> &'static str {
    match target {
        ExternalExportTarget::Markdown => "无法读取 Markdown 配置。",
        ExternalExportTarget::Obsidian => "无法读取 Obsidian 配置。",
        ExternalExportTarget::Notion => "无法读取 Notion 配置。",
        ExternalExportTarget::Ima => "无法读取 Ima 配置。",
    }
}

fn target_failure(
    target: ExternalExportTarget,
    code: &str,
    message: &str,
    detail: Option<String>,
) -> ExportTargetResult {
    ExportTargetResult {
        target,
        status: ExportTargetStatus::Failed,
        title: None,
        path: None,
        url: None,
        page_id: None,
        operation_id: None,
        operation_stage: None,
        resource_id: None,
        file_count: None,
        warning: None,
        error: Some(ExportTargetError {
            code: code.to_string(),
            message: message.to_string(),
            detail,
        }),
    }
}

#[cfg(test)]
mod tests {
    use crate::export::{
        document::{ExportDocument, ExportSourceKind},
        targets::{ExternalExportTarget, MultiTargetExportRequest},
    };

    use super::{document_for_notion_target, obsidian_index_to_run_before_notion};

    #[test]
    fn obsidian_runs_before_notion_when_request_order_is_reversed() {
        let request = MultiTargetExportRequest {
            targets: vec![ExternalExportTarget::Notion, ExternalExportTarget::Obsidian],
            obsidian: None,
            notion: None,
            ima: None,
        };

        assert_eq!(obsidian_index_to_run_before_notion(&request), Some(1));
    }

    #[test]
    fn obsidian_keeps_request_order_when_it_already_precedes_notion() {
        let request = MultiTargetExportRequest {
            targets: vec![ExternalExportTarget::Obsidian, ExternalExportTarget::Notion],
            obsidian: None,
            notion: None,
            ima: None,
        };

        assert_eq!(obsidian_index_to_run_before_notion(&request), None);
    }

    #[test]
    fn notion_document_includes_obsidian_path_when_available() {
        let document = test_document();

        let notion_document = document_for_notion_target(&document, Some("C:/vault/book.md"));

        assert_eq!(document.front_matter.len(), 0);
        assert_eq!(
            notion_document
                .front_matter
                .iter()
                .find(|field| field.key == "obsidianPath")
                .map(|field| field.value.as_str()),
            Some("C:/vault/book.md")
        );
    }

    #[test]
    fn notion_document_skips_blank_obsidian_path() {
        let document = test_document();

        let notion_document = document_for_notion_target(&document, Some("  "));

        assert!(notion_document.front_matter.is_empty());
    }

    fn test_document() -> ExportDocument {
        ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书籍".to_string(),
            author: None,
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        }
    }
}
