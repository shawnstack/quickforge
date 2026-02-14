use clap::Parser;

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
    println!("fastcode bootstrap running in mode: {}", cli.mode);
    println!("next: implement TUI app loop and agent orchestration");
    Ok(())
}