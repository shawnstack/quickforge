# Changelog

All notable changes to QuickForge will be documented in this file.

## [1.5.4] - 2026-07-01

### Added

- Added an Electron desktop app entry that reuses the same QuickForge local service and frontend build output for Windows/macOS/Linux desktop builds.
- Added desktop build scripts and a GitHub Actions `Desktop Build` workflow for producing platform-specific desktop artifacts without publishing npm automatically.
- Added npm-importable startup API metadata while preserving the existing `qf` / `quickforge` CLI entry points.

### Changed

- Polished the desktop shell with system tray support, localized tray labels, titlebar spacing, and app icon handling for desktop builds.
- Refined workspace and sidebar UI details, including hover feedback, overview panel layout, and workspace changes placement.
- Kept Electron and desktop-only resources isolated from the npm runtime package whitelist.

### Fixed

- Preserved attachments when switching models.
- Ran settings updates through the external update supervisor to avoid replacing the active process directly.

### Released

- Prepared `@shawnstack/quickforge@1.5.4` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.5.4.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.5.4.tgz
  ```

## [1.5.3] - 2026-06-30

### Changed

- Split the monolithic runtime `config.json` into per-store files so each configuration domain is persisted and written independently:
  - `settings.json` (general app preferences, no longer holds MCP servers).
  - `mcp-servers.json` (MCP promoted from a nested `settings.mcpServers` key to its own store with an independent write queue).
  - `providers.json` (custom model provider definitions and their API keys kept together as strongly-coupled data under a shared write queue).
  - `plugins.json` and `projects.json` (each with its own file and write queue).
- Demoted `config.json` to metadata only (`layoutVersion: 2`) after a one-time idempotent migration (`migrateSplitConfig()`), with a read-side fallback to legacy sections for interrupted migrations.

### Added

- Added MCP servers as a first-class backup section; importing an older backup automatically lifts `settings.mcpServers` into the new `mcp` section.
- Added a merge restore mode for backups (backup wins on conflict, local-only entries preserved) covering settings, MCP, provider keys, custom providers, projects, scheduled tasks, and conversations.
- Added tests covering the config split migration, read-side fallback, shared `providers.json` store, and the backup merge/replace modes.

### Released

- Prepared `@shawnstack/quickforge@1.5.3` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.5.3.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.5.3.tgz
  ```

## [1.5.2] - 2026-06-30

### Added

- Added the ability to archive conversations instead of permanently deleting them.
- Surfaced the right-side workspace toggle tooltip according to its expand/collapse state.

### Changed

- Split the chat panel decoration logic into focused modules and extracted scheduled task utilities into a reusable module, with added test coverage for the scheduling helpers.
- Improved streaming performance by skipping artifact extraction and process decoration for stable turns, and omitting redundant scroll writes when pinned to the bottom.
- Delayed the conversation sidebar hover tooltip to avoid re-render churn when quickly moving across the list.

### Fixed

- Stored composer drafts locally so in-progress input is restored across reloads.
- Restricted automatic preview to `present_files`; `write_file`/`edit_file` no longer auto-open a preview tab.
- Prevented historical previews from re-opening after a refresh.
- Aligned the subagent trace border color.

### Released

- Prepared `@shawnstack/quickforge@1.5.2` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.5.2.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.5.2.tgz
  ```

## [1.5.1] - 2026-06-29

### Added

- Added a background update checker that runs asynchronously on startup, surfaces an update reminder in the lower-left corner, and lets you configure the update check frequency on the About settings page.
- Added image thumbnails, a preview entry, and file-type icons across the workspace file tree and changes list.
- Added automatic file preview: invoking `present_files` opens the preview pane without format restrictions, and Markdown artifacts render as preview tabs in the sidebar.
- Added an appearance settings panel with theme and font size options.
- Relaxed subagent workspace requirements and expanded file preview limits.

### Changed

- Improved responsiveness by skipping redundant list refreshes when switching sessions and debouncing font-size preview updates.
- Removed stray dark divider lines in the overview command and the channel log expansion for visual consistency.

### Fixed

- Hid the upper-right console and workspace icons when opening the settings dialog.

### Released

- Prepared `@shawnstack/quickforge@1.5.1` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.5.1.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.5.1.tgz
  ```

## [1.5.0] - 2026-06-26

### Added

- Added an ACP (Agent Communication Protocol) agent server with enhanced session context, keep-alive, and per-workspace subagent resolution.
- Added a channel framework with a WeChat bridge, including workspace selection and stabilized channel sessions.
- Replaced YOLO mode with explicit agent access modes for finer control over what the agent can do.
- Allowed loading file-based agent profiles from project and user `agents` directories.
- Simplified the custom model configuration UI with presets and a connection test, and updated the composer model selector menu.
- Enhanced the artifact workspace preview and added file-edit diff stats to tool summaries.
- Gave global conversations a default workspace and improved workspace UI and ACP session visibility.
- Added an update settings entry on the About page.
- Polished the workspace reader, file tree, and auto-widening inspector.

### Changed

- Replaced inline description text with reusable InfoTip components across settings and pages.
- Aligned popovers, pages, and inputs with the design language; widened the workspace inspector max width to 640px.
- Simplified the workspace inspector and polished toolbar, terminal, and sidebar toggle icons.
- Split the inspector into a left navigation pane and a right preview pane, and trimmed verbose hint copy.
- Rewrote the design language documentation to focus on aesthetics over implementation details.
- Adjusted the `/compact` and `/summary` commands.

### Fixed

- Waited for the terminal to be ready before sending markdown commands.
- Hid internal preview URLs and matched ACP project paths case-insensitively.
- Improved ACP session persistence and recovery.
- Hid the splitter and right pane when no preview tab is open, and fixed the sidebar browser preview with a new tool-card preview entry.

### Released

- Prepared `@shawnstack/quickforge@1.5.0` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.5.0.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.5.0.tgz
  ```

## [1.4.1] - 2026-06-18

### Added

- Unified `/plan` command selection with plan mode and allowed Explore subagents to run read-only commands during repository research.
- Added workspace browser preview support.
- Added a redesigned MCP configuration UI with form and JSON editing modes.
- Improved project command settings with multi-project support, command previews, and unified help popovers.

### Changed

- Improved context usage handling across server persistence, auto-compaction, chat utilities, and frontend usage display.
- Prioritized Explore for repository discovery guidance.
- Improved MCP tool call display.

### Fixed

- Preserved plan mode when sending prompts.

### Released

- Prepared `@shawnstack/quickforge@1.4.1` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.4.1.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.4.1.tgz
  ```

## [1.4.0] - 2026-06-16

### Changed

- Improved agent state recovery with an SSE-first recovery path.
- Reduced avoidable persistence, context-estimation, code-block decoding, initial bundle, render, and filesystem overhead for better responsiveness.
- Lazy-loaded heavy frontend modules and coalesced chat decoration work.

### Fixed

- Improved app error handling and resilience.
- Preserved aborted task status.
- Clarified task toast status presentation.

### Released

- Prepared `@shawnstack/quickforge@1.4.0` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.4.0.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.4.0.tgz
  ```

## [1.3.30] - 2026-06-15

### Added

- Added a rollback confirmation popover to reduce accidental conversation rollbacks.
- Allowed subagents to assist read-only research while using plan mode.

### Changed

- Improved chat process detail folding and streaming decoration behavior so intermediate process content stays collapsed and less distracting.
- Improved app error handling.
- Added a documented UX improvements plan.

### Fixed

- Kept message action controls below chat message bubbles.
- Hid mutating actions in read-only shared chats.
- Deferred process folding until streaming completes to avoid flicker and unstable intermediate UI states.
- Preserved streaming response text while stabilizing tool-call/process-detail folding.

### Released

- Prepared `@shawnstack/quickforge@1.3.30` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.30.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.30.tgz
  ```

## [1.3.29] - 2026-06-08

### Changed

- Normalized Agent Skill names case-insensitively so uppercase names such as `SDD` are recognized from `SKILL.md`, `skill.json`, saved selections, and skill tool calls while preserving lowercase canonical names internally.
- Documented the Agent Skills name normalization behavior in the server wiki.

### Released

- Prepared `@shawnstack/quickforge@1.3.29` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.29.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.29.tgz
  ```

## [1.3.28] - 2026-06-05

### Fixed

- Included bundled plugins in both runtime and offline package builds.
- Improved project deletion confirmation menu behavior.
- Improved slash command suggestions.
- Corrected the composer image paste model display.

### Released

- Prepared `@shawnstack/quickforge@1.3.28` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.28.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.28.tgz
  ```

## [1.3.27] - 2026-06-04

### Fixed

- Corrected the project Commands settings example to show `.opencode/commands` without the invalid singular `.opencode/command` entry.

### Released

- Prepared `@shawnstack/quickforge@1.3.27` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.27.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.27.tgz
  ```

## [1.3.26] - 2026-06-04

### Added

- Added the Agent plugin system with bundled document, presentation, and spreadsheet capability plugins.
- Added composer plus-menu capability suggestions and the `/review` slash command.
- Added Claude/opencode-compatible custom instruction, skills, and command discovery paths.
- Added plugin management UI details and plugin capability documentation.

### Changed

- Improved plugin details display, composer capability discovery, chat panel decoration, and custom command discovery precedence.
- Updated Agent Skills and project command documentation to describe compatible Claude/opencode directories.
- Removed unused legacy reasoning-content cache code.

### Fixed

- Restored the assistant waiting dots animation after page refresh.

### Released

- Prepared `@shawnstack/quickforge@1.3.26` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.26.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.26.tgz
  ```

## [1.3.25] - 2026-06-03

### Added

- Added the `/review` command for pre-commit self-review of pending code changes without editing files.
- Added Vitest-based server utility and tool definition coverage.
- Added first-use guide and assistant waiting bubble improvements.

### Changed

- Migrated Pi packages to the `@earendil-works` scope.
- Split large agent manager and app modules while cleaning obsolete type fields.
- Improved sidebar session deletion flow, chat waiting indicators, and scoped session metadata updates.

### Fixed

- Resolved high-priority memory leak, race condition, performance, and security issues.
- Fixed MCP tool name helper imports.
- Smoothed session deletion animation behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.25` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.25.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.25.tgz
  ```

## [1.3.24] - 2026-06-02

### Added

- Added the `/plan` command to generate implementation plans before execution.
- Added terminal execution for markdown shell code blocks and workspace path resolution support.
- Added chat/project navigation improvements including git branch display, project drag-and-drop reordering, and collapse/expand-all controls.

### Changed

- Enhanced terminal dock behavior, workspace APIs, chat panel decoration, layout, and context-usage display.
- Improved model selector open performance and model option defaults.
- Refined terminal shell selection behavior.

### Fixed

- Used the server-side continue endpoint for in-place retry instead of creating a new conversation turn.
- Prevented message loss on request timeout or disconnect.
- Fixed confirmation Enter-key handling, task completion toast placement, and the missing `DefaultOptions` model settings tab.

### Released

- Prepared `@shawnstack/quickforge@1.3.24` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.24.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.24.tgz
  ```

## [1.3.23] - 2026-06-01

### Changed

- Kept the `package-offline` npm publishing path while removing bundled runtime dependencies from the generated package.
- Updated patch release guidance and automation to pack `package-offline` without installing `node_modules`, avoiding npm/cnpm package size sync limits.
- Clarified release documentation for the offline release tarball dependency behavior.

### Released

- Prepared `@shawnstack/quickforge@1.3.23` for npm publishing with the `latest` tag.
- Built offline release tarball: `package-offline/shawnstack-quickforge-1.3.23.tgz`.
- The offline release tarball contains QuickForge runtime files and installs npm dependencies from the registry:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.23.tgz
  ```

## [1.3.22] - 2026-06-01

### Added

- Added custom agent profiles with AI fill support.
- Added per-task scheduled execution mode for scheduled tasks.
- Added conversation pinning and header actions.

### Changed

- Improved sidebar conversation list timestamps.
- Updated scheduled task prompts and font size settings.
- Updated bug triage documentation and related server/frontend wiki coverage.

### Fixed

- Closed the scheduled task menu when interacting outside of it.
- Hardened deferred agent cleanup.
- Prevented sent chat drafts from reappearing.

### Released

- Prepared `@shawnstack/quickforge@1.3.22` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.22.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.22.tgz
  ```

## [1.3.21] - 2026-05-28

### Changed

- Updated patch release guidance to avoid the automated preparation script by default on Windows workspaces.

### Fixed

- Improved mobile message action spacing and touch behavior.
- Show zero context usage for empty chats.

### Released

- Prepared `@shawnstack/quickforge@1.3.21` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.21.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.21.tgz
  ```

## [1.3.20] - 2026-05-27

### Changed

- Increased built-in `general` and `explore` subagent tool-call budgets to 300.

### Released

- Prepared `@shawnstack/quickforge@1.3.20` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.20.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.20.tgz
  ```

## [1.3.19] - 2026-05-27

### Added

- Added subagent support and streamed subagent traces in chat.

### Changed

- Improved project task prompt guidance, search tool visibility, workspace authorization styling, and subagent timeout behavior.
- Updated Pi dependencies and DeepSeek thinking-level model configuration.

### Fixed

- Fixed context usage accounting, compact summary notices, collapsed subagent tool-call display, and chat decoration for subagent traces.

### Released

- Prepared `@shawnstack/quickforge@1.3.19` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.3.19.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.3.19.tgz
  ```

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
