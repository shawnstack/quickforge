use clap::Parser;
use fastcode::modes::runtime_mode::RuntimeMode;
use std::str::FromStr;

#[derive(Debug, Parser)]
#[command(name = "fastcode")]
#[command(about = "FastCode Rust TUI bootstrap")]
struct Cli {
    #[arg(long, default_value = "edit")]
    mode: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mode = RuntimeMode::from_str(&cli.mode)?;
    println!("fastcode bootstrap running in mode: {}", mode);
    println!("next: implement TUI app loop and agent orchestration");
    Ok(())
}
