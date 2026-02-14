use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeMode {
    Plan,
    Edit,
    Auto,
}

impl RuntimeMode {
    pub fn can_write(self) -> bool {
        matches!(self, RuntimeMode::Edit | RuntimeMode::Auto)
    }

    pub fn can_execute(self) -> bool {
        matches!(self, RuntimeMode::Edit | RuntimeMode::Auto)
    }

    pub fn requires_approval(self) -> bool {
        matches!(self, RuntimeMode::Edit)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RuntimeMode::Plan => "plan",
            RuntimeMode::Edit => "edit",
            RuntimeMode::Auto => "auto",
        }
    }
}

impl Default for RuntimeMode {
    fn default() -> Self {
        RuntimeMode::Edit
    }
}

impl Display for RuntimeMode {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeModeParseError {
    value: String,
}

impl RuntimeModeParseError {
    fn new(value: &str) -> Self {
        Self {
            value: value.to_string(),
        }
    }
}

impl Display for RuntimeModeParseError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "invalid runtime mode '{}', expected one of: plan, edit, auto",
            self.value
        )
    }
}

impl Error for RuntimeModeParseError {}

impl FromStr for RuntimeMode {
    type Err = RuntimeModeParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "plan" => Ok(RuntimeMode::Plan),
            "edit" => Ok(RuntimeMode::Edit),
            "auto" => Ok(RuntimeMode::Auto),
            _ => Err(RuntimeModeParseError::new(s)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeMode;
    use std::str::FromStr;

    #[test]
    fn test_runtime_mode_permissions() {
        assert!(!RuntimeMode::Plan.can_write());
        assert!(!RuntimeMode::Plan.can_execute());
        assert!(!RuntimeMode::Plan.requires_approval());

        assert!(RuntimeMode::Edit.can_write());
        assert!(RuntimeMode::Edit.can_execute());
        assert!(RuntimeMode::Edit.requires_approval());

        assert!(RuntimeMode::Auto.can_write());
        assert!(RuntimeMode::Auto.can_execute());
        assert!(!RuntimeMode::Auto.requires_approval());
    }

    #[test]
    fn parses_mode_case_insensitively() {
        assert_eq!(RuntimeMode::from_str("plan").unwrap(), RuntimeMode::Plan);
        assert_eq!(RuntimeMode::from_str("EDIT").unwrap(), RuntimeMode::Edit);
        assert_eq!(RuntimeMode::from_str(" Auto ").unwrap(), RuntimeMode::Auto);
    }

    #[test]
    fn mode_string_round_trip_is_stable() {
        for mode in [RuntimeMode::Plan, RuntimeMode::Edit, RuntimeMode::Auto] {
            let parsed = RuntimeMode::from_str(mode.as_str()).unwrap();
            assert_eq!(mode, parsed);
            assert_eq!(mode.to_string(), mode.as_str());
        }
    }

    #[test]
    fn rejects_unknown_mode() {
        let err = RuntimeMode::from_str("unsafe").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("invalid runtime mode"));
        assert!(msg.contains("plan, edit, auto"));
    }
}
