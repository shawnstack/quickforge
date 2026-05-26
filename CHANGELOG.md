# Changelog

All notable changes to QuickForge will be documented in this file.

## [1.3.18] - 2026-05-26

### Changed

- Enhanced `run_command` for long-running tests with configurable timeouts, stdout/stderr previews capped at the last 200 lines and 10,000 shared characters, truncation metadata, duration metadata, and full command log files.
- Updated the server tools wiki for the long-running command output behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.18` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.18.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.18.tgz
  ```

## [1.3.17] - 2026-05-26

### Added

- Show compact summary in chat.
- Improve context compaction feedback.

### Changed

- Refine tool terminate button style.
- Fix live tool elapsed time updates.
- Polish composer stop button style.

### Fixed

- Preserve compacted context tail.
- Use real usage for auto compact trigger.

### Released

- Prepared `@shawnstack/quickforge@1.3.17` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.17.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.17.tgz
  ```

## [1.3.16] - 2026-05-25

### Changed

- Add icon usage design rules.
- Add patch release preparation script.
- Included working tree updates in `docs/wiki/server/tools/README.md`, `docs/wiki/src/lib/README.md`, `server/tools/definitions.mjs`, `server/tools/index.mjs`, `src/components/chat/panel-decoration.ts`, `src/lib/local-tools.ts`.

### Released

- Prepared `@shawnstack/quickforge@1.3.16` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.16.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.16.tgz
  ```

## [1.3.15] - 2026-05-25

### Added

- Added an approval step before automatic conversation compaction replaces the current context.
- Added a running `run_command` terminate control in tool cards, backed by server-side command abort handling.

### Changed

- Increased the default `run_command` timeout to 10 minutes and documented the behavior in the code wiki.

### Fixed

- Fixed `edit_file` matching so exact edits tolerate workspace line-ending differences.

### Released

- Prepared `@shawnstack/quickforge@1.3.15` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.15.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.15.tgz
  ```

## [1.3.14] - 2026-05-25

### Added

- Added automatic conversation context compaction when model context usage crosses the configured threshold.
- Added auto-compaction settings for enabling the feature, choosing the trigger threshold, and controlling recent-turn retention.

### Changed

- Updated the server wiki documentation for automatic context compaction behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.14` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.14.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.14.tgz
  ```

## [1.3.13] - 2026-05-25

### Added

- Added PWA assets and service worker registration for installable app support.
- Added a Markdown workspace reader and improved workspace inspector actions.

### Changed

- Aligned terminal styling with the application theme.
- Improved workspace inspector behavior and documentation.

### Fixed

- Fixed thinking-only process duration so it remains frozen after completion.

### Released

- Prepared `@shawnstack/quickforge@1.3.13` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.13.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.13.tgz
  ```

## [1.3.12] - 2026-05-22

### Added

- Added a fullscreen toggle for the terminal dock.
- Added API key visibility toggles in provider configuration fields.

### Released

- Prepared `@shawnstack/quickforge@1.3.12` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.12.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.12.tgz
  ```

## [1.3.11] - 2026-05-21

### Changed

- Reissued the `1.3.10` release contents as `1.3.11` after the `1.3.10` npm package was published from the wrong directory.
- No runtime source changes were introduced since `v1.3.10`.

### Released

- Prepared `@shawnstack/quickforge@1.3.11` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.11.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.11.tgz
  ```

## [1.3.10] - 2026-05-21

### Added

- Added configurable terminal shell selection with project-level shell profiles.
- Added terminal shell profile support across server APIs, terminal sessions, settings UI, and localized copy.

### Changed

- Updated the sidebar toggle icon styling.
- Updated code wiki documentation for terminal shell profile behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.10` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.10.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.10.tgz
  ```

## [1.3.9] - 2026-05-21

### Changed

- Reduced the offline installation tarball by moving frontend-only Monaco and xterm packages to development dependencies.
- Kept `node-pty` optional and out of the bundled offline tarball to avoid packaging large platform PTY binaries.
- Gracefully disable the built-in terminal panel when optional PTY support is unavailable after an offline install.
- Updated release and script documentation for the leaner offline package behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.9` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.9.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.9.tgz
  ```

## [1.3.8] - 2026-05-21

### Added

- Added workspace inspector APIs and UI for browsing project files, viewing file contents, and reviewing workspace changes.
- Added a multi-session terminal dock backed by server-side terminal management.

### Changed

- Improved workspace inspector layout and separated the workspace column from the main chat area.
- Updated the code wiki for the new workspace and terminal modules.

### Fixed

- Fixed workspace column layout separation for a cleaner project workspace view.

### Released

- Prepared `@shawnstack/quickforge@1.3.8` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.8.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.8.tgz
  ```

## [1.3.7] - 2026-05-21

### Added

- Added collapsed AI processing detail panels with decorative visual treatment.

### Changed

- Polished chat tool call icons and processing detail completion behavior.
- Removed MCP server description copy from the server management dialog.

### Fixed

- Fold processing details after completion and preserve finalized collapsed processing state.

### Released

- Prepared `@shawnstack/quickforge@1.3.7` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.7.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.7.tgz
  ```

## [1.3.6] - 2026-05-20

### Changed

- Prepared a patch maintenance release after `v1.3.5`.
- No runtime source changes were introduced since `v1.3.5`.

### Released

- Prepared `@shawnstack/quickforge@1.3.6` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.6.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.6.tgz
  ```

## [1.3.5] - 2026-05-20

### Added

- Added opt-in full AI HTTP request/response tracing with independent `ai-http-YYYY-MM-DD.jsonl` logs.
- Captured AI request URL, method, headers, body, response status, headers, body, duration, session, provider, API, model, and request purpose for local diagnostics.
- Covered both normal chat requests and conversation compaction requests.

### Changed

- Documented the `QUICKFORGE_AI_HTTP_LOG` diagnostic switch and related sensitive-log handling guidance.

### Released

- Prepared `@shawnstack/quickforge@1.3.5` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.5.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.5.tgz
  ```

## [1.3.4] - 2026-05-20

### Changed

- Prepared a patch maintenance release after temporary custom command verification and cleanup.
- No runtime source changes were introduced since `v1.3.3`.

### Released

- Prepared `@shawnstack/quickforge@1.3.4` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.4.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.4.tgz
  ```

## [1.3.3] - 2026-05-20

### Changed

- Optimized offline package publishing to keep `@vscode/ripgrep` optional and platform-neutral.
- Added offline package pruning to reduce bundled tarball size.
- Updated release runbook and script wiki documentation for offline packaging behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.3` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.3.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.3.tgz
  ```

## [1.3.2] - 2026-05-20

### Added

- Added global MCP server integration with configuration, registry, API routes, and UI management.

### Changed

- Enhanced the bilingual README for clearer feature, install, and safety documentation.
- Refined MCP server list actions for a cleaner management experience.

### Released

- Prepared `@shawnstack/quickforge@1.3.2` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.2.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.2.tgz
  ```

## [1.3.1] - 2026-05-19

### Added

- Added configurable per-project command directories and a project command settings tab.
- Enhanced workspace file tools for richer file operations.

### Changed

- Removed replace-in-files tool references and handling from documentation, prompts, and tool registration.
- Updated wiki documentation for the current project structure.

### Fixed

- Improved session YOLO approval handling.
- Fixed output and approval diff rendering with preserved line styling and inline colors.
- Unified rollback confirmation dialog behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.1` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.1.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.1.tgz
  ```

## [1.3.0] - 2026-05-15

### Changed

- Updated project and base agent instructions to emphasize minimal, style-matching coding changes and Chinese project guidance.
- Refreshed the code wiki and project handoff documentation.

### Fixed

- Fixed `qf update` to install the latest published package version.
- Fixed LAN shared conversation asset resolution and open-share password handling.
- Fixed release packaging scripts to skip optional package entries that are not present in the workspace.

### Released

- Prepared `@shawnstack/quickforge@1.3.0` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.0.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.0.tgz
  ```

## [1.2.9] - 2026-05-14

### Added

- Added CLI version commands: `qf --version`, `qf -v`, and `qf version`.
- Added CLI update check commands: `qf check-update` and `qf update`, which check npm for newer versions without auto-installing.

### Released

- Prepared `@shawnstack/quickforge@1.2.9` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.9.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.9.tgz
  ```

## [1.2.8] - 2026-05-14

### Fixed

- Fixed LAN shared conversation pages failing to load bundled JavaScript assets from remote devices.
- Prevented missing static asset requests from falling back to `index.html`, making stale build artifacts surface as 404s instead of module MIME errors.

### Released

- Prepared `@shawnstack/quickforge@1.2.8` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.8.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.8.tgz
  ```

## [1.2.7] - 2026-05-13

### Fixed

- Added clipboard polyfill for non-secure HTTP contexts.

### Changed

- Improved `run_command` abort support and message state handling.

### Released

- Prepared `@shawnstack/quickforge@1.2.7` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.7.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.7.tgz
  ```

## [1.2.6] - 2026-05-13

### Added

- Added tool execution timing display for local tool calls.
- Added the patch release runbook for repeatable small-version releases.

### Changed

- Improved the file edit fallback prompt.
- Hid chat token usage from the chat UI.

### Released

- Prepared `@shawnstack/quickforge@1.2.6` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.6.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.6.tgz
  ```

## [1.2.5] - 2026-05-13

### Added

- Added password-protected LAN access for shared local sessions.
- Added tool display preferences.
- Added real-time streaming updates for tool execution.

### Changed

- Improved backup restore controls.
- Moved project delete into the overflow menu.

### Fixed

- Isolated restored composer drafts by session.

### Released

- Prepared `@shawnstack/quickforge@1.2.5` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.5.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.5.tgz
  ```

## [1.2.4] - 2026-05-12

### Fixed

- Fixed startup opening behavior to use localhost correctly.
- Fixed project sessions loading when a project is expanded.
- Fixed restored draft handling to prevent consumed drafts from reappearing.

### Released

- Prepared `@shawnstack/quickforge@1.2.4` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.4.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.4.tgz
  ```

## [1.2.3] - 2026-05-12

### Released

- Published `@shawnstack/quickforge@1.2.3` to npm with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.3.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.3.tgz
  ```

### Changed

- Improved non-YOLO tool approval and per-project YOLO mode handling.
- Improved task history, rollback handling, scheduled task drafts, and scheduled task display.
- Fixed initial chat panel decoration timing after Lit render.
- Synced rollback state to the server to prevent client/server state drift.

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
