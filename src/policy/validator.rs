use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PolicyConfig {
    #[serde(default)]
    pub allow_command_prefixes: Vec<String>,
    #[serde(default)]
    pub deny_command_patterns: Vec<String>,
    #[serde(default)]
    pub protected_paths: Vec<PathBuf>,
}

impl PolicyConfig {
    pub fn from_json_str(raw: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(raw)
    }
}

#[derive(Debug, Clone)]
pub struct PolicyValidator {
    config: PolicyConfig,
}

impl PolicyValidator {
    pub fn new(config: PolicyConfig) -> Self {
        Self { config }
    }

    pub fn validate_command(&self, command: &str) -> Result<(), PolicyError> {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err(PolicyError::EmptyCommand);
        }

        let lowered = normalize_for_match(trimmed);

        for pattern in &self.config.deny_command_patterns {
            if lowered.contains(&normalize_for_match(pattern)) {
                return Err(PolicyError::DeniedCommand {
                    command: trimmed.to_string(),
                    pattern: pattern.clone(),
                });
            }
        }

        if !self.config.allow_command_prefixes.is_empty() {
            let allowed = self
                .config
                .allow_command_prefixes
                .iter()
                .any(|prefix| lowered.starts_with(&normalize_for_match(prefix)));

            if !allowed {
                return Err(PolicyError::CommandNotAllowed {
                    command: trimmed.to_string(),
                });
            }
        }

        Ok(())
    }

    pub fn validate_paths<'a, I>(&self, paths: I) -> Result<(), PolicyError>
    where
        I: IntoIterator<Item = &'a Path>,
    {
        for path in paths {
            for protected_root in &self.config.protected_paths {
                if is_path_under(path, protected_root) {
                    return Err(PolicyError::ProtectedPath {
                        path: path.to_path_buf(),
                        protected_root: protected_root.clone(),
                    });
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyError {
    EmptyCommand,
    DeniedCommand { command: String, pattern: String },
    CommandNotAllowed { command: String },
    ProtectedPath { path: PathBuf, protected_root: PathBuf },
}

impl Display for PolicyError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            PolicyError::EmptyCommand => write!(f, "policy rejected command: command is empty"),
            PolicyError::DeniedCommand { command, pattern } => write!(
                f,
                "policy rejected command '{}': matched deny pattern '{}')",
                command, pattern
            ),
            PolicyError::CommandNotAllowed { command } => write!(
                f,
                "policy rejected command '{}': command does not match allow list",
                command
            ),
            PolicyError::ProtectedPath {
                path,
                protected_root,
            } => write!(
                f,
                "policy rejected path '{}': protected root '{}'",
                path.display(),
                protected_root.display()
            ),
        }
    }
}

impl Error for PolicyError {}

fn normalize_for_match(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn is_path_under(path: &Path, root: &Path) -> bool {
    let candidate = normalize_path_for_match(path);
    let protected = normalize_path_for_match(root);

    if candidate == protected {
        return true;
    }

    if let Some(rest) = candidate.strip_prefix(&protected) {
        return rest.starts_with('/');
    }

    false
}

fn normalize_path_for_match(path: &Path) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        normalized = normalized.to_ascii_lowercase();
    }
    while normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::{PolicyConfig, PolicyError, PolicyValidator};
    use std::env;
    use std::path::Path;

    #[test]
    fn loads_policy_config_from_json() {
        let raw = r#"{
          "allow_command_prefixes": ["git ", "cargo "],
          "deny_command_patterns": ["rm -rf", "shutdown"],
          "protected_paths": ["/critical", "/secrets"]
        }"#;

        let config = PolicyConfig::from_json_str(raw).unwrap();
        assert_eq!(config.allow_command_prefixes.len(), 2);
        assert_eq!(config.deny_command_patterns.len(), 2);
        assert_eq!(config.protected_paths.len(), 2);
    }

    #[test]
    fn allows_configured_safe_command() {
        let config = PolicyConfig {
            allow_command_prefixes: vec!["git ".into(), "cargo ".into()],
            deny_command_patterns: vec!["rm -rf".into()],
            protected_paths: Vec::new(),
        };
        let validator = PolicyValidator::new(config);

        assert!(validator.validate_command("cargo test").is_ok());
    }

    #[test]
    fn rejects_denied_command_with_explicit_error() {
        let config = PolicyConfig {
            allow_command_prefixes: vec!["git ".into(), "cargo ".into()],
            deny_command_patterns: vec!["rm -rf".into()],
            protected_paths: Vec::new(),
        };
        let validator = PolicyValidator::new(config);

        let err = validator.validate_command("cargo test && rm -rf /").unwrap_err();
        match err {
            PolicyError::DeniedCommand { command, pattern } => {
                assert_eq!(command, "cargo test && rm -rf /");
                assert_eq!(pattern, "rm -rf");
            }
            _ => panic!("expected denied command error"),
        }
    }

    #[test]
    fn rejects_command_outside_allow_list() {
        let config = PolicyConfig {
            allow_command_prefixes: vec!["git ".into()],
            deny_command_patterns: Vec::new(),
            protected_paths: Vec::new(),
        };
        let validator = PolicyValidator::new(config);

        let err = validator.validate_command("cargo build").unwrap_err();
        assert!(matches!(err, PolicyError::CommandNotAllowed { .. }));
    }

    #[test]
    fn rejects_protected_paths() {
        let protected_root = env::temp_dir().join("fastcode-protected-root");
        let target = protected_root.join("nested").join("file.txt");

        let config = PolicyConfig {
            allow_command_prefixes: Vec::new(),
            deny_command_patterns: Vec::new(),
            protected_paths: vec![protected_root.clone()],
        };

        let validator = PolicyValidator::new(config);
        let err = validator
            .validate_paths([target.as_path()])
            .expect_err("path should be blocked");

        match err {
            PolicyError::ProtectedPath {
                path,
                protected_root: root,
            } => {
                assert_eq!(path, target);
                assert_eq!(root, protected_root);
            }
            _ => panic!("expected protected path error"),
        }
    }

    #[test]
    fn allows_paths_outside_protected_roots() {
        let config = PolicyConfig {
            allow_command_prefixes: Vec::new(),
            deny_command_patterns: Vec::new(),
            protected_paths: vec![Path::new("/do-not-touch").to_path_buf()],
        };

        let validator = PolicyValidator::new(config);
        assert!(validator
            .validate_paths([Path::new("/workspace/project/src/main.rs")])
            .is_ok());
    }
}
