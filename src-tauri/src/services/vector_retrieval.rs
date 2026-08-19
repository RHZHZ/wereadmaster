use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
};

use rusqlite::{params, Connection, OptionalExtension};

use super::retrieval::NoteType;

const DEFAULT_RRF_K: usize = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RetrievalStrategy {
    Lexical,
    Hybrid,
}

pub(crate) fn choose_retrieval_strategy(
    exact_phrase: Option<&str>,
    require_exhaustive_lexical_match: bool,
    ready_profile_available: bool,
) -> RetrievalStrategy {
    if exact_phrase.is_some() || require_exhaustive_lexical_match || !ready_profile_available {
        RetrievalStrategy::Lexical
    } else {
        RetrievalStrategy::Hybrid
    }
}

pub(crate) trait EmbeddingProvider {
    fn provider_kind(&self) -> &str;
    fn model_id(&self) -> &str;
    fn dimensions(&self) -> usize;
    fn embed_batch(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VectorProfileSpec {
    pub id: String,
    pub provider_kind: String,
    pub model_id: String,
    pub dimensions: usize,
    pub normalization_version: String,
    pub chunking_version: String,
    pub content_hash_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EmbeddingDocument {
    pub document_id: String,
    pub content_hash: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EmbeddedDocument {
    pub document_id: String,
    pub content_hash: String,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RankedDocument {
    pub document_id: String,
    pub score: f64,
}

pub(crate) fn normalize_vector(
    values: &[f32],
    expected_dimensions: usize,
) -> Result<Vec<f32>, String> {
    if values.len() != expected_dimensions {
        return Err(format!(
            "embedding dimensions mismatch: expected {expected_dimensions}, got {}",
            values.len()
        ));
    }
    if values.iter().any(|value| !value.is_finite()) {
        return Err("embedding contains a non-finite value".to_string());
    }
    let norm = values
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm <= f64::EPSILON {
        return Err("embedding must not be a zero vector".to_string());
    }
    Ok(values
        .iter()
        .map(|value| (*value as f64 / norm) as f32)
        .collect())
}

pub(crate) fn encode_vector(values: &[f32], expected_dimensions: usize) -> Result<Vec<u8>, String> {
    let normalized = normalize_vector(values, expected_dimensions)?;
    let mut encoded = Vec::with_capacity(normalized.len() * size_of::<f32>());
    for value in normalized {
        encoded.extend_from_slice(&value.to_le_bytes());
    }
    Ok(encoded)
}

pub(crate) fn decode_vector(bytes: &[u8], expected_dimensions: usize) -> Result<Vec<f32>, String> {
    let expected_bytes = expected_dimensions
        .checked_mul(size_of::<f32>())
        .ok_or_else(|| "embedding dimensions overflow".to_string())?;
    if bytes.len() != expected_bytes {
        return Err(format!(
            "embedding blob length mismatch: expected {expected_bytes}, got {}",
            bytes.len()
        ));
    }
    let values = bytes
        .chunks_exact(size_of::<f32>())
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect::<Vec<_>>();
    normalize_vector(&values, expected_dimensions)
}

pub(crate) fn create_building_profile(
    connection: &Connection,
    spec: &VectorProfileSpec,
    now: &str,
) -> Result<usize, String> {
    if spec.dimensions == 0 {
        return Err("embedding dimensions must be positive".to_string());
    }
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM retrieval_documents WHERE deleted_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        .max(0) as usize;
    connection
        .execute(
            "INSERT INTO retrieval_index_profiles (
                id, provider_kind, model_id, dimensions, distance_metric,
                normalization_version, chunking_version, content_hash_version,
                status, total_document_count, indexed_document_count,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'cosine', ?5, ?6, ?7,
                'building', ?8, 0, ?9, ?9)",
            params![
                spec.id,
                spec.provider_kind,
                spec.model_id,
                spec.dimensions as i64,
                spec.normalization_version,
                spec.chunking_version,
                spec.content_hash_version,
                total as i64,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(total)
}

pub(crate) fn read_pending_documents(
    connection: &Connection,
    profile_id: &str,
    limit: usize,
) -> Result<Vec<EmbeddingDocument>, String> {
    let status = connection
        .query_row(
            "SELECT status FROM retrieval_index_profiles WHERE id = ?1",
            [profile_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if status.as_deref() != Some("building") {
        return Err("embedding profile is not building".to_string());
    }
    let mut statement = connection
        .prepare(
            "SELECT d.id, d.content_hash, d.content
             FROM retrieval_documents d
             LEFT JOIN retrieval_embeddings e
               ON e.profile_id = ?1 AND e.document_id = d.id
             WHERE d.deleted_at IS NULL
               AND (e.document_id IS NULL OR e.content_hash <> d.content_hash)
             ORDER BY d.id ASC
             LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![profile_id, limit.max(1) as i64], |row| {
            Ok(EmbeddingDocument {
                document_id: row.get(0)?,
                content_hash: row.get(1)?,
                content: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

pub(crate) fn embed_pending_batch(
    connection: &Connection,
    profile_id: &str,
    provider: &dyn EmbeddingProvider,
    limit: usize,
    now: &str,
) -> Result<usize, String> {
    let profile = connection
        .query_row(
            "SELECT provider_kind, model_id, dimensions
             FROM retrieval_index_profiles WHERE id = ?1 AND status = 'building'",
            [profile_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "embedding profile is not building".to_string())?;
    if profile.0 != provider.provider_kind()
        || profile.1 != provider.model_id()
        || profile.2 != provider.dimensions() as i64
    {
        return Err("embedding provider metadata does not match profile".to_string());
    }

    let pending = read_pending_documents(connection, profile_id, limit)?;
    if pending.is_empty() {
        return Ok(0);
    }
    let inputs = pending
        .iter()
        .map(|document| document.content.clone())
        .collect::<Vec<_>>();
    let vectors = provider.embed_batch(&inputs)?;
    if vectors.len() != pending.len() {
        return Err(format!(
            "embedding batch count mismatch: expected {}, got {}",
            pending.len(),
            vectors.len()
        ));
    }
    let embedded = pending
        .into_iter()
        .zip(vectors)
        .map(|(document, vector)| EmbeddedDocument {
            document_id: document.document_id,
            content_hash: document.content_hash,
            vector,
        })
        .collect::<Vec<_>>();
    upsert_embedding_batch(connection, profile_id, &embedded, now)?;
    Ok(embedded.len())
}

pub(crate) fn upsert_embedding_batch(
    connection: &Connection,
    profile_id: &str,
    documents: &[EmbeddedDocument],
    now: &str,
) -> Result<usize, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let (status, dimensions) = transaction
        .query_row(
            "SELECT status, dimensions FROM retrieval_index_profiles WHERE id = ?1",
            [profile_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if status != "building" {
        return Err("embedding profile is not building".to_string());
    }
    let dimensions =
        usize::try_from(dimensions).map_err(|_| "invalid profile dimensions".to_string())?;

    for document in documents {
        let current_hash = transaction
            .query_row(
                "SELECT content_hash FROM retrieval_documents
                 WHERE id = ?1 AND deleted_at IS NULL",
                [&document.document_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if current_hash.as_deref() != Some(document.content_hash.as_str()) {
            return Err(format!(
                "document content hash changed: {}",
                document.document_id
            ));
        }
        let vector_blob = encode_vector(&document.vector, dimensions)?;
        transaction
            .execute(
                "INSERT INTO retrieval_embeddings (
                    profile_id, document_id, content_hash, dimensions, vector_blob,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(profile_id, document_id) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    dimensions = excluded.dimensions,
                    vector_blob = excluded.vector_blob,
                    updated_at = excluded.updated_at",
                params![
                    profile_id,
                    document.document_id,
                    document.content_hash,
                    dimensions as i64,
                    vector_blob,
                    now,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    let indexed = transaction
        .query_row(
            "SELECT COUNT(*)
             FROM retrieval_embeddings e
             JOIN retrieval_documents d ON d.id = e.document_id
             WHERE e.profile_id = ?1
               AND d.deleted_at IS NULL
               AND e.content_hash = d.content_hash",
            [profile_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        .max(0) as usize;
    transaction
        .execute(
            "UPDATE retrieval_index_profiles
             SET indexed_document_count = ?2, updated_at = ?3
             WHERE id = ?1",
            params![profile_id, indexed as i64, now],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(indexed)
}

pub(crate) fn complete_profile(
    connection: &Connection,
    profile_id: &str,
    now: &str,
) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let (status, total, indexed) = transaction
        .query_row(
            "SELECT status, total_document_count, indexed_document_count
             FROM retrieval_index_profiles WHERE id = ?1",
            [profile_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    if status != "building" || indexed != total {
        return Err("embedding profile is incomplete".to_string());
    }
    let valid_count = transaction
        .query_row(
            "SELECT COUNT(*)
             FROM retrieval_embeddings e
             JOIN retrieval_documents d ON d.id = e.document_id
             WHERE e.profile_id = ?1
               AND d.deleted_at IS NULL
               AND e.content_hash = d.content_hash",
            [profile_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if valid_count != total {
        return Err("embedding profile no longer matches the retrieval corpus".to_string());
    }

    transaction
        .execute(
            "UPDATE retrieval_index_profiles
             SET status = 'superseded', updated_at = ?2
             WHERE status = 'ready' AND id <> ?1",
            params![profile_id, now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE retrieval_index_profiles
             SET status = 'ready', completed_at = ?2, updated_at = ?2
             WHERE id = ?1 AND status = 'building'",
            params![profile_id, now],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn fail_profile(
    connection: &Connection,
    profile_id: &str,
    error_code: &str,
    error_message: &str,
    now: &str,
) -> Result<(), String> {
    let changed = connection
        .execute(
            "UPDATE retrieval_index_profiles
             SET status = 'failed', error_code = ?2, error_message = ?3, updated_at = ?4
             WHERE id = ?1 AND status = 'building'",
            params![profile_id, error_code, error_message, now],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err("embedding profile is not building".to_string());
    }
    Ok(())
}

pub(crate) fn delete_profile(connection: &Connection, profile_id: &str) -> Result<bool, String> {
    connection
        .execute(
            "DELETE FROM retrieval_index_profiles WHERE id = ?1",
            [profile_id],
        )
        .map(|count| count == 1)
        .map_err(|error| error.to_string())
}

pub(crate) fn search_ready_profile(
    connection: &Connection,
    book_id: &str,
    note_types: &[NoteType],
    query_vector: &[f32],
    limit: usize,
) -> Result<Vec<RankedDocument>, String> {
    search_ready_profile_with_book_scope(connection, Some(book_id), note_types, query_vector, limit)
}

pub(crate) fn search_ready_profile_library(
    connection: &Connection,
    note_types: &[NoteType],
    query_vector: &[f32],
    limit: usize,
) -> Result<Vec<RankedDocument>, String> {
    search_ready_profile_with_book_scope(connection, None, note_types, query_vector, limit)
}

fn search_ready_profile_with_book_scope(
    connection: &Connection,
    book_id: Option<&str>,
    note_types: &[NoteType],
    query_vector: &[f32],
    limit: usize,
) -> Result<Vec<RankedDocument>, String> {
    let profile = connection
        .query_row(
            "SELECT id, dimensions FROM retrieval_index_profiles
             WHERE status = 'ready'",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((profile_id, dimensions)) = profile else {
        return Ok(Vec::new());
    };
    let dimensions =
        usize::try_from(dimensions).map_err(|_| "invalid profile dimensions".to_string())?;
    let normalized_query = normalize_vector(query_vector, dimensions)?;
    let include_highlights = note_types.is_empty() || note_types.contains(&NoteType::Highlight);
    let include_thoughts = note_types.is_empty() || note_types.contains(&NoteType::Thought);

    let sql = if book_id.is_some() {
        "SELECT d.id, e.vector_blob, e.dimensions
         FROM retrieval_documents d
         JOIN retrieval_embeddings e
           ON e.document_id = d.id
          AND e.profile_id = ?1
          AND e.content_hash = d.content_hash
         WHERE d.book_id = ?2
           AND d.deleted_at IS NULL
           AND ((?3 = 1 AND d.source_type = 'highlight')
             OR (?4 = 1 AND d.source_type = 'thought'))
         ORDER BY d.id ASC"
    } else {
        "SELECT d.id, e.vector_blob, e.dimensions
         FROM retrieval_documents d
         JOIN retrieval_embeddings e
           ON e.document_id = d.id
          AND e.profile_id = ?1
          AND e.content_hash = d.content_hash
         WHERE d.deleted_at IS NULL
           AND ((?2 = 1 AND d.source_type = 'highlight')
             OR (?3 = 1 AND d.source_type = 'thought'))
         ORDER BY d.id ASC"
    };
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Vec<u8>>(1)?,
            row.get::<_, i64>(2)?,
        ))
    };
    let candidates = if let Some(book_id) = book_id {
        statement
            .query_map(
                params![
                    profile_id,
                    book_id,
                    i64::from(include_highlights),
                    i64::from(include_thoughts),
                ],
                map_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    } else {
        statement
            .query_map(
                params![
                    profile_id,
                    i64::from(include_highlights),
                    i64::from(include_thoughts),
                ],
                map_row,
            )
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };

    let mut ranked = Vec::with_capacity(candidates.len());
    for (document_id, vector_blob, stored_dimensions) in candidates {
        if stored_dimensions != dimensions as i64 {
            return Err(format!(
                "stored embedding dimensions mismatch: {document_id}"
            ));
        }
        let vector = decode_vector(&vector_blob, dimensions)?;
        let score = normalized_query
            .iter()
            .zip(vector.iter())
            .map(|(left, right)| f64::from(*left) * f64::from(*right))
            .sum::<f64>();
        ranked.push(RankedDocument { document_id, score });
    }
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.document_id.cmp(&right.document_id))
    });
    ranked.truncate(limit);
    Ok(ranked)
}

pub(crate) fn reciprocal_rank_fusion(
    lexical: &[String],
    vector: &[String],
    limit: usize,
) -> Vec<RankedDocument> {
    let mut scores = HashMap::<String, f64>::new();
    for ranking in [lexical, vector] {
        let mut seen = HashSet::new();
        for (index, document_id) in ranking.iter().enumerate() {
            if seen.insert(document_id) {
                *scores.entry(document_id.clone()).or_default() +=
                    1.0 / (DEFAULT_RRF_K + index + 1) as f64;
            }
        }
    }
    let mut ranked = scores
        .into_iter()
        .map(|(document_id, score)| RankedDocument { document_id, score })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.document_id.cmp(&right.document_id))
    });
    ranked.truncate(limit);
    ranked
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use crate::{
        db::initialize_schema,
        services::retrieval::{plan_note_retrieval, search_book_notes},
    };

    use super::{
        choose_retrieval_strategy, complete_profile, create_building_profile, decode_vector,
        delete_profile, embed_pending_batch, encode_vector, fail_profile, reciprocal_rank_fusion,
        search_ready_profile, EmbeddingProvider, RetrievalStrategy, VectorProfileSpec,
    };

    struct DeterministicEmbeddingProvider;
    struct MismatchedEmbeddingProvider;

    impl EmbeddingProvider for MismatchedEmbeddingProvider {
        fn provider_kind(&self) -> &str {
            "deterministic-test"
        }

        fn model_id(&self) -> &str {
            "wrong-model"
        }

        fn dimensions(&self) -> usize {
            3
        }

        fn embed_batch(&self, _inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
            unreachable!("mismatched provider must be rejected before embedding")
        }
    }

    impl EmbeddingProvider for DeterministicEmbeddingProvider {
        fn provider_kind(&self) -> &str {
            "deterministic-test"
        }

        fn model_id(&self) -> &str {
            "topic-map-v1"
        }

        fn dimensions(&self) -> usize {
            3
        }

        fn embed_batch(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Ok(inputs
                .iter()
                .map(|input| {
                    let normalized = input.to_lowercase();
                    let mut vector = vec![0.05, 0.05, 0.05];
                    if ["专注", "深度", "注意力", "focus"]
                        .iter()
                        .any(|term| normalized.contains(term))
                    {
                        vector[0] += 1.0;
                    }
                    if ["宽恕", "原谅", "边界"]
                        .iter()
                        .any(|term| normalized.contains(term))
                    {
                        vector[1] += 1.0;
                    }
                    if ["希望", "行动", "hope"]
                        .iter()
                        .any(|term| normalized.contains(term))
                    {
                        vector[2] += 1.0;
                    }
                    vector
                })
                .collect())
        }
    }

    fn profile(id: &str) -> VectorProfileSpec {
        VectorProfileSpec {
            id: id.to_string(),
            provider_kind: "deterministic-test".to_string(),
            model_id: "topic-map-v1".to_string(),
            dimensions: 3,
            normalization_version: "retrieval-text-v1".to_string(),
            chunking_version: "document-v1".to_string(),
            content_hash_version: "sha256-v1".to_string(),
        }
    }

    fn recall_at_k(ranking: &[String], relevant: &str, k: usize) -> f64 {
        if ranking
            .iter()
            .take(k)
            .any(|document_id| document_id == relevant)
        {
            1.0
        } else {
            0.0
        }
    }

    fn reciprocal_rank(ranking: &[String], relevant: &str) -> f64 {
        ranking
            .iter()
            .position(|document_id| document_id == relevant)
            .map(|index| 1.0 / (index + 1) as f64)
            .unwrap_or(0.0)
    }

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        for (id, source_type, source_id, content, hash) in [
            (
                "note:highlight:h1",
                "highlight",
                "h1",
                "深度工作需要专注",
                "sha256-v1:h1",
            ),
            (
                "note:thought:t1",
                "thought",
                "t1",
                "原谅也需要边界",
                "sha256-v1:t1",
            ),
        ] {
            connection
                .execute(
                    "INSERT INTO retrieval_documents (
                        id, source_type, source_id, book_id, content, normalized_content,
                        metadata_json, content_hash, source_updated_at, indexed_at
                     ) VALUES (?1, ?2, ?3, 'book-1', ?4, ?4, '{}', ?5, '100', '100')",
                    rusqlite::params![id, source_type, source_id, content, hash],
                )
                .expect("document should insert");
        }
        connection
    }

    #[test]
    fn vector_codec_normalizes_and_rejects_invalid_values() {
        let encoded = encode_vector(&[3.0, 4.0], 2).expect("vector should encode");
        let decoded = decode_vector(&encoded, 2).expect("vector should decode");
        assert!((decoded[0] - 0.6).abs() < 0.0001);
        assert!((decoded[1] - 0.8).abs() < 0.0001);
        assert!(encode_vector(&[0.0, 0.0], 2).is_err());
        assert!(encode_vector(&[f32::NAN, 1.0], 2).is_err());
        assert!(encode_vector(&[1.0], 2).is_err());
        assert!(decode_vector(&encoded[..4], 2).is_err());
    }

    #[test]
    fn profile_build_switch_is_atomic_and_failed_build_keeps_ready_profile() {
        let connection = fixture();
        let provider = DeterministicEmbeddingProvider;
        assert_eq!(
            create_building_profile(&connection, &profile("profile-old"), "100").unwrap(),
            2
        );
        assert!(embed_pending_batch(
            &connection,
            "profile-old",
            &MismatchedEmbeddingProvider,
            10,
            "101"
        )
        .is_err());
        assert_eq!(
            embed_pending_batch(&connection, "profile-old", &provider, 10, "101").unwrap(),
            2
        );
        complete_profile(&connection, "profile-old", "102").unwrap();

        create_building_profile(&connection, &profile("profile-failed"), "103").unwrap();
        fail_profile(
            &connection,
            "profile-failed",
            "provider_error",
            "failed",
            "104",
        )
        .unwrap();
        let ready: String = connection
            .query_row(
                "SELECT id FROM retrieval_index_profiles WHERE status = 'ready'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ready, "profile-old");

        create_building_profile(&connection, &profile("profile-new"), "105").unwrap();
        assert!(complete_profile(&connection, "profile-new", "106").is_err());
        let ready_after_incomplete: String = connection
            .query_row(
                "SELECT id FROM retrieval_index_profiles WHERE status = 'ready'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ready_after_incomplete, "profile-old");
        assert!(delete_profile(&connection, "profile-failed").unwrap());
        assert!(!delete_profile(&connection, "profile-missing").unwrap());
    }

    #[test]
    fn deleting_profile_cascades_embeddings() {
        let connection = fixture();
        let provider = DeterministicEmbeddingProvider;
        create_building_profile(&connection, &profile("profile-delete"), "100").unwrap();
        embed_pending_batch(&connection, "profile-delete", &provider, 10, "101").unwrap();
        assert!(delete_profile(&connection, "profile-delete").unwrap());
        let embedding_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_embeddings
                 WHERE profile_id = 'profile-delete'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(embedding_count, 0);
    }

    #[test]
    fn cosine_scan_filters_by_book_type_hash_and_has_stable_ties() {
        let connection = fixture();
        let provider = DeterministicEmbeddingProvider;
        create_building_profile(&connection, &profile("profile-ready"), "100").unwrap();
        assert_eq!(
            embed_pending_batch(&connection, "profile-ready", &provider, 10, "101").unwrap(),
            2
        );
        complete_profile(&connection, "profile-ready", "102").unwrap();

        let query = provider
            .embed_batch(&["保持注意力".to_string()])
            .unwrap()
            .remove(0);
        let highlights = search_ready_profile(
            &connection,
            "book-1",
            &[crate::services::retrieval::NoteType::Highlight],
            &query,
            10,
        )
        .unwrap();
        assert_eq!(highlights.len(), 1);
        assert_eq!(highlights[0].document_id, "note:highlight:h1");

        connection
            .execute(
                "UPDATE retrieval_embeddings SET content_hash = 'stale'
                 WHERE document_id = 'note:highlight:h1'",
                [],
            )
            .unwrap();
        let stale = search_ready_profile(&connection, "book-1", &[], &query, 10).unwrap();
        assert!(stale
            .iter()
            .all(|item| item.document_id != "note:highlight:h1"));
    }

    #[test]
    fn rrf_is_symmetric_stable_and_deduplicated() {
        let lexical = vec!["a".to_string(), "b".to_string(), "a".to_string()];
        let vector = vec!["b".to_string(), "a".to_string(), "c".to_string()];
        let forward = reciprocal_rank_fusion(&lexical, &vector, 10);
        let reverse = reciprocal_rank_fusion(&vector, &lexical, 10);
        assert_eq!(forward, reverse);
        assert_eq!(
            forward
                .iter()
                .filter(|item| item.document_id == "a")
                .count(),
            1
        );
        assert_eq!(forward[0].document_id, "a");
        assert_eq!(forward[1].document_id, "b");
    }

    #[test]
    fn hybrid_evaluation_improves_synonym_recall_and_mrr() {
        let connection = fixture();
        let provider = DeterministicEmbeddingProvider;
        create_building_profile(&connection, &profile("profile-eval"), "100").unwrap();
        embed_pending_batch(&connection, "profile-eval", &provider, 10, "101").unwrap();
        complete_profile(&connection, "profile-eval", "102").unwrap();

        let plan = plan_note_retrieval("保持注意力");
        let lexical = search_book_notes(&connection, "book-1", &plan, None, Some(10)).unwrap();
        let lexical_ids = lexical
            .hits
            .iter()
            .map(|hit| hit.document_id.clone())
            .collect::<Vec<_>>();
        let query = provider
            .embed_batch(&[plan.query_text.clone()])
            .unwrap()
            .remove(0);
        let vector_ids = search_ready_profile(&connection, "book-1", &plan.note_types, &query, 10)
            .unwrap()
            .into_iter()
            .map(|item| item.document_id)
            .collect::<Vec<_>>();
        let hybrid_ids = reciprocal_rank_fusion(&lexical_ids, &vector_ids, 10)
            .into_iter()
            .map(|item| item.document_id)
            .collect::<Vec<_>>();
        let relevant = "note:highlight:h1";

        assert_eq!(recall_at_k(&lexical_ids, relevant, 1), 0.0);
        assert_eq!(reciprocal_rank(&lexical_ids, relevant), 0.0);
        assert_eq!(recall_at_k(&hybrid_ids, relevant, 1), 1.0);
        assert_eq!(reciprocal_rank(&hybrid_ids, relevant), 1.0);
    }

    #[test]
    fn exact_exhaustive_and_missing_profile_force_lexical_strategy() {
        assert_eq!(
            choose_retrieval_strategy(Some("宽恕"), false, true),
            RetrievalStrategy::Lexical
        );
        assert_eq!(
            choose_retrieval_strategy(None, true, true),
            RetrievalStrategy::Lexical
        );
        assert_eq!(
            choose_retrieval_strategy(None, false, false),
            RetrievalStrategy::Lexical
        );
        assert_eq!(
            choose_retrieval_strategy(None, false, true),
            RetrievalStrategy::Hybrid
        );

        let connection = fixture();
        let no_vectors = search_ready_profile(&connection, "book-1", &[], &[1.0, 0.0, 0.0], 10)
            .expect("missing ready profile should degrade to no vector candidates");
        assert!(no_vectors.is_empty());
    }

    #[test]
    #[ignore = "manual M3A filtered vector scan performance sample"]
    fn filtered_vector_scan_performance_sample() {
        let connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let dimensions = 384_usize;
        let document_count = 10_000_usize;
        let mut source = vec![0.0_f32; dimensions];
        for (index, value) in source.iter_mut().enumerate() {
            *value = ((index % 17) + 1) as f32;
        }
        let vector_blob = encode_vector(&source, dimensions).expect("fixture vector should encode");
        let transaction = connection.unchecked_transaction().unwrap();
        {
            let mut insert_document = transaction
                .prepare(
                    "INSERT INTO retrieval_documents (
                        id, source_type, source_id, book_id, content, normalized_content,
                        metadata_json, content_hash, source_updated_at, indexed_at
                     ) VALUES (?1, 'highlight', ?2, 'book-perf', '性能样本', '性能样本',
                        '{}', ?3, '100', '100')",
                )
                .unwrap();
            for index in 0..document_count {
                let document_id = format!("note:highlight:perf-{index:05}");
                let source_id = format!("perf-{index:05}");
                let content_hash = format!("sha256-v1:perf-{index:05}");
                insert_document
                    .execute(rusqlite::params![document_id, source_id, content_hash])
                    .unwrap();
            }
        }
        transaction.commit().unwrap();
        let spec = VectorProfileSpec {
            id: "profile-perf".to_string(),
            provider_kind: "deterministic-test".to_string(),
            model_id: "perf-v1".to_string(),
            dimensions,
            normalization_version: "retrieval-text-v1".to_string(),
            chunking_version: "document-v1".to_string(),
            content_hash_version: "sha256-v1".to_string(),
        };
        assert_eq!(
            create_building_profile(&connection, &spec, "100").unwrap(),
            document_count
        );
        let transaction = connection.unchecked_transaction().unwrap();
        {
            let mut insert_embedding = transaction
                .prepare(
                    "INSERT INTO retrieval_embeddings (
                        profile_id, document_id, content_hash, dimensions, vector_blob,
                        created_at, updated_at
                     ) SELECT 'profile-perf', id, content_hash, ?1, ?2, '100', '100'
                       FROM retrieval_documents WHERE id = ?3",
                )
                .unwrap();
            for index in 0..document_count {
                let document_id = format!("note:highlight:perf-{index:05}");
                insert_embedding
                    .execute(rusqlite::params![
                        dimensions as i64,
                        &vector_blob,
                        document_id
                    ])
                    .unwrap();
            }
        }
        transaction
            .execute(
                "UPDATE retrieval_index_profiles
                 SET indexed_document_count = total_document_count
                 WHERE id = 'profile-perf'",
                [],
            )
            .unwrap();
        transaction.commit().unwrap();
        complete_profile(&connection, "profile-perf", "101").unwrap();

        let query = vec![1.0_f32; dimensions];
        let mut samples = Vec::new();
        for _ in 0..12 {
            let started = std::time::Instant::now();
            let hits = search_ready_profile(&connection, "book-perf", &[], &query, 80).unwrap();
            assert_eq!(hits.len(), 80);
            samples.push(started.elapsed());
        }
        samples.sort();
        let p50 = samples[samples.len() / 2];
        let p95 = samples[(samples.len() * 95 / 100).min(samples.len() - 1)];
        eprintln!(
            "M3A filtered scan sample: documents={document_count}, dimensions={dimensions}, p50={p50:?}, p95={p95:?}"
        );
    }

    #[test]
    fn deterministic_provider_metadata_is_explicit() {
        let provider = DeterministicEmbeddingProvider;
        assert_eq!(provider.provider_kind(), "deterministic-test");
        assert_eq!(provider.model_id(), "topic-map-v1");
        assert_eq!(provider.dimensions(), 3);
    }
}
