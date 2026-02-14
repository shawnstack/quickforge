use crate::mcp::config::McpConfig;
use crate::mcp::lifecycle::{McpServerHealth, run_lifecycle_check};
use crate::modes::runtime_mode::RuntimeMode;
use crate::tools::builtin::register_builtin_tools;
use crate::tools::registry::{ToolContext, ToolRegistry, ToolResultEnvelope, ToolStatus};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use crossterm::{ExecutableCommand, execute};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::io;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

const INPUT_MAX_LEN: usize = 512;
const STREAM_CHUNK_INTERVAL_MS: u64 = 60;
const STREAM_CHARS_PER_CHUNK: usize = 4;
pub const DEFAULT_MCP_REFRESH_INTERVAL_MS: u64 = 800;
const DEFAULT_MESSAGE_COMPACT_WIDTH: u16 = 80;
const MIN_MESSAGE_CONTENT_BUDGET: usize = 24;
const MAX_TOOL_CALL_ROUNDS: usize = 3;
const THINK_SPINNER_INTERVAL_MS: u64 = 120;
const THINK_FRAMES: [&str; 4] = ["thinking", "thinking.", "thinking..", "thinking..."];
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const CONTENT_LEFT_PAD: &str = "  ";
const MODEL_CONNECT_TIMEOUT_SECS: u64 = 8;
const MODEL_REQUEST_TIMEOUT_SECS: u64 = 90;
const STATUS_LABEL_WIDTH: usize = 11;
const STATUS_SECS_WIDTH: usize = 4;

const COLOR_TEXT_PRIMARY: Color = Color::White;
const COLOR_TEXT_USER: Color = Color::Cyan;
const COLOR_TEXT_MUTED: Color = Color::DarkGray;
const COLOR_ACCENT: Color = Color::Cyan;
const COLOR_SUCCESS: Color = Color::Green;
const COLOR_ERROR: Color = Color::Red;
const COLOR_TOOL_BODY: Color = Color::Gray;
const COLOR_CODE: Color = Color::LightCyan;
const COLOR_BANNER_BORDER: Color = Color::DarkGray;
const COLOR_INPUT_ACTIVE: Color = Color::White;
const COLOR_INPUT_DISABLED: Color = Color::Gray;

#[derive(Debug, Deserialize)]
struct LlmConfig {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    model: String,
}

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
enum WorkerEvent {
    ToolResult { line: String },
    Done(String),
}

#[derive(Debug)]
struct PendingReplyState {
    receiver: Receiver<WorkerEvent>,
    started_at: Instant,
    last_spinner_at: Instant,
    spinner_frame: usize,
}

#[derive(Debug)]
pub struct App {
    mode: RuntimeMode,
    input: String,
    messages: Vec<String>,
    display_model: String,
    working_dir_display: String,
    mcp_status_label: String,
    status: UiStatus,
    should_quit: bool,
    scroll: u16,
    viewport_width: u16,
    viewport_height: u16,
    mcp_refresh_count: u64,
    mcp_refresh_dedup_count: u64,
    last_mcp_refresh_signature: Option<String>,
    last_mcp_summary_raw: Option<String>,
    pending_reply: Option<PendingReplyState>,
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
        let display_model = load_llm_config()
            .map(|cfg| cfg.model)
            .unwrap_or_else(|_| "unknown".to_string());
        let working_dir_display = std::env::current_dir()
            .ok()
            .map(|dir| dir.display().to_string())
            .unwrap_or_else(|| "~".to_string());
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
            display_model,
            working_dir_display,
            mcp_status_label,
            status: UiStatus::Idle,
            should_quit: false,
            scroll: 0,
            viewport_width: 0,
            viewport_height: 0,
            mcp_refresh_count: 0,
            mcp_refresh_dedup_count: 0,
            last_mcp_refresh_signature,
            last_mcp_summary_raw,
            pending_reply: None,
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
        format!(
            "{} r{} d{}",
            self.mcp_status_label, self.mcp_refresh_count, self.mcp_refresh_dedup_count
        )
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

        let mut queued_events = Vec::new();
        let mut worker_disconnected = false;
        if let Some(pending) = self.pending_reply.as_mut() {
            if pending.last_spinner_at.elapsed() >= Duration::from_millis(THINK_SPINNER_INTERVAL_MS)
            {
                pending.last_spinner_at = Instant::now();
                pending.spinner_frame = (pending.spinner_frame + 1) % THINK_FRAMES.len();
            }

            loop {
            match pending.receiver.try_recv() {
                Ok(event) => queued_events.push(event),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        worker_disconnected = true;
                        break;
                    }
                }
            }
        }
        for event in queued_events {
            match event {
                WorkerEvent::ToolResult { line } => {
                    self.messages.push(format!("tool: {}", line));
                    self.scroll = 0;
                }
                WorkerEvent::Done(reply) => {
                    self.messages.push("assistant: ".to_string());
                    self.scroll = 0;
                    let target = self.messages.len() - 1;
                    let formatted_reply = format_assistant_markdown(&reply);
                    let chunks = chunk_text(&formatted_reply);
                    self.stream_state = Some(StreamState {
                        target_message_index: target,
                        chunks,
                        next_chunk: 0,
                        last_emit_at: Instant::now()
                            - Duration::from_millis(STREAM_CHUNK_INTERVAL_MS),
                    });
                    self.pending_reply = None;
                }
            }
        }
        if worker_disconnected && self.pending_reply.is_some() {
            self.messages
                .push("assistant: model worker disconnected unexpectedly".to_string());
            self.scroll = 0;
            self.pending_reply = None;
            self.status = UiStatus::Idle;
        }

        if let Some(stream) = self.stream_state.as_mut() {
            if stream.last_emit_at.elapsed() < Duration::from_millis(STREAM_CHUNK_INTERVAL_MS) {
                return;
            }
            stream.last_emit_at = Instant::now();

            if let Some(chunk) = stream.chunks.get(stream.next_chunk) {
                self.messages[stream.target_message_index].push_str(chunk);
                self.scroll = 0;
                stream.next_chunk += 1;
            }

            if stream.next_chunk >= stream.chunks.len() {
                self.status = UiStatus::Idle;
                self.stream_state = None;
            }
        }
    }

    pub fn apply_mcp_refresh(&mut self, diagnostics: McpDiagnostics) {
        self.mcp_refresh_count = self.mcp_refresh_count.saturating_add(1);
        let status_changed = self.mcp_status_label != diagnostics.status_label;
        self.mcp_status_label = diagnostics.status_label.clone();
        if status_changed {
            self.mcp_refresh_dedup_count = 0;
        }
        let summary = diagnostics.messages.first().cloned().unwrap_or_else(|| {
            format!(
                "MCP diagnostics update ({}): no summary details provided",
                diagnostics.status_label
            )
        });
        let signature = format!("{}|{}", diagnostics.status_label, summary);
        self.last_mcp_summary_raw = Some(summary.clone());
        if self.last_mcp_refresh_signature.as_deref() == Some(signature.as_str()) {
            self.mcp_refresh_dedup_count = self.mcp_refresh_dedup_count.saturating_add(1);
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
        self.scroll = 0;
        self.last_mcp_refresh_signature = Some(signature);
    }

    pub fn on_key(&mut self, key: KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }

        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.should_quit = true;
            return;
        }

        match key.code {
            KeyCode::BackTab => {
                self.mode = next_mode(self.mode);
            }
            KeyCode::Esc => self.should_quit = true,
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
                self.scroll = 0;
                self.input.clear();
                self.status = UiStatus::Processing;
                let (tx, rx) = mpsc::channel::<WorkerEvent>();
                thread::spawn(move || {
                    let reply = generate_assistant_reply(&prompt, Some(&tx))
                        .unwrap_or_else(|err| fallback_assistant_reply(&prompt, Some(err.as_str())));
                    let _ = tx.send(WorkerEvent::Done(reply));
                });
                self.pending_reply = Some(PendingReplyState {
                    receiver: rx,
                    started_at: Instant::now(),
                    last_spinner_at: Instant::now(),
                    spinner_frame: 0,
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

fn next_mode(mode: RuntimeMode) -> RuntimeMode {
    match mode {
        RuntimeMode::Plan => RuntimeMode::Edit,
        RuntimeMode::Edit => RuntimeMode::Auto,
        RuntimeMode::Auto => RuntimeMode::Plan,
    }
}

fn chunk_text(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(STREAM_CHARS_PER_CHUNK)
        .map(|segment| segment.iter().collect::<String>())
        .collect()
}

fn generate_assistant_reply(
    prompt: &str,
    event_tx: Option<&Sender<WorkerEvent>>,
) -> Result<String, String> {
    let config = load_llm_config().map_err(|err| format!("config load failed: {}", err))?;
    let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let tool_specs = build_tool_specs();
    let mut messages = vec![
        json!({
            "role": "system",
            "content": "You are FastCode coding assistant. Use tools when needed. Return only final answer without showing reasoning."
        }),
        json!({
            "role": "user",
            "content": prompt
        }),
    ];
    let mut tool_transcript = Vec::new();

    for _ in 0..MAX_TOOL_CALL_ROUNDS {
        let response = request_chat_completion(&config, &endpoint, &messages, &tool_specs)?;
        let (content, tool_calls) = extract_assistant_content_and_tools(&response)?;

        if !tool_calls.is_empty() {
            messages.push(json!({
                "role": "assistant",
                "content": if content.is_empty() { Value::Null } else { Value::String(content.clone()) },
                "tool_calls": tool_calls
            }));
            let tool_results = execute_tool_calls(
                messages.as_slice(),
                &tool_calls,
                &mut tool_transcript,
                event_tx,
            )?;
            messages.extend(tool_results);
            continue;
        }

        if !content.is_empty() {
            return Ok(content);
        }

        if !tool_transcript.is_empty() {
            return Ok("Tool calls completed, but model returned no visible text.".to_string());
        }

        return Err("model response is empty".to_string());
    }

    Err("tool call rounds exceeded limit".to_string())
}

fn request_chat_completion(
    config: &LlmConfig,
    endpoint: &str,
    messages: &[Value],
    tool_specs: &[Value],
) -> Result<Value, String> {
    let payload = json!({
        "model": config.model,
        "messages": messages,
        "stream": false,
        "tools": tool_specs,
        "tool_choice": "auto"
    });
    let client = model_http_client()?;
    let response = client
        .post(endpoint)
        .bearer_auth(config.api_key.as_str())
        .json(&payload)
        .send()
        .map_err(|err| format!("model request failed: {}", err))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|err| format!("model response read failed: {}", err))?;
    if !status.is_success() {
        if let Ok(value) = serde_json::from_str::<Value>(&body) {
            if let Some(error) = value.get("error") {
                return Err(format!(
                    "model request failed with status {}: {}",
                    status,
                    compact_json_for_error(error)
                ));
            }
        }
        let detail = body.trim();
        let short_detail: String = detail.chars().take(320).collect();
        return Err(format!(
            "model request failed with status {}: {}",
            status, short_detail
        ));
    }

    serde_json::from_str::<Value>(&body).map_err(|err| format!("model response decode failed: {}", err))
}

fn model_http_client() -> Result<&'static reqwest::blocking::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::blocking::Client, String>> = OnceLock::new();
    let result = CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(MODEL_CONNECT_TIMEOUT_SECS))
            .timeout(Duration::from_secs(MODEL_REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|err| format!("http client init failed: {}", err))
    });
    match result {
        Ok(client) => Ok(client),
        Err(err) => Err(err.clone()),
    }
}

fn extract_assistant_content_and_tools(response: &Value) -> Result<(String, Vec<Value>), String> {
    if let Some(error_obj) = response.get("error") {
        if let Some(message) = error_obj.get("message").and_then(Value::as_str) {
            let code = error_obj.get("code").and_then(Value::as_str).unwrap_or("");
            let suffix = if code.is_empty() {
                String::new()
            } else {
                format!(" (code: {})", code)
            };
            return Err(format!("model API error: {}{}", message.trim(), suffix));
        }
        return Err(format!(
            "model API returned error object: {}",
            compact_json_for_error(error_obj)
        ));
    }

    if let Some(choices) = response.get("choices").and_then(Value::as_array) {
        if let Some(choice) = choices.first() {
            if let Some(message) = choice.get("message") {
                let content = extract_text_content(message.get("content"));
                let tool_calls = message
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                return Ok((content, tool_calls));
            }

            if let Some(text) = choice.get("text").and_then(Value::as_str) {
                return Ok((text.trim().to_string(), Vec::new()));
            }
        }
    }

    if let Some(output_text) = response.get("output_text").and_then(Value::as_str) {
        return Ok((output_text.trim().to_string(), Vec::new()));
    }

    Err(format!(
        "model response shape unsupported: {}",
        compact_json_for_error(response)
    ))
}

fn extract_text_content(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };

    if let Some(text) = content.as_str() {
        return text.trim().to_string();
    }

    if let Some(parts) = content.as_array() {
        let mut merged = String::new();
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !merged.is_empty() && !merged.ends_with('\n') {
                    merged.push('\n');
                }
                merged.push_str(text.trim());
            }
        }
        return merged.trim().to_string();
    }

    String::new()
}

fn compact_json_for_error(value: &Value) -> String {
    let raw = value.to_string();
    let limit = 320usize;
    let mut compact = raw.chars().take(limit).collect::<String>();
    if raw.chars().count() > limit {
        compact.push_str("...");
    }
    compact
}

fn compact_inline_text(text: &str, max_chars: usize) -> String {
    let normalized = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" / ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut short = normalized.chars().take(max_chars).collect::<String>();
    short.push_str("...");
    short
}

fn summarize_tool_event(name: &str, args: &Value, result: &ToolResultEnvelope) -> String {
    let args_preview = compact_inline_text(&args.to_string(), 120);
    let status = match result.status {
        ToolStatus::Success => "Success",
        ToolStatus::Error => "Failed",
    };
    let detail = match result.status {
        ToolStatus::Success => result.output.as_deref().unwrap_or(""),
        ToolStatus::Error => result.error_message.as_deref().unwrap_or(""),
    };
    let detail_lines = detail
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let first_detail = detail_lines
        .first()
        .map(|line| compact_inline_text(line, 140))
        .unwrap_or_else(|| "no output".to_string());
    let more_suffix = if detail_lines.len() > 1 {
        format!("  (+{} lines)", detail_lines.len() - 1)
    } else {
        String::new()
    };

    format!(
        "[Tool] {}  [{}]\n  command: {}  ->  {}{}",
        name, status, args_preview, first_detail, more_suffix
    )
}

fn build_tool_specs() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "shell",
                "description": "Run a shell command in project directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" }
                    },
                    "required": ["command"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "file",
                "description": "Read a text file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "git",
                "description": "Run git with argument array.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "args": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["args"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files recursively from a path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "max_entries": { "type": "integer" },
                        "include_hidden": { "type": "boolean" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "search_text",
                "description": "Search text in files recursively.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "path": { "type": "string" },
                        "max_results": { "type": "integer" },
                        "include_hidden": { "type": "boolean" }
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "run_tests",
                "description": "Run project tests; optional command override.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "lint",
                "description": "Run lint/typecheck; optional command override.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "apply_patch",
                "description": "Apply unified patch text to repository.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "patch": { "type": "string" }
                    },
                    "required": ["patch"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "symbol_lookup",
                "description": "Find symbols by textual match.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbol": { "type": "string" },
                        "path": { "type": "string" },
                        "max_results": { "type": "integer" }
                    },
                    "required": ["symbol"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "git_status_diff",
                "description": "Get git status and diff summary.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "git_commit",
                "description": "Stage and commit changes.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": { "type": "string" },
                        "add_all": { "type": "boolean" }
                    },
                    "required": ["message"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "fetch_url",
                "description": "Fetch web content from URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string" },
                        "max_chars": { "type": "integer" }
                    },
                    "required": ["url"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search web with query text.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" }
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "ask_approval",
                "description": "Persist approval prefix for future shell commands.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prefix": { "type": "string" },
                        "approval_type": { "type": "string" },
                        "session_id": { "type": "string" }
                    },
                    "required": ["prefix"]
                }
            }
        }),
    ]
}

fn execute_tool_calls(
    _messages: &[Value],
    tool_calls: &[Value],
    tool_transcript: &mut Vec<String>,
    event_tx: Option<&Sender<WorkerEvent>>,
) -> Result<Vec<Value>, String> {
    let mut registry = ToolRegistry::new();
    register_builtin_tools(&mut registry).map_err(|err| format!("register tools failed: {}", err))?;
    let cwd = std::env::current_dir().map_err(|err| format!("resolve cwd failed: {}", err))?;
    let ctx = ToolContext::new(cwd);
    let mut outputs = Vec::new();

    for tool_call in tool_calls {
        let tool_call_id = tool_call
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "tool call missing id".to_string())?;
        let function = tool_call
            .get("function")
            .ok_or_else(|| "tool call missing function".to_string())?;
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "tool call missing function.name".to_string())?;
        let args_raw = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        let args = serde_json::from_str::<Value>(args_raw).unwrap_or_else(|_| json!({}));
        let result = registry.execute(name, &args, &ctx);
        if let Some(tx) = event_tx {
            let line = summarize_tool_event(name, &args, &result);
            let _ = tx.send(WorkerEvent::ToolResult {
                line,
            });
        }
        let rendered = serde_json::to_string(&result)
            .map_err(|err| format!("serialize tool result failed: {}", err))?;
        tool_transcript.push(format!("{}({}) -> {}", name, args, rendered));
        outputs.push(json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": rendered
        }));
    }

    Ok(outputs)
}

fn load_llm_config() -> anyhow::Result<LlmConfig> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home directory is unavailable"))?;
    let config_path = home.join(".happycode").join("config.json");
    let text = std::fs::read_to_string(&config_path)?;
    let config: LlmConfig = serde_json::from_str(&text)?;
    if config.base_url.trim().is_empty()
        || config.api_key.trim().is_empty()
        || config.model.trim().is_empty()
    {
        anyhow::bail!(
            "config must include baseUrl/apiKey/model: {}",
            config_path.display()
        );
    }
    Ok(config)
}

fn fallback_assistant_reply(prompt: &str, error: Option<&str>) -> String {
    let normalized = prompt.to_ascii_lowercase();
    let has_error_keyword = prompt.contains("\u{62a5}\u{9519}")
        || prompt.contains("\u{9519}\u{8bef}")
        || normalized.contains("error")
        || normalized.contains("exception");
    if has_error_keyword {
        return "\u{628a}\u{5b8c}\u{6574}\u{62a5}\u{9519}\u{5806}\u{6808}\u{548c}\u{89e6}\u{53d1}\u{547d}\u{4ee4}\u{8d34}\u{51fa}\u{6765}\u{ff0c}\u{6211}\u{4f1a}\u{7ed9}\u{4f60}\u{7cbe}\u{786e}\u{5b9a}\u{4f4d}\u{548c}\u{4fee}\u{590d}\u{6b65}\u{9aa4}\u{3002}".to_string();
    }

    match error {
        Some(err) => format!(
            "model request failed ({}). describe your goal and I can still guide step-by-step.",
            err
        ),
        None => "\u{6536}\u{5230}\u{ff0c}\u{6b63}\u{5728}\u{5904}\u{7406}\u{3002}".to_string(),
    }
}

fn format_assistant_markdown(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut output = Vec::new();
    let mut in_code_block = false;
    let mut consecutive_blank = 0usize;

    for raw_line in normalized.lines() {
        let mut line = raw_line.trim_end().to_string();
        if line.starts_with("```") {
            in_code_block = !in_code_block;
        }
        if !in_code_block && line.starts_with("* ") {
            line = format!("- {}", &line[2..]);
        }

        if line.is_empty() {
            consecutive_blank += 1;
            if consecutive_blank > 1 {
                continue;
            }
        } else {
            consecutive_blank = 0;
        }
        output.push(line);
    }

    output.join("\n")
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
    let mcp_config_for_refresh = mcp_config_path.clone();
    let result = run_loop(
        &mut terminal,
        &mut app,
        scripted_actions,
        mcp_refresh_interval,
        move || mcp_config_for_refresh.as_ref().map(refresh_mcp_diagnostics),
    );
    disable_raw_mode()?;
    std::io::stdout().execute(LeaveAlternateScreen)?;
    result
}

fn run_loop<B: ratatui::backend::Backend>(
    terminal: &mut ratatui::Terminal<B>,
    app: &mut App,
    mut scripted_actions: VecDeque<ScriptAction>,
    mcp_refresh_interval: Duration,
    mut refresh_diagnostics: impl FnMut() -> Option<McpDiagnostics>,
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

        if last_mcp_refresh_at.elapsed() >= mcp_refresh_interval {
            if let Some(diagnostics) = refresh_diagnostics() {
                app.apply_mcp_refresh(diagnostics);
            }
            last_mcp_refresh_at = Instant::now();
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
        "backtab" => KeyCode::BackTab,
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
        .constraints([Constraint::Min(1), Constraint::Length(2)])
        .split(frame.area());

    let messages_area = inset_left(chunks[0], CONTENT_LEFT_PAD.chars().count() as u16);
    let input_area = chunks[1];

    let mut body_lines: Vec<Line> = Vec::new();
    let banner_lines = [
        "fastcode".to_string(),
        format!("model: {}", app.display_model),
        format!("mode:  {}", app.mode().as_str()),
        format!(
            "dir:   {}",
            compact_message_for_width(&app.working_dir_display, app.viewport_width)
        ),
        format!("version: {}", APP_VERSION),
    ];
    let inner_width = banner_lines
        .iter()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0)
        + 2;
    body_lines.push(Line::from(vec![Span::styled(
        format!("{}+{}+", CONTENT_LEFT_PAD, "-".repeat(inner_width)),
        Style::default().fg(COLOR_BANNER_BORDER),
    )]));
    for (index, raw_line) in banner_lines.iter().enumerate() {
        let color = if index == 0 { COLOR_ACCENT } else { COLOR_TEXT_MUTED };
        let pad = inner_width.saturating_sub(raw_line.chars().count());
        body_lines.push(Line::from(vec![Span::styled(
            format!("{}| {}{}|", CONTENT_LEFT_PAD, raw_line, " ".repeat(pad.saturating_sub(1))),
            Style::default().fg(color),
        )]));
    }
    body_lines.push(Line::from(vec![Span::styled(
        format!("{}+{}+", CONTENT_LEFT_PAD, "-".repeat(inner_width)),
        Style::default().fg(COLOR_BANNER_BORDER),
    )]));
    body_lines.push(Line::from(""));

    let mut in_code_block = false;
    for message in app.messages() {
        let (content, is_tool_line, is_system_line, is_user_line) =
            if let Some(content) = message.strip_prefix("user: ") {
                (content, false, false, true)
            } else if let Some(content) = message.strip_prefix("assistant: ") {
                (content, false, false, false)
            } else if let Some(content) = message.strip_prefix("tool: ") {
                (content, true, false, false)
            } else if let Some(content) = message.strip_prefix("system: ") {
                (content, false, true, false)
            } else {
                (message.as_str(), false, false, false)
            };

        if !body_lines.is_empty() {
            body_lines.push(Line::from(""));
        }
        for line in content.split('\n') {
            let display_line = if is_tool_line {
                line.to_string()
            } else {
                line.to_string()
            };

            let color = if display_line.starts_with("```") {
                in_code_block = !in_code_block;
                COLOR_TEXT_MUTED
            } else if in_code_block {
                COLOR_CODE
            } else if is_tool_line && display_line.starts_with("[Tool]") {
                if display_line.contains("[Failed]") {
                    COLOR_ERROR
                } else if display_line.contains("[Success]") {
                    COLOR_SUCCESS
                } else {
                    COLOR_TOOL_BODY
                }
            } else if is_system_line {
                COLOR_TEXT_MUTED
            } else if is_tool_line {
                COLOR_TOOL_BODY
            } else if is_user_line {
                COLOR_TEXT_USER
            } else {
                COLOR_TEXT_PRIMARY
            };

            body_lines.push(Line::from(vec![Span::styled(
                format!("{}{}", CONTENT_LEFT_PAD, display_line),
                Style::default().fg(color),
            )]));
        }
    }

    let body_line_count = body_lines.len();
    let messages = Paragraph::new(body_lines)
        .wrap(Wrap { trim: false })
        .scroll((compute_scroll_from_bottom(app.scroll(), body_line_count, messages_area.height), 0));
    frame.render_widget(messages, messages_area);

    let input_color = if app.status() == &UiStatus::Processing {
        COLOR_INPUT_DISABLED
    } else {
        COLOR_INPUT_ACTIVE
    };
    let status_text = if app.status() == &UiStatus::Processing {
        if let Some(pending) = app.pending_reply.as_ref() {
            format_processing_status(
                THINK_FRAMES[pending.spinner_frame],
                Some(pending.started_at.elapsed().as_secs()),
            )
        } else if app.stream_state.is_some() {
            format_processing_status("streaming...", None)
        } else {
            format_processing_status("thinking...", None)
        }
    } else {
        String::new()
    };
    let input = Paragraph::new(vec![
        Line::from(vec![Span::styled(
            status_text,
            Style::default().fg(COLOR_TEXT_MUTED),
        )]),
        Line::from(vec![
            Span::styled("> ", Style::default().fg(COLOR_ACCENT)),
            Span::styled(app.input().to_string(), Style::default().fg(input_color)),
            Span::styled("|", Style::default().fg(COLOR_ACCENT)),
        ]),
    ]);
    frame.render_widget(input, input_area);
}

fn inset_left(area: Rect, left_pad: u16) -> Rect {
    if area.width <= left_pad {
        return area;
    }
    Rect::new(area.x + left_pad, area.y, area.width - left_pad, area.height)
}

fn compute_scroll_from_bottom(scroll_from_bottom: u16, total_lines: usize, viewport_height: u16) -> u16 {
    let viewport = usize::from(viewport_height);
    let max_top_offset = total_lines.saturating_sub(viewport);
    let clamped_from_bottom = usize::from(scroll_from_bottom).min(max_top_offset);
    let top_offset = max_top_offset.saturating_sub(clamped_from_bottom);
    u16::try_from(top_offset).unwrap_or(u16::MAX)
}

fn format_processing_status(label: &str, elapsed_secs: Option<u64>) -> String {
    let fixed_label = fit_status_label(label, STATUS_LABEL_WIDTH);
    let clamped = elapsed_secs.unwrap_or(0).min(9_999);
    if elapsed_secs.is_some() {
        return format!(
            "{:<label_width$} ({:>secs_width$}s)",
            fixed_label,
            clamped,
            label_width = STATUS_LABEL_WIDTH,
            secs_width = STATUS_SECS_WIDTH
        );
    }
    format!(
        "{:<label_width$} ({:>secs_width$}s)",
        fixed_label,
        "",
        label_width = STATUS_LABEL_WIDTH,
        secs_width = STATUS_SECS_WIDTH
    )
}

fn fit_status_label(label: &str, width: usize) -> String {
    let mut out = label.chars().take(width).collect::<String>();
    let len = out.chars().count();
    if len < width {
        out.push_str(&" ".repeat(width - len));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        App, McpDiagnostics, UiStatus, chunk_text, compact_message_for_width, draw,
        format_processing_status,
    };
    use crate::modes::runtime_mode::RuntimeMode;
    use crate::tools::registry::{ToolResultEnvelope, ToolStatus};
    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyEventState, KeyModifiers};
    use ratatui::{Terminal, backend::TestBackend};
    use serde_json::json;
    use std::collections::VecDeque;
    use std::time::{Duration, Instant};

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent {
            code,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        }
    }

    fn key_with_modifiers(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
        KeyEvent {
            code,
            modifiers,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        }
    }

    fn drain_processing(app: &mut App) {
        for _ in 0..600 {
            if app.status() != &UiStatus::Processing {
                break;
            }
            if let Some(stream) = app.stream_state.as_mut() {
                stream.last_emit_at = Instant::now() - Duration::from_millis(100);
            }
            app.on_tick();
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(app.status(), &UiStatus::Idle);
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
    fn ctrl_c_sets_should_quit() {
        let mut app = App::new(RuntimeMode::Edit);
        app.on_key(key_with_modifiers(KeyCode::Char('c'), KeyModifiers::CONTROL));
        assert!(app.should_quit());
    }

    #[test]
    fn shift_tab_cycles_mode_plan_edit_auto() {
        let mut app = App::new(RuntimeMode::Plan);
        assert_eq!(app.mode(), RuntimeMode::Plan);
        app.on_key(key(KeyCode::BackTab));
        assert_eq!(app.mode(), RuntimeMode::Edit);
        app.on_key(key(KeyCode::BackTab));
        assert_eq!(app.mode(), RuntimeMode::Auto);
        app.on_key(key(KeyCode::BackTab));
        assert_eq!(app.mode(), RuntimeMode::Plan);
    }

    #[test]
    fn processing_transitions_back_to_idle_and_appends_assistant_reply() {
        let mut app = App::new(RuntimeMode::Plan);
        app.on_resize(80, 24);
        app.on_key(key(KeyCode::Char('x')));
        app.on_key(key(KeyCode::Enter));
        assert_eq!(app.status(), &UiStatus::Processing);
        assert!(!app.messages().iter().any(|m| m.starts_with("assistant: ")));

        drain_processing(&mut app);
        assert!(
            app.messages()
                .iter()
                .any(|m| m.starts_with("assistant: "))
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
        assert!(content.contains("fastcode"));
        assert!(content.contains("mode:"));
        assert!(content.contains("> z"));
        assert!(!content.contains("for shortcuts"));
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
            assert!(content.contains("fastcode"));
            assert!(content.contains("> ok"));
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
        assert_eq!(app.mcp_status_display(), "ok 1/1 r1 d0");
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
        assert_eq!(app.mcp_status_display(), "error r1 d0");

        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "error".to_string(),
            messages: vec!["MCP diagnostics failed: test failure".to_string()],
        });

        assert_eq!(app.mcp_status_display(), "error r2 d1");
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

        assert_eq!(app.mcp_status_display(), "error r3 d1");
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

        assert_eq!(app.mcp_status_display(), "degraded 0/1 r1 d0");
        let last = app.messages().last().expect("fallback message exists");
        assert!(last.contains("MCP refresh 1: MCP diagnostics update"));
        assert!(last.contains("degraded 0/1"));
    }

    #[test]
    fn status_display_tracks_suppressed_refresh_dedup_count() {
        let mut app = App::new(RuntimeMode::Edit);
        for _ in 0..3 {
            app.apply_mcp_refresh(McpDiagnostics {
                status_label: "error".to_string(),
                messages: vec!["MCP diagnostics failed: sticky failure".to_string()],
            });
        }

        assert_eq!(app.mcp_status_display(), "error r3 d2");
        assert!(
            app.messages()
                .iter()
                .filter(|m| m.contains("MCP refresh"))
                .count()
                == 1
        );
    }

    #[test]
    fn status_transition_resets_refresh_dedup_counter() {
        let mut app = App::new(RuntimeMode::Edit);
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "degraded 0/1".to_string(),
            messages: vec!["MCP diagnostics degraded (0/1 running)".to_string()],
        });
        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "degraded 0/1".to_string(),
            messages: vec!["MCP diagnostics degraded (0/1 running)".to_string()],
        });
        assert_eq!(app.mcp_status_display(), "degraded 0/1 r2 d1");

        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "ok 1/1".to_string(),
            messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
        });
        assert_eq!(app.mcp_status_display(), "ok 1/1 r3 d0");

        app.apply_mcp_refresh(McpDiagnostics {
            status_label: "ok 1/1".to_string(),
            messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
        });
        assert_eq!(app.mcp_status_display(), "ok 1/1 r4 d1");
    }

    #[test]
    fn scripted_loop_error_to_ok_transition_resets_dedup_and_keeps_user_flow() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut app = App::new(RuntimeMode::Edit);
        app.on_resize(100, 30);
        let actions =
            super::parse_scripted_actions("h,i,Enter,sleep5,sleep5,sleep5,sleep5,Up,Down,q");
        let mut diagnostics = VecDeque::from(vec![
            McpDiagnostics {
                status_label: "error".to_string(),
                messages: vec!["MCP diagnostics failed: sticky failure".to_string()],
            },
            McpDiagnostics {
                status_label: "error".to_string(),
                messages: vec!["MCP diagnostics failed: sticky failure".to_string()],
            },
            McpDiagnostics {
                status_label: "ok 1/1".to_string(),
                messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
            },
            McpDiagnostics {
                status_label: "ok 1/1".to_string(),
                messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
            },
        ]);

        super::run_loop(
            &mut terminal,
            &mut app,
            actions,
            Duration::from_millis(1),
            move || diagnostics.pop_front(),
        )
        .expect("run loop");

        drain_processing(&mut app);

        assert_eq!(app.mcp_status_display(), "ok 1/1 r4 d1");
        assert!(
            app.messages()
                .iter()
                .any(|m| m == "system: MCP refresh 1: MCP diagnostics failed: sticky failure")
        );
        assert!(
            app.messages()
                .iter()
                .any(|m| m == "system: MCP refresh 3: MCP diagnostics healthy (1/1 running)")
        );
        assert!(app.messages().iter().any(|m| m == "user: hi"));
        assert!(
            app.messages()
                .iter()
                .any(|m| m.starts_with("assistant: "))
        );
    }

    #[test]
    fn scripted_loop_ok_error_ok_oscillation_resets_dedup_per_phase() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut app = App::new(RuntimeMode::Edit);
        app.on_resize(100, 30);
        let actions =
            super::parse_scripted_actions("h,i,Enter,sleep5,sleep5,sleep5,sleep5,sleep5,sleep5,q");
        let mut diagnostics = VecDeque::from(vec![
            McpDiagnostics {
                status_label: "ok 1/1".to_string(),
                messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
            },
            McpDiagnostics {
                status_label: "ok 1/1".to_string(),
                messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
            },
            McpDiagnostics {
                status_label: "error".to_string(),
                messages: vec!["MCP diagnostics failed: intermittent failure".to_string()],
            },
            McpDiagnostics {
                status_label: "error".to_string(),
                messages: vec!["MCP diagnostics failed: intermittent failure".to_string()],
            },
            McpDiagnostics {
                status_label: "ok 1/1".to_string(),
                messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
            },
            McpDiagnostics {
                status_label: "ok 1/1".to_string(),
                messages: vec!["MCP diagnostics healthy (1/1 running)".to_string()],
            },
        ]);

        super::run_loop(
            &mut terminal,
            &mut app,
            actions,
            Duration::from_millis(1),
            move || diagnostics.pop_front(),
        )
        .expect("run loop");

        drain_processing(&mut app);

        assert_eq!(app.mcp_status_display(), "ok 1/1 r6 d1");
        assert!(
            app.messages()
                .iter()
                .any(|m| m == "system: MCP refresh 1: MCP diagnostics healthy (1/1 running)")
        );
        assert!(
            app.messages()
                .iter()
                .any(|m| m == "system: MCP refresh 3: MCP diagnostics failed: intermittent failure")
        );
        assert!(
            app.messages()
                .iter()
                .any(|m| m == "system: MCP refresh 5: MCP diagnostics healthy (1/1 running)")
        );
        assert!(app.messages().iter().any(|m| m == "user: hi"));
        assert!(
            app.messages()
                .iter()
                .any(|m| m.starts_with("assistant: "))
        );
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

    #[test]
    fn markdown_formatter_normalizes_spacing_and_list_style() {
        let raw = "Title\r\n\r\n\r\n* one\r\n* two\r\n\r\n```rs\r\nlet x = 1;\r\n```\r\n";
        let formatted = super::format_assistant_markdown(raw);
        assert!(formatted.contains("- one"));
        assert!(formatted.contains("- two"));
        assert!(!formatted.contains("* one"));
        assert!(!formatted.contains("\n\n\n"));
    }

    #[test]
    fn draw_formats_tool_lines_with_compact_prefixes() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut app = App::new(RuntimeMode::Edit);
        app.messages.push("tool: [Tool] shell  [Success]\n  command: {\"command\":\"echo ok\"}  ->  ok".to_string());
        app.messages.push("tool: [Tool] git  [Failed]\n  command: {\"args\":[\"status\"]}  ->  fatal: not a git repository".to_string());
        terminal.draw(|frame| draw(frame, &app)).expect("draw");
        let content = format!("{:?}", terminal.backend().buffer());
        assert!(content.contains("fastcode"));
        assert!(app.messages().iter().any(|m| m.contains("[Tool] shell")));
        assert!(app.messages().iter().any(|m| m.contains("[Failed]")));
    }

    #[test]
    fn scroll_from_bottom_defaults_to_latest_content() {
        let offset = super::compute_scroll_from_bottom(0, 100, 10);
        assert_eq!(offset, 90);
    }

    #[test]
    fn scroll_from_bottom_clamps_to_history_limit() {
        let offset = super::compute_scroll_from_bottom(999, 30, 10);
        assert_eq!(offset, 0);
    }

    #[test]
    fn processing_status_slot_has_stable_width() {
        let a = format_processing_status("thinking", Some(1));
        let b = format_processing_status("thinking...", Some(123));
        let c = format_processing_status("streaming...", None);
        assert_eq!(a.chars().count(), b.chars().count());
        assert_eq!(b.chars().count(), c.chars().count());
    }

    #[test]
    fn extracts_text_from_choice_text_shape() {
        let response = json!({
            "choices": [
                { "text": "hello from text" }
            ]
        });
        let (content, tool_calls) = super::extract_assistant_content_and_tools(&response).unwrap();
        assert_eq!(content, "hello from text");
        assert!(tool_calls.is_empty());
    }

    #[test]
    fn surfaces_model_error_message_from_error_object() {
        let response = json!({
            "error": {
                "message": "invalid api key",
                "code": "auth_failed"
            }
        });
        let err = super::extract_assistant_content_and_tools(&response).unwrap_err();
        assert!(err.contains("invalid api key"));
        assert!(err.contains("auth_failed"));
    }

    #[test]
    fn tool_summary_uses_compact_two_line_style() {
        let result = ToolResultEnvelope {
            tool: "shell".to_string(),
            status: ToolStatus::Success,
            output: Some("line1\nline2\nline3".to_string()),
            error_code: None,
            error_message: None,
        };
        let summary = super::summarize_tool_event("shell", &json!({"command":"echo hi"}), &result);
        assert!(summary.starts_with("[Tool] shell"));
        assert!(summary.contains("[Success]"));
        assert!(summary.contains("command: {\"command\":\"echo hi\"}"));
        assert!(summary.contains("line1"));
        assert!(summary.contains("(+2 lines)"));
    }
}
