use std::{collections::BTreeSet, fmt::Write};

use serde::{Deserialize, Serialize};

use crate::mappers::notes::{BookNotesRecord, NotebookBookRecord};

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
    let _ = writeln!(markdown, "## 书籍");
    let _ = writeln!(markdown);

    for item in &report.items {
        let target = item
            .notes_file
            .as_deref()
            .or(item.ai_review_file.as_deref())
            .unwrap_or("export-report.md");
        let _ = writeln!(
            markdown,
            "- [{}]({}) - {:?}",
            item.title, target, item.status
        );
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
        let _ = writeln!(markdown);
    }

    markdown
}

#[cfg(test)]
mod tests {
    use crate::mappers::notes::{BookNotesRecord, NotebookBookRecord};

    use super::{
        build_bulk_export_preflight, chunk_bulk_export_jobs, normalize_bulk_export_concurrency,
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
                reason: "需要同步/读取后才能导出。".to_string(),
            }],
        };

        let markdown = serialize_bulk_export_report(&report);

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
