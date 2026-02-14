use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpConfig {
    pub servers: Vec<McpServerConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub cwd: Option<PathBuf>,
}

impl McpConfig {
    pub fn load_from_path(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let raw = fs::read_to_string(path)
            .with_context(|| format!("failed to read MCP config file '{}'", path.display()))?;
        let config: McpConfig = serde_json::from_str(&raw)
            .with_context(|| format!("failed to parse MCP config JSON '{}'", path.display()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        if self.servers.is_empty() {
            anyhow::bail!("MCP config must define at least one server");
        }

        let mut names = BTreeMap::new();
        for server in &self.servers {
            let name = server.name.trim();
            if name.is_empty() {
                anyhow::bail!("MCP server name cannot be empty");
            }
            if names.insert(name.to_string(), ()).is_some() {
                anyhow::bail!("duplicate MCP server name '{}'", name);
            }

            if server.command.trim().is_empty() {
                anyhow::bail!("MCP server '{}' has empty command", name);
            }
        }
        Ok(())
    }

    pub fn server_names(&self) -> Vec<String> {
        let mut names = self
            .servers
            .iter()
            .map(|server| server.name.trim().to_string())
            .collect::<Vec<_>>();
        names.sort();
        names
    }
}

#[cfg(test)]
mod tests {
    use super::McpConfig;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock went backwards")
            .as_nanos();
        std::env::temp_dir().join(format!("fastcode_mcp_{}_{}.json", name, nonce))
    }

    #[test]
    fn loads_and_sorts_server_names() {
        let path = temp_file("valid");
        let raw = r#"{
  "servers": [
    {"name":"github","command":"npx","args":["-y","@modelcontextprotocol/server-github"]},
    {"name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}
  ]
}"#;
        fs::write(&path, raw).expect("write config");

        let loaded = McpConfig::load_from_path(&path).expect("load config");
        assert_eq!(loaded.servers.len(), 2);
        assert_eq!(
            loaded.server_names(),
            vec!["filesystem".to_string(), "github".to_string()]
        );

        fs::remove_file(path).ok();
    }

    #[test]
    fn rejects_duplicate_server_names() {
        let path = temp_file("duplicate");
        let raw = r#"{
  "servers": [
    {"name":"filesystem","command":"npx"},
    {"name":"filesystem","command":"python"}
  ]
}"#;
        fs::write(&path, raw).expect("write config");
        let err = McpConfig::load_from_path(&path).expect_err("should reject duplicate names");
        let message = err.to_string();
        assert!(message.contains("duplicate MCP server name"), "{message}");
        fs::remove_file(path).ok();
    }

    #[test]
    fn rejects_empty_command() {
        let path = temp_file("empty_command");
        let raw = r#"{
  "servers": [
    {"name":"filesystem","command":"   "}
  ]
}"#;
        fs::write(&path, raw).expect("write config");
        let err = McpConfig::load_from_path(&path).expect_err("should reject empty command");
        let message = err.to_string();
        assert!(message.contains("empty command"), "{message}");
        fs::remove_file(path).ok();
    }
}
