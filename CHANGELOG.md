# Changelog

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
