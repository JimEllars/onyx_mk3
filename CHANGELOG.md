# Changelog

All notable changes to the Onyx Mk3 workspace. Newest first. Entries are
prepended; dates are the date the branch was verified, in America/Chicago.

## 2026-11-04 — Telemetry reaches a host that exists; CORS admits what the dashboard sends; signatures move to v2

Branch `fix/core-ingest-url-and-cors`, base `22591e2` (main).

Three defects, all found by auditing production rather than reading the code.

### 1. `CORE_INGEST_URL` pointed at a host that 302s to a 404 page

Defined three different ways and wrong three different times:

| Source | Said |
|---|---|
| `wrangler.jsonc` | `https://api.axim.us.com/telemetry` |
| `.dev.vars.example` | `https://api.axim.us.com/v1/functions/telemetry-ingest` |
| in-code fallback | `https://api.axim.us.com/v1/functions/telemetry-ingest` |

Every path on `api.axim.us.com` returns `302 -> /404.html`, so `drainIngestDlq`
re-queued forever. That is the mechanical reason the edge DLQ never empties and
why "submit before idle" has never happened.

The target is now the `telemetry-ingress` Supabase Edge Function, which is the
counterpart of `resolve-hitl` that `CORE_HITL_URL` already names. It verifies the
same signature contract this worker emits, accepts `Bearer ${AXIM_INTERNAL_KEY}`,
already lists `onyx_edge_worker` in `ALLOWED_APPS`, returns `202`, and defers
persistence to `EdgeRuntime.waitUntil` — non-blocking by design. All three
declarations now agree, and a new `DEFAULT_CORE_INGEST_URL` is the single source.

### 2. CORS rejected the dashboard's own GET requests

`Access-Control-Allow-Methods` was `"POST, OPTIONS"` while the HUD polls
`GET /health` and `GET /api/telemetry/summary` every 15 seconds. The browser
refused both at preflight, so the status bar could only ever render
`OFFLINE / RECONNECTING` regardless of actual worker health.

- `GET` (and `PUT`, `DELETE`) added to allowed methods.
- `X-Axim-Signature`, `X-Axim-Signature-Version`, `X-Axim-Timestamp`,
  `X-AXiM-Trace-ID` and `Idempotency-Key` added to allowed headers. Without them
  preflight strips the headers before the request is made, so a browser-side
  signed call was impossible.
- `Access-Control-Max-Age: 86400` and `Vary: Origin` added. The absent `Vary`
  meant a shared cache could serve one origin's response to another.
- `ALLOWED_ORIGIN` is now parsed as a comma-separated list. It was compared with
  strict equality against a single value, so every entry after the first was dead
  configuration and adding an origin meant editing code.

### 3. The telemetry signer emitted the legacy v1 signature

`telemetry-ingress` verifies v2 — `HMAC(secret, "<timestamp>.<body>")` with the
timestamp required and skew-checked at 300s — and retires the body-only form on
**2026-12-31** via `DEFAULT_LEGACY_SUNSET`. The worker was signing v1, so it would
have worked until that date and then failed silently.

The signer now emits `X-Axim-Signature-Version: 2`, `X-Axim-Timestamp`, and an
HMAC over `"<ts>.<body>"`. Two related changes:

- Removed the `"default_internal_key_fallback"` literal. An unconfigured deploy
  was signing with a public string; a missing secret now fails closed and logs
  `edge.telemetry.ingest_unsigned`.
- `resolveCronUrl` learned the Supabase path shape. It stripped
  `/v1/functions/telemetry-ingest` but not `/functions/v1/telemetry-ingress`, so
  after the URL move it produced `/functions/v1/api/v1/internal/cron/daily-run`.
  Caught by a test written before the change was trusted.

### Added

`test/ingest-and-cors.test.ts` (19 tests): the ingest default is asserted against
all three declarations, CORS is exercised through real preflight requests
(including a comma-separated list and a hostile origin), and the v2 signing shape
is pinned by source assertion so a revert to body-only signing fails here.

### Verified

`npx tsc --noEmit` → exit 0; `npx vitest run` → 13 files, **163 tests**. Not
verified: a live ingest round trip — `telemetry-ingress` is not deployed yet
(axim-core-v1.2#498 deploys it). The pairing that must match at runtime is
`AXIM_INTERNAL_KEY` on both sides; a mismatch presents as `401`.

## 2026-11-04 — `cargo clippy -D warnings` is clean, and CI enforces it

Branch `fix/onyx-clippy-strict-gate`, base `22591e2` (main, post-PR #306).

The runbook's baseline gate is `cargo clippy --workspace --all-targets -- -D warnings`.
It had not passed for some time, and nothing noticed: `rust-ci.yml` ran
`cargo clippy --workspace` with no `-D warnings`, so findings were printed into the log
and the job exited 0. Seventy-four had accumulated on `main`.

### Fixed

- **Three findings were in the provider retry path, not in test code.** Both `jitter_for_base`
  helpers (`api/src/providers/anthropic.rs`, `api/src/providers/openai_compat.rs`) called
  `Result::map(..).unwrap_or(0)` on every jittered retry; `MessageStop` usage recording in
  `anthropic.rs` nested an `if !self.usage_recorded` inside the match arm.
- **Clippy 1.99 renamed a lint out from under eight `#[allow]` attributes.**
  `unused_async` split into `unused_async` + `unused_async_trait_impl`, so the six
  `commands` action stubs and two `gemini` stubs went back to warning. Both names are now
  allowed, with a comment tying each to the stub it belongs to.
- **42 bare emptiness assertions now print the value on failure.**
  `assert!(x.is_empty())` → `assert!(x.is_empty(), "{x:?} should be empty")`. A boolean
  assertion tells you only that the check failed, which is the expensive half of debugging
  a CI-only failure.
- **6 `Duration`s in a smaller unit than they needed** (`from_secs(60 * 60)` →
  `from_hours(1)`), 10 `map(..).unwrap_or(..)`/`.ok().is_some_and(..)` collapses,
  3 `assert!(a == b)` → `assert_eq!(a, b)`, plus one each of `manual_let_else`,
  `assigning_clones`, `useless_format` and two trailing commas.

### Changed

- **`rust-ci.yml` clippy job is now a gate, not a log.**
  `cargo clippy --workspace` → `cargo clippy --workspace --all-targets -- -D warnings`.
  `--all-targets` matters: most of the assertion hits were in `#[cfg(test)]` blocks and
  test files, which the old invocation never linted.

### Verified

`cargo fmt --all -- --check` clean; `cargo clippy --workspace --all-targets -- -D warnings`
exit 0 (and `cargo clippy --workspace -- -D warnings`, the shape CI now runs, likewise);
edge-bridge `npm test` 144 passed, `npm run typecheck` clean; HUD `npm test` 49 passed.
`cargo test --workspace` is proved by `rust-ci.yml` on the PR — see the verification log for
why the sandbox could not link the `onyx` binary.

### Found while doing this, not fixed here

- **The embedded HUD bundle does not match `src/`.** A fresh `npx vite build` on this base
  emits `rust/crates/onyx/static/assets/index-Cz7yW5cY.js` (263 KB); the committed bundle is
  `index-CllMSb_c.js` (481 KB). Open item 5 of `WEB_APP_DEVELOPMENT_PLAN.md` is therefore
  live drift, not a theoretical risk.

## 2026-11-04 — Daily-run failures can no longer be silent; deploys are gated on `/health` being JSON

Branch `fix/cron-error-visibility-and-deploy-gate`, base `7f229c1` (main).

This branch came out of a live audit of production. Two findings drove it, and
neither was visible from the code alone.

### The audit, in short

- `onyx-edge.axim.us.com` was serving bundle `index-Cz7yW5cY.js` while `main`
  shipped `index-CllMSb_c.js`. Every API route — `/health`, `/api/v1/health`,
  `/api/v1/health/edge`, `/api/v1/telemetry/summary` — answered with the SPA's
  `index.html`. POST routes answered bare `405`. The router was correct in
  source (`src/index.ts:1376`); production was simply an older build.
- `CORE_INGEST_URL` is defined three different ways in this repo
  (`wrangler.jsonc` → `/telemetry`, `.dev.vars.example` →
  `/v1/functions/telemetry-ingest`, and the in-code fallback → the same), and all
  three point at a host that returns `302 → /404.html` on every path.

### Fixed

- **The daily run discarded its own result.** The dispatch ended in
  `.then((res) => void 0).catch((e) => void 0)`. A `302` to a 404 page is a
  *successful* fetch, so a dead `CORE_INGEST_URL` produced no log, no DLQ entry
  and no signal. The dispatch could fail every night indefinitely with nothing
  anywhere saying so. It now logs `edge.cron.daily_run_failed` with the status
  and URL, `edge.cron.daily_run_threw` with the error, and
  `edge.cron.daily_run_completed` on success.
- **The cron URL was derived by string replacement that silently no-opped.**
  `CORE_INGEST_URL.replace("/v1/functions/telemetry-ingest", "/api/v1/internal/cron/daily-run")`
  only works if the configured value contains that exact substring. Against a
  bare origin, or the `/telemetry` suffix `wrangler.jsonc` actually deploys, the
  replace did nothing and the cron POST went to the *ingest* path. Newly
  exported `resolveCronUrl()` re-roots on the origin after stripping any known terminal
  API path.
- **An unbound `CRON_SECRET_KEY` sent `Bearer undefined`.** `CRON_SECRET_KEY` is
  in neither `wrangler.jsonc` `vars` nor `.dev.vars.example`, so the header was
  almost certainly the literal string. It now logs
  `edge.cron.daily_run_unauthenticated` before dispatching.

### Added

- **`test/cron-dispatch-visibility.test.ts` (12 tests).** Seven exercise
  `resolveCronUrl` across every configuration shape seen in the repo. Five are
  source assertions that fail if the swallow or the fragile replace returns —
  what regressed here was the *shape* of a promise chain, which behaviour tests
  do not reliably catch.
- **A gated deploy job in `.github/workflows/edge-bridge-sync.yml`.** The
  workflow ran `typecheck`, `test` and `deploy:dry-run` and **never deployed**,
  which is the structural reason production could drift for as long as it did.
  The job is `main`-only, `push`-only, concurrency-limited to
  `edge-bridge-production`, and its last step asserts that `/health` returns
  `application/json` and not `<!DOCTYPE html>`. A deploy that leaves the router
  shadowed now fails the build.

### Verified

`npx tsc --noEmit` → exit 0; `npx vitest run` → 12 files, **144 tests**.
Not verified: the Worker was not deployed from this branch — no Cloudflare
credentials were available to the audit process. The deploy job is the mechanism
by which it should go out, and the `/health` assertion is what will prove it.

## 2026-11-03 — Pre-gate route registry, structured error logs, constant-time secret checks

Branch `fix/onyx-pregate-route-invariant`, base `0ce4e8e` (main, post-PR #303).

### Added

- **`edge-bridge/src/preGateRoutes.ts`.** Every route the worker answers before the global
  HMAC gate is now listed with its auth mode, the evidence that auth leaves in its handler,
  and why it is safe: 17 routes plus the one gate exemption (`/api/v1/webhooks`). Also adds
  `classifyPreGateRoute(method, pathname)` — longest-prefix, method-aware — as the seam for
  the router refactor that would remove the positional-ordering hazard entirely.
- **`edge-bridge/test/pre-gate-routes.test.ts` (13 tests).** Parses `src/index.ts` and fails
  when a route above the gate is unregistered, when a registered route no longer exists, or
  when a declared auth call (`checkAuth`, `verifyHmacSignature`, …) has been removed from
  its handler. Both failure modes were demonstrated before being trusted.
- **`edge-bridge/src/logging.ts`.** `logError(event, error, context)` and
  `logRequest(event, context)`: one JSON line per record, `edge.<subsystem>.<what_happened>`
  event names, `Error` normalised to `{message, error_name}`, and a non-throwing fallback for
  context that cannot serialise.
- **`edge-bridge/test/logging.test.ts` (11 tests)** and
  **`edge-bridge/test/webhook-signature.test.ts` (16 tests)**.

### Fixed

- **`fetch()` logged an error on every successful request.** The bare `console.error("error")`
  at the end of the happy path meant normal traffic filled the error stream. It is now an
  `edge.request.completed` info record with method, path, status, duration and trace id.
  (`edge-bridge/src/index.ts:1285`)
- **All 34 `console.error` call sites are labelled.** 21 were bare `console.error("error")`;
  the other 13 carried ad-hoc messages. `console.error` no longer appears in `index.ts` at
  all — everything goes through `logError` with a trace id where one is in scope. Two sites
  were not errors at all (the 405 branch and idempotent replay) and are now info-level.
  Closes standing defect 4.
- **Three secret comparisons were not constant time.** The GitHub and WordPress webhook
  handlers computed their own HMAC and compared hex with `!==` (42 lines each path), and the
  emergency-direct bearer did the same. Now `verifyHexHmacSignature()` (`crypto.subtle.verify`,
  optional `sha256=` prefix, hex validated, fails closed without throwing) and
  `equalSecrets()` for the bearer.
- **The embedded HUD bundle was stale.** `rust/crates/onyx/static/assets/index-2CSI7Ry0.js`
  still carried `react-dom` 19.2.8 after #298 moved the HUD to 19.3.1, so `onyx daemon`
  served the pre-bump runtime from the binary. Regenerated (`index-CllMSb_c.js`).

### Verified

`cd edge-bridge && npx tsc --noEmit` → exit 0; `npx vitest run` → 11 files, **132 tests**
passed (was 8 / 93); `wrangler deploy --dry-run` → exit 0. Root HUD suite unchanged: 7 files,
49 tests. Two negative controls (an unregistered pre-gate route; a deleted `checkAuth` on
`/api/v1/telemetry/flush`) both fail the new test with the reason spelled out.

### Not verified

No Rust was compiled here (`cargo` is unavailable in this sandbox; see `LEARNINGS.md` §11).
No Rust *source* changed, but `rust/crates/onyx/static` did and `daemon.rs` asserts
`index.html` is embedded, so `rust-ci.yml` is the compiler of record for this branch. The
constant-time claim is structural: the tests pin that a right secret passes and a wrong one
is refused, not that a timing side channel is gone.

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
