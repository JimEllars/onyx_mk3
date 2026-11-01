# Changelog

All notable changes to the Onyx Mk3 workspace. Entries are prepended, newest first.

## 2026-11-01 — `feat/onyx-daemon-embedded-hud`

### Added
- **Embedded HUD daemon (Web App Phase 4).** `onyx daemon` and `onyx --daemon` start an
  axum listener on `127.0.0.1:3141` that serves the compiled React HUD straight out of the
  binary via `rust-embed`, plus a read-only JSON surface:
  - `GET /api/v1/health` — daemon identity, bind address, uptime, embedded asset count.
  - `GET /api/telemetry/summary` — the same counters the TUI status bar polls.
  - `GET /metrics` — Prometheus text exposition from `telemetry::metrics`.
  - SPA fallback: any unknown non-`/api/` path returns `index.html`, so a refresh on a
    client-side route still renders the HUD; unknown `/api/` paths stay `404`.
- `--host` / `--port` bind options, validated and rejected when supplied without `--daemon`.
- Deny-list middleware on the daemon port: directory traversal and CGI argument injection
  (`..`, `%2e%2e`, `?-d`, `auto_prepend_file`, `auto_append_file`, `allow_url_include`,
  `disable_functions`, `safe_mode`, `php://input`, `.php`, `/wp-admin`) now return `403` on
  the loopback daemon too, matching the edge worker perimeter. Hostile targets are echoed to
  the log with control characters stripped.
- Response security headers on every daemon response: strict CSP with `frame-ancestors
  'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`.
- Immutable caching for fingerprinted `/assets/*` bundles, `no-cache` for the HTML entrypoint.
- 12 unit tests in `rust/crates/onyx/src/daemon.rs` (deny list, traversal/injection payloads,
  percent decoding, content types, SPA fallback, `/api/` 404, embedded bundle, option parsing)
  and 3 CLI parsing tests in `main.rs`.

### Fixed
- **`serve-headless --port N` regression guard.** `--port`/`--host` are only captured as daemon
  options in the global position (before any subcommand), so `onyx serve-headless --port 4711`
  keeps parsing its own flag. Regression test:
  `parses_serve_headless_port_without_stealing_it_for_the_daemon`.
- **TUI telemetry badges never lit locally.** `tui/status_bar.rs` polls
  `http://127.0.0.1:3141/api/telemetry/summary`, but only the Cloudflare worker served that
  path; a stand-alone Onyx had nothing listening. The daemon now serves it from the same
  process-wide counters (`EDGE_HEARTBEAT_INTERCEPTS`, `DAILY_CRON_RUNS`), so the TUI, the
  HUD and the edge report the same numbers.
- Rebuild of the tracked HUD bundle was verified (`npx vite build` exit 0, emits
  `index-D2_eJtD8.js` from current `src/`) but deliberately **not** committed here: PR #292
  regenerates the same directory from its own `src/` changes (`index-2CSI7Ry0.js`), and
  committing a second fingerprint would only create a delete/add conflict on
  `rust/crates/onyx/static/assets`. The stale-bundle drift is tracked as a follow-up.

### Verification
- `cargo fmt --all -- --check` — clean locally.
- `edge-bridge`: `npm test` 62/62 pass, `npm run typecheck` exit 0, `npm run deploy:dry-run`
  exit 0.
- Frontend: `npx vite build` exit 0.
- `cargo clippy` / `cargo test` could **not** run in the authoring sandbox (no C linker —
  `error: linker cc not found`). They run on CI via `.github/workflows/rust-ci.yml`; see
  `AGENTS_VERIFICATION.md` for the exact evidence and the CI gate on this branch.
