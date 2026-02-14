use anyhow::Context;
use clap::Parser;
use fastcode::mcp::config::McpConfig;
use fastcode::modes::runtime_mode::RuntimeMode;
use fastcode::tui;
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Parser)]
#[command(name = "fastcode")]
#[command(about = "FastCode Rust TUI bootstrap")]
struct Cli {
    #[arg(long, default_value = "edit")]
    mode: String,
    #[arg(long, default_value_t = false)]
    tui: bool,
    #[arg(long)]
    mcp_config: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    list_mcp_servers: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mode = RuntimeMode::from_str(&cli.mode)?;

    if cli.list_mcp_servers {
        let config_path = cli
            .mcp_config
            .as_ref()
            .with_context(|| "--list-mcp-servers requires --mcp-config <path-to-json-config>")?;
        let config = McpConfig::load_from_path(config_path)?;
        println!("loaded {} MCP server(s):", config.servers.len());
        for name in config.server_names() {
            println!("- {}", name);
        }
        return Ok(());
    }

    if cli.tui {
        tui::run_app(mode)?;
    } else {
        println!("fastcode bootstrap running in mode: {}", mode);
        println!("hint: run with --tui to launch the terminal UI");
    }
    Ok(())
}
