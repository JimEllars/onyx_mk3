# Verification Log — Web App Phase 4: Embedded HUD Daemon (2026-11-01)

**Branch:** `feat/onyx-daemon-embedded-hud`
**Base:** `17dbe89` (main, post-PR #291); rebased onto `97630c3` (post-PR #292/#293) at merge
**Scope:** `rust/crates/onyx` (+ rebuilt `rust/crates/onyx/static` bundle). `edge-bridge/`
and `src/` untouched.

## What was implemented

| File | Lines | Change |
| --- | --- | --- |
| `rust/crates/onyx/src/daemon.rs` | new, 563 | axum daemon on `127.0.0.1:3141`: embedded HUD via `rust-embed`, `/api/v1/health`, `/api/telemetry/summary`, `/metrics`, SPA fallback, deny-list middleware, security headers, option parsing, 12 unit tests |
| `rust/crates/onyx/src/main.rs` | +87 | `mod daemon`, `use crate::daemon::run_daemon`, `CliAction::Daemon { host, port }`, `--daemon` / `--port` / `--host` flags, `onyx daemon` subcommand, help text, 3 parsing tests |
| `rust/crates/onyx/Cargo.toml` | +4 | `rust-embed = { version = "8.7.2", features = ["debug-embed"] }` |
| `rust/Cargo.lock` | +43 | lockfile entries for `rust-embed`, `rust-embed-impl`, `rust-embed-utils` (purely additive; no version churn) |
| `rust/crates/onyx/static/**` | 0 | rebuild verified but not committed — PR #292 regenerates this directory (`index-2CSI7Ry0.js`); a second fingerprint would only create a delete/add conflict |

## Defect found and fixed while auditing

`rust/crates/onyx/src/tui/status_bar.rs:20-45` polls
`http://127.0.0.1:{port}/api/telemetry/summary` and only turns the edge/cron badges on when
that JSON reports `edge_heartbeat_intercepts > 0` / `daily_cron_runs > 0`. The only server
that ever answered that path was `edge-bridge/src/index.ts:3358`, so a stand-alone Onyx
(the REPL passing `3141` into `spawn_telemetry_polling_loop`) polled a dead port forever.
The daemon now serves the same payload from the in-process counters
(`telemetry::metrics::EDGE_HEARTBEAT_INTERCEPTS`, `api::router::DAILY_CRON_RUNS`), so TUI,
HUD and edge agree.

## Executed in the authoring sandbox

```
$ cd rust && cargo fmt --all -- --check
FMT_EXIT=0

$ cd rust && cargo metadata --format-version 1   # manifest + lockfile resolution
exit=0

$ python3 .github/scripts/check_doc_source_of_truth.py
doc source-of-truth check passed

$ cd edge-bridge && npm test
 Test Files  5 passed (5)
      Tests  62 passed (62)

$ cd edge-bridge && npm run typecheck
TYPECHECK_EXIT=0

$ cd edge-bridge && npm run deploy:dry-run
DRYRUN_EXIT=0

$ npx vite build
VITE_EXIT=0
```

The build wrote `rust/crates/onyx/static/assets/index-D2_eJtD8.js` + a new `index.html`. Those
artifacts were reverted from this branch on purpose: PR #292 rebuilds the same directory from
its own `src/` changes, and two competing fingerprints would conflict on delete/add. The
`embeds_the_built_hud` test asserts the embedded `index.html` exists, not a specific hash.

## CI as the compiler of record — two failures caught and fixed

`rust-ci.yml` on PR #294 failed twice before going green; both are worth recording because they
are the kind of defect a sandbox without `cargo` cannot see:

1. `error[E0277]: the trait bound fn(State<Arc<DaemonState>>) -> _ {daemon_health}: Handler<_, _>
   is not satisfied` for all four handlers. axum 0.7 implements `Handler` only for `fn`s that
   return a `Future`; a plain sync `fn() -> Response` is not a handler. Handlers are now
   `async fn` wrappers around sync `*_body()`/`serve_path()` helpers, so the testable logic stays
   synchronous and no `#[tokio::test]` feature is needed.
2. `mock-anthropic-service/tests/scenario.rs:102 assertion failed: resp.is_ok()` — the integration
   harness runs `onyx serve-headless --port <port>`, and my first cut swallowed `--port` at any
   position, breaking the subcommand: `error: --port/--host only apply to the daemon`. `--port` /
   `--host` / `--daemon` are now only captured while `rest.is_empty()` (global position), with a
   regression test.

## Not verified locally — read before merging

`cargo clippy` and `cargo test` **cannot run in this sandbox**: there is no C toolchain, so
even build scripts fail to link.

```
$ cd rust && cargo clippy --workspace --all-targets -- -D warnings
   Compiling libc v0.2.183
   Compiling cc v1.2.58
error: linker `cc` not found
  |
  = note: No such file or directory (os error 2)
CLIPPY_EXIT=101

$ cd rust && cargo test --workspace
error: could not compile `libc` (build script) due to 1 previous error
TEST_EXIT=101
```

`cc`, `gcc`, `clang`, `ld` are all absent and there is no `sudo`/`apt-get` write access. A
downloaded Zig 0.17.0 toolchain (`zig cc` as `CC`/`-C linker`) was tried as a substitute and
hangs in this container even on a `hello world` translation unit, so it was abandoned.

**Consequence:** the Rust changes on this branch are reviewed by reading plus `cargo fmt`
(which parses and type-agnostically formats the new module), and must be proven by
`.github/workflows/rust-ci.yml` — `cargo fmt`, `cargo clippy --workspace`,
`cargo test --workspace`, `cargo test --test '*' --features integration` — before any merge.
The 15 new tests are written to fail loudly rather than silently pass if the embedded bundle
or deny list regresses (`embeds_the_built_hud`, `rejects_cgi_argument_injection`).
