# Onyx Mk3 Architecture

## TUI Modernization & Monolith Extraction (Phase 30)

Historically, the Onyx CLI REPL and application lifecycle logic was tightly coupled within `main.rs`, resulting in a massive monolith that hindered the development of modern Terminal User Interfaces (TUI).

To resolve this, the architecture has been refactored:
1. **Extraction of `app.rs`**: The core REPL logic, including the `LiveCli` struct and `run_repl` function, has been extracted from `main.rs` into a dedicated `app.rs` module.
2. **Binary Entrypoint**: `main.rs` now acts exclusively as the binary entrypoint, handling initial argument parsing, global configurations, and dispatching CLI actions to the `app.rs` lifecycle.
3. **Crossterm TUI**: A modern status bar has been implemented in `tui::status_bar.rs`. It utilizes `crossterm` escape sequences to render a terminal-size-aware, bottom-pinned HUD beneath the standard output stream without disrupting scrollback.
