use clap::Parser;
use fastcode::modes::runtime_mode::RuntimeMode;
use fastcode::tui;
use std::str::FromStr;

#[derive(Debug, Parser)]
#[command(name = "fastcode")]
#[command(about = "FastCode Rust TUI bootstrap")]
struct Cli {
    #[arg(long, default_value = "edit")]
    mode: String,
    #[arg(long, default_value_t = false)]
    tui: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mode = RuntimeMode::from_str(&cli.mode)?;
    if cli.tui {
        tui::run_app(mode)?;
    } else {
        println!("fastcode bootstrap running in mode: {}", mode);
        println!("hint: run with --tui to launch the terminal UI");
    }
    Ok(())
}
