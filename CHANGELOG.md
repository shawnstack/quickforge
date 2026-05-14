# Changelog

All notable changes to QuickForge will be documented in this file.

## [1.2.10] - 2026-05-14

### Changed

- Changed `qf update` to install `@shawnstack/quickforge@latest` from npm when a newer version is available.
- Kept `qf check-update` as a check-only command.

### Fixed

- Fixed share-relative asset paths for shared conversation pages.
- Avoided password prompts for open shared conversations.

### Released

- Prepared `@shawnstack/quickforge@1.2.10` for npm publishing with the `latest` tag.
- Built offline installation tarball: `package-offline/shawnstack-quickforge-1.2.10.tgz`.
- The offline tarball bundles runtime dependencies and can be installed with:

  ```bash
  npm install -g ./package-offline/shawnstack-quickforge-1.2.10.tgz
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
