use crate::modes::runtime_mode::RuntimeMode;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub created_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
    pub current_mode: RuntimeMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub name: String,
    pub created_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug)]
pub struct SessionManager {
    current_session: Option<Session>,
    sessions_dir: PathBuf,
}

impl SessionManager {
    pub fn with_default_dir() -> anyhow::Result<Self> {
        let base = dirs::config_dir().ok_or_else(|| {
            anyhow::anyhow!("failed to resolve configuration directory for session storage")
        })?;
        Self::new(base.join("fastcode").join("sessions"))
    }

    pub fn new(sessions_dir: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let sessions_dir = sessions_dir.into();
        fs::create_dir_all(&sessions_dir)?;
        Ok(Self {
            current_session: None,
            sessions_dir,
        })
    }

    pub fn sessions_dir(&self) -> &Path {
        &self.sessions_dir
    }

    pub fn current_session(&self) -> Option<&Session> {
        self.current_session.as_ref()
    }

    pub fn create(&mut self, name: Option<String>) -> anyhow::Result<Session> {
        let timestamp = current_epoch_secs();
        let session = Session {
            id: Uuid::new_v4().to_string(),
            name: normalize_name(name)
                .unwrap_or_else(|| format!("session-{}", format_compact_timestamp(timestamp))),
            created_at_epoch_secs: timestamp,
            updated_at_epoch_secs: timestamp,
            current_mode: RuntimeMode::default(),
        };

        self.save_session(&session)?;
        self.current_session = Some(session.clone());
        Ok(session)
    }

    pub fn load(&mut self, id: &str) -> anyhow::Result<Session> {
        let normalized_id = normalize_id(id)?;
        let path = self.sessions_dir.join(format!("{}.json", normalized_id));
        let content = fs::read_to_string(&path).map_err(|err| {
            anyhow::anyhow!(
                "failed to load session '{}': {} (path: {})",
                normalized_id,
                err,
                path.display()
            )
        })?;
        let session: Session = serde_json::from_str(&content)?;
        self.current_session = Some(session.clone());
        Ok(session)
    }

    pub fn switch(&mut self, id: &str) -> anyhow::Result<Session> {
        self.load(id)
    }

    pub fn save_session(&self, session: &Session) -> anyhow::Result<()> {
        validate_session(session)?;
        let path = self.sessions_dir.join(format!("{}.json", session.id));
        let json = serde_json::to_string_pretty(session)?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn list(&self) -> anyhow::Result<Vec<SessionMeta>> {
        let mut sessions = Vec::new();
        for entry in fs::read_dir(&self.sessions_dir)? {
            let entry = entry?;
            let path = entry.path();
            if !is_session_file(&path) {
                continue;
            }

            let content = fs::read_to_string(&path)?;
            let session: Session = serde_json::from_str(&content)?;
            sessions.push(SessionMeta {
                id: session.id,
                name: session.name,
                created_at_epoch_secs: session.created_at_epoch_secs,
                updated_at_epoch_secs: session.updated_at_epoch_secs,
            });
        }

        sessions.sort_by(|a, b| {
            b.updated_at_epoch_secs
                .cmp(&a.updated_at_epoch_secs)
                .then_with(|| a.name.cmp(&b.name))
        });

        Ok(sessions)
    }
}

fn normalize_name(input: Option<String>) -> Option<String> {
    input.and_then(|name| {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_id(id: &str) -> anyhow::Result<String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        anyhow::bail!("session id cannot be empty");
    }
    Ok(trimmed.to_string())
}

fn validate_session(session: &Session) -> anyhow::Result<()> {
    if session.id.trim().is_empty() {
        anyhow::bail!("session id cannot be empty");
    }
    if session.name.trim().is_empty() {
        anyhow::bail!("session name cannot be empty");
    }
    Ok(())
}

fn is_session_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|value| value.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("json"))
            .unwrap_or(false)
}

fn format_compact_timestamp(epoch_secs: u64) -> String {
    epoch_secs.to_string()
}

fn current_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::SessionManager;
    use std::env;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn creates_persists_and_lists_sessions_with_metadata() {
        let sessions_dir = unique_temp_dir("session-manager-list");
        cleanup_dir(&sessions_dir);

        let mut manager = SessionManager::new(&sessions_dir).unwrap();
        let first = manager.create(Some("alpha".to_string())).unwrap();
        let second = manager.create(Some("beta".to_string())).unwrap();

        assert_ne!(first.id, second.id);
        assert_eq!(manager.current_session().unwrap().id, second.id);

        let reloaded = SessionManager::new(&sessions_dir).unwrap();
        let list = reloaded.list().unwrap();
        assert_eq!(list.len(), 2);
        assert!(
            list.iter()
                .any(|meta| meta.id == first.id && meta.name == "alpha")
        );
        assert!(
            list.iter()
                .any(|meta| meta.id == second.id && meta.name == "beta")
        );
        assert!(
            list.iter()
                .all(|meta| meta.created_at_epoch_secs > 0 && meta.updated_at_epoch_secs > 0)
        );

        cleanup_dir(&sessions_dir);
    }

    #[test]
    fn loads_and_switches_active_session() {
        let sessions_dir = unique_temp_dir("session-manager-switch");
        cleanup_dir(&sessions_dir);

        let mut manager = SessionManager::new(&sessions_dir).unwrap();
        let first = manager.create(Some("first".to_string())).unwrap();
        let second = manager.create(Some("second".to_string())).unwrap();

        let loaded_first = manager.load(&first.id).unwrap();
        assert_eq!(loaded_first.id, first.id);
        assert_eq!(manager.current_session().unwrap().id, first.id);

        let switched = manager.switch(&second.id).unwrap();
        assert_eq!(switched.id, second.id);
        assert_eq!(manager.current_session().unwrap().id, second.id);

        cleanup_dir(&sessions_dir);
    }

    #[test]
    fn rejects_invalid_load_arguments() {
        let sessions_dir = unique_temp_dir("session-manager-invalid");
        cleanup_dir(&sessions_dir);

        let mut manager = SessionManager::new(&sessions_dir).unwrap();
        let err = manager.load("   ").unwrap_err();
        assert!(err.to_string().contains("session id cannot be empty"));

        cleanup_dir(&sessions_dir);
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        env::temp_dir().join(format!("fastcode-{}-{}", prefix, stamp))
    }

    fn cleanup_dir(path: &Path) {
        if path.exists() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}
