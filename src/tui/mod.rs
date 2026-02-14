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
use std::io;
use std::time::{Duration, Instant};

const INPUT_MAX_LEN: usize = 512;
const LOADING_DURATION_MS: u64 = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UiStatus {
    Idle,
    Processing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct App {
    mode: RuntimeMode,
    input: String,
    messages: Vec<String>,
    status: UiStatus,
    should_quit: bool,
    scroll: u16,
    processing_started_at: Option<Instant>,
}

impl App {
    pub fn new(mode: RuntimeMode) -> Self {
        Self {
            mode,
            input: String::new(),
            messages: vec!["system: welcome to fastcode".to_string()],
            status: UiStatus::Idle,
            should_quit: false,
            scroll: 0,
            processing_started_at: None,
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

    pub fn should_quit(&self) -> bool {
        self.should_quit
    }

    pub fn scroll(&self) -> u16 {
        self.scroll
    }

    pub fn on_tick(&mut self) {
        if self.status == UiStatus::Processing
            && self
                .processing_started_at
                .is_some_and(|t| t.elapsed() >= Duration::from_millis(LOADING_DURATION_MS))
        {
            let prompt = self.messages.last().cloned().unwrap_or_default();
            self.messages
                .push(format!("assistant: received -> {}", prompt.trim()));
            self.status = UiStatus::Idle;
            self.processing_started_at = None;
        }
    }

    pub fn on_key(&mut self, key: KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }

        match key.code {
            KeyCode::Char('q') => self.should_quit = true,
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

                let line = format!("user: {}", self.input.trim());
                self.messages.push(line);
                self.input.clear();
                self.status = UiStatus::Processing;
                self.processing_started_at = Some(Instant::now());
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

pub fn run_app(mode: RuntimeMode) -> anyhow::Result<()> {
    let mut stdout = io::stdout();
    enable_raw_mode()?;
    execute!(stdout, EnterAlternateScreen)?;
    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = ratatui::Terminal::new(backend)?;
    let mut app = App::new(mode);
    let scripted_keys = scripted_keys_from_env();
    let result = run_loop(&mut terminal, &mut app, scripted_keys);
    disable_raw_mode()?;
    std::io::stdout().execute(LeaveAlternateScreen)?;
    result
}

fn run_loop<B: ratatui::backend::Backend>(
    terminal: &mut ratatui::Terminal<B>,
    app: &mut App,
    mut scripted_keys: Vec<KeyEvent>,
) -> anyhow::Result<()> {
    while !app.should_quit() {
        terminal.draw(|frame| draw(frame, app))?;

        if !scripted_keys.is_empty() {
            let key = scripted_keys.remove(0);
            app.on_key(key);
        } else if event::poll(Duration::from_millis(16))? {
            if let Event::Key(key) = event::read()? {
                app.on_key(key);
            }
        }
        app.on_tick();
    }

    Ok(())
}

fn scripted_keys_from_env() -> Vec<KeyEvent> {
    std::env::var("FASTCODE_TUI_SCRIPT")
        .ok()
        .map(|script| parse_scripted_keys(&script))
        .unwrap_or_default()
}

fn parse_scripted_keys(script: &str) -> Vec<KeyEvent> {
    script
        .split(',')
        .filter_map(|token| token_to_key_event(token.trim()))
        .collect()
}

fn token_to_key_event(token: &str) -> Option<KeyEvent> {
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

    Some(KeyEvent::new(code, crossterm::event::KeyModifiers::NONE))
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
        " fastcode | mode: {} | status: {} | q quit ",
        app.mode(),
        match app.status() {
            UiStatus::Idle => "idle",
            UiStatus::Processing => "processing",
        }
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
    use super::{App, UiStatus, draw};
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
        app.on_key(key(KeyCode::Char('x')));
        app.on_key(key(KeyCode::Enter));
        assert_eq!(app.status(), &UiStatus::Processing);
        app.processing_started_at = Some(Instant::now() - Duration::from_millis(400));
        app.on_tick();

        assert_eq!(app.status(), &UiStatus::Idle);
        assert!(
            app.messages()
                .iter()
                .any(|m| m.starts_with("assistant: received -> user: x"))
        );
    }

    #[test]
    fn draw_renders_status_messages_and_input_regions() {
        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut app = App::new(RuntimeMode::Auto);
        app.on_key(key(KeyCode::Char('z')));
        terminal.draw(|frame| draw(frame, &app)).expect("draw");

        let buffer = terminal.backend().buffer();
        let content = format!("{buffer:?}");
        assert!(content.contains("mode: auto"));
        assert!(content.contains("Messages"));
        assert!(content.contains("Input (Enter submit)"));
        assert!(content.contains("welcome to fastcode"));
    }

    #[test]
    fn parses_scripted_key_sequence_tokens() {
        let keys = super::parse_scripted_keys("h,i,Enter,Up,Down,Backspace,q");
        assert_eq!(keys.len(), 7);
        assert_eq!(keys[0].code, KeyCode::Char('h'));
        assert_eq!(keys[2].code, KeyCode::Enter);
        assert_eq!(keys[3].code, KeyCode::Up);
        assert_eq!(keys[4].code, KeyCode::Down);
        assert_eq!(keys[5].code, KeyCode::Backspace);
        assert_eq!(keys[6].code, KeyCode::Char('q'));
    }
}
