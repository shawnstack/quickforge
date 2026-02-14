use crate::mcp::config::McpConfig;
use crate::mcp::lifecycle::{McpServerHealth, run_lifecycle_check};
use crate::modes::runtime_mode::RuntimeMode;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind};
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use crossterm::{ExecutableCommand, execute};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use std::collections::VecDeque;
use std::io;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const INPUT_MAX_LEN: usize = 512;
const STREAM_CHUNK_INTERVAL_MS: u64 = 60;
const STREAM_CHARS_PER_CHUNK: usize = 4;
pub const DEFAULT_MCP_REFRESH_INTERVAL_MS: u64 = 800;
const DEFAULT_MESSAGE_COMPACT_WIDTH: u16 = 80;
const MIN_MESSAGE_CONTENT_BUDGET: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpDiagnostics {
    pub status_label: String,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UiStatus {
    Idle,
    Processing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ScriptAction {
    Key(KeyEvent),
    Sleep(Duration),
    Resize { width: u16, height: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StreamState {
    target_message_index: usize,
    chunks: Vec<String>,
    next_chunk: usize,
    last_emit_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct App {
    mode: RuntimeMode,
    input: String,
    messages: Vec<String>,
    mcp_status_label: String,
    status: UiStatus,
    should_quit: bool,
    scroll: u16,
    viewport_width: u16,
    viewport_height: u16,
    mcp_refresh_count: u64,
    last_mcp_refresh_signature: Option<String>,
    last_mcp_summary_raw: Option<String>,
    stream_state: Option<StreamState>,
}

impl App {
    pub fn new(mode: RuntimeMode) -> Self {
        Self::new_with_mcp_diagnostics(mode, None)
    }

    pub fn new_with_mcp_diagnostics(
        mode: RuntimeMode,
        mcp_diagnostics: Option<McpDiagnostics>,
    ) -> Self {
        let mut messages = vec!["system: welcome to fastcode".to_string()];
        let mut mcp_status_label = "off".to_string();
        let mut last_mcp_refresh_signature = None;
        let mut last_mcp_summary_raw = None;
        if let Some(diagnostics) = mcp_diagnostics {
            mcp_status_label = diagnostics.status_label;
            if let Some(summary) = diagnostics.messages.first() {
                last_mcp_summary_raw = Some(summary.clone());
                last_mcp_refresh_signature = Some(format!("{}|{}", mcp_status_label, summary));
            }
            messages.extend(
                diagnostics.messages.into_iter().map(|message| {
                    compact_message_for_width(&message, DEFAULT_MESSAGE_COMPACT_WIDTH)
                }),
            );
        }

        Self {
            mode,
            input: String::new(),
            messages,
            mcp_status_label,
            status: UiStatus::Idle,
            should_quit: false,
            scroll: 0,
            viewport_width: 0,
            viewport_height: 0,
            mcp_refresh_count: 0,
            last_mcp_refresh_signature,
            last_mcp_summary_raw,
            stream_state: None,
        }
    }

    pub fn mode(&self) -> RuntimeMode {
        self.mode
    }

    pub fn status(&self) -> &UiStatus {
        &self.status
    }

    pub fn input(&self) -> &str {
        &self.input
    }

    pub fn messages(&self) -> &[String] {
        &self.messages
    }

    pub fn mcp_status_label(&self) -> &str {
        &self.mcp_status_label
    }

    pub fn mcp_status_display(&self) -> String {
        format!("{} r{}", self.mcp_status_label, self.mcp_refresh_count)
    }

    pub fn should_quit(&self) -> bool {
        self.should_quit
    }

    pub fn scroll(&self) -> u16 {
        self.scroll
    }

    pub fn viewport_size(&self) -> (u16, u16) {
        (self.viewport_width, self.viewport_height)
    }

    pub fn on_resize(&mut self, width: u16, height: u16) {
        self.viewport_width = width;
        self.viewport_height = height;
    }

    pub fn on_tick(&mut self) {
        if self.status != UiStatus::Processing {
            return;
        }

        let Some(stream) = self.stream_state.as_mut() else {
            return;
        };

        if stream.last_emit_at.elapsed() < Duration::from_millis(STREAM_CHUNK_INTERVAL_MS) {
            return;
        }
        stream.last_emit_at = Instant::now();

        if let Some(chunk) = stream.chunks.get(stream.next_chunk) {
            self.messages[stream.target_message_index].push_str(chunk);
            stream.next_chunk += 1;
        }

        if stream.next_chunk >= stream.chunks.len() {
            self.status = UiStatus::Idle;
            self.stream_state = None;
        }
    }

    pub fn apply_mcp_refresh(&mut self, diagnostics: McpDiagnostics) {
        self.mcp_refresh_count = self.mcp_refresh_count.saturating_add(1);
        self.mcp_status_label = diagnostics.status_label.clone();
        let summary = diagnostics.messages.first().cloned().unwrap_or_else(|| {
            format!(
                "MCP diagnostics update ({}): no summary details provided",
                diagnostics.status_label
            )
        });
        let signature = format!("{}|{}", diagnostics.status_label, summary);
        self.last_mcp_summary_raw = Some(summary.clone());
        if self.last_mcp_refresh_signature.as_deref() == Some(signature.as_str()) {
            return;
        }
        let message = format!(
            "system: MCP refresh {}: {}",
            self.mcp_refresh_count, summary
        );
        let compact_width = if self.viewport_width == 0 {
            DEFAULT_MESSAGE_COMPACT_WIDTH
        } else {
            self.viewport_width
        };
        self.messages
            .push(compact_message_for_width(&message, compact_width));
        self.last_mcp_refresh_signature = Some(signature);
    }

    pub fn on_key(&mut self, key: KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }

        match key.code {
            KeyCode::Char('q') => self.should_quit = true,
            KeyCode::Char('v') => {
                let details = self
                    .last_mcp_summary_raw
                    .as_deref()
                    .unwrap_or("MCP details unavailable");
                self.messages
                    .push(format!("system: MCP details: {}", details));
            }
            KeyCode::Char(c) => {
                if self.input.len() < INPUT_MAX_LEN {
                    self.input.push(c);
                }
            }
            KeyCode::Backspace => {
                self.input.pop();
            }
            KeyCode::Enter => {
                if self.input.trim().is_empty() || self.status == UiStatus::Processing {
                    return;
                }

                let prompt = self.input.trim().to_string();
                self.messages.push(format!("user: {}", prompt));
                self.input.clear();
                self.status = UiStatus::Processing;
                let assistant_reply = format!("received -> {}", prompt);
                let chunks = chunk_text(&assistant_reply);
                self.messages.push("assistant: ".to_string());
                self.stream_state = Some(StreamState {
                    target_message_index: self.messages.len() - 1,
                    chunks,
                    next_chunk: 0,
                    last_emit_at: Instant::now() - Duration::from_millis(STREAM_CHUNK_INTERVAL_MS),
                });
            }
            KeyCode::Up => {
                self.scroll = self.scroll.saturating_add(1);
            }
            KeyCode::Down => {
                self.scroll = self.scroll.saturating_sub(1);
            }
            _ => {}
        }
    }
}

fn chunk_text(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(STREAM_CHARS_PER_CHUNK)
        .map(|segment| segment.iter().collect::<String>())
        .collect()
}

fn compact_message_for_width(message: &str, viewport_width: u16) -> String {
    let width = usize::from(viewport_width);
    let budget = width.saturating_sub(8).max(MIN_MESSAGE_CONTENT_BUDGET);
    let chars: Vec<char> = message.chars().collect();
    if chars.len() <= budget {
        return message.to_string();
    }

    if budget <= 12 {
        let keep = budget.saturating_sub(3);
        let prefix = chars.iter().take(keep).collect::<String>();
        return format!("{prefix}...");
    }

    let keep = budget.saturating_sub(13);
    let omitted = chars.len().saturating_sub(keep);
    let prefix = chars.iter().take(keep).collect::<String>();
    format!("{prefix}... (+{omitted} chars)")
}

pub fn run_app(mode: RuntimeMode) -> anyhow::Result<()> {
    run_app_with_mcp_diagnostics(mode, None, None, None)
}

pub fn run_app_with_mcp_diagnostics(
    mode: RuntimeMode,
    mcp_diagnostics: Option<McpDiagnostics>,
    mcp_config_path: Option<PathBuf>,
    mcp_refresh_interval_ms: Option<u64>,
) -> anyhow::Result<()> {
    let mut stdout = io::stdout();
    enable_raw_mode()?;
    execute!(stdout, EnterAlternateScreen)?;
    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = ratatui::Terminal::new(backend)?;
    if let Some((width, height)) = terminal_size_from_env() {
        terminal.resize(ratatui::layout::Rect::new(0, 0, width, height))?;
    }
    let mut app = App::new_with_mcp_diagnostics(mode, mcp_diagnostics);
    let size = terminal.size()?;
    app.on_resize(size.width, size.height);
    let scripted_actions = scripted_actions_from_env();
    let mcp_refresh_interval =
        Duration::from_millis(mcp_refresh_interval_ms.unwrap_or(DEFAULT_MCP_REFRESH_INTERVAL_MS));
    let result = run_loop(
        &mut terminal,
        &mut app,
        scripted_actions,
        mcp_config_path,
        mcp_refresh_interval,
    );
    disable_raw_mode()?;
    std::io::stdout().execute(LeaveAlternateScreen)?;
    result
}

fn run_loop<B: ratatui::backend::Backend>(
    terminal: &mut ratatui::Terminal<B>,
    app: &mut App,
    mut scripted_actions: VecDeque<ScriptAction>,
    mcp_config_path: Option<PathBuf>,
    mcp_refresh_interval: Duration,
) -> anyhow::Result<()> {
    let mut last_mcp_refresh_at = Instant::now() - mcp_refresh_interval;
    while !app.should_quit() {
        terminal.draw(|frame| draw(frame, app))?;

        if let Some(action) = scripted_actions.pop_front() {
            match action {
                ScriptAction::Key(key) => app.on_key(key),
                ScriptAction::Sleep(duration) => std::thread::sleep(duration),
                ScriptAction::Resize { width, height } => {
                    terminal.resize(ratatui::layout::Rect::new(0, 0, width, height))?;
                    app.on_resize(width, height);
                }
            }
        } else if event::poll(Duration::from_millis(16))? {
            match event::read()? {
                Event::Key(key) => app.on_key(key),
                Event::Resize(width, height) => app.on_resize(width, height),
                _ => {}
            }
        }

        if let Some(config_path) = &mcp_config_path {
            if last_mcp_refresh_at.elapsed() >= mcp_refresh_interval {
                app.apply_mcp_refresh(refresh_mcp_diagnostics(config_path));
                last_mcp_refresh_at = Instant::now();
            }
        }
        app.on_tick();
    }

    Ok(())
}

fn refresh_mcp_diagnostics(config_path: &PathBuf) -> McpDiagnostics {
    match McpConfig::load_from_path(config_path) {
        Ok(config) => match run_lifecycle_check(&config) {
            Ok(report) => {
                let running = report
                    .health
                    .iter()
                    .filter(|(_, state)| matches!(state, McpServerHealth::Running))
                    .count();
                let total = report.health.len();
                if report
                    .health
                    .iter()
                    .any(|(_, state)| matches!(state, McpServerHealth::Exited(_)))
                {
                    McpDiagnostics {
                        status_label: format!("degraded {running}/{total}"),
                        messages: vec![format!(
                            "MCP diagnostics degraded ({running}/{total} running)"
                        )],
                    }
                } else {
                    McpDiagnostics {
                        status_label: format!("ok {running}/{total}"),
                        messages: vec![format!(
                            "MCP diagnostics healthy ({running}/{total} running)"
                        )],
                    }
                }
            }
            Err(err) => McpDiagnostics {
                status_label: "error".to_string(),
                messages: vec![format!("MCP diagnostics failed: {}", err)],
            },
        },
        Err(err) => McpDiagnostics {
            status_label: "invalid-config".to_string(),
            messages: vec![format!(
                "MCP config load failed ({}): {}",
                config_path.display(),
                err
            )],
        },
    }
}

fn scripted_actions_from_env() -> VecDeque<ScriptAction> {
    std::env::var("FASTCODE_TUI_SCRIPT")
        .ok()
        .map(|script| parse_scripted_actions(&script))
        .unwrap_or_default()
}

fn terminal_size_from_env() -> Option<(u16, u16)> {
    std::env::var("FASTCODE_TUI_SIZE")
        .ok()
        .and_then(|value| parse_size_token(value.trim()))
}

fn parse_scripted_actions(script: &str) -> VecDeque<ScriptAction> {
    script
        .split(',')
        .filter_map(|token| token_to_script_action(token.trim()))
        .collect()
}

fn token_to_script_action(token: &str) -> Option<ScriptAction> {
    let lowercase = token.to_ascii_lowercase();
    if let Some(size_token) = lowercase
        .strip_prefix("resize")
        .or_else(|| lowercase.strip_prefix("size"))
    {
        let (width, height) = parse_size_token(size_token)?;
        return Some(ScriptAction::Resize { width, height });
    }

    if let Some(ms) = lowercase
        .strip_prefix("sleep")
        .or_else(|| lowercase.strip_prefix("wait"))
    {
        let duration_ms = ms.parse::<u64>().ok()?;
        return Some(ScriptAction::Sleep(Duration::from_millis(duration_ms)));
    }

    let code = match token.to_ascii_lowercase().as_str() {
        "enter" => KeyCode::Enter,
        "up" => KeyCode::Up,
        "down" => KeyCode::Down,
        "backspace" => KeyCode::Backspace,
        "q" => KeyCode::Char('q'),
        _ => {
            let mut chars = token.chars();
            if let Some(c) = chars.next() {
                if chars.next().is_none() {
                    KeyCode::Char(c)
                } else {
                    return None;
                }
            } else {
                return None;
            }
        }
    };

    Some(ScriptAction::Key(KeyEvent::new(
        code,
        crossterm::event::KeyModifiers::NONE,
    )))
}

fn parse_size_token(token: &str) -> Option<(u16, u16)> {
    let mut parts = token
        .trim()
        .trim_start_matches('=')
        .split(['x', 'X'])
        .map(str::trim);
    let width = parts.next()?.parse::<u16>().ok()?;
    let height = parts.next()?.parse::<u16>().ok()?;
    if parts.next().is_some() || width == 0 || height == 0 {
        return None;
    }
    Some((width, height))
}

pub fn draw(frame: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(3),
        ])
        .split(frame.area());

    let status_text = format!(
        " fastcode | mode: {} | status: {} | mcp: {} | size: {}x{} | q quit | v mcp details ",
        app.mode(),
        match app.status() {
            UiStatus::Idle => "idle",
            UiStatus::Processing => "processing",
        },
        app.mcp_status_display(),
        app.viewport_width,
        app.viewport_height
    );
    let status_line = Paragraph::new(status_text)
        .style(
            Style::default()
                .fg(Color::Black)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .block(Block::default());
    frame.render_widget(status_line, chunks[0]);

    let body = app.messages().join("\n");
    let messages = Paragraph::new(body)
        .block(Block::default().borders(Borders::ALL).title("Messages"))
        .wrap(Wrap { trim: false })
        .scroll((app.scroll(), 0));
    frame.render_widget(messages, chunks[1]);

    let input = Paragraph::new(Line::from(app.input().to_string())).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Input (Enter submit)"),
    );
    frame.render_widget(input, chunks[2]);
}

#[cfg(test)]
mod tests {
    use super::{App, McpDiagnostics, UiStatus, chunk_text, compact_message_for_width, draw};
    use crate::modes::runtime_mode::RuntimeMode;
    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyEventState, KeyModifiers};
    use ratatui::{Terminal, backend::TestBackend};
    use std::time::{Duration, Instant};

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent {
            code,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        }
    }

    #[test]
    fn handles_input_submit_and_scroll_keys() {
        let mut app = App::new(RuntimeMode::Edit);
        app.on_resize(80, 24);
        app.on_key(key(KeyCode::Char('h')));
        app.on_key(key(KeyCode::Char('i')));
        assert_eq!(app.input(), "hi");

        app.on_key(key(KeyCode::Enter));
        assert_eq!(app.status(), &UiStatus::Processing);
        assert_eq!(app.input(), "");
        assert!(app.messages().iter().any(|m| m == "user: hi"));

        app.on_key(key(KeyCode::Up));
        assert_eq!(app.scroll(), 1);
        app.on_key(key(KeyCode::Down));
        assert_eq!(app.scroll(), 0);
    }

    #[test]
    fn processing_transitions_back_to_idle_and_appends_assistant_reply() {
        let mut app = App::new(RuntimeMode::Plan);
        app.on_resize(80, 24);
        app.on_key(key(KeyCode::Char('x')));
        app.on_key(key(KeyCode::Enter));
        assert_eq!(app.status(), &UiStatus::Processing);
        assert!(app.messages().iter().any(|m| m == "assistant: "));

        while app.status() == &UiStatus::Processing {
            app.stream_state
                .as_mut()
                .expect("stream state exists")
                .last_emit_at = Instant::now() - Duration::from_millis(100);
            app.on_tick();
        }

        assert_eq!(app.status(), &UiStatus::Idle);
        assert!(
            app.messages()
                .iter()
                .any(|m| m.starts_with("assistant: received -> x"))
        );
    }

    #[test]
    fn streaming_does_not_block_user_typing_during_processing() {
        let mut app = App::new(RuntimeMode::Edit);
        app.on_resize(80, 24);
        app.on_key(key(KeyCode::Char('h')));
        app.on_key(key(KeyCode::Char('i')));
        app.on_key(key(KeyCode::Enter));
        assert_eq!(app.status(), &UiStatus::Processing);

        app.on_key(key(KeyCode::Char('a')));
        app.on_key(key(KeyCode::Char('b')));
        assert_eq!(app.input(), "ab");
        assert_eq!(app.status(), &UiStatus::Processing);
    }

    #[test]
    fn draw_renders_status_messages_and_input_regions() {
        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut app = App::new(RuntimeMode::Auto);
        app.on_resize(80, 24);
        app.on_key(key(KeyCode::Char('z')));
        terminal.draw(|frame| draw(frame, &app)).expect("draw");

        let buffer = terminal.backend().buffer();
        let content = format!("{buffer:?}");
        assert!(content.contains("mode: auto"));
        assert!(content.contains("mcp: off"));
        assert!(content.contains("size: 80x24"));
        assert!(content.contains("Messages"));
        assert!(content.contains("Input (Enter submit)"));
        assert!(content.contains("welcome to fastcode"));
    }

    #[test]
    fn injects_mcp_diagnostics_into_status_and_messages() {
        let app = App::new_with_mcp_diagnostics(
            RuntimeMode::Edit,
            Some(McpDiagnostics {
                status_label: "ok 1/1".to_string(),
                messages: vec!["system: MCP diagnostics: all healthy".to_string()],
            }),
        );
        assert_eq!(app.mcp_status_label(), "ok 1/1");
        assert!(
            app.messages()
                .iter()
                .any(|message| message == "system: MCP diagnostics: all healthy")
        );
    }

    #[test]
    fn draw_supports_standard_terminal_sizes() {
        for (width, height) in [(80, 24), (120, 40)] {
            let backend = TestBackend::new(width, height);
            let mut terminal = Terminal::new(backend).expect("terminal");
            let mut app = App::new(RuntimeMode::Edit);
            app.on_resize(width, height);
            app.on_key(key(KeyCode::Char('o')));
            app.on_key(key(KeyCode::Char('k')));
            terminal.draw(|frame| draw(frame, &app)).expect("draw");

            let buffer = terminal.backend().buffer();
            let content = format!("{buffer:?}");
            assert!(content.contains("size:"));
            assert!(content.contains("Messages"));
            assert!(content.contains("Input (Enter submit)"));
            assert!(content.contains("ok"));
        }
    }

    #[test]
    fn resize_keeps_input_and_navigation_functional() {
        let mut app = App::new(RuntimeMode::Edit);
        app.on_resize(120, 40);
        app.on_key(key(KeyCode::Char('h')));
        app.on_key(key(KeyCode::Char('i')));
        app.on_resize(80, 24);
        app.on_key(key(KeyCode::Up));
        app.on_key(key(KeyCode::Down));
        app.on_key(key(KeyCode::Enter));

        assert_eq!(app.input(), "");
        assert!(app.messages().iter().any(|m| m == "user: hi"));
        assert_eq!(app.scroll(), 0);
        assert_eq!(app.viewport_size(), (80, 24));
    }

    #[test]
    fn parses_scripted_key_sequence_tokens() {
        let actions =
            super::parse_scripted_actions("h,i,Enter,sleep120,resize120x40,Up,Down,Backspace,q");
        assert_eq!(actions.len(), 9);
        assert!(matches!(
            actions[0],
            super::ScriptAction::Key(KeyEvent {
                code: KeyCode::Char('h'),
                ..
            })
        ));
        assert!(matches!(
            actions[2],
            super::ScriptAction::Key(KeyEvent {
                code: KeyCode::Enter,
                ..
            })
        ));
        assert!(matches!(
            actions[3],
            super::ScriptAction::Sleep(duration) if duration == Duration::from_millis(120)
        ));
        assert!(matches!(
            actions[4],
            super::ScriptAction::Resize {
                width: 120,
                height: 40
            }
        ));
        assert!(matches!(
            actions[5],
            super::ScriptAction::Key(KeyEvent {
                code: KeyCode::Up,
                ..
            })
        ));
    }

    #[test]
    fn parses_terminal_size_token() {
        assert_eq!(super::parse_size_token("80x24"), Some((80, 24)));
        assert_eq!(super::parse_size_token("=120x40"), Some((120, 40)));
        assert_eq!(super::parse_size_token("120X40"), Some((120, 40)));
        assert_eq!(super::parse_size_token("0x40"), None);
        assert_eq!(super::parse_size_token("abc"), None);
    }

    #[test]
    fn chunking_keeps_stream_order_stable() {
        let chunks = chunk_text("abcdefghi");
        assert_eq!(chunks, vec!["abcd", "efgh", "i"]);
    }

    #[test]
    fn mcp_refresh_updates_status_and_appends_summary_message() {
        let mut app = App::new(RuntimeMode::Edit);
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "ok 1/1".to_string(),
            messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
        });

        assert_eq!(app.mcp_status_label(), "ok 1/1");
        assert_eq!(app.mcp_status_display(), "ok 1/1 r1");
        assert!(
            app.messages()
                .iter()
                .any(|m| { m == "system: MCP refresh 1: MCP diagnostics healthy (1/1 running)" })
        );
    }

    #[test]
    fn compacts_long_mcp_refresh_message_for_narrow_viewport() {
        let mut app = App::new(RuntimeMode::Edit);
        app.on_resize(80, 24);
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec![format!("MCP diagnostics failed: {}", "x".repeat(160))],
        });

        let last = app.messages().last().expect("message exists");
        assert!(last.contains("... (+"));
        assert!(last.len() <= 90);
    }

    #[test]
    fn deduplicates_identical_consecutive_mcp_refresh_messages() {
        let mut app = App::new(RuntimeMode::Edit);
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec!["MCP diagnostics failed: test failure".to_string()],
        });
        let message_count_after_first = app.messages().len();
        assert_eq!(app.mcp_status_display(), "error r1");

        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec!["MCP diagnostics failed: test failure".to_string()],
        });

        assert_eq!(app.mcp_status_display(), "error r2");
        assert_eq!(app.messages().len(), message_count_after_first);
    }

    #[test]
    fn appends_new_refresh_message_when_summary_changes() {
        let mut app = App::new(RuntimeMode::Edit);
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec!["MCP diagnostics failed: same summary".to_string()],
        });
        let message_count_after_first = app.messages().len();

        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec!["MCP diagnostics failed: same summary".to_string()],
        });
        assert_eq!(app.messages().len(), message_count_after_first);

        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec!["MCP diagnostics failed: changed summary".to_string()],
        });

        assert_eq!(app.mcp_status_display(), "error r3");
        assert_eq!(app.messages().len(), message_count_after_first + 1);
        assert!(
            app.messages()
                .iter()
                .any(|m| { m == "system: MCP refresh 3: MCP diagnostics failed: changed summary" })
        );
    }

    #[test]
    fn appends_fallback_refresh_message_when_summary_is_missing() {
        let mut app = App::new(RuntimeMode::Edit);
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "degraded 0/1".to_string(),
            messages: vec![],
        });

        assert_eq!(app.mcp_status_display(), "degraded 0/1 r1");
        let last = app.messages().last().expect("fallback message exists");
        assert!(last.contains("MCP refresh 1: MCP diagnostics update"));
        assert!(last.contains("degraded 0/1"));
    }

    #[test]
    fn key_v_appends_full_untruncated_mcp_details() {
        let mut app = App::new(RuntimeMode::Edit);
        app.on_resize(80, 24);
        let long_summary = format!("MCP diagnostics failed: {}", "x".repeat(160));
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec![long_summary.clone()],
        });
        let compacted = app.messages().last().expect("compacted refresh message");
        assert!(compacted.contains("... (+"));

        app.on_key(key(KeyCode::Char('v')));
        let details = app.messages().last().expect("details message");
        assert_eq!(details, &format!("system: MCP details: {}", long_summary));
    }

    #[test]
    fn key_v_reports_missing_details_before_any_mcp_diagnostics() {
        let mut app = App::new(RuntimeMode::Edit);
        app.on_key(key(KeyCode::Char('v')));
        let details = app.messages().last().expect("details message");
        assert_eq!(details, "system: MCP details: MCP details unavailable");
    }

    #[test]
    fn compact_message_keeps_short_text_intact() {
        let message = "system: MCP diagnostics healthy";
        assert_eq!(
            compact_message_for_width(message, 80),
            "system: MCP diagnostics healthy"
        );
    }
}
