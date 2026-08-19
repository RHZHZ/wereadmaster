use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    db,
    services::vector_retrieval::{reciprocal_rank_fusion, RankedDocument},
};

pub const DEFAULT_NOTE_CONTEXT_TOP_K: usize = 20;
pub const MAX_NOTE_CONTEXT_TOP_K: usize = 60;
pub const DEFAULT_NOTE_CONTEXT_MAX_CHARS: usize = 12_000;
pub const MAX_NOTE_CONTEXT_ITEM_CHARS: usize = 500;
pub const DEFAULT_NOTE_RETRIEVAL_CANDIDATES: usize = 120;
const MIN_THOUGHT_RESULTS: usize = 4;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteType {
    Highlight,
    Thought,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoteRetrievalScope {
    Book(String),
    Library,
}

impl NoteRetrievalScope {
    fn cursor_key(&self) -> String {
        match self {
            Self::Book(book_id) => format!("book:{book_id}"),
            Self::Library => "library".to_string(),
        }
    }
}

impl NoteType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Highlight => "highlight",
            Self::Thought => "thought",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteRetrievalMode {
    Recent,
    Lexical,
    LikeFallback,
    Hybrid,
    HybridFallback,
}

impl NoteRetrievalMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Recent => "recent",
            Self::Lexical => "lexical",
            Self::LikeFallback => "likeFallback",
            Self::Hybrid => "hybrid",
            Self::HybridFallback => "hybridFallback",
        }
    }
}

/// 记录一次笔记检索的实际范围、策略和覆盖边界。
///
/// 该对象只描述本地检索事实，不包含 Provider 凭据或原始配置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalDiagnostic {
    pub scope: String,
    pub strategy: String,
    pub available_item_count: usize,
    pub matched_item_count: usize,
    pub included_item_count: usize,
    pub coverage: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteRetrievalPlan {
    pub query_text: String,
    pub exact_phrase: Option<String>,
    pub note_types: Vec<NoteType>,
    pub candidate_limit: usize,
    pub context_item_limit: usize,
    pub max_total_chars: usize,
    pub require_exhaustive_lexical_match: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalHit {
    pub document_id: String,
    pub source_type: String,
    pub source_id: String,
    pub book_id: String,
    pub book_title: Option<String>,
    pub chapter_uid: Option<i64>,
    pub chapter_title: Option<String>,
    pub text: String,
    pub created_at: Option<i64>,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteRetrievalResult {
    pub mode: NoteRetrievalMode,
    pub query_text: String,
    pub available_item_count: usize,
    pub matched_item_count: usize,
    pub exhaustive_match: bool,
    pub truncated: bool,
    pub has_more: bool,
    pub next_cursor: Option<String>,
    pub diagnostic: RetrievalDiagnostic,
    pub hits: Vec<RetrievalHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NoteRetrievalCursor {
    version: u8,
    mode: NoteRetrievalMode,
    score_bits: u64,
    created_at: i64,
    document_id: String,
    #[serde(default)]
    scope_key: Option<String>,
    #[serde(default)]
    ranked_document_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct StoredDocument {
    id: String,
    source_type: String,
    source_id: String,
    book_id: String,
    title: Option<String>,
    chapter_uid: Option<i64>,
    chapter_title: Option<String>,
    content: String,
    normalized_content: String,
    metadata: Value,
}

#[derive(Debug, Clone)]
struct SourceDocument {
    note_type: NoteType,
    source_id: String,
    chapter_uid: Option<i64>,
    chapter_title: Option<String>,
    content: String,
    created_at: Option<i64>,
    star: Option<i64>,
    source_updated_at: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct RetrievalSyncSummary {
    pub inserted: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub deleted: usize,
    pub total: usize,
}

pub fn normalize_retrieval_text(value: &str) -> String {
    let mut normalized = String::new();
    let mut pending_space = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_control() || character.is_whitespace() {
            pending_space = !normalized.is_empty();
            continue;
        }
        if pending_space {
            normalized.push(' ');
            pending_space = false;
        }
        normalized.push(character);
    }
    normalized.trim().to_string()
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
    )
}

pub fn build_retrieval_tokens(value: &str) -> Vec<String> {
    let normalized = normalize_retrieval_text(value);
    let mut tokens = Vec::new();
    let mut cjk_run = Vec::new();
    let mut word = String::new();

    let flush_cjk = |run: &mut Vec<char>, output: &mut Vec<String>| {
        if run.len() == 1 {
            output.push(run[0].to_string());
        } else {
            for pair in run.windows(2) {
                output.push(pair.iter().collect::<String>());
            }
        }
        run.clear();
    };
    let flush_word = |word: &mut String, output: &mut Vec<String>| {
        if !word.is_empty() {
            output.push(std::mem::take(word));
        }
    };

    for character in normalized.chars() {
        if is_cjk(character) {
            flush_word(&mut word, &mut tokens);
            cjk_run.push(character);
        } else if character.is_alphanumeric() || character == '_' {
            flush_cjk(&mut cjk_run, &mut tokens);
            word.push(character);
        } else {
            flush_cjk(&mut cjk_run, &mut tokens);
            flush_word(&mut word, &mut tokens);
        }
    }
    flush_cjk(&mut cjk_run, &mut tokens);
    flush_word(&mut word, &mut tokens);

    let mut seen = HashSet::new();
    tokens
        .into_iter()
        .filter(|token| !token.is_empty() && seen.insert(token.clone()))
        .collect()
}

fn token_stream(value: &str) -> String {
    build_retrieval_tokens(value).join(" ")
}

fn stable_content_hash(values: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"retrieval-content-hash-v1\0");
    for value in values {
        hasher.update((value.len() as u64).to_le_bytes());
        hasher.update(value.as_bytes());
    }
    format!("sha256-v1:{:x}", hasher.finalize())
}

pub fn plan_note_retrieval(message: &str) -> NoteRetrievalPlan {
    let normalized = normalize_retrieval_text(message);
    let exact_phrase = extract_quoted_phrase(message).or_else(|| {
        ["包含", "出现", "提到"]
            .iter()
            .find_map(|marker| normalized.split_once(marker).map(|(_, value)| value.trim()))
            .map(trim_query_scaffolding)
            .filter(|value| !value.is_empty())
    });
    let query_text = exact_phrase
        .clone()
        .unwrap_or_else(|| trim_query_scaffolding(&normalized));
    let thoughts_only = ["只看想法", "只找想法", "我的想法", "我的点评"]
        .iter()
        .any(|marker| normalized.contains(marker));
    let highlights_only = ["只看划线", "只找划线", "所有划线"]
        .iter()
        .any(|marker| normalized.contains(marker));
    let note_types = if thoughts_only {
        vec![NoteType::Thought]
    } else if highlights_only {
        vec![NoteType::Highlight]
    } else {
        vec![NoteType::Highlight, NoteType::Thought]
    };
    let asks_synthesis = ["总结", "归纳", "提炼", "主题", "对比", "梳理"]
        .iter()
        .any(|marker| normalized.contains(marker));
    let require_exhaustive_lexical_match = exact_phrase.is_some()
        && ["全部", "所有", "每条"]
            .iter()
            .any(|marker| normalized.contains(marker));

    NoteRetrievalPlan {
        query_text,
        exact_phrase,
        note_types,
        candidate_limit: DEFAULT_NOTE_RETRIEVAL_CANDIDATES,
        context_item_limit: if asks_synthesis {
            40
        } else {
            DEFAULT_NOTE_CONTEXT_TOP_K
        },
        max_total_chars: if asks_synthesis {
            20_000
        } else {
            DEFAULT_NOTE_CONTEXT_MAX_CHARS
        },
        require_exhaustive_lexical_match,
    }
}

fn extract_quoted_phrase(value: &str) -> Option<String> {
    [('“', '”'), ('‘', '’'), ('"', '"'), ('\'', '\'')]
        .into_iter()
        .find_map(|(start, end)| {
            let (_, tail) = value.split_once(start)?;
            let (phrase, _) = tail.split_once(end)?;
            let phrase = normalize_retrieval_text(phrase);
            (!phrase.is_empty()).then_some(phrase)
        })
}

fn trim_query_scaffolding(value: &str) -> String {
    let mut result = value.to_string();
    for phrase in [
        "请帮我",
        "帮我",
        "请",
        "找出",
        "查找",
        "搜索",
        "检索",
        "看看",
        "这本书",
        "当前书",
        "所有",
        "全部",
        "相关的",
        "相关",
        "笔记",
        "划线",
        "想法",
        "内容",
        "有哪些",
        "有关于",
        "关于",
        "与",
        "有关",
        "的",
    ] {
        result = result.replace(phrase, " ");
    }
    normalize_retrieval_text(&result)
}

pub fn rebuild_book_retrieval_documents(
    connection: &Connection,
    book_id: &str,
    indexed_at: &str,
) -> rusqlite::Result<usize> {
    synchronize_book_retrieval_documents(connection, book_id, indexed_at)
        .map(|summary| summary.total)
}

pub(crate) fn synchronize_book_retrieval_documents(
    connection: &Connection,
    book_id: &str,
    indexed_at: &str,
) -> rusqlite::Result<RetrievalSyncSummary> {
    let title = connection
        .query_row(
            "SELECT title FROM notebook_books WHERE book_id = ?1",
            [book_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .or_else(|| {
            connection
                .query_row(
                    "SELECT title FROM book_details WHERE book_id = ?1",
                    [book_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
        });

    let mut documents = Vec::new();
    {
        let mut statement = connection.prepare(
            "SELECT bookmark_id, chapter_uid, chapter_title, mark_text, create_time, updated_at
             FROM highlights WHERE book_id = ?1",
        )?;
        let rows = statement.query_map([book_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        for row in rows {
            let (source_id, chapter_uid, chapter_title, content, created_at, source_updated_at) =
                row?;
            documents.push(SourceDocument {
                note_type: NoteType::Highlight,
                source_id,
                chapter_uid,
                chapter_title,
                content,
                created_at,
                star: None,
                source_updated_at,
            });
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT review_id, chapter_uid, chapter_name, content, create_time, star, updated_at
             FROM thoughts WHERE book_id = ?1",
        )?;
        let rows = statement.query_map([book_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        for row in rows {
            let (
                source_id,
                chapter_uid,
                chapter_title,
                content,
                created_at,
                star,
                source_updated_at,
            ) = row?;
            documents.push(SourceDocument {
                note_type: NoteType::Thought,
                source_id,
                chapter_uid,
                chapter_title,
                content,
                created_at,
                star,
                source_updated_at,
            });
        }
    }

    let transaction = connection.unchecked_transaction()?;
    let fts_available = db::retrieval_fts_available(&transaction);
    let existing = {
        let mut statement = transaction
            .prepare("SELECT id, content_hash FROM retrieval_documents WHERE book_id = ?1")?;
        let rows = statement
            .query_map([book_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        rows
    };
    let mut incoming_ids = HashSet::with_capacity(documents.len());
    let mut summary = RetrievalSyncSummary::default();

    for document in documents {
        let document_id = format!(
            "note:{}:{}",
            document.note_type.as_str(),
            document.source_id
        );
        incoming_ids.insert(document_id.clone());
        let normalized_content = normalize_retrieval_text(&document.content);
        let metadata_json =
            json!({ "createdAt": document.created_at, "star": document.star }).to_string();
        let content_hash = stable_content_hash(&[
            document.note_type.as_str(),
            &document.source_id,
            title.as_deref().unwrap_or(""),
            document.chapter_title.as_deref().unwrap_or(""),
            &normalized_content,
        ]);
        let content_changed = match existing.get(&document_id) {
            Some(previous_hash) if previous_hash == &content_hash => {
                transaction.execute(
                    "UPDATE retrieval_documents
                     SET chapter_uid = ?2,
                         chapter_title = ?3,
                         title = ?4,
                         content = ?5,
                         normalized_content = ?6,
                         metadata_json = ?7,
                         source_updated_at = ?8,
                         deleted_at = NULL
                     WHERE id = ?1",
                    params![
                        &document_id,
                        document.chapter_uid,
                        &document.chapter_title,
                        title.as_deref(),
                        &document.content,
                        &normalized_content,
                        &metadata_json,
                        &document.source_updated_at,
                    ],
                )?;
                summary.unchanged += 1;
                continue;
            }
            Some(_) => {
                summary.updated += 1;
                true
            }
            None => {
                summary.inserted += 1;
                false
            }
        };
        if content_changed {
            transaction.execute(
                "DELETE FROM retrieval_embeddings WHERE document_id = ?1",
                [&document_id],
            )?;
        }

        transaction.execute(
            "INSERT INTO retrieval_documents (
                id, source_type, source_id, book_id, chapter_uid, chapter_title, title,
                content, normalized_content, metadata_json, content_hash,
                source_updated_at, indexed_at, deleted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL)
             ON CONFLICT(id) DO UPDATE SET
                source_type = excluded.source_type,
                source_id = excluded.source_id,
                book_id = excluded.book_id,
                chapter_uid = excluded.chapter_uid,
                chapter_title = excluded.chapter_title,
                title = excluded.title,
                content = excluded.content,
                normalized_content = excluded.normalized_content,
                metadata_json = excluded.metadata_json,
                content_hash = excluded.content_hash,
                source_updated_at = excluded.source_updated_at,
                indexed_at = excluded.indexed_at,
                deleted_at = NULL",
            params![
                &document_id,
                document.note_type.as_str(),
                &document.source_id,
                book_id,
                document.chapter_uid,
                &document.chapter_title,
                title.as_deref(),
                &document.content,
                &normalized_content,
                &metadata_json,
                &content_hash,
                &document.source_updated_at,
                indexed_at,
            ],
        )?;
        if fts_available {
            transaction.execute(
                "DELETE FROM retrieval_documents_fts WHERE document_id = ?1",
                [&document_id],
            )?;
            transaction.execute(
                "INSERT INTO retrieval_documents_fts (
                    document_id, title_tokens, chapter_tokens, content_tokens
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    &document_id,
                    token_stream(title.as_deref().unwrap_or("")),
                    token_stream(document.chapter_title.as_deref().unwrap_or("")),
                    token_stream(&document.content),
                ],
            )?;
        }
    }

    for document_id in existing.keys().filter(|id| !incoming_ids.contains(*id)) {
        transaction.execute(
            "DELETE FROM retrieval_embeddings WHERE document_id = ?1",
            [document_id],
        )?;
        if fts_available {
            transaction.execute(
                "DELETE FROM retrieval_documents_fts WHERE document_id = ?1",
                [document_id],
            )?;
        }
        summary.deleted += transaction.execute(
            "DELETE FROM retrieval_documents WHERE id = ?1 AND book_id = ?2",
            params![document_id, book_id],
        )?;
    }

    summary.total = transaction.query_row(
        "SELECT COUNT(*) FROM retrieval_documents WHERE book_id = ?1 AND deleted_at IS NULL",
        [book_id],
        |row| row.get::<_, i64>(0),
    )? as usize;
    transaction.execute(
        "UPDATE retrieval_index_profiles
         SET total_document_count = (
                SELECT COUNT(*) FROM retrieval_documents WHERE deleted_at IS NULL
             ),
             indexed_document_count = (
                SELECT COUNT(*)
                FROM retrieval_embeddings e
                JOIN retrieval_documents d ON d.id = e.document_id
                WHERE e.profile_id = retrieval_index_profiles.id
                  AND d.deleted_at IS NULL
                  AND e.content_hash = d.content_hash
             ),
             status = CASE
                WHEN status = 'ready' AND (
                    SELECT COUNT(*)
                    FROM retrieval_embeddings e
                    JOIN retrieval_documents d ON d.id = e.document_id
                    WHERE e.profile_id = retrieval_index_profiles.id
                      AND d.deleted_at IS NULL
                      AND e.content_hash = d.content_hash
                ) < (SELECT COUNT(*) FROM retrieval_documents WHERE deleted_at IS NULL)
                THEN 'building'
                ELSE status
             END,
             completed_at = CASE
                WHEN status = 'ready' AND (
                    SELECT COUNT(*)
                    FROM retrieval_embeddings e
                    JOIN retrieval_documents d ON d.id = e.document_id
                    WHERE e.profile_id = retrieval_index_profiles.id
                      AND d.deleted_at IS NULL
                      AND e.content_hash = d.content_hash
                ) < (SELECT COUNT(*) FROM retrieval_documents WHERE deleted_at IS NULL)
                THEN NULL
                ELSE completed_at
             END
         WHERE status IN ('building', 'ready')",
        [],
    )?;
    transaction.commit()?;
    Ok(summary)
}

pub(crate) fn rebuild_retrieval_fts(connection: &Connection) -> rusqlite::Result<usize> {
    if !db::ensure_retrieval_fts_schema(connection)? {
        return Ok(0);
    }
    let transaction = connection.unchecked_transaction()?;
    transaction.execute("DELETE FROM retrieval_documents_fts", [])?;
    let documents = {
        let mut statement = transaction.prepare(
            "SELECT id, title, chapter_title, content
             FROM retrieval_documents
             WHERE deleted_at IS NULL
             ORDER BY id ASC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (document_id, title, chapter_title, content) in &documents {
        transaction.execute(
            "INSERT INTO retrieval_documents_fts (
                document_id, title_tokens, chapter_tokens, content_tokens
             ) VALUES (?1, ?2, ?3, ?4)",
            params![
                document_id,
                token_stream(title.as_deref().unwrap_or("")),
                token_stream(chapter_title.as_deref().unwrap_or("")),
                token_stream(content),
            ],
        )?;
    }
    transaction.commit()?;
    Ok(documents.len())
}

pub fn search_book_notes(
    connection: &Connection,
    book_id: &str,
    plan: &NoteRetrievalPlan,
    cursor: Option<&str>,
    page_limit: Option<usize>,
) -> rusqlite::Result<NoteRetrievalResult> {
    let mode = if plan.query_text.is_empty() {
        NoteRetrievalMode::Recent
    } else if db::retrieval_fts_available(connection) {
        NoteRetrievalMode::Lexical
    } else {
        NoteRetrievalMode::LikeFallback
    };
    search_notes_with_scope(
        connection,
        &NoteRetrievalScope::Book(book_id.to_string()),
        plan,
        cursor,
        page_limit,
        None,
        mode,
    )
}

pub fn search_library_notes(
    connection: &Connection,
    plan: &NoteRetrievalPlan,
    cursor: Option<&str>,
    page_limit: Option<usize>,
) -> rusqlite::Result<NoteRetrievalResult> {
    let mode = if plan.query_text.is_empty() {
        NoteRetrievalMode::Recent
    } else if db::retrieval_fts_available(connection) {
        NoteRetrievalMode::Lexical
    } else {
        NoteRetrievalMode::LikeFallback
    };
    search_notes_with_scope(
        connection,
        &NoteRetrievalScope::Library,
        plan,
        cursor,
        page_limit,
        None,
        mode,
    )
}

pub fn search_book_notes_with_ranked_vector(
    connection: &Connection,
    book_id: &str,
    plan: &NoteRetrievalPlan,
    cursor: Option<&str>,
    page_limit: Option<usize>,
    vector_rank: Option<&[RankedDocument]>,
    mode: NoteRetrievalMode,
) -> rusqlite::Result<NoteRetrievalResult> {
    search_notes_with_scope(
        connection,
        &NoteRetrievalScope::Book(book_id.to_string()),
        plan,
        cursor,
        page_limit,
        vector_rank,
        mode,
    )
}

pub fn search_library_notes_with_ranked_vector(
    connection: &Connection,
    plan: &NoteRetrievalPlan,
    cursor: Option<&str>,
    page_limit: Option<usize>,
    vector_rank: Option<&[RankedDocument]>,
    mode: NoteRetrievalMode,
) -> rusqlite::Result<NoteRetrievalResult> {
    search_notes_with_scope(
        connection,
        &NoteRetrievalScope::Library,
        plan,
        cursor,
        page_limit,
        vector_rank,
        mode,
    )
}

fn search_notes_with_scope(
    connection: &Connection,
    scope: &NoteRetrievalScope,
    plan: &NoteRetrievalPlan,
    cursor: Option<&str>,
    page_limit: Option<usize>,
    vector_rank: Option<&[RankedDocument]>,
    mode: NoteRetrievalMode,
) -> rusqlite::Result<NoteRetrievalResult> {
    let available_item_count = read_scope_available_item_count(connection, scope)?;
    let mut documents = read_scope_documents(connection, scope, &plan.note_types)?;
    let query_tokens = build_retrieval_tokens(&plan.query_text);
    let exact_phrase = plan
        .exact_phrase
        .as_deref()
        .map(normalize_retrieval_text)
        .filter(|value| !value.is_empty());
    let fts_available = db::retrieval_fts_available(connection);
    let fts_ids = if fts_available && !query_tokens.is_empty() {
        fts_candidate_ids(connection, scope, &query_tokens, plan.candidate_limit)
            .unwrap_or_default()
    } else {
        HashSet::new()
    };

    let cursor_state = cursor.and_then(decode_cursor).filter(|state| {
        state.scope_key.as_deref() == Some(scope.cursor_key().as_str())
            || (matches!(scope, NoteRetrievalScope::Book(_)) && state.scope_key.is_none())
    });
    let cursor_ranked_ids = cursor_state
        .as_ref()
        .filter(|state| matches!(state.mode, NoteRetrievalMode::Hybrid))
        .map(|state| state.ranked_document_ids.as_slice())
        .filter(|ranked| !ranked.is_empty());
    let effective_mode = cursor_state
        .as_ref()
        .map(|state| state.mode)
        .unwrap_or(mode);
    let vector_ranking_ids = effective_mode
        .eq(&NoteRetrievalMode::Hybrid)
        .then(|| effective_vector_rank_ids(vector_rank, cursor_ranked_ids))
        .unwrap_or_default();
    let vector_ids = vector_ranking_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let lexical_matches = |document: &StoredDocument| {
        if let Some(phrase) = exact_phrase.as_deref() {
            document.normalized_content.contains(phrase)
                || document
                    .chapter_title
                    .as_deref()
                    .map(normalize_retrieval_text)
                    .is_some_and(|chapter| chapter.contains(phrase))
        } else if query_tokens.is_empty() {
            true
        } else {
            fts_ids.contains(&document.id)
                || query_tokens.iter().any(|token| {
                    token.len() >= 2
                        && (document.normalized_content.contains(token)
                            || document
                                .chapter_title
                                .as_deref()
                                .map(normalize_retrieval_text)
                                .is_some_and(|chapter| chapter.contains(token)))
                })
        }
    };
    documents.retain(|document| {
        lexical_matches(document)
            || (matches!(effective_mode, NoteRetrievalMode::Hybrid)
                && vector_ids.contains(document.id.as_str()))
    });

    let matched_item_count = documents.len();
    for document in &mut documents {
        let overlap = query_tokens
            .iter()
            .filter(|token| {
                document.normalized_content.contains(token.as_str())
                    || document
                        .chapter_title
                        .as_deref()
                        .map(normalize_retrieval_text)
                        .is_some_and(|chapter| chapter.contains(token.as_str()))
            })
            .count() as f64;
        let exact_bonus = exact_phrase
            .as_deref()
            .is_some_and(|phrase| document.normalized_content.contains(phrase))
            as u8 as f64
            * 8.0;
        let thought_bonus = (document.source_type == "thought") as u8 as f64 * 0.75;
        let star_bonus = document
            .metadata
            .get("star")
            .and_then(Value::as_i64)
            .unwrap_or_default()
            .clamp(0, 5) as f64
            * 0.1;
        let lexical_score = overlap * 2.0 + exact_bonus + thought_bonus + star_bonus;
        document.metadata["score"] = json!(lexical_score);
    }
    documents.sort_by(|left, right| {
        score_of(right)
            .partial_cmp(&score_of(left))
            .unwrap_or(Ordering::Equal)
            .then_with(|| created_at_of(right).cmp(&created_at_of(left)))
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut stable_ranked_document_ids = Vec::new();
    if matches!(effective_mode, NoteRetrievalMode::Hybrid) {
        stable_ranked_document_ids = if let Some(ranked) = cursor_ranked_ids {
            ranked.to_vec()
        } else {
            let lexical_ids = documents
                .iter()
                .filter(|document| lexical_matches(document))
                .map(|document| document.id.clone())
                .collect::<Vec<_>>();
            reciprocal_rank_fusion(&lexical_ids, &vector_ranking_ids, documents.len())
                .into_iter()
                .map(|item| item.document_id)
                .collect()
        };
        let fused_scores = stable_ranked_document_ids
            .iter()
            .enumerate()
            .map(|(index, document_id)| (document_id.as_str(), index))
            .collect::<HashMap<_, _>>();
        for document in &mut documents {
            let rank = fused_scores
                .get(document.id.as_str())
                .copied()
                .unwrap_or(usize::MAX);
            document.metadata["score"] = json!(1.0 / (rank.saturating_add(1) as f64));
        }
    }
    documents.sort_by(|left, right| {
        score_of(right)
            .partial_cmp(&score_of(left))
            .unwrap_or(Ordering::Equal)
            .then_with(|| created_at_of(right).cmp(&created_at_of(left)))
            .then_with(|| left.id.cmp(&right.id))
    });

    if cursor.is_some() && cursor_state.is_none() {
        return Err(rusqlite::Error::InvalidParameterName(
            "note search cursor is invalid".to_string(),
        ));
    }
    if let Some(cursor_key) = cursor_state.as_ref() {
        documents.retain(|document| document_is_after_cursor(document, cursor_key));
    }
    let remaining_item_count = documents.len();
    let requested_limit = page_limit
        .unwrap_or(plan.context_item_limit)
        .clamp(1, MAX_NOTE_CONTEXT_TOP_K);
    let ranked_document_ids = stable_ranked_document_ids;
    let (selected, has_more, next_cursor) = if page_limit.is_some() {
        let selected = documents
            .into_iter()
            .take(requested_limit)
            .collect::<Vec<_>>();
        let has_more = selected.len() < remaining_item_count;
        let next_cursor = has_more
            .then(|| {
                selected.last().map(|document| {
                    encode_cursor(
                        document,
                        effective_mode,
                        &scope.cursor_key(),
                        &ranked_document_ids,
                    )
                })
            })
            .flatten();
        (selected, has_more, next_cursor)
    } else {
        let candidate_window_limit = requested_limit.saturating_mul(4).min(remaining_item_count);
        let page_candidates = documents
            .into_iter()
            .take(candidate_window_limit)
            .collect::<Vec<_>>();
        let next_cursor = page_candidates.last().map(|document| {
            encode_cursor(
                document,
                effective_mode,
                &scope.cursor_key(),
                &ranked_document_ids,
            )
        });
        let selected = diversity_rerank(
            page_candidates,
            requested_limit,
            plan.max_total_chars,
            plan.note_types.len() == 1,
        );
        let has_more = candidate_window_limit < remaining_item_count;
        let next_cursor = has_more.then_some(next_cursor).flatten();
        (selected, has_more, next_cursor)
    };
    let hits = selected.into_iter().map(to_hit).collect::<Vec<_>>();
    let coverage = if plan.require_exhaustive_lexical_match {
        "exhaustiveMatch"
    } else {
        "sampled"
    };
    let scope_label = match scope {
        NoteRetrievalScope::Book(_) => "book",
        NoteRetrievalScope::Library => "library",
    };

    Ok(NoteRetrievalResult {
        mode: effective_mode,
        query_text: plan.query_text.clone(),
        available_item_count,
        matched_item_count,
        exhaustive_match: plan.require_exhaustive_lexical_match,
        truncated: hits.len() < matched_item_count,
        has_more,
        next_cursor,
        diagnostic: RetrievalDiagnostic {
            scope: scope_label.to_string(),
            strategy: effective_mode.as_str().to_string(),
            available_item_count,
            matched_item_count,
            included_item_count: hits.len(),
            coverage: coverage.to_string(),
            index_status: None,
            reason: None,
        },
        hits,
    })
}

fn effective_vector_rank_ids(
    vector_rank: Option<&[RankedDocument]>,
    cursor_ranked_ids: Option<&[String]>,
) -> Vec<String> {
    vector_rank
        .map(|ranked| {
            ranked
                .iter()
                .map(|item| item.document_id.clone())
                .collect::<Vec<_>>()
        })
        .or_else(|| cursor_ranked_ids.map(<[String]>::to_vec))
        .unwrap_or_default()
}

fn read_scope_available_item_count(
    connection: &Connection,
    scope: &NoteRetrievalScope,
) -> rusqlite::Result<usize> {
    match scope {
        NoteRetrievalScope::Book(book_id) => connection.query_row(
            "SELECT COUNT(*) FROM retrieval_documents WHERE book_id = ?1 AND deleted_at IS NULL",
            [book_id],
            |row| row.get::<_, i64>(0),
        ),
        NoteRetrievalScope::Library => connection.query_row(
            "SELECT COUNT(*) FROM retrieval_documents WHERE deleted_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        ),
    }
    .map(|count| count as usize)
}

fn read_scope_documents(
    connection: &Connection,
    scope: &NoteRetrievalScope,
    note_types: &[NoteType],
) -> rusqlite::Result<Vec<StoredDocument>> {
    let allowed = note_types
        .iter()
        .map(|value| value.as_str())
        .collect::<HashSet<_>>();
    let sql = match scope {
        NoteRetrievalScope::Book(_) => {
            "SELECT id, source_type, source_id, book_id, title, chapter_uid, chapter_title,
                    content, normalized_content, metadata_json
             FROM retrieval_documents
             WHERE book_id = ?1 AND deleted_at IS NULL"
        }
        NoteRetrievalScope::Library => {
            "SELECT id, source_type, source_id, book_id, title, chapter_uid, chapter_title,
                    content, normalized_content, metadata_json
             FROM retrieval_documents
             WHERE deleted_at IS NULL"
        }
    };
    let mut statement = connection.prepare(sql)?;
    let map_row = |row: &rusqlite::Row<'_>| {
        let metadata_json = row.get::<_, String>(9)?;
        Ok(StoredDocument {
            id: row.get(0)?,
            source_type: row.get(1)?,
            source_id: row.get(2)?,
            book_id: row.get(3)?,
            title: row.get(4)?,
            chapter_uid: row.get(5)?,
            chapter_title: row.get(6)?,
            content: row.get(7)?,
            normalized_content: row.get(8)?,
            metadata: serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({})),
        })
    };
    let rows = match scope {
        NoteRetrievalScope::Book(book_id) => statement.query_map([book_id], map_row)?,
        NoteRetrievalScope::Library => statement.query_map([], map_row)?,
    };
    rows.filter_map(|row| match row {
        Ok(document) if allowed.contains(document.source_type.as_str()) => Some(Ok(document)),
        Ok(_) => None,
        Err(error) => Some(Err(error)),
    })
    .collect()
}

fn fts_candidate_ids(
    connection: &Connection,
    scope: &NoteRetrievalScope,
    query_tokens: &[String],
    limit: usize,
) -> rusqlite::Result<HashSet<String>> {
    let match_query = query_tokens
        .iter()
        .take(24)
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = match scope {
        NoteRetrievalScope::Book(_) => {
            "SELECT f.document_id
             FROM retrieval_documents_fts f
             JOIN retrieval_documents d ON d.id = f.document_id
             WHERE retrieval_documents_fts MATCH ?1
               AND d.book_id = ?2 AND d.deleted_at IS NULL
             ORDER BY bm25(retrieval_documents_fts), f.document_id
             LIMIT ?3"
        }
        NoteRetrievalScope::Library => {
            "SELECT f.document_id
             FROM retrieval_documents_fts f
             JOIN retrieval_documents d ON d.id = f.document_id
             WHERE retrieval_documents_fts MATCH ?1
               AND d.deleted_at IS NULL
             ORDER BY bm25(retrieval_documents_fts), f.document_id
             LIMIT ?2"
        }
    };
    let mut statement = connection.prepare(sql)?;
    match scope {
        NoteRetrievalScope::Book(book_id) => statement
            .query_map(params![match_query, book_id, limit as i64], |row| {
                row.get(0)
            })?
            .collect(),
        NoteRetrievalScope::Library => statement
            .query_map(params![match_query, limit as i64], |row| row.get(0))?
            .collect(),
    }
}

fn diversity_rerank(
    documents: Vec<StoredDocument>,
    limit: usize,
    max_total_chars: usize,
    single_type: bool,
) -> Vec<StoredDocument> {
    let mut selected = Vec::new();
    let mut selected_ids = HashSet::new();
    let mut normalized_seen = HashSet::new();
    let mut chapter_counts: HashMap<String, usize> = HashMap::new();
    let max_per_chapter = ((limit as f64 * 0.4).ceil() as usize).max(1);
    let thought_target = if single_type {
        0
    } else {
        MIN_THOUGHT_RESULTS.min(limit)
    };
    let mut total_chars = 0;

    let push = |document: &StoredDocument,
                selected: &mut Vec<StoredDocument>,
                selected_ids: &mut HashSet<String>,
                normalized_seen: &mut HashSet<String>,
                chapter_counts: &mut HashMap<String, usize>,
                total_chars: &mut usize|
     -> bool {
        let item_chars = document
            .content
            .chars()
            .count()
            .min(MAX_NOTE_CONTEXT_ITEM_CHARS);
        if *total_chars + item_chars > max_total_chars && !selected.is_empty() {
            return false;
        }
        let duplicate_key = document
            .normalized_content
            .chars()
            .take(160)
            .collect::<String>();
        if !normalized_seen.insert(duplicate_key) {
            return false;
        }
        let chapter_key = document.chapter_title.clone().unwrap_or_default();
        if !chapter_key.is_empty()
            && chapter_counts.get(&chapter_key).copied().unwrap_or(0) >= max_per_chapter
        {
            return false;
        }
        selected_ids.insert(document.id.clone());
        *chapter_counts.entry(chapter_key).or_default() += 1;
        *total_chars += item_chars;
        selected.push(document.clone());
        true
    };

    if thought_target > 0 {
        for document in documents
            .iter()
            .filter(|item| item.source_type == "thought")
        {
            if selected.len() >= thought_target {
                break;
            }
            push(
                document,
                &mut selected,
                &mut selected_ids,
                &mut normalized_seen,
                &mut chapter_counts,
                &mut total_chars,
            );
        }
    }
    for document in &documents {
        if selected.len() >= limit {
            break;
        }
        if selected_ids.contains(&document.id) {
            continue;
        }
        push(
            document,
            &mut selected,
            &mut selected_ids,
            &mut normalized_seen,
            &mut chapter_counts,
            &mut total_chars,
        );
    }
    selected.sort_by(|left, right| {
        score_of(right)
            .partial_cmp(&score_of(left))
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.id.cmp(&right.id))
    });
    selected
}

fn score_of(document: &StoredDocument) -> f64 {
    document
        .metadata
        .get("score")
        .and_then(Value::as_f64)
        .unwrap_or_default()
}

fn created_at_of(document: &StoredDocument) -> i64 {
    document
        .metadata
        .get("createdAt")
        .and_then(Value::as_i64)
        .unwrap_or_default()
}

fn to_hit(document: StoredDocument) -> RetrievalHit {
    let score = score_of(&document);
    let created_at = document.metadata.get("createdAt").and_then(Value::as_i64);
    RetrievalHit {
        document_id: document.id,
        source_type: document.source_type,
        source_id: document.source_id,
        book_id: document.book_id,
        book_title: document.title,
        chapter_uid: document.chapter_uid,
        chapter_title: document.chapter_title,
        text: document
            .content
            .chars()
            .take(MAX_NOTE_CONTEXT_ITEM_CHARS)
            .collect(),
        created_at,
        score,
    }
}

fn encode_cursor(
    document: &StoredDocument,
    mode: NoteRetrievalMode,
    scope_key: &str,
    ranked_document_ids: &[String],
) -> String {
    let state = NoteRetrievalCursor {
        version: 1,
        mode,
        score_bits: score_of(document).to_bits(),
        created_at: created_at_of(document),
        document_id: document.id.clone(),
        scope_key: Some(scope_key.to_string()),
        ranked_document_ids: ranked_document_ids.to_vec(),
    };
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&state).unwrap_or_default())
}

fn decode_cursor(cursor: &str) -> Option<NoteRetrievalCursor> {
    let bytes = URL_SAFE_NO_PAD.decode(cursor).ok()?;
    let state = serde_json::from_slice::<NoteRetrievalCursor>(&bytes).ok()?;
    (state.version == 1 && !state.document_id.is_empty()).then_some(state)
}

pub fn is_valid_note_retrieval_cursor(cursor: &str) -> bool {
    decode_cursor(cursor).is_some()
}

fn document_is_after_cursor(document: &StoredDocument, cursor: &NoteRetrievalCursor) -> bool {
    let document_key = (
        score_of(document).to_bits(),
        created_at_of(document),
        &document.id,
    );
    document_key.0 < cursor.score_bits
        || (document_key.0 == cursor.score_bits
            && (document_key.1 < cursor.created_at
                || (document_key.1 == cursor.created_at && document_key.2 > &cursor.document_id)))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use crate::db::initialize_schema;

    use super::{
        build_retrieval_tokens, normalize_retrieval_text, plan_note_retrieval,
        rebuild_book_retrieval_documents, search_book_notes, search_book_notes_with_ranked_vector,
        synchronize_book_retrieval_documents, NoteRetrievalMode, NoteType,
    };
    use crate::services::vector_retrieval::RankedDocument;

    fn seed_embedding(connection: &Connection, profile_id: &str, document_id: &str) {
        let content_hash: String = connection
            .query_row(
                "SELECT content_hash FROM retrieval_documents WHERE id = ?1",
                [document_id],
                |row| row.get(0),
            )
            .expect("document hash should read");
        connection
            .execute(
                "INSERT INTO retrieval_index_profiles (
                    id, provider_kind, model_id, dimensions, distance_metric,
                    normalization_version, chunking_version, content_hash_version,
                    status, total_document_count, indexed_document_count,
                    created_at, updated_at
                 ) VALUES (?1, 'deterministic-test', 'fixture-v1', 2, 'cosine',
                    'retrieval-text-v1', 'document-v1', 'sha256-v1',
                    'building', 1, 1, '100', '100')",
                [profile_id],
            )
            .expect("profile should insert");
        connection
            .execute(
                "INSERT INTO retrieval_embeddings (
                    profile_id, document_id, content_hash, dimensions, vector_blob,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 2, X'0000000000000000', '100', '100')",
                rusqlite::params![profile_id, document_id, content_hash],
            )
            .expect("embedding should insert");
    }

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "INSERT INTO notebook_books (book_id, title, author, review_count, note_count, bookmark_count, total_note_count, raw_json, updated_at)
                 VALUES ('b1', '测试书', '作者', 0, 0, 0, 0, '{}', '100')",
                [],
            )
            .expect("book should insert");
        for (id, chapter, text, time) in [
            ("h1", "第一章", "深度工作需要不受干扰的专注时间", 100),
            ("h2", "第二章", "宽恕并不等于遗忘", 90),
            ("h3", "第三章", "希望来自持续行动", 80),
        ] {
            connection
                .execute(
                    "INSERT INTO highlights (bookmark_id, book_id, chapter_title, mark_text, create_time, raw_json, updated_at)
                     VALUES (?1, 'b1', ?2, ?3, ?4, '{}', '100')",
                    rusqlite::params![id, chapter, text, time],
                )
                .expect("highlight should insert");
        }
        connection
            .execute(
                "INSERT INTO thoughts (review_id, book_id, content, create_time, star, chapter_name, raw_json, updated_at)
                 VALUES ('t1', 'b1', '我想到宽恕也需要边界', 110, 5, '第二章', '{}', '100')",
                [],
            )
            .expect("thought should insert");
        rebuild_book_retrieval_documents(&connection, "b1", "100")
            .expect("documents should rebuild");
        connection
    }

    #[test]
    fn chinese_bigram_and_latin_tokens_are_stable() {
        assert_eq!(
            build_retrieval_tokens("宽恕与 Hope 2026"),
            vec!["宽恕", "恕与", "hope", "2026"]
        );
        assert_eq!(build_retrieval_tokens("宽"), vec!["宽"]);
        assert_eq!(normalize_retrieval_text("  深度\n工作  "), "深度 工作");
    }

    #[test]
    fn planner_detects_exact_exhaustive_and_type_filters() {
        let plan = plan_note_retrieval("找出包含“宽恕”的所有笔记，只看想法");
        assert_eq!(plan.exact_phrase.as_deref(), Some("宽恕"));
        assert!(plan.require_exhaustive_lexical_match);
        assert_eq!(plan.note_types, vec![NoteType::Thought]);
    }

    #[test]
    fn lexical_search_finds_different_note_types_and_reports_counts() {
        let connection = fixture();
        let plan = plan_note_retrieval("找出与宽恕有关的笔记");
        let result =
            search_book_notes(&connection, "b1", &plan, None, None).expect("search should succeed");

        assert_eq!(result.mode, NoteRetrievalMode::Lexical);
        assert_eq!(result.available_item_count, 4);
        assert_eq!(result.matched_item_count, 2);
        assert_eq!(result.hits.len(), 2);
        assert_eq!(result.diagnostic.scope, "book");
        assert_eq!(result.diagnostic.strategy, "lexical");
        assert_eq!(result.diagnostic.available_item_count, 4);
        assert_eq!(result.diagnostic.matched_item_count, 2);
        assert_eq!(result.diagnostic.included_item_count, 2);
        assert_eq!(result.diagnostic.coverage, "sampled");
        assert!(result.hits.iter().any(|hit| hit.source_type == "highlight"));
        assert!(result.hits.iter().any(|hit| hit.source_type == "thought"));
    }

    #[test]
    fn hybrid_search_fuses_vector_only_candidates_and_preserves_cursor_state() {
        let connection = fixture();
        let plan = plan_note_retrieval("保持注意力");
        let vector_rank = vec![
            RankedDocument {
                document_id: "note:highlight:h1".to_string(),
                score: 0.99,
            },
            RankedDocument {
                document_id: "note:thought:t1".to_string(),
                score: 0.75,
            },
        ];
        let result = search_book_notes_with_ranked_vector(
            &connection,
            "b1",
            &plan,
            None,
            Some(1),
            Some(&vector_rank),
            NoteRetrievalMode::Hybrid,
        )
        .expect("hybrid search should succeed");

        assert_eq!(result.mode, NoteRetrievalMode::Hybrid);
        assert_eq!(result.matched_item_count, 2);
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].document_id, "note:highlight:h1");
        assert_eq!(result.diagnostic.strategy, "hybrid");
        assert_eq!(result.diagnostic.included_item_count, 1);
        assert!(result.has_more);
        let cursor = result
            .next_cursor
            .as_deref()
            .expect("hybrid page should expose cursor");
        let next = search_book_notes_with_ranked_vector(
            &connection,
            "b1",
            &plan,
            Some(cursor),
            Some(1),
            None,
            NoteRetrievalMode::Hybrid,
        )
        .expect("hybrid cursor page should succeed");
        assert_eq!(next.mode, NoteRetrievalMode::Hybrid);
        assert_eq!(next.hits.len(), 1);
        assert_eq!(next.hits[0].document_id, "note:thought:t1");
        assert!(!next.has_more);
        assert!(next.next_cursor.is_none());
    }

    #[test]
    fn like_fallback_and_empty_result_keep_local_count_contracts() {
        let connection = fixture();
        connection
            .execute("DROP TABLE retrieval_documents_fts", [])
            .expect("fts table should drop for fallback simulation");

        let matched_plan = plan_note_retrieval("找出与宽恕有关的笔记");
        let matched = search_book_notes(&connection, "b1", &matched_plan, None, Some(20))
            .expect("fallback search should succeed");
        assert_eq!(matched.mode, NoteRetrievalMode::LikeFallback);
        assert_eq!(matched.available_item_count, 4);
        assert_eq!(matched.matched_item_count, 2);
        assert_eq!(matched.hits.len(), 2);
        assert_eq!(matched.diagnostic.strategy, "likeFallback");
        assert_eq!(matched.diagnostic.coverage, "sampled");

        let empty_plan = plan_note_retrieval("找出与量子纠缠有关的笔记");
        let empty = search_book_notes(&connection, "b1", &empty_plan, None, Some(20))
            .expect("empty fallback search should succeed");
        assert_eq!(empty.mode, NoteRetrievalMode::LikeFallback);
        assert_eq!(empty.available_item_count, 4);
        assert_eq!(empty.matched_item_count, 0);
        assert!(empty.hits.is_empty());
        assert!(!empty.has_more);
        assert!(empty.next_cursor.is_none());
    }

    #[test]
    fn incremental_sync_preserves_unchanged_documents_and_updates_only_changed_rows() {
        let connection = fixture();
        let original_hash: String = connection
            .query_row(
                "SELECT content_hash FROM retrieval_documents WHERE id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("original hash should read");
        let original_indexed_at: String = connection
            .query_row(
                "SELECT indexed_at FROM retrieval_documents WHERE id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("original indexed time should read");

        seed_embedding(&connection, "profile-unchanged", "note:highlight:h1");
        let unchanged = synchronize_book_retrieval_documents(&connection, "b1", "101")
            .expect("unchanged sync should succeed");
        assert_eq!(unchanged.inserted, 0);
        assert_eq!(unchanged.updated, 0);
        assert_eq!(unchanged.unchanged, 4);
        assert_eq!(unchanged.deleted, 0);
        assert_eq!(unchanged.total, 4);
        let indexed_at: String = connection
            .query_row(
                "SELECT indexed_at FROM retrieval_documents WHERE id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("unchanged indexed time should read");
        assert_eq!(indexed_at, original_indexed_at);
        let retained_embedding_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_embeddings
                 WHERE profile_id = 'profile-unchanged'
                   AND document_id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("retained embedding count should read");
        assert_eq!(retained_embedding_count, 1);

        connection
            .execute(
                "UPDATE thoughts SET star = 3, updated_at = '101'
                 WHERE review_id = 't1'",
                [],
            )
            .expect("source metadata should update");
        let metadata_only = synchronize_book_retrieval_documents(&connection, "b1", "101")
            .expect("metadata-only sync should succeed");
        assert_eq!(metadata_only.updated, 0);
        assert_eq!(metadata_only.unchanged, 4);
        let (metadata_json, metadata_indexed_at): (String, String) = connection
            .query_row(
                "SELECT metadata_json, indexed_at FROM retrieval_documents
                 WHERE id = 'note:thought:t1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("metadata-only document should read");
        assert!(metadata_json.contains("\"star\":3"));
        assert_eq!(metadata_indexed_at, original_indexed_at);
        let retained_after_metadata_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_embeddings
                 WHERE profile_id = 'profile-unchanged'
                   AND document_id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("embedding should remain after metadata update");
        assert_eq!(retained_after_metadata_count, 1);

        connection
            .execute(
                "UPDATE highlights SET mark_text = '深度工作需要连续而专注的时间', updated_at = '102'
                 WHERE bookmark_id = 'h1'",
                [],
            )
            .expect("source highlight should update");
        let changed = synchronize_book_retrieval_documents(&connection, "b1", "102")
            .expect("changed sync should succeed");
        assert_eq!(changed.inserted, 0);
        assert_eq!(changed.updated, 1);
        assert_eq!(changed.unchanged, 3);
        assert_eq!(changed.deleted, 0);
        let changed_hash: String = connection
            .query_row(
                "SELECT content_hash FROM retrieval_documents WHERE id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("changed hash should read");
        assert_ne!(changed_hash, original_hash);
        assert!(changed_hash.starts_with("sha256-v1:"));
        let invalidated_embedding_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_embeddings
                 WHERE profile_id = 'profile-unchanged'
                   AND document_id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("invalidated embedding count should read");
        assert_eq!(invalidated_embedding_count, 0);
        let fts_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_documents_fts
                 WHERE document_id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("fts row count should read");
        assert_eq!(fts_count, 1);
    }

    #[test]
    fn incremental_sync_downgrades_ready_profile_only_when_corpus_changes() {
        let connection = fixture();
        connection
            .execute(
                "INSERT INTO retrieval_index_profiles (
                    id, provider_kind, model_id, dimensions, distance_metric,
                    normalization_version, chunking_version, content_hash_version,
                    status, total_document_count, indexed_document_count,
                    created_at, updated_at, completed_at
                 ) VALUES ('profile-ready', 'deterministic-test', 'fixture-v1', 2, 'cosine',
                    'retrieval-text-v1', 'document-v1', 'sha256-v1',
                    'ready', 4, 4, '100', '100', '100')",
                [],
            )
            .expect("ready profile should insert");
        connection
            .execute(
                "INSERT INTO retrieval_embeddings (
                    profile_id, document_id, content_hash, dimensions, vector_blob,
                    created_at, updated_at
                 ) SELECT 'profile-ready', id, content_hash, 2,
                    X'0000803F00000000', '100', '100'
                   FROM retrieval_documents",
                [],
            )
            .expect("complete embeddings should insert");

        synchronize_book_retrieval_documents(&connection, "b1", "101")
            .expect("unchanged sync should succeed");
        let unchanged_status: String = connection
            .query_row(
                "SELECT status FROM retrieval_index_profiles WHERE id = 'profile-ready'",
                [],
                |row| row.get(0),
            )
            .expect("unchanged profile status should read");
        assert_eq!(unchanged_status, "ready");

        connection
            .execute(
                "UPDATE highlights SET mark_text = '专注需要主动隔离干扰', updated_at = '102'
                 WHERE bookmark_id = 'h1'",
                [],
            )
            .expect("source highlight should update");
        synchronize_book_retrieval_documents(&connection, "b1", "102")
            .expect("changed sync should succeed");
        let state: (String, i64, i64, Option<String>) = connection
            .query_row(
                "SELECT status, total_document_count, indexed_document_count, completed_at
                 FROM retrieval_index_profiles WHERE id = 'profile-ready'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("changed profile state should read");
        assert_eq!(state, ("building".to_string(), 4, 3, None));
    }

    #[test]
    fn incremental_sync_removes_only_missing_source_document() {
        let connection = fixture();
        let retained_hash: String = connection
            .query_row(
                "SELECT content_hash FROM retrieval_documents WHERE id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("retained hash should read");
        seed_embedding(&connection, "profile-deleted", "note:highlight:h2");
        connection
            .execute("DELETE FROM highlights WHERE bookmark_id = 'h2'", [])
            .expect("highlight should delete");

        let summary = synchronize_book_retrieval_documents(&connection, "b1", "101")
            .expect("delete sync should succeed");
        assert_eq!(summary.inserted, 0);
        assert_eq!(summary.updated, 0);
        assert_eq!(summary.unchanged, 3);
        assert_eq!(summary.deleted, 1);
        assert_eq!(summary.total, 3);
        let retained_after: String = connection
            .query_row(
                "SELECT content_hash FROM retrieval_documents WHERE id = 'note:highlight:h1'",
                [],
                |row| row.get(0),
            )
            .expect("retained hash should still read");
        assert_eq!(retained_after, retained_hash);
        let removed_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_documents WHERE id = 'note:highlight:h2'",
                [],
                |row| row.get(0),
            )
            .expect("removed count should read");
        assert_eq!(removed_count, 0);
        let removed_embedding_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_embeddings
                 WHERE profile_id = 'profile-deleted'
                   AND document_id = 'note:highlight:h2'",
                [],
                |row| row.get(0),
            )
            .expect("removed embedding count should read");
        assert_eq!(removed_embedding_count, 0);
    }

    #[test]
    fn exact_search_is_exhaustive_and_rebuild_removes_deleted_source() {
        let connection = fixture();
        let plan = plan_note_retrieval("包含“宽恕”的所有笔记");
        let first = search_book_notes(&connection, "b1", &plan, None, Some(1))
            .expect("search should succeed");
        assert!(first.exhaustive_match);
        assert_eq!(first.matched_item_count, 2);
        assert!(first.has_more);
        let first_document_id = first.hits[0].document_id.clone();
        let next_cursor = first
            .next_cursor
            .as_deref()
            .expect("first page should expose a cursor");
        let next = search_book_notes(&connection, "b1", &plan, Some(next_cursor), Some(1))
            .expect("next page should succeed");
        assert_eq!(next.hits.len(), 1);
        assert_ne!(next.hits[0].document_id, first_document_id);
        assert!(!next.has_more);
        assert!(next.next_cursor.is_none());

        let invalid_cursor =
            search_book_notes(&connection, "b1", &plan, Some("not-a-cursor"), Some(1));
        assert!(invalid_cursor.is_err());

        connection
            .execute("DELETE FROM highlights WHERE bookmark_id = 'h2'", [])
            .expect("highlight should delete");
        rebuild_book_retrieval_documents(&connection, "b1", "101")
            .expect("documents should rebuild");
        let second =
            search_book_notes(&connection, "b1", &plan, None, None).expect("search should succeed");
        assert_eq!(second.matched_item_count, 1);
        assert!(second.hits.iter().all(|hit| hit.source_id != "h2"));
    }
}
