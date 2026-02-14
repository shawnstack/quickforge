use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalType {
    AllowOnce,
    AllowSession,
    AllowGlobal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approval {
    pub prefix: String,
    pub approval_type: ApprovalType,
    pub session_id: Option<String>,
    pub created_at_epoch_secs: u64,
}

#[derive(Debug)]
pub struct ApprovalManager {
    approvals: Vec<Approval>,
    path: PathBuf,
}

impl ApprovalManager {
    pub fn load_or_create(path: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let approvals = if path.exists() {
            let raw = fs::read_to_string(&path)?;
            if raw.trim().is_empty() {
                Vec::new()
            } else {
                serde_json::from_str(&raw)?
            }
        } else {
            Vec::new()
        };

        Ok(Self { approvals, path })
    }

    pub fn approvals(&self) -> &[Approval] {
        &self.approvals
    }

    pub fn save(&self) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&self.approvals)?;
        fs::write(&self.path, json)?;
        Ok(())
    }

    pub fn add_approval(
        &mut self,
        prefix: &str,
        approval_type: ApprovalType,
        session_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let normalized_prefix = prefix.trim();
        if normalized_prefix.is_empty() {
            anyhow::bail!("approval prefix cannot be empty");
        }

        let normalized_session = session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);

        if matches!(
            approval_type,
            ApprovalType::AllowOnce | ApprovalType::AllowSession
        ) && normalized_session.is_none()
        {
            anyhow::bail!("session_id is required for allow_once and allow_session approvals");
        }

        let approval = Approval {
            prefix: normalized_prefix.to_string(),
            approval_type,
            session_id: if matches!(approval_type, ApprovalType::AllowGlobal) {
                None
            } else {
                normalized_session
            },
            created_at_epoch_secs: current_epoch_secs(),
        };

        self.approvals.push(approval);
        self.save()?;
        Ok(())
    }

    pub fn is_approved(&self, command: &str, session_id: &str) -> Option<&Approval> {
        let normalized_command = normalize_command(command);
        if normalized_command.is_empty() {
            return None;
        }
        let normalized_session = session_id.trim();
        if normalized_session.is_empty() {
            return None;
        }

        let order = [
            ApprovalType::AllowOnce,
            ApprovalType::AllowSession,
            ApprovalType::AllowGlobal,
        ];

        for approval_type in order {
            if let Some(approval) = self.approvals.iter().find(|approval| {
                approval.approval_type == approval_type
                    && command_matches_prefix(&normalized_command, &approval.prefix)
                    && scope_matches(approval, normalized_session)
            }) {
                return Some(approval);
            }
        }

        None
    }

    pub fn authorize_command(
        &mut self,
        command: &str,
        session_id: &str,
    ) -> anyhow::Result<Option<Approval>> {
        let normalized_command = normalize_command(command);
        if normalized_command.is_empty() {
            return Ok(None);
        }
        let normalized_session = session_id.trim();
        if normalized_session.is_empty() {
            return Ok(None);
        }

        let order = [
            ApprovalType::AllowOnce,
            ApprovalType::AllowSession,
            ApprovalType::AllowGlobal,
        ];

        for approval_type in order {
            if let Some(index) = self.approvals.iter().position(|approval| {
                approval.approval_type == approval_type
                    && command_matches_prefix(&normalized_command, &approval.prefix)
                    && scope_matches(approval, normalized_session)
            }) {
                let matched = self.approvals[index].clone();
                if matched.approval_type == ApprovalType::AllowOnce {
                    self.approvals.remove(index);
                    self.save()?;
                }
                return Ok(Some(matched));
            }
        }

        Ok(None)
    }
}

fn normalize_command(command: &str) -> String {
    command.trim().to_string()
}

fn command_matches_prefix(command: &str, prefix: &str) -> bool {
    command.starts_with(prefix.trim())
}

fn scope_matches(approval: &Approval, session_id: &str) -> bool {
    match approval.approval_type {
        ApprovalType::AllowGlobal => true,
        ApprovalType::AllowSession | ApprovalType::AllowOnce => {
            approval.session_id.as_deref() == Some(session_id)
        }
    }
}

fn current_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::{ApprovalManager, ApprovalType};
    use std::env;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn persists_and_reloads_all_approval_scopes() {
        let path = unique_temp_file("approvals-all-scopes");
        cleanup_file(&path);

        let mut manager = ApprovalManager::load_or_create(&path).unwrap();
        manager
            .add_approval("git status", ApprovalType::AllowGlobal, None)
            .unwrap();
        manager
            .add_approval("cargo test", ApprovalType::AllowSession, Some("session-a"))
            .unwrap();
        manager
            .add_approval("npm run", ApprovalType::AllowOnce, Some("session-a"))
            .unwrap();

        let reloaded = ApprovalManager::load_or_create(&path).unwrap();
        assert_eq!(reloaded.approvals().len(), 3);

        let global = reloaded.is_approved("git status --short", "any-session");
        assert!(global.is_some());
        assert_eq!(global.unwrap().approval_type, ApprovalType::AllowGlobal);

        let session = reloaded.is_approved("cargo test -q", "session-a");
        assert!(session.is_some());
        assert_eq!(session.unwrap().approval_type, ApprovalType::AllowSession);

        assert!(reloaded.is_approved("cargo test -q", "session-b").is_none());
        assert!(reloaded.is_approved("npm run build", "session-a").is_some());
        cleanup_file(&path);
    }

    #[test]
    fn allow_once_is_consumed_after_authorization() {
        let path = unique_temp_file("approvals-allow-once");
        cleanup_file(&path);

        let mut manager = ApprovalManager::load_or_create(&path).unwrap();
        manager
            .add_approval("make build", ApprovalType::AllowOnce, Some("session-a"))
            .unwrap();

        let first = manager
            .authorize_command("make build --release", "session-a")
            .unwrap();
        assert!(first.is_some());
        assert_eq!(first.unwrap().approval_type, ApprovalType::AllowOnce);

        let second = manager
            .authorize_command("make build --release", "session-a")
            .unwrap();
        assert!(second.is_none());

        let reloaded = ApprovalManager::load_or_create(&path).unwrap();
        assert!(
            reloaded
                .is_approved("make build --release", "session-a")
                .is_none()
        );
        cleanup_file(&path);
    }

    #[test]
    fn rejects_missing_session_for_session_scoped_approvals() {
        let path = unique_temp_file("approvals-invalid-scope");
        cleanup_file(&path);

        let mut manager = ApprovalManager::load_or_create(&path).unwrap();
        let err = manager
            .add_approval("cargo test", ApprovalType::AllowSession, None)
            .unwrap_err();
        assert!(
            err.to_string()
                .contains("session_id is required for allow_once and allow_session approvals")
        );
        cleanup_file(&path);
    }

    fn unique_temp_file(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        env::temp_dir().join(format!("fastcode-{}-{}.json", prefix, stamp))
    }

    fn cleanup_file(path: &Path) {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
}
