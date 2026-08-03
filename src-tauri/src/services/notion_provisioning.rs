use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{atomic_file, errors::AppError, export::notion_views::NotionDefaultViewResult};

pub const NOTION_STANDARD_PROVISIONING_FILE_NAME: &str =
    "notion-standard-database-provisioning.json";
const NOTION_STANDARD_PROVISIONING_VERSION: u32 = 2;
const NOTION_STANDARD_DATABASE_TITLE: &str = "阅读成果库";

static NOTION_STANDARD_PROVISIONING_ACTIVE: AtomicBool = AtomicBool::new(false);
static PROVISIONING_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionStandardProvisioningPhase {
    CreatingDatabase,
    DatabaseCreateUnknown,
    DatabaseCreated,
    ConnectionSaved,
    ViewsInitializing,
    Partial,
    Complete,
}

impl NotionStandardProvisioningPhase {
    fn rank(self) -> u8 {
        match self {
            Self::CreatingDatabase => 0,
            Self::DatabaseCreateUnknown => 1,
            Self::DatabaseCreated => 2,
            Self::ConnectionSaved => 3,
            Self::ViewsInitializing => 4,
            Self::Partial => 5,
            Self::Complete => 6,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionStandardProvisioningStatus {
    Complete,
    Partial,
    RecoveryRequired,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionProvisioningError {
    pub step: String,
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub result_unknown: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionStandardProvisioningState {
    pub version: u32,
    pub provisioning_id: String,
    pub parent_page_id: String,
    pub title: String,
    pub phase: NotionStandardProvisioningPhase,
    pub created_at: String,
    pub updated_at: String,
    pub database_id: Option<String>,
    pub database_url: Option<String>,
    #[serde(default)]
    pub data_source_id: Option<String>,
    pub connection_saved_at: Option<String>,
    #[serde(default)]
    pub initialized_at: Option<String>,
    #[serde(default)]
    pub views: Vec<NotionDefaultViewResult>,
    pub last_error: Option<NotionProvisioningError>,
}

impl NotionStandardProvisioningState {
    pub fn creating(parent_page_id: String) -> Self {
        let now = unix_timestamp_millis();
        Self {
            version: NOTION_STANDARD_PROVISIONING_VERSION,
            provisioning_id: next_provisioning_id(&now),
            parent_page_id,
            title: NOTION_STANDARD_DATABASE_TITLE.to_string(),
            phase: NotionStandardProvisioningPhase::CreatingDatabase,
            created_at: now.clone(),
            updated_at: now,
            database_id: None,
            database_url: None,
            data_source_id: None,
            connection_saved_at: None,
            initialized_at: None,
            views: Vec::new(),
            last_error: None,
        }
    }

    pub fn transition(&mut self, phase: NotionStandardProvisioningPhase) -> Result<(), AppError> {
        let retrying_views_after_partial = self.phase == NotionStandardProvisioningPhase::Partial
            && phase == NotionStandardProvisioningPhase::ViewsInitializing;
        if phase.rank() < self.phase.rank() && !retrying_views_after_partial {
            return Err(AppError::Storage(format!(
                "Notion provisioning 阶段不能从 {:?} 退回 {:?}。",
                self.phase, phase
            )));
        }
        if phase == NotionStandardProvisioningPhase::DatabaseCreated
            && self.database_id.as_deref().unwrap_or_default().is_empty()
        {
            return Err(AppError::Storage(
                "Notion provisioning 进入 databaseCreated 前必须保存 database ID。".to_string(),
            ));
        }
        if matches!(
            phase,
            NotionStandardProvisioningPhase::ConnectionSaved
                | NotionStandardProvisioningPhase::ViewsInitializing
                | NotionStandardProvisioningPhase::Partial
                | NotionStandardProvisioningPhase::Complete
        ) && self.database_id.as_deref().unwrap_or_default().is_empty()
        {
            return Err(AppError::Storage(
                "Notion provisioning 进入连接或视图阶段前必须保存 database ID。".to_string(),
            ));
        }
        if matches!(
            phase,
            NotionStandardProvisioningPhase::ViewsInitializing
                | NotionStandardProvisioningPhase::Partial
                | NotionStandardProvisioningPhase::Complete
        ) && self.connection_saved_at.is_none()
        {
            return Err(AppError::Storage(
                "Notion provisioning 进入视图阶段前必须保存正式数据库连接。".to_string(),
            ));
        }
        self.phase = phase;
        self.updated_at = unix_timestamp_millis();
        Ok(())
    }

    pub fn status(&self) -> NotionStandardProvisioningStatus {
        match self.phase {
            NotionStandardProvisioningPhase::DatabaseCreateUnknown => {
                NotionStandardProvisioningStatus::Unknown
            }
            NotionStandardProvisioningPhase::DatabaseCreated => {
                NotionStandardProvisioningStatus::RecoveryRequired
            }
            NotionStandardProvisioningPhase::ConnectionSaved
            | NotionStandardProvisioningPhase::ViewsInitializing
            | NotionStandardProvisioningPhase::Partial => NotionStandardProvisioningStatus::Partial,
            NotionStandardProvisioningPhase::Complete => NotionStandardProvisioningStatus::Complete,
            NotionStandardProvisioningPhase::CreatingDatabase => {
                NotionStandardProvisioningStatus::Unknown
            }
        }
    }
}

pub struct NotionProvisioningOperationGuard;

impl Drop for NotionProvisioningOperationGuard {
    fn drop(&mut self) {
        NOTION_STANDARD_PROVISIONING_ACTIVE.store(false, Ordering::Release);
    }
}

pub fn try_begin_provisioning_operation() -> Result<NotionProvisioningOperationGuard, AppError> {
    NOTION_STANDARD_PROVISIONING_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| {
            AppError::InvalidPayload(
                "标准阅读成果库正在创建或恢复，请等待当前操作完成。".to_string(),
            )
        })?;
    Ok(NotionProvisioningOperationGuard)
}

pub fn provisioning_path(default_data_dir: &Path) -> PathBuf {
    default_data_dir.join(NOTION_STANDARD_PROVISIONING_FILE_NAME)
}

pub fn read_provisioning(path: &Path) -> Result<Option<NotionStandardProvisioningState>, AppError> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::Storage(error.to_string())),
    };
    let mut state =
        serde_json::from_slice::<NotionStandardProvisioningState>(&content).map_err(|error| {
            AppError::Storage(format!(
                "Notion provisioning 状态文件损坏，已停止自动创建以避免重复建库：{error}"
            ))
        })?;
    if state.version == 0 || state.version > NOTION_STANDARD_PROVISIONING_VERSION {
        return Err(AppError::Storage(format!(
            "不支持的 Notion provisioning 状态版本：{}。",
            state.version
        )));
    }
    if state.version < NOTION_STANDARD_PROVISIONING_VERSION {
        state.version = NOTION_STANDARD_PROVISIONING_VERSION;
    }
    Ok(Some(state))
}

pub fn write_provisioning_atomic(
    path: &Path,
    state: &NotionStandardProvisioningState,
) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Storage(error.to_string()))?;
    }
    let content =
        serde_json::to_vec_pretty(state).map_err(|error| AppError::Storage(error.to_string()))?;
    atomic_file::write_bytes(path, &content).map_err(|error| AppError::Storage(error.to_string()))
}

pub fn clear_provisioning(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::Storage(error.to_string())),
    }
}

fn next_provisioning_id(timestamp: &str) -> String {
    let counter = PROVISIONING_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "notion-standard-{}-{}-{counter}",
        timestamp,
        std::process::id()
    )
}

fn unix_timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use serde_json::json;

    use super::{
        clear_provisioning, read_provisioning, write_provisioning_atomic,
        NotionStandardProvisioningPhase, NotionStandardProvisioningState,
    };

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "wxreadmaster-{label}-{}-{}.json",
            std::process::id(),
            super::unix_timestamp_millis()
        ))
    }

    #[test]
    fn atomic_write_and_read_round_trip() {
        let path = temp_path("notion-provisioning-roundtrip");
        let state = NotionStandardProvisioningState::creating("parent-page".to_string());

        write_provisioning_atomic(&path, &state).expect("state should be written");
        let stored = read_provisioning(&path)
            .expect("state should be readable")
            .expect("state should exist");

        assert_eq!(stored, state);
        clear_provisioning(&path).expect("state should be removed");
    }

    #[test]
    fn version_one_state_upgrades_with_empty_view_metadata() {
        let path = temp_path("notion-provisioning-version-one");
        let state = json!({
            "version": 1,
            "provisioningId": "legacy-provisioning",
            "parentPageId": "parent-page",
            "title": "阅读成果库",
            "phase": "connectionSaved",
            "createdAt": "100",
            "updatedAt": "200",
            "databaseId": "database-id",
            "databaseUrl": "https://www.notion.so/database-id",
            "connectionSavedAt": "200",
            "lastError": null
        });
        fs::write(
            &path,
            serde_json::to_vec_pretty(&state).expect("legacy state should serialize"),
        )
        .expect("legacy state should be written");

        let upgraded = read_provisioning(&path)
            .expect("legacy state should be readable")
            .expect("legacy state should exist");
        assert_eq!(upgraded.version, 2);
        assert_eq!(
            upgraded.phase,
            NotionStandardProvisioningPhase::ConnectionSaved
        );
        assert_eq!(upgraded.database_id.as_deref(), Some("database-id"));
        assert!(upgraded.data_source_id.is_none());
        assert!(upgraded.initialized_at.is_none());
        assert!(upgraded.views.is_empty());
        clear_provisioning(&path).expect("state should be removed");
    }

    #[test]
    fn corrupted_state_is_not_treated_as_missing() {
        let path = temp_path("notion-provisioning-corrupt");
        fs::write(&path, b"{not-json").expect("corrupted state should be written");

        let error = read_provisioning(&path).expect_err("corrupted state should fail");
        assert_eq!(error.code(), "local_storage_error");

        clear_provisioning(&path).expect("state should be removed");
    }

    #[test]
    fn unknown_fields_are_ignored_for_forward_compatibility() {
        let path = temp_path("notion-provisioning-forward-compatible");
        let mut state = serde_json::to_value(NotionStandardProvisioningState::creating(
            "parent-page".to_string(),
        ))
        .expect("state should serialize");
        state["futureField"] = json!({ "enabled": true });
        fs::write(
            &path,
            serde_json::to_vec_pretty(&state).expect("state should serialize"),
        )
        .expect("state should be written");

        assert!(read_provisioning(&path)
            .expect("state should be readable")
            .is_some());
        clear_provisioning(&path).expect("state should be removed");
    }

    #[test]
    fn phase_cannot_move_backwards() {
        let mut state = NotionStandardProvisioningState::creating("parent-page".to_string());
        state.database_id = Some("database-id".to_string());
        state
            .transition(NotionStandardProvisioningPhase::DatabaseCreated)
            .expect("forward transition should succeed");

        let error = state
            .transition(NotionStandardProvisioningPhase::CreatingDatabase)
            .expect_err("backward transition should fail");
        assert_eq!(error.code(), "local_storage_error");
    }

    #[test]
    fn partial_can_reenter_view_initialization_without_reopening_database_creation() {
        let mut state = NotionStandardProvisioningState::creating("parent-page".to_string());
        state.database_id = Some("database-id".to_string());
        state.connection_saved_at = Some("saved-at".to_string());
        state
            .transition(NotionStandardProvisioningPhase::DatabaseCreated)
            .expect("database transition should succeed");
        state
            .transition(NotionStandardProvisioningPhase::ConnectionSaved)
            .expect("connection transition should succeed");
        state
            .transition(NotionStandardProvisioningPhase::ViewsInitializing)
            .expect("view initialization should start");
        state
            .transition(NotionStandardProvisioningPhase::Partial)
            .expect("partial transition should succeed");

        state
            .transition(NotionStandardProvisioningPhase::ViewsInitializing)
            .expect("partial should allow a view-only retry");
        assert_eq!(
            state.phase,
            NotionStandardProvisioningPhase::ViewsInitializing
        );
        assert_eq!(state.database_id.as_deref(), Some("database-id"));
    }

    #[test]
    fn database_created_requires_recovery_anchor() {
        let mut state = NotionStandardProvisioningState::creating("parent-page".to_string());

        let error = state
            .transition(NotionStandardProvisioningPhase::DatabaseCreated)
            .expect_err("missing database id should fail");
        assert_eq!(error.code(), "local_storage_error");
    }
}
