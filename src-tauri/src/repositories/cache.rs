use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawCacheRecord {
    pub namespace: String,
    pub cache_key: String,
    pub raw_json: String,
    pub updated_at: String,
}

pub struct RawCacheRepository<'conn> {
    connection: &'conn Connection,
}

impl<'conn> RawCacheRepository<'conn> {
    pub fn new(connection: &'conn Connection) -> Self {
        Self { connection }
    }

    pub fn put_json(
        &self,
        namespace: &str,
        cache_key: &str,
        value: &Value,
        updated_at: &str,
    ) -> rusqlite::Result<()> {
        let raw_json = serde_json::to_string(value)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        self.connection.execute(
            "
            INSERT INTO raw_cache (namespace, cache_key, raw_json, updated_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(namespace, cache_key) DO UPDATE SET
                raw_json = excluded.raw_json,
                updated_at = excluded.updated_at
            ",
            params![namespace, cache_key, raw_json, updated_at],
        )?;

        Ok(())
    }

    pub fn get(
        &self,
        namespace: &str,
        cache_key: &str,
    ) -> rusqlite::Result<Option<RawCacheRecord>> {
        self.connection
            .query_row(
                "
                SELECT namespace, cache_key, raw_json, updated_at
                FROM raw_cache
                WHERE namespace = ?1 AND cache_key = ?2
                ",
                params![namespace, cache_key],
                |row| {
                    Ok(RawCacheRecord {
                        namespace: row.get(0)?,
                        cache_key: row.get(1)?,
                        raw_json: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()
    }

    pub fn get_json(&self, namespace: &str, cache_key: &str) -> rusqlite::Result<Option<Value>> {
        self.get(namespace, cache_key)?
            .map(|record| {
                serde_json::from_str::<Value>(&record.raw_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })
            })
            .transpose()
    }

    pub fn delete_namespace(&self, namespace: &str) -> rusqlite::Result<usize> {
        self.connection
            .execute("DELETE FROM raw_cache WHERE namespace = ?1", [namespace])
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use crate::db::initialize_schema;

    use super::RawCacheRepository;

    #[test]
    fn raw_cache_repository_upserts_json_values() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let repository = RawCacheRepository::new(&connection);

        repository
            .put_json("shelf", "latest", &json!({ "books": [] }), "100")
            .expect("json should save");
        repository
            .put_json("shelf", "latest", &json!({ "books": [1] }), "120")
            .expect("json should update");

        let value = repository
            .get_json("shelf", "latest")
            .expect("json should query")
            .expect("json should exist");

        assert_eq!(value, json!({ "books": [1] }));
    }

    #[test]
    fn raw_cache_repository_deletes_by_namespace() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let repository = RawCacheRepository::new(&connection);

        repository
            .put_json("shelf", "latest", &json!({ "books": [] }), "100")
            .expect("json should save");
        repository
            .put_json("notes", "latest", &json!({ "books": [] }), "100")
            .expect("json should save");

        let deleted = repository
            .delete_namespace("shelf")
            .expect("namespace should delete");

        assert_eq!(deleted, 1);
        assert!(repository
            .get_json("shelf", "latest")
            .expect("json should query")
            .is_none());
        assert!(repository
            .get_json("notes", "latest")
            .expect("json should query")
            .is_some());
    }
}
