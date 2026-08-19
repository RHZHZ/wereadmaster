use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct ImaExportAttempt {
    pub export_id: String,
    pub record_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub content_hash: String,
    pub destination_scope: String,
    pub title: String,
    pub snapshot_markdown: String,
    pub snapshot_hash: String,
    pub chunk_count: usize,
    pub status: String,
    pub note_id: Option<String>,
    pub media_id: Option<String>,
    pub last_completed_stage: Option<String>,
    pub uncertain_stage: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ImaExportChunk {
    pub chunk_index: usize,
    pub chunker_version: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub status: String,
    pub attempt_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImaExistingExport {
    pub operation_id: Option<String>,
    pub note_id: Option<String>,
    pub media_id: Option<String>,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImaBeginAttemptResult {
    Started,
    Existing(ImaExistingExport),
}

pub struct ImaExportRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> ImaExportRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn begin_attempt(
        &self,
        record_id: &str,
        export_id: &str,
        source_kind: &str,
        source_id: &str,
        content_hash: &str,
        destination_scope: &str,
        title: &str,
        snapshot_markdown: &str,
        snapshot_hash: &str,
        chunker_version: &str,
        chunks: &[(usize, usize, usize, &str)],
        force_new_snapshot: bool,
        now: &str,
    ) -> Result<ImaBeginAttemptResult, String> {
        self.connection
            .execute_batch("BEGIN IMMEDIATE TRANSACTION")
            .map_err(|error| error.to_string())?;
        let result = (|| {
            let existing = self
                .connection
                .query_row(
                    "
                    SELECT a.export_id, r.ima_note_id, r.ima_media_id, r.title, r.status
                    FROM ima_export_records r
                    LEFT JOIN ima_export_attempts a ON a.record_id = r.id
                    WHERE r.source_kind = ?1 AND r.source_id = ?2 AND r.content_hash = ?3
                      AND r.destination_scope = ?4
                      AND (
                          r.status IN ('attempting', 'partial', 'unknown')
                          OR (?5 = 0 AND r.status = 'succeeded')
                      )
                    ORDER BY CASE
                        WHEN r.status IN ('attempting', 'partial', 'unknown') THEN 0
                        ELSE 1
                    END, r.updated_at DESC
                    LIMIT 1
                    ",
                    params![
                        source_kind,
                        source_id,
                        content_hash,
                        destination_scope,
                        if force_new_snapshot { 1 } else { 0 }
                    ],
                    |row| {
                        Ok(ImaExistingExport {
                            operation_id: row.get(0)?,
                            note_id: row.get(1)?,
                            media_id: row.get(2)?,
                            title: row.get(3)?,
                            status: row.get(4)?,
                        })
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some(existing) = existing {
                return Ok(ImaBeginAttemptResult::Existing(existing));
            }

            self.connection
                .execute(
                    "
            INSERT INTO ima_export_records
                (id, source_kind, source_id, content_hash, destination_scope, title,
                 status, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'attempting', ?7, ?7)
            ",
                    params![
                        record_id,
                        source_kind,
                        source_id,
                        content_hash,
                        destination_scope,
                        title,
                        now
                    ],
                )
                .map_err(|error| error.to_string())?;
            self.connection
                .execute(
                    "
            INSERT INTO ima_export_attempts
                (export_id, record_id, snapshot_markdown, snapshot_hash, chunk_count,
                 status, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 'attempting', ?6, ?6)
            ",
                    params![
                        export_id,
                        record_id,
                        snapshot_markdown,
                        snapshot_hash,
                        chunks.len(),
                        now
                    ],
                )
                .map_err(|error| error.to_string())?;
            for (index, start_byte, end_byte, hash) in chunks {
                self.connection
                    .execute(
                        "
                INSERT INTO ima_export_chunks
                    (export_id, chunk_index, chunker_version, start_byte, end_byte,
                     chunk_hash, status)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')
                ",
                        params![
                            export_id,
                            index,
                            chunker_version,
                            start_byte,
                            end_byte,
                            hash
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(ImaBeginAttemptResult::Started)
        })();

        match result {
            Ok(result) => {
                self.connection
                    .execute_batch("COMMIT")
                    .map_err(|error| error.to_string())?;
                Ok(result)
            }
            Err(error) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn begin_association_retarget(
        &self,
        record_id: &str,
        export_id: &str,
        source_kind: &str,
        source_id: &str,
        content_hash: &str,
        destination_scope: &str,
        title: &str,
        snapshot_markdown: &str,
        snapshot_hash: &str,
        chunker_version: &str,
        chunks: &[(usize, usize, usize, &str)],
        note_id: &str,
        now: &str,
    ) -> Result<ImaBeginAttemptResult, String> {
        self.connection
            .execute_batch("BEGIN IMMEDIATE TRANSACTION")
            .map_err(|error| error.to_string())?;
        let result = (|| {
            let existing = self
                .connection
                .query_row(
                    "
                    SELECT a.export_id, r.ima_note_id, r.ima_media_id, r.title, r.status
                    FROM ima_export_records r
                    LEFT JOIN ima_export_attempts a ON a.record_id = r.id
                    WHERE r.source_kind = ?1 AND r.source_id = ?2 AND r.content_hash = ?3
                      AND r.destination_scope = ?4
                      AND r.status IN ('attempting', 'partial', 'unknown', 'succeeded')
                    ORDER BY CASE
                        WHEN r.status IN ('attempting', 'partial', 'unknown') THEN 0
                        WHEN r.status = 'succeeded' THEN 1
                        ELSE 2
                    END, r.updated_at DESC
                    LIMIT 1
                    ",
                    params![source_kind, source_id, content_hash, destination_scope],
                    |row| {
                        Ok(ImaExistingExport {
                            operation_id: row.get(0)?,
                            note_id: row.get(1)?,
                            media_id: row.get(2)?,
                            title: row.get(3)?,
                            status: row.get(4)?,
                        })
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some(existing) = existing {
                return Ok(ImaBeginAttemptResult::Existing(existing));
            }

            self.connection
                .execute(
                    "
                    INSERT INTO ima_export_records
                        (id, source_kind, source_id, content_hash, destination_scope, title,
                         ima_note_id, status, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'attempting', ?8, ?8)
                    ",
                    params![
                        record_id,
                        source_kind,
                        source_id,
                        content_hash,
                        destination_scope,
                        title,
                        note_id,
                        now
                    ],
                )
                .map_err(|error| error.to_string())?;
            self.connection
                .execute(
                    "
                    INSERT INTO ima_export_attempts
                        (export_id, record_id, snapshot_markdown, snapshot_hash, chunk_count,
                         status, last_completed_stage, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, 'attempting', 'appendDoc', ?6, ?6)
                    ",
                    params![
                        export_id,
                        record_id,
                        snapshot_markdown,
                        snapshot_hash,
                        chunks.len(),
                        now
                    ],
                )
                .map_err(|error| error.to_string())?;
            for (index, start_byte, end_byte, hash) in chunks {
                self.connection
                    .execute(
                        "
                        INSERT INTO ima_export_chunks
                            (export_id, chunk_index, chunker_version, start_byte, end_byte,
                             chunk_hash, status, attempt_count)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'succeeded', 1)
                        ",
                        params![
                            export_id,
                            index,
                            chunker_version,
                            start_byte,
                            end_byte,
                            hash
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(ImaBeginAttemptResult::Started)
        })();

        match result {
            Ok(result) => {
                self.connection
                    .execute_batch("COMMIT")
                    .map_err(|error| error.to_string())?;
                Ok(result)
            }
            Err(error) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn finalize_association_retarget(
        &self,
        old_export_id: &str,
        old_record_id: &str,
        new_export_id: &str,
        new_record_id: &str,
        note_id: &str,
        media_id: &str,
        now: &str,
    ) -> Result<(), String> {
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_attempts
            SET status = 'succeeded', last_completed_stage = 'addKnowledge',
                uncertain_stage = NULL, error_code = NULL, error_message = NULL, updated_at = ?1
            WHERE export_id = ?2
            ",
            params![now, new_export_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_records
            SET status = 'succeeded', ima_note_id = ?1, ima_media_id = ?2, updated_at = ?3
            WHERE id = ?4
            ",
            params![note_id, media_id, now, new_record_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_attempts
            SET snapshot_markdown = '', updated_at = ?1
            WHERE export_id = ?2
            ",
            params![now, new_export_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM ima_export_chunks WHERE export_id = ?1",
            [new_export_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_attempts
            SET status = 'abandoned', updated_at = ?1
            WHERE export_id = ?2
            ",
            params![now, old_export_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_records
            SET status = 'abandoned', updated_at = ?1
            WHERE id = ?2
            ",
            params![now, old_record_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_attempts
            SET snapshot_markdown = '', updated_at = ?1
            WHERE export_id = ?2
            ",
            params![now, old_export_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM ima_export_chunks WHERE export_id = ?1",
            [old_export_id],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn mark_chunk(
        &self,
        export_id: &str,
        chunk_index: usize,
        status: &str,
        attempt_count: usize,
        error_code: Option<&str>,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "
                UPDATE ima_export_chunks
                SET status = ?1, attempt_count = ?2, last_error_code = ?3
                WHERE export_id = ?4 AND chunk_index = ?5
                ",
                params![status, attempt_count, error_code, export_id, chunk_index],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn mark_chunk_attempting(
        &self,
        export_id: &str,
        chunk_index: usize,
    ) -> Result<usize, String> {
        self.connection
            .execute(
                "
                UPDATE ima_export_chunks
                SET status = 'attempting', attempt_count = attempt_count + 1,
                    last_error_code = NULL
                WHERE export_id = ?1 AND chunk_index = ?2
                  AND status IN ('pending', 'failed')
                ",
                params![export_id, chunk_index],
            )
            .map_err(|error| error.to_string())?;
        self.connection
            .query_row(
                "
                SELECT attempt_count
                FROM ima_export_chunks
                WHERE export_id = ?1 AND chunk_index = ?2
                ",
                params![export_id, chunk_index],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value as usize)
            .map_err(|error| error.to_string())
    }

    pub fn mark_chunk_result(
        &self,
        export_id: &str,
        chunk_index: usize,
        status: &str,
        error_code: Option<&str>,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "
                UPDATE ima_export_chunks
                SET status = ?1, last_error_code = ?2
                WHERE export_id = ?3 AND chunk_index = ?4
                ",
                params![status, error_code, export_id, chunk_index],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn mark_status(
        &self,
        export_id: &str,
        record_id: &str,
        status: &str,
        stage: Option<&str>,
        uncertain_stage: Option<&str>,
        note_id: Option<&str>,
        media_id: Option<&str>,
        error_code: Option<&str>,
        error_message: Option<&str>,
        now: &str,
    ) -> Result<(), String> {
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_attempts
            SET status = ?1, last_completed_stage = ?2, uncertain_stage = ?3,
                error_code = ?4, error_message = ?5, updated_at = ?6
            WHERE export_id = ?7
            ",
            params![
                status,
                stage,
                uncertain_stage,
                error_code,
                error_message,
                now,
                export_id
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "
            UPDATE ima_export_records
            SET status = ?1, ima_note_id = COALESCE(?2, ima_note_id),
                ima_media_id = COALESCE(?3, ima_media_id), updated_at = ?4
            WHERE id = ?5
            ",
            params![status, note_id, media_id, now, record_id],
        )
        .map_err(|error| error.to_string())?;
        if matches!(status, "succeeded" | "abandoned") {
            tx.execute(
                "
                UPDATE ima_export_attempts
                SET snapshot_markdown = ''
                WHERE export_id = ?1
                ",
                [export_id],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM ima_export_chunks WHERE export_id = ?1",
                [export_id],
            )
            .map_err(|error| error.to_string())?;
        }
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn get_attempt(&self, export_id: &str) -> Result<Option<ImaExportAttempt>, String> {
        self.connection
            .query_row(
                "
                SELECT a.export_id, a.record_id, r.source_kind, r.source_id,
                       r.content_hash, r.destination_scope, r.title,
                       a.snapshot_markdown, a.snapshot_hash, a.chunk_count,
                       a.status, r.ima_note_id, r.ima_media_id,
                       a.last_completed_stage, a.uncertain_stage
                FROM ima_export_attempts a
                JOIN ima_export_records r ON r.id = a.record_id
                WHERE a.export_id = ?1
                ",
                [export_id],
                |row| {
                    Ok(ImaExportAttempt {
                        export_id: row.get(0)?,
                        record_id: row.get(1)?,
                        source_kind: row.get(2)?,
                        source_id: row.get(3)?,
                        content_hash: row.get(4)?,
                        destination_scope: row.get(5)?,
                        title: row.get(6)?,
                        snapshot_markdown: row.get(7)?,
                        snapshot_hash: row.get(8)?,
                        chunk_count: row.get::<_, i64>(9)? as usize,
                        status: row.get(10)?,
                        note_id: row.get(11)?,
                        media_id: row.get(12)?,
                        last_completed_stage: row.get(13)?,
                        uncertain_stage: row.get(14)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn list_chunks(&self, export_id: &str) -> Result<Vec<ImaExportChunk>, String> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT chunk_index, chunker_version, start_byte, end_byte,
                       status, attempt_count
                FROM ima_export_chunks
                WHERE export_id = ?1
                ORDER BY chunk_index ASC
                ",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([export_id], |row| {
                Ok(ImaExportChunk {
                    chunk_index: row.get::<_, i64>(0)? as usize,
                    chunker_version: row.get(1)?,
                    start_byte: row.get::<_, i64>(2)? as usize,
                    end_byte: row.get::<_, i64>(3)? as usize,
                    status: row.get(4)?,
                    attempt_count: row.get::<_, i64>(5)? as usize,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn mark_attempting_as_unknown(&self, now: &str) -> Result<(), String> {
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        tx.execute(
                r#"
                UPDATE ima_export_attempts AS a
                SET status = 'unknown',
                    uncertain_stage = COALESCE(
                        uncertain_stage,
                        CASE
                            WHEN EXISTS (
                                SELECT 1 FROM ima_export_chunks c
                                WHERE c.export_id = a.export_id
                                  AND c.status = 'attempting' AND c.chunk_index = 0
                            ) THEN 'importDoc'
                            WHEN EXISTS (
                                SELECT 1 FROM ima_export_chunks c
                                WHERE c.export_id = a.export_id
                                  AND c.status = 'attempting' AND c.chunk_index > 0
                            ) THEN 'appendDoc'
                            WHEN EXISTS (
                                SELECT 1 FROM ima_export_records r
                                WHERE r.id = a.record_id
                                  AND instr(r.destination_scope, '"publishToKnowledgeBase":true') > 0
                            ) THEN 'addKnowledge'
                            ELSE 'persistResult'
                        END
                    ),
                    updated_at = ?1
                WHERE status = 'attempting'
                "#,
                [now],
            )
            .map_err(|error| error.to_string())?;
        tx.execute(
            "
                UPDATE ima_export_records
                SET status = 'unknown', updated_at = ?1
                WHERE id IN (
                    SELECT record_id FROM ima_export_attempts WHERE status = 'unknown'
                ) AND status = 'attempting'
                ",
            [now],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())
    }
}

pub fn current_unix_seconds() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use crate::db::initialize_schema;

    use super::{ImaBeginAttemptResult, ImaExportRepository};

    #[test]
    fn begin_attempt_atomically_reuses_an_existing_active_export() {
        let connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let repository = ImaExportRepository::new(&connection);
        let chunks = [(0, 0, 8, "chunk-hash")];

        let first = repository
            .begin_attempt(
                "record-1",
                "operation-1",
                "bookNotes",
                "book-1",
                "content-hash",
                "destination",
                "title",
                "snapshot",
                "snapshot-hash",
                "ima-v1",
                &chunks,
                false,
                "100",
            )
            .expect("first attempt should start");
        assert_eq!(first, ImaBeginAttemptResult::Started);

        let second = repository
            .begin_attempt(
                "record-2",
                "operation-2",
                "bookNotes",
                "book-1",
                "content-hash",
                "destination",
                "title",
                "snapshot",
                "snapshot-hash",
                "ima-v1",
                &chunks,
                false,
                "101",
            )
            .expect("second attempt should reuse the active export");
        let ImaBeginAttemptResult::Existing(existing) = second else {
            panic!("second attempt should not start");
        };
        assert_eq!(existing.operation_id.as_deref(), Some("operation-1"));
        assert_eq!(existing.status, "attempting");

        repository
            .mark_status(
                "operation-1",
                "record-1",
                "succeeded",
                Some("importDoc"),
                None,
                Some("note-1"),
                None,
                None,
                None,
                "102",
            )
            .expect("first attempt should be marked succeeded");

        let deduplicated = repository
            .begin_attempt(
                "record-3",
                "operation-3",
                "bookNotes",
                "book-1",
                "content-hash",
                "destination",
                "title",
                "snapshot",
                "snapshot-hash",
                "ima-v1",
                &chunks,
                false,
                "103",
            )
            .expect("normal export should inspect succeeded records");
        let ImaBeginAttemptResult::Existing(existing) = deduplicated else {
            panic!("normal export should reuse the succeeded record");
        };
        assert_eq!(existing.operation_id.as_deref(), Some("operation-1"));
        assert_eq!(existing.status, "succeeded");

        let forced = repository
            .begin_attempt(
                "record-4",
                "operation-4",
                "bookNotes",
                "book-1",
                "content-hash",
                "destination",
                "title",
                "snapshot",
                "snapshot-hash",
                "ima-v1",
                &chunks,
                true,
                "104",
            )
            .expect("force export should create a new snapshot");
        assert_eq!(forced, ImaBeginAttemptResult::Started);

        let active_after_force = repository
            .begin_attempt(
                "record-5",
                "operation-5",
                "bookNotes",
                "book-1",
                "content-hash",
                "destination",
                "title",
                "snapshot",
                "snapshot-hash",
                "ima-v1",
                &chunks,
                false,
                "105",
            )
            .expect("normal export should inspect the new active snapshot first");
        let ImaBeginAttemptResult::Existing(existing) = active_after_force else {
            panic!("normal export should not hide an active forced snapshot behind an old success");
        };
        assert_eq!(existing.operation_id.as_deref(), Some("operation-4"));
        assert_eq!(existing.status, "attempting");
    }

    #[test]
    fn association_retarget_reuses_note_and_finalizes_both_local_attempts_atomically() {
        let connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let repository = ImaExportRepository::new(&connection);
        let chunks = [(0, 0, 8, "chunk-hash")];

        assert_eq!(
            repository
                .begin_attempt(
                    "old-record",
                    "old-operation",
                    "bookNotes",
                    "book-1",
                    "content-hash",
                    "old-destination",
                    "title",
                    "snapshot",
                    "snapshot-hash",
                    "ima-v1",
                    &chunks,
                    false,
                    "100",
                )
                .unwrap(),
            ImaBeginAttemptResult::Started
        );
        repository
            .mark_chunk_result("old-operation", 0, "succeeded", None)
            .unwrap();
        repository
            .mark_status(
                "old-operation",
                "old-record",
                "partial",
                Some("addKnowledge"),
                None,
                Some("note-1"),
                None,
                Some("IMA_KNOWLEDGE_ADD_FAILED"),
                Some("目标失效"),
                "101",
            )
            .unwrap();

        assert_eq!(
            repository
                .begin_association_retarget(
                    "new-record",
                    "new-operation",
                    "bookNotes",
                    "book-1",
                    "content-hash",
                    "new-destination",
                    "title",
                    "snapshot",
                    "snapshot-hash",
                    "ima-v1",
                    &chunks,
                    "note-1",
                    "102",
                )
                .unwrap(),
            ImaBeginAttemptResult::Started
        );
        let new_attempt = repository
            .get_attempt("new-operation")
            .unwrap()
            .expect("retarget attempt should exist");
        assert_eq!(new_attempt.note_id.as_deref(), Some("note-1"));
        assert_eq!(
            repository.list_chunks("new-operation").unwrap()[0].status,
            "succeeded"
        );

        repository
            .finalize_association_retarget(
                "old-operation",
                "old-record",
                "new-operation",
                "new-record",
                "note-1",
                "media-1",
                "103",
            )
            .unwrap();
        let old_attempt = repository
            .get_attempt("old-operation")
            .unwrap()
            .expect("old attempt should remain auditable");
        assert_eq!(old_attempt.status, "abandoned");
        assert_eq!(old_attempt.snapshot_markdown, "");
        assert_eq!(old_attempt.note_id.as_deref(), Some("note-1"));
        assert!(repository.list_chunks("old-operation").unwrap().is_empty());
        let new_attempt = repository
            .get_attempt("new-operation")
            .unwrap()
            .expect("new attempt should remain auditable");
        assert_eq!(new_attempt.status, "succeeded");
        assert_eq!(new_attempt.media_id.as_deref(), Some("media-1"));
        assert!(repository.list_chunks("new-operation").unwrap().is_empty());

        let duplicate = repository
            .begin_association_retarget(
                "duplicate-record",
                "duplicate-operation",
                "bookNotes",
                "book-1",
                "content-hash",
                "new-destination",
                "title",
                "snapshot",
                "snapshot-hash",
                "ima-v1",
                &chunks,
                "note-1",
                "104",
            )
            .unwrap();
        let ImaBeginAttemptResult::Existing(existing) = duplicate else {
            panic!("successful target should be deduplicated");
        };
        assert_eq!(existing.operation_id.as_deref(), Some("new-operation"));
        assert_eq!(existing.status, "succeeded");

        repository
            .mark_status(
                "new-operation",
                "new-record",
                "abandoned",
                Some("addKnowledge"),
                None,
                Some("note-1"),
                Some("media-1"),
                None,
                None,
                "105",
            )
            .unwrap();
        assert_eq!(
            repository
                .begin_association_retarget(
                    "replacement-record",
                    "replacement-operation",
                    "bookNotes",
                    "book-1",
                    "content-hash",
                    "new-destination",
                    "title",
                    "snapshot",
                    "snapshot-hash",
                    "ima-v1",
                    &chunks,
                    "note-1",
                    "106",
                )
                .unwrap(),
            ImaBeginAttemptResult::Started
        );
    }
}
