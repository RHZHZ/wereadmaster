use serde::{Deserialize, Serialize};

use crate::mappers::notes::BookNotesRecord;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportSourceKind {
    BookNotes,
    BookReview,
    ReadingStatsReview,
    ReadingRoute,
    BookDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocument {
    pub source_kind: ExportSourceKind,
    pub source_id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<super::assets::ExportAsset>,
    pub front_matter: Vec<ExportMetaField>,
    pub sections: Vec<ExportSection>,
    pub exported_at: String,
    pub basis_notice: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSection {
    pub heading: String,
    pub body_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportMetaField {
    pub key: String,
    pub value: String,
}

impl ExportDocument {
    pub fn with_front_matter(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.front_matter.push(ExportMetaField {
            key: key.into(),
            value: value.into(),
        });
        self
    }

    pub fn from_book_notes(notes: &BookNotesRecord, exported_at: &str) -> Self {
        let book = notes.book.as_ref();
        let mut front_matter = vec![
            ExportMetaField {
                key: "bookId".to_string(),
                value: notes.book_id.clone(),
            },
            ExportMetaField {
                key: "highlightCount".to_string(),
                value: notes.highlights.len().to_string(),
            },
            ExportMetaField {
                key: "thoughtCount".to_string(),
                value: notes.thoughts.len().to_string(),
            },
            ExportMetaField {
                key: "bookmarkCount".to_string(),
                value: notes.bookmark_count.to_string(),
            },
            ExportMetaField {
                key: "exportableCount".to_string(),
                value: notes.exportable_count.to_string(),
            },
        ];
        if let Some(progress) = book.and_then(|value| value.reading_progress) {
            front_matter.push(ExportMetaField {
                key: "progress".to_string(),
                value: progress.clamp(0, 100).to_string(),
            });
        }

        Self {
            source_kind: ExportSourceKind::BookNotes,
            source_id: notes.book_id.clone(),
            title: book
                .map(|value| value.title.clone())
                .unwrap_or_else(|| notes.book_id.clone()),
            author: book.and_then(|value| value.author.clone()),
            cover: book.and_then(|value| value.cover.as_ref()).map(|url| {
                super::assets::ExportAsset {
                    kind: super::assets::ExportAssetKind::Cover,
                    remote_url: Some(url.clone()),
                    local_path: None,
                    file_name: None,
                    mime_type: None,
                }
            }),
            front_matter,
            sections: Vec::new(),
            exported_at: exported_at.to_string(),
            basis_notice: Some(notes.bookmark_content_notice.clone()),
        }
    }
}
