# Changelog

All notable changes to the Onyx Mk3 workspace. Newest first. Entries are
prepended; dates are the date the branch was verified, in America/Chicago.

## 2026-11-02 (later) — Grouped Dependabot updates

Branch `chore/dependabot-grouped-updates`, base `1fdddef` (post-PR #295).

### Added

- **`.github/dependabot.yml`.** The repo had none, so Dependabot produced one PR per
  advisory: #262, #263, #274 and #285 all landed against the root lockfile, three of them
  patching the same tree, while ~29 advisories never produced a PR. Patch/minor updates are
  now grouped weekly per ecosystem (root HUD, edge-bridge, rust) and grouped monthly for
  GitHub Actions.
- **Majors are never grouped**, and `tailwindcss` is excluded from the HUD group. #263 was a
  Tailwind 3 → 4 migration wearing a dependency bump's clothes: it dropped the v3 plugin
  chain from the lockfile and failed `Workers Builds`.

### Verified

YAML parses (PyYAML 6.0.3); 4 entries; every interval and commit prefix present; `time`
quoted so it is not read as sexagesimal.

### Not verified

**No automated gate.** `.github/dependabot.yml` is in no workflow's `paths:` filter, so this
PR runs GitGuardian and the worker build only, neither of which reads it. Schema acceptance
is proven by Dependabot itself on the next Monday run; a bad key surfaces under
Insights → Dependency graph → Dependabot.

## 2026-11-02 — Daily briefing: dead HITL buttons and unescaped ticket text

Branch `fix/onyx-hitl-digest-links`, base `69ee55e` (main, post-PR #294/#274/#285).

### Fixed

- **Every Approve/Reject button in the daily briefing was dead.** Phase B (#289) moved HITL
  decisions from `GET /api/v1/hitl/action?decision=…` to an authenticated
  `POST /api/v1/hitl/action`, but the digest email was never updated, so its primary call to
  action answered **405** — and only after the operator had committed to the decision. The
  email now carries no decision at all: each ticket links to the read-only ticket view and to
  the cockpit, where the decision is POSTed with an operator credential. Re-adding a
  one-click link would re-open the hole Phase B closed, because mail scanners, link
  previewers and browser prefetch all fire GET.
- **A ticket description could inject markup into the briefing.** `description` came from a
  tool proposal and was interpolated into the email HTML unescaped, so it could carry links
  and markup into a message that arrives from a trusted internal sender. Now escaped, along
  with the token (`encodeURIComponent`) and both hrefs.
- **A malformed ticket was silently dropped** by `catch (e) {}`, under-reporting the queue.
  It now logs `hitl_ticket_unparseable` with the token and continues.
- **`scheduled()` logged `console.error("error")` on every tick**, including the five-minute
  one — a permanent error-rate signal for any alerting on the worker. Removed.

### Verified

`edge-bridge` 8 files / **93 tests** (13 new in `test/hitl-digest.test.ts`) ·
`npm run build` (typegen + `tsc --noEmit`) clean, generated types byte-identical ·
`wrangler deploy --dry-run` clean (117.44 KiB / 21.49 KiB gzip). Each dimension was reverted
individually to prove the tests fail first: restoring the `?decision=` links fails 3 tests,
restoring the unescaped interpolation fails 3 tests.

### Not verified

The email was not delivered — `fetch` to the email provider is stubbed and the assertion is
on the request body. Rendering in a real mail client is unverified. Nothing was deployed.

## 2026-11-01 — Embedded HUD daemon (Web App Phase 4, PR #294)

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


All notable changes to the Onyx Mk3 workspace. Newest first. Dates are the date the
branch was verified, in America/Chicago.

## 2026-11-01 (later) — Daily cron restored, retention cutoffs un-mixed

Branch `feat/onyx-fleet-health-rollup`, base `237bce7` (PR #292, stacked).

### Fixed

- **The daily scheduled job never ran.** The handler tested `controller.cron ===
  "0 12 * * *"` while `wrangler.jsonc` deploys `0 0 * * *` and `*/5 * * * *`, so the digest
  email and the retention pass were dead code. It now matches a set of daily crons
  (`isDailyCron`), so the job runs on the deployed schedule and survives a schedule move.
- **The retention cutoff compared epoch seconds against a millisecond column.**
  `onyx_telemetry_logs.created_at` is written with `Date.now()`; the cutoff was
  `Date.now()/1000 - 30d`, which is older than every row ever written. Each cutoff is now
  bound in the unit its own column uses (`telemetryCutoffMs`, `secondsCutoff`).
- **The retention batch ran on every five-minute tick**, because it sat outside the daily
  branch. Together with the unit bug this emptied `onyx_telemetry_logs` — the table the DLQ
  drain replays from and the source of `unsynced_receipts_depth` — every five minutes in
  production. It now runs once a day.

### Verified

`edge-bridge` 7 files / 80 tests (9 new in `test/cron-retention.test.ts`) · `npm run build`
(typegen + `tsc --noEmit`) clean · `wrangler deploy --dry-run` clean (116.42 KiB / 20.82 →
21.09 KiB gzip) · `cargo fmt` clean. Each dimension was reverted individually to prove the
tests fail first.

### Operator decision needed

The digest now sends at **00:00 UTC**, because that is the deployed trigger. If midday was
intended, change `wrangler.jsonc:85` to `0 12 * * *` — the handler accepts both.


## 2026-11-01 — HUD connection hardening, live DLQ telemetry, RCA inspector, personas, HITL relay

Branch `feat/onyx-hud-phase1-connection-hardening`, base `17dbe89`.

### Fixed

- **HUD auth gate threw instead of denying.** `useAximAuth.hasSuperAdminRole` read a
  claim Passport never issues (`app_metadata.SUPER_ADMIN_ROLES`) and referenced an
  undeclared `role`, so any real token raised `TypeError`/`ReferenceError` inside the
  auth effect and a valid super-admin never got past the login wall. Role parsing now
  lives in `src/lib/roles.js`, a mirror of `edge-bridge/src/passport.ts`, and the check
  is wrapped so a malformed token denies.
- **HITL decisions went to the wrong endpoint and lost their outcome.** The console
  POSTed to `/api/v1/mcp/execute` and treated `response.ok` as success; it now posts to
  the canonical `/api/v1/hitl/action`, and distinguishes `APPROVED`/`REJECTED` from
  `RECORDED · CORE UNREACHABLE` (edge `502` = recorded in `HITL_APPROVAL_KV`, not
  applied). Tickets are no longer retired on a non-confirmed outcome.
- **A classified chat failure was overwritten by the generic stream error.** 429/401/403
  and exhausted-failover messages survived only until the `catch` block replaced them
  with "Stream failed…", telling operators to await a reconnect that could not succeed.
- **Summon retry used a flat 2 s delay**, now 1s→2s→4s with 30 s clamp and jitter via
  the shared `nextRetryDelay` helper.

### Added

- `useDlqStatus` polls `GET /api/v1/telemetry/dlq-status` (authenticated) and reports
  `loading | live | stale | offline`; the Action Console shows real unsynced relays +
  receipts, Core reachability and breaker state instead of numbers derived from the local
  event buffer.
- `RcaInspector` drawer: structured RCA JSON for micro-app 5xx events, raw-event toggle,
  copy, graceful fallback when no RCA block was shipped.
- Domain-context personas (`axim-core`, `robotics-lab`, `speedreport-network`,
  `axim-academy`) end to end: switcher in `ChatInterface`, `domain_context` on every
  summon, and an allow-listed `DOMAIN_CONTEXT_PREAMBLES` in the edge bridge that the
  provider fallback actually applies. Lookup is `hasOwnProperty`-guarded.
- JavaScript test harness: `vitest` + `jsdom` + `@testing-library/react`, with 49 tests
  across 7 files (`npm test` at the repo root).
- `edge-bridge/test/domain-context.test.ts`: 9 tests, including the persona travelling
  down the DeepSeek fallback path and prototype-key rejection.

### Verified

`cargo fmt --all -- --check` clean · root `vitest` 49/49 · `edge-bridge` 71/71 ·
`edge-bridge npm run build` (typegen + `tsc --noEmit`) clean · `wrangler deploy
--dry-run` clean · `vite build` clean.

**Not verified in this environment:** the Rust workspace was not compiled — the sandbox
has no C toolchain or glibc headers (``error: linker `cc` not found``). No Rust source was
modified on this branch. Full detail, including the four workarounds that were tried, is
in `AGENTS_VERIFICATION.d/2026-11-01-hud-telemetry-personas.md`.
