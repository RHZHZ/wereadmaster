use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStateRecord {
    pub section: String,
    pub status: String,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl SyncStateRecord {
    pub fn idle(section: impl Into<String>) -> Self {
        Self {
            section: section.into(),
            status: "idle".to_string(),
            last_success_at: None,
            last_attempt_at: None,
            error_code: None,
            error_message: None,
        }
    }
}

pub struct SyncStateRepository<'conn> {
    connection: &'conn Connection,
}

impl<'conn> SyncStateRepository<'conn> {
    pub fn new(connection: &'conn Connection) -> Self {
        Self { connection }
    }

    pub fn get(&self, section: &str) -> rusqlite::Result<Option<SyncStateRecord>> {
        self.connection
            .query_row(
                "
                SELECT section, status, last_success_at, last_attempt_at, error_code, error_message
                FROM sync_state
                WHERE section = ?1
                ",
                [section],
                map_sync_state_record,
            )
            .optional()
    }

    pub fn list(&self) -> rusqlite::Result<Vec<SyncStateRecord>> {
        let mut statement = self.connection.prepare(
            "
            SELECT section, status, last_success_at, last_attempt_at, error_code, error_message
            FROM sync_state
            ORDER BY section
            ",
        )?;
        let records = statement
            .query_map([], map_sync_state_record)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(records)
    }

    pub fn upsert(&self, record: &SyncStateRecord) -> rusqlite::Result<()> {
        self.connection.execute(
            "
            INSERT INTO sync_state (
                section,
                status,
                last_success_at,
                last_attempt_at,
                error_code,
                error_message
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(section) DO UPDATE SET
                status = excluded.status,
                last_success_at = excluded.last_success_at,
                last_attempt_at = excluded.last_attempt_at,
                error_code = excluded.error_code,
                error_message = excluded.error_message
            ",
            params![
                &record.section,
                &record.status,
                &record.last_success_at,
                &record.last_attempt_at,
                &record.error_code,
                &record.error_message
            ],
        )?;

        Ok(())
    }

    pub fn mark_syncing(&self, section: &str, attempted_at: &str) -> rusqlite::Result<()> {
        let mut record = self
            .get(section)?
            .unwrap_or_else(|| SyncStateRecord::idle(section));
        record.status = "syncing".to_string();
        record.last_attempt_at = Some(attempted_at.to_string());
        record.error_code = None;
        record.error_message = None;

        self.upsert(&record)
    }

    pub fn mark_success(&self, section: &str, completed_at: &str) -> rusqlite::Result<()> {
        let mut record = self
            .get(section)?
            .unwrap_or_else(|| SyncStateRecord::idle(section));
        record.status = "success".to_string();
        record.last_success_at = Some(completed_at.to_string());
        record.last_attempt_at = Some(completed_at.to_string());
        record.error_code = None;
        record.error_message = None;

        self.upsert(&record)
    }

    pub fn mark_failed(
        &self,
        section: &str,
        attempted_at: &str,
        error_code: &str,
        error_message: &str,
    ) -> rusqlite::Result<()> {
        let mut record = self
            .get(section)?
            .unwrap_or_else(|| SyncStateRecord::idle(section));
        record.status = "failed".to_string();
        record.last_attempt_at = Some(attempted_at.to_string());
        record.error_code = Some(error_code.to_string());
        record.error_message = Some(error_message.to_string());

        self.upsert(&record)
    }
}

fn map_sync_state_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncStateRecord> {
    Ok(SyncStateRecord {
        section: row.get(0)?,
        status: row.get(1)?,
        last_success_at: row.get(2)?,
        last_attempt_at: row.get(3)?,
        error_code: row.get(4)?,
        error_message: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use crate::db::initialize_schema;

    use super::SyncStateRepository;

    #[test]
    fn sync_state_repository_upserts_and_reads_state() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let repository = SyncStateRepository::new(&connection);

        repository
            .mark_syncing("shelf", "100")
            .expect("syncing state should save");
        repository
            .mark_success("shelf", "120")
            .expect("success state should save");

        let record = repository
            .get("shelf")
            .expect("state should query")
            .expect("state should exist");

        assert_eq!(record.status, "success");
        assert_eq!(record.last_success_at, Some("120".to_string()));
        assert_eq!(record.last_attempt_at, Some("120".to_string()));
        assert_eq!(record.error_code, None);
    }

    #[test]
    fn sync_state_repository_preserves_last_success_on_failure() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let repository = SyncStateRepository::new(&connection);

        repository
            .mark_success("notes", "100")
            .expect("success state should save");
        repository
            .mark_failed("notes", "130", "network", "连接失败")
            .expect("failed state should save");

        let record = repository
            .get("notes")
            .expect("state should query")
            .expect("state should exist");

        assert_eq!(record.status, "failed");
        assert_eq!(record.last_success_at, Some("100".to_string()));
        assert_eq!(record.last_attempt_at, Some("130".to_string()));
        assert_eq!(record.error_code, Some("network".to_string()));
    }
}
