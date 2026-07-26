use std::{collections::BTreeSet, fmt::Write};

use serde::{Deserialize, Serialize};

use crate::mappers::notes::{BookNotesRecord, NotebookBookRecord};

use super::targets::{
    ExportTargetResult, ExportTargetStatus, ExternalExportTarget, MultiTargetExportRequest,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BulkExportStrategy {
    LocalCachedOnly,
    SyncMissingNotes,
    SelectedBooksOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BulkExportItemStatus {
    Ready,
    NeedsSync,
    NoContent,
    Skipped,
    Failed,
    Exported,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkExportPreflightItem {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub total_note_count: i64,
    pub cached_exportable_count: usize,
    pub has_cached_notes: bool,
    pub has_cached_ai_review: bool,
    pub status: BulkExportItemStatus,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkExportPreflight {
    pub total_books: usize,
    pub ready_count: usize,
    pub needs_sync_count: usize,
    pub no_content_count: usize,
    pub cached_ai_review_count: usize,
    pub items: Vec<BulkExportPreflightItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkExportResultItem {
    pub book_id: String,
    pub title: String,
    pub status: BulkExportItemStatus,
    pub notes_file: Option<String>,
    pub ai_review_file: Option<String>,
    /// 目标级结果（Obsidian / Notion）。仅当批量请求选择了外部目标时非空；
    /// Markdown 始终写入批量目录，不在此列表中重复。
    #[serde(default)]
    pub targets: Vec<ExportTargetResult>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkExportReport {
    pub exported_at: String,
    pub strategy: BulkExportStrategy,
    pub concurrency: usize,
    pub items: Vec<BulkExportResultItem>,
}

pub fn build_bulk_export_preflight(
    books: &[NotebookBookRecord],
    cached_notes: &[BookNotesRecord],
    cached_ai_review_book_ids: &[String],
    selected_book_ids: Option<&[String]>,
    exclude_without_exportable_notes: bool,
) -> BulkExportPreflight {
    let cached_ai_ids = cached_ai_review_book_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let review_only_books = cached_ai_review_book_ids
        .iter()
        .filter(|book_id| !books.iter().any(|book| book.book_id == **book_id))
        .map(|book_id| NotebookBookRecord {
            book_id: book_id.clone(),
            title: book_id.clone(),
            author: None,
            cover: None,
            review_count: 0,
            note_count: 0,
            bookmark_count: 0,
            total_note_count: 0,
            reading_progress: None,
            marked_status: None,
            sort: None,
            raw_json: "{}".to_string(),
        })
        .collect::<Vec<_>>();
    let all_books = books
        .iter()
        .chain(review_only_books.iter())
        .collect::<Vec<_>>();
    let cached_note_ids = cached_notes
        .iter()
        .map(|notes| notes.book_id.as_str())
        .collect::<BTreeSet<_>>();
    let cached_exportable_counts = cached_notes
        .iter()
        .map(|notes| (notes.book_id.as_str(), notes.exportable_count))
        .collect::<std::collections::BTreeMap<_, _>>();
    let selected_ids =
        selected_book_ids.map(|ids| ids.iter().map(String::as_str).collect::<BTreeSet<_>>());

    let items = all_books
        .iter()
        .filter(|book| {
            selected_ids
                .as_ref()
                .map(|ids| ids.contains(book.book_id.as_str()))
                .unwrap_or(true)
        })
        .filter(|book| {
            if !exclude_without_exportable_notes {
                return true;
            }

            book.review_count > 0
                || book.note_count > 0
                || cached_ai_ids.contains(book.book_id.as_str())
        })
        .map(|book| {
            let has_cached_notes = cached_note_ids.contains(book.book_id.as_str());
            let cached_exportable_count = cached_exportable_counts
                .get(book.book_id.as_str())
                .copied()
                .unwrap_or(0);
            let has_cached_ai_review = cached_ai_ids.contains(book.book_id.as_str());
            let (status, reason) = if book.total_note_count <= 0 && has_cached_ai_review {
                (
                    BulkExportItemStatus::Ready,
                    "本地已有 AI 复盘缓存，将只导出已生成复盘。".to_string(),
                )
            } else if book.total_note_count <= 0 {
                (
                    BulkExportItemStatus::NoContent,
                    "本地笔记概览显示无可导出内容。".to_string(),
                )
            } else if has_cached_notes && cached_exportable_count > 0 {
                (
                    BulkExportItemStatus::Ready,
                    "本地已缓存可导出的划线或想法。".to_string(),
                )
            } else if has_cached_notes {
                (
                    BulkExportItemStatus::NoContent,
                    "已缓存笔记但没有划线或想法可导出。".to_string(),
                )
            } else {
                (
                    BulkExportItemStatus::NeedsSync,
                    "需要同步/读取后才能导出。".to_string(),
                )
            };

            BulkExportPreflightItem {
                book_id: book.book_id.clone(),
                title: book.title.clone(),
                author: book.author.clone(),
                total_note_count: book.total_note_count,
                cached_exportable_count,
                has_cached_notes,
                has_cached_ai_review,
                status,
                reason,
            }
        })
        .collect::<Vec<_>>();

    BulkExportPreflight {
        total_books: items.len(),
        ready_count: items
            .iter()
            .filter(|item| item.status == BulkExportItemStatus::Ready)
            .count(),
        needs_sync_count: items
            .iter()
            .filter(|item| item.status == BulkExportItemStatus::NeedsSync)
            .count(),
        no_content_count: items
            .iter()
            .filter(|item| item.status == BulkExportItemStatus::NoContent)
            .count(),
        cached_ai_review_count: items
            .iter()
            .filter(|item| item.has_cached_ai_review)
            .count(),
        items,
    }
}

/// 提取批量请求中需要额外写出的外部目标（Obsidian / Notion），保序去重。
/// Markdown 不在其中：批量导出始终把 Markdown 写入本次批量目录作为兜底。
pub fn bulk_external_targets(
    request: Option<&MultiTargetExportRequest>,
) -> Vec<ExternalExportTarget> {
    let Some(request) = request else {
        return Vec::new();
    };
    let mut targets = Vec::new();
    for target in &request.targets {
        if *target != ExternalExportTarget::Markdown && !targets.contains(target) {
            targets.push(*target);
        }
    }
    targets
}

fn external_target_label(target: ExternalExportTarget) -> &'static str {
    match target {
        ExternalExportTarget::Markdown => "Markdown",
        ExternalExportTarget::Obsidian => "Obsidian",
        ExternalExportTarget::Notion => "Notion",
    }
}

fn write_bulk_export_target_line(markdown: &mut String, target: &ExportTargetResult) {
    let label = external_target_label(target.target);
    match target.status {
        ExportTargetStatus::Succeeded => {
            let location = target
                .url
                .as_deref()
                .or(target.path.as_deref())
                .unwrap_or("已完成");
            let _ = writeln!(markdown, "- {label}：{location}");
            if let Some(warning) = target.warning.as_deref() {
                let _ = writeln!(markdown, "- {label} 警告：{warning}");
            }
        }
        ExportTargetStatus::Failed => {
            let reason = target
                .error
                .as_ref()
                .map(|error| error.message.as_str())
                .unwrap_or("未知原因");
            let _ = writeln!(markdown, "- {label}：失败（{reason}）");
        }
        ExportTargetStatus::Skipped => {
            let _ = writeln!(markdown, "- {label}：已跳过");
        }
    }
}

pub fn normalize_bulk_export_concurrency(value: Option<usize>) -> usize {
    value.unwrap_or(2).clamp(1, 3)
}

pub fn chunk_bulk_export_jobs<T: Clone>(jobs: &[T], concurrency: usize) -> Vec<Vec<T>> {
    let concurrency = concurrency.clamp(1, 3);

    jobs.chunks(concurrency)
        .map(|chunk| chunk.to_vec())
        .collect()
}

pub fn serialize_bulk_export_index(report: &BulkExportReport) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# wxreadmaster 批量导出索引");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 导出时间：{}", report.exported_at);
    let _ = writeln!(markdown, "- 策略：{:?}", report.strategy);
    let _ = writeln!(markdown, "- 并发：{}", report.concurrency);
    let _ = writeln!(markdown);
    write_bulk_export_boundary_section(&mut markdown);
    let _ = writeln!(markdown, "## 书籍");
    let _ = writeln!(markdown);

    for item in &report.items {
        let target = item
            .notes_file
            .as_deref()
            .or(item.ai_review_file.as_deref())
            .unwrap_or("export-report.md");
        let mut line = format!("- [{}]({}) - {:?}", item.title, target, item.status);
        for target_result in &item.targets {
            if target_result.status != ExportTargetStatus::Succeeded {
                continue;
            }
            match target_result.target {
                ExternalExportTarget::Notion => {
                    if let Some(url) = target_result.url.as_deref() {
                        line.push_str(&format!(" · [Notion]({url})"));
                    }
                }
                ExternalExportTarget::Obsidian => {
                    line.push_str(" · Obsidian ✓");
                }
                ExternalExportTarget::Markdown => {}
            }
        }
        let _ = writeln!(markdown, "{line}");
    }

    markdown
}

pub fn serialize_bulk_export_report(report: &BulkExportReport) -> String {
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# wxreadmaster 批量导出报告");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 导出时间：{}", report.exported_at);
    let _ = writeln!(markdown, "- 策略：{:?}", report.strategy);
    let _ = writeln!(markdown, "- 并发：{}", report.concurrency);
    let _ = writeln!(markdown);
    write_bulk_export_boundary_section(&mut markdown);

    for item in &report.items {
        let _ = writeln!(markdown, "## {}", item.title);
        let _ = writeln!(markdown);
        let _ = writeln!(markdown, "- 状态：{:?}", item.status);
        let _ = writeln!(markdown, "- 原因：{}", item.reason);
        if let Some(notes_file) = item.notes_file.as_deref() {
            let _ = writeln!(markdown, "- 笔记文件：{}", notes_file);
        }
        if let Some(ai_review_file) = item.ai_review_file.as_deref() {
            let _ = writeln!(markdown, "- 已生成复盘：{}", ai_review_file);
        }
        for target in &item.targets {
            write_bulk_export_target_line(&mut markdown, target);
        }
        let _ = writeln!(markdown);
    }

    markdown
}

fn write_bulk_export_boundary_section(markdown: &mut String) {
    let _ = writeln!(markdown, "## 数据边界");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 数据来源：本地笔记概览、单本笔记缓存和已生成复盘缓存"
    );
    let _ = writeln!(
        markdown,
        "- 包含：划线、想法/点评、章节分组、可导出笔记元信息和本地已生成的书籍复盘缓存"
    );
    let _ = writeln!(
        markdown,
        "- 不包含：书签正文、微信读书 API Key、AI API Key、数据库路径和原始接口响应"
    );
    let _ = writeln!(
        markdown,
        "- 导出行为：只有选择同步策略时才会按有界队列读取缺失书籍；不会自动生成 AI 复盘。"
    );
    let _ = writeln!(markdown);
}

#[cfg(test)]
mod tests {
    use crate::mappers::notes::{BookNotesRecord, NotebookBookRecord};

    use crate::export::targets::{
        ExportTargetError, ExportTargetResult, ExportTargetStatus, ExternalExportTarget,
        MultiTargetExportRequest,
    };

    use super::{
        build_bulk_export_preflight, bulk_external_targets, chunk_bulk_export_jobs,
        normalize_bulk_export_concurrency, serialize_bulk_export_index,
        serialize_bulk_export_report, BulkExportItemStatus, BulkExportReport, BulkExportResultItem,
        BulkExportStrategy,
    };

    #[test]
    fn preflight_marks_uncached_note_books_as_needing_sync() {
        let books = vec![
            notebook_book("cached", "已缓存", 2),
            notebook_book("missing", "未缓存", 3),
        ];
        let cached_notes = vec![book_notes("cached", 2)];

        let preflight = build_bulk_export_preflight(
            &books,
            &cached_notes,
            &["cached".to_string()],
            None,
            false,
        );

        assert_eq!(preflight.ready_count, 1);
        assert_eq!(preflight.needs_sync_count, 1);
        assert_eq!(preflight.cached_ai_review_count, 1);
        assert_eq!(preflight.items[1].status, BulkExportItemStatus::NeedsSync);
        assert_eq!(preflight.items[1].reason, "需要同步/读取后才能导出。");
    }

    #[test]
    fn selected_preflight_limits_books_without_free_text_paths() {
        let books = vec![
            notebook_book("one", "第一本", 1),
            notebook_book("two", "第二本", 1),
        ];
        let selected = vec!["two".to_string()];

        let preflight = build_bulk_export_preflight(&books, &[], &[], Some(&selected), false);

        assert_eq!(preflight.total_books, 1);
        assert_eq!(preflight.items[0].book_id, "two");
        assert_eq!(preflight.items[0].status, BulkExportItemStatus::NeedsSync);
    }

    #[test]
    fn preflight_includes_cached_ai_reviews_without_notebook_rows() {
        let preflight =
            build_bulk_export_preflight(&[], &[], &["review-only".to_string()], None, true);

        assert_eq!(preflight.total_books, 1);
        assert_eq!(preflight.ready_count, 1);
        assert_eq!(preflight.cached_ai_review_count, 1);
        assert_eq!(preflight.items[0].book_id, "review-only");
        assert_eq!(preflight.items[0].status, BulkExportItemStatus::Ready);
        assert!(preflight.items[0].reason.contains("只导出已生成复盘"));
    }

    #[test]
    fn preflight_can_exclude_books_without_exportable_notes() {
        let books = vec![
            notebook_book_with_counts("bookmark-only", "只有书签", 0, 0, 3),
            notebook_book_with_counts("has-review", "有想法", 1, 0, 0),
            notebook_book_with_counts("has-highlight", "有划线", 0, 2, 0),
            notebook_book_with_counts("cached-review", "已有复盘", 0, 0, 0),
        ];

        let preflight =
            build_bulk_export_preflight(&books, &[], &["cached-review".to_string()], None, true);

        assert_eq!(preflight.total_books, 3);
        assert!(!preflight
            .items
            .iter()
            .any(|item| item.book_id == "bookmark-only"));
        assert!(preflight
            .items
            .iter()
            .any(|item| item.book_id == "has-review"));
        assert!(preflight
            .items
            .iter()
            .any(|item| item.book_id == "has-highlight"));
        assert!(preflight
            .items
            .iter()
            .any(|item| item.book_id == "cached-review"));
    }

    #[test]
    fn bulk_export_concurrency_is_bounded() {
        assert_eq!(normalize_bulk_export_concurrency(None), 2);
        assert_eq!(normalize_bulk_export_concurrency(Some(0)), 1);
        assert_eq!(normalize_bulk_export_concurrency(Some(9)), 3);
    }

    #[test]
    fn bulk_export_jobs_are_chunked_by_bounded_concurrency() {
        let jobs = vec![1, 2, 3, 4, 5];

        let chunks = chunk_bulk_export_jobs(&jobs, 2);
        let oversized_chunks = chunk_bulk_export_jobs(&jobs, 10);

        assert_eq!(chunks, vec![vec![1, 2], vec![3, 4], vec![5]]);
        assert_eq!(oversized_chunks, vec![vec![1, 2, 3], vec![4, 5]]);
    }

    #[test]
    fn report_records_skipped_missing_notes_and_cached_ai_only() {
        let report = BulkExportReport {
            exported_at: "100".to_string(),
            strategy: BulkExportStrategy::LocalCachedOnly,
            concurrency: 2,
            items: vec![BulkExportResultItem {
                book_id: "missing".to_string(),
                title: "未缓存".to_string(),
                status: BulkExportItemStatus::Skipped,
                notes_file: None,
                ai_review_file: Some("reviews/missing-ai-summary.md".to_string()),
                targets: Vec::new(),
                reason: "需要同步/读取后才能导出。".to_string(),
            }],
        };

        let markdown = serialize_bulk_export_report(&report);

        assert!(markdown.contains("## 数据边界"));
        assert!(markdown.contains("不会自动生成 AI 复盘"));
        assert!(markdown.contains("需要同步/读取后才能导出"));
        assert!(markdown.contains("已生成复盘"));
        assert!(!markdown.contains("sk-"));
        assert!(!markdown.contains("reading-cache.sqlite3"));
    }

    #[test]
    fn report_records_canceled_sync_jobs() {
        let report = BulkExportReport {
            exported_at: "100".to_string(),
            strategy: BulkExportStrategy::SyncMissingNotes,
            concurrency: 2,
            items: vec![BulkExportResultItem {
                book_id: "canceled".to_string(),
                title: "已取消".to_string(),
                status: BulkExportItemStatus::Canceled,
                notes_file: None,
                ai_review_file: None,
                targets: Vec::new(),
                reason: "用户已取消，未开始同步。".to_string(),
            }],
        };

        let markdown = serialize_bulk_export_report(&report);

        assert!(markdown.contains("Canceled"));
        assert!(markdown.contains("用户已取消，未开始同步。"));
    }

    #[test]
    fn report_records_failed_sync_jobs_without_sensitive_paths() {
        let report = BulkExportReport {
            exported_at: "100".to_string(),
            strategy: BulkExportStrategy::SyncMissingNotes,
            concurrency: 2,
            items: vec![BulkExportResultItem {
                book_id: "failed".to_string(),
                title: "同步失败".to_string(),
                status: BulkExportItemStatus::Failed,
                notes_file: None,
                ai_review_file: None,
                targets: Vec::new(),
                reason: "微信读书接口暂时无法连接，请稍后重试。".to_string(),
            }],
        };

        let markdown = serialize_bulk_export_report(&report);

        assert!(markdown.contains("Failed"));
        assert!(markdown.contains("微信读书接口暂时无法连接，请稍后重试。"));
        assert!(!markdown.contains("sk-"));
        assert!(!markdown.contains("reading-cache.sqlite3"));
        assert!(!markdown.contains("AppData"));
    }

    #[test]
    fn external_targets_are_deduped_and_exclude_markdown() {
        assert!(bulk_external_targets(None).is_empty());

        let markdown_only = MultiTargetExportRequest {
            targets: vec![ExternalExportTarget::Markdown],
            obsidian: None,
            notion: None,
        };
        assert!(bulk_external_targets(Some(&markdown_only)).is_empty());

        let mixed = MultiTargetExportRequest {
            targets: vec![
                ExternalExportTarget::Markdown,
                ExternalExportTarget::Obsidian,
                ExternalExportTarget::Notion,
                ExternalExportTarget::Notion,
            ],
            obsidian: None,
            notion: None,
        };
        assert_eq!(
            bulk_external_targets(Some(&mixed)),
            vec![ExternalExportTarget::Obsidian, ExternalExportTarget::Notion]
        );
    }

    #[test]
    fn report_and_index_render_external_target_results() {
        let report = BulkExportReport {
            exported_at: "100".to_string(),
            strategy: BulkExportStrategy::LocalCachedOnly,
            concurrency: 1,
            items: vec![
                BulkExportResultItem {
                    book_id: "book-1".to_string(),
                    title: "深度工作".to_string(),
                    status: BulkExportItemStatus::Exported,
                    notes_file: Some("notes/深度工作-100.md".to_string()),
                    ai_review_file: None,
                    targets: vec![
                        ExportTargetResult {
                            target: ExternalExportTarget::Obsidian,
                            status: ExportTargetStatus::Succeeded,
                            title: Some("深度工作".to_string()),
                            path: Some(
                                "C:/vault/wxreadmaster/书籍笔记/深度工作-100.md".to_string(),
                            ),
                            url: None,
                            page_id: None,
                            file_count: Some(1),
                            warning: None,
                            error: None,
                        },
                        ExportTargetResult {
                            target: ExternalExportTarget::Notion,
                            status: ExportTargetStatus::Succeeded,
                            title: Some("深度工作".to_string()),
                            path: None,
                            url: Some("https://www.notion.so/page-1".to_string()),
                            page_id: Some("page-1".to_string()),
                            file_count: None,
                            warning: Some("封面写入失败，正文已导入。".to_string()),
                            error: None,
                        },
                    ],
                    reason: "已导出本地笔记 Markdown；外部目标已完成 2 个。".to_string(),
                },
                BulkExportResultItem {
                    book_id: "book-2".to_string(),
                    title: "另一本".to_string(),
                    status: BulkExportItemStatus::Exported,
                    notes_file: Some("notes/另一本-100.md".to_string()),
                    ai_review_file: None,
                    targets: vec![ExportTargetResult {
                        target: ExternalExportTarget::Notion,
                        status: ExportTargetStatus::Failed,
                        title: None,
                        path: None,
                        url: None,
                        page_id: None,
                        file_count: None,
                        warning: None,
                        error: Some(ExportTargetError {
                            code: "notion_export_failed".to_string(),
                            message: "导入到 Notion 失败。".to_string(),
                            detail: None,
                        }),
                    }],
                    reason: "已导出本地笔记 Markdown；外部目标完成 0/1 个，失败 1 个。".to_string(),
                },
            ],
        };

        let report_markdown = serialize_bulk_export_report(&report);
        assert!(
            report_markdown.contains("- Obsidian：C:/vault/wxreadmaster/书籍笔记/深度工作-100.md")
        );
        assert!(report_markdown.contains("- Notion：https://www.notion.so/page-1"));
        assert!(report_markdown.contains("- Notion 警告：封面写入失败，正文已导入。"));
        assert!(report_markdown.contains("- Notion：失败（导入到 Notion 失败。）"));

        let index_markdown = serialize_bulk_export_index(&report);
        assert!(index_markdown.contains(" · [Notion](https://www.notion.so/page-1)"));
        assert!(index_markdown.contains(" · Obsidian ✓"));
        assert!(!index_markdown.contains("另一本-100.md) - Exported · [Notion]"));
    }

    fn notebook_book(book_id: &str, title: &str, total_note_count: i64) -> NotebookBookRecord {
        notebook_book_with_counts(book_id, title, total_note_count, 0, 0)
    }

    fn notebook_book_with_counts(
        book_id: &str,
        title: &str,
        review_count: i64,
        note_count: i64,
        bookmark_count: i64,
    ) -> NotebookBookRecord {
        NotebookBookRecord {
            book_id: book_id.to_string(),
            title: title.to_string(),
            author: Some("作者".to_string()),
            cover: None,
            review_count,
            note_count,
            bookmark_count,
            total_note_count: review_count + note_count + bookmark_count,
            reading_progress: None,
            marked_status: None,
            sort: None,
            raw_json: "{}".to_string(),
        }
    }

    fn book_notes(book_id: &str, exportable_count: usize) -> BookNotesRecord {
        BookNotesRecord {
            book_id: book_id.to_string(),
            book: None,
            highlights: vec![],
            thoughts: vec![],
            chapters: vec![],
            chapter_groups: vec![],
            bookmark_count: 0,
            exportable_count,
            bookmark_content_notice: "书签内容不可导出。".to_string(),
        }
    }
}
