# Changelog

All notable changes to QuickForge will be documented in this file.

## [1.0.0] - 2025-04-29

### Added

- Initial release of QuickForge (速构).
- ChatGPT-like chat UI with conversation list, streaming, and model settings.
- Local Node.js server for file-based JSON storage (`~/.quickforge/storage/`).
- YOLO mode with local workspace tools: `list_dir`, `read_file`, `grep_files`, `write_file`, `edit_file`, `run_command`.
- Custom provider support for OpenAI-compatible and Anthropic Messages APIs.
- Default LiteLLM proxy profile (`anthropic/claude-sonnet-4`).
- Automatic migration from legacy FastCode data directories.
- Browser IndexedDB import on first run.
- CLI entry point (`bin/quickforge.mjs`) with `quickforge` and `qf` commands.
