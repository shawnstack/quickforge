use crate::modes::runtime_mode::RuntimeMode;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditRecord {
    pub timestamp_unix_ms: u128,
    pub mode: RuntimeMode,
    pub tool: String,
    pub result: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuditLogger {
    path: PathBuf,
}

impl AuditLogger {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn log_tool_invocation(
        &self,
        mode: RuntimeMode,
        tool: &str,
        result: &str,
        error_code: Option<&str>,
        error_message: Option<&str>,
    ) -> anyhow::Result<()> {
        let record = AuditRecord {
            timestamp_unix_ms: current_unix_ms(),
            mode,
            tool: tool.to_string(),
            result: result.to_ascii_lowercase(),
            error_code: error_code.map(str::to_string),
            error_message: error_message.map(str::to_string),
        };
        self.append_record(&record)
    }

    fn append_record(&self, record: &AuditRecord) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let line = serde_json::to_string(record)?;
        writeln!(file, "{}", line)?;
        Ok(())
    }
}

fn current_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::{AuditLogger, AuditRecord};
    use crate::modes::runtime_mode::RuntimeMode;
    use std::env;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn appends_parseable_jsonl_records_with_required_fields() {
        let temp_dir = unique_temp_dir("audit-logger");
        cleanup_dir(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let log_path = temp_dir.join("audit.jsonl");
        let logger = AuditLogger::new(&log_path);
        logger
            .log_tool_invocation(RuntimeMode::Edit, "shell", "success", None, None)
            .unwrap();
        logger
            .log_tool_invocation(
                RuntimeMode::Plan,
                "git",
                "error",
                Some("tool_execution_failed"),
                Some("git failed"),
            )
            .unwrap();

        let raw = std::fs::read_to_string(&log_path).unwrap();
        let lines = raw.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);

        let first: AuditRecord = serde_json::from_str(lines[0]).unwrap();
        assert!(first.timestamp_unix_ms > 0);
        assert_eq!(first.mode, RuntimeMode::Edit);
        assert_eq!(first.tool, "shell");
        assert_eq!(first.result, "success");

        let second: AuditRecord = serde_json::from_str(lines[1]).unwrap();
        assert!(second.timestamp_unix_ms >= first.timestamp_unix_ms);
        assert_eq!(second.mode, RuntimeMode::Plan);
        assert_eq!(second.tool, "git");
        assert_eq!(second.result, "error");
        assert_eq!(second.error_code.as_deref(), Some("tool_execution_failed"));

        cleanup_dir(&temp_dir);
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
