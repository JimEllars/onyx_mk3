# Verification and Fixes Notes

## 1. P0 Session Workspace Isolation
- **Issue**: Parallel lanes silently cross wires as the global session store has no per-worktree isolation. This leads to phantom completions.
- **Fix**: Appended `.with_workspace_root()` on the creation of all new sessions (e.g. `Session::new()`).
- Adjusted `load_from_path` in `session.rs` to validate the `workspace_root` of the loaded session matches the current working directory, otherwise throw a `SessionError::WorkspaceMismatch`.
- Replaced occurrences of `Session::new()` with `Session::new().with_workspace_root(...)`.

## 2. P0 Async Tool Runtime Collision
- **Issue**: Calling async functions in tools creates a new tokio runtime, leading to crashes in headless mode.
- **Fix**: Used `tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(...))` instead of `tokio::runtime::Runtime::new().unwrap().block_on(...)` in `crates/tools/src/lib.rs`.

## 3. P1 Observability State Surface
- **Issue**: Ensure `.claw/worker-state.json` emission on every `WorkerStatus` transition and add `onyx state` subcommand.
- **Fix**: Verified `push_event` calls `emit_state_file` to write state files on transition in `worker_boot.rs`.
- Added the `state` subcommand via parsing `CliAction::State` inside `crates/onyx/src/main.rs`. Implemented `run_worker_state()` to print the contents of `.claw/worker-state.json`.

## 4. P1 Trusted Roots Default Configuration
- **Issue**: Need to merge `trusted_roots` config settings.
- **Fix**: Verified `RuntimeConfig` loads `trusted_roots`. Verified `WorkerRegistry::create()` extracts and merges `config_roots` correctly. The `worker_create_merges_config_trusted_roots_without_per_call_override` integration test passes.

## 5. P1 Config Validation Enhancement
- **Fix**: Verified that `validate_optional_hooks_config()` is executed before deep merging into the overall object in `config.rs`. This provides clearer parse-time validation messages including paths.

## 6. P2 Stale Branch Detection
- **Fix**: Verified that stale branch metrics are detected via `behind/ahead` and it maps successfully to `BranchStaleAgainstMain` lane event through integration and unit tests in `stale_branch.rs`.

## 7. P2 Failure Taxonomy Completeness
- **Fix**: Verified `WorkerFailureKind` includes `TrustGate`, `PromptDelivery`, `Protocol`, `Provider`, and accurately maps to `FailureScenario` in `recovery_recipes.rs`. Verified complete test coverage.

## 8. P2 MCP Degraded Startup Reporting
- **Fix**: Verified that `degraded_report` tracks partial server failures in `mcp_stdio.rs` / `mcp_lifecycle_hardened.rs`.

## 9. Cleanup
- Removed lingering `.rej` files and old `.orig` backups.
