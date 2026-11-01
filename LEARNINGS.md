## Edge Bridge and Rust Core Synchronization
When adding cross-service telemetry and resilient fallback states, ensuring deep synchronization between Edge environments (Cloudflare Workers) and the inner Daemon is critical.
1. `GET /health` and `GET /ready` act as fundamental uptime checkpoints to verify upstream dependencies seamlessly.
2. In `edge-bridge/src/index.ts`, logging should strip credentials and output structured JSON, mapping directly to analytics workflows.
3. Fallback logic within Cloudflare isolates external outages while retaining data transparency (`code: "502" | "504"` for context mapping inside `emailDispatchManager.ts`).
4. In `rust/crates/api/src/client.rs`, errors from Edge/Providers shouldn't halt the user instance logic or lock TUI frames. Utilizing structured map_err boundaries and logging asynchronous SQLite records ensures observability without UI friction.
5. In integration tests like `mock-anthropic-service/tests/scenario.rs`, you must replicate the entire mock environment explicitly (e.g. `DEEPSEEK_API_KEY` for the default internal model wrapper fallback) so CI tests won't flake across developers who haven't populated `.env`.

## Embedded HUD daemon (2026-11-01)

1. `vite.config.js` writes the HUD bundle to `rust/crates/onyx/static` and that directory is
   tracked, so `rust-embed` can point at `#[folder = "static"]` with no `build.rs` staging and
   no risk of a compile error in CI, where no JS toolchain runs before `cargo test`.
2. Enable the `debug-embed` feature, otherwise `rust-embed` reads from the filesystem relative
   to the *current working directory* in debug builds — unit tests then pass or fail depending
   on where `cargo test` was invoked from.
3. The workspace carries **axum 0.7 (`onyx`) and axum 0.8 (`api`) at the same time**. A
   handler from `api::router` cannot be mounted on an `onyx` router; share behaviour through
   plain statics (`DAILY_CRON_RUNS`, `EDGE_HEARTBEAT_INTERCEPTS`) instead of composing routers
   across the version boundary. Aligning both crates on 0.8 is a follow-up.
4. `tui/status_bar.rs` polls `/api/telemetry/summary` on the daemon port, a path only the edge
   worker served. When adding a poller, assert in a test that *some* server in the same
   topology answers the path, or the badge silently stays dark forever.
5. This authoring sandbox has no C toolchain (`cc`/`gcc`/`clang`/`ld` all missing, no `sudo`),
   so `libc`'s build script cannot link and `cargo clippy` / `cargo test` cannot run at all,
   even for `cargo check`. A downloaded Zig 0.17.0 used as `CC`/linker hangs in this container.
   `cargo fmt --check` and `cargo metadata` still work — use them as the local gate and let
   `rust-ci.yml` be the compiler of record. Say so explicitly in `AGENTS_VERIFICATION.md`
   instead of implying the Rust side compiled.
