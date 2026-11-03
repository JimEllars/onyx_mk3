# AXiM Onyx Mk3 Web App - Continued Development Plan

Status as of 2026-11-03 (post-merge of #295-#303). Each item records where it stands and
which file proves it, because "planned" and "shipped" kept being confused.

**Merged to `main` this cycle (PRs #288-#294).**

| PR | What landed | Proof |
|---|---|---|
| #288 | Phase A edge containment: no secret reflection, mock session mint deleted, telemetry authenticated | `edge-bridge/test/phase-a-hardening.test.ts` |
| #289 | Phase B operator auth, HITL relay to Core, decode-aware deny list | `edge-bridge/test/phase-b-hardening.test.ts` |
| #290 | Canonical `super_admin`, legacy spellings reported | `src/lib/__tests__/roles.test.js` |
| #291 | Versioned HMAC signatures with a dual-accept window | `edge-bridge/test/signature-window.test.ts` |
| #292 | **Phases 1-3**: backoff, 3-state connection badge, live DLQ polling, RCA inspector, domain personas, canonical HITL relay | `src/lib/__tests__/*`, `src/components/hud/__tests__/*`, `edge-bridge/test/domain-context.test.ts` |
| #293 | Daily cron actually runs; retention cutoffs bound in the column's own unit | `edge-bridge/test/cron-retention.test.ts` |
| #294 | **Phase 4**: `onyx daemon` serves the compiled HUD from the binary on `127.0.0.1:3141` | `rust/crates/onyx/src/daemon.rs` |

All four plan phases are now on `main`. Remaining work is tracked in "Next candidates"
below, not in the phase list.

**Housekeeping for the operator:** `feat/onyx-hud-phase2-3-telemetry-personas` (commit
`b10bec1`) is superseded by #292 and should be deleted rather than merged. The four
Dependabot PRs (#262, #263, #274, #285) each touch one package; they are handled by the
grouped `dependabot.yml` added in this cycle.

## Current State Review
The Onyx Mk3 Web App currently features a React/Vite-based frontend, serving as a Headless UI wrapper for the core Onyx Rust engine.
1. **Architecture & Styling**: The application is structured with a central `App.jsx` orchestrating the main layout. It uses a modern dark-themed aesthetic powered by Tailwind CSS. The layout includes:
   - `SystemSidebar`: Provides navigation and system status indicators.
   - `ChatInterface`: The primary conversational UI for interacting with Onyx.
   - `ActionConsole`: Rendered conditionally upon authentication to provide deeper system controls.
2. **Authentication**: Handled via a custom `useAximAuth` hook which currently gates access to the `ActionConsole`.
3. **State Management**: Zustand is utilized (e.g., `useDesktopAgentStore.js`) for managing local UI and agent connection states without unnecessary prop drilling.
4. **Agent Connection**: `useAgentConnection.js` handles WebSocket or SSE streaming with the Onyx Edge Bridge (`/api/v1/chat`).
5. **Tests**: `npm test` at the repo root runs the HUD suite (vitest + jsdom + Testing Library). Before 2026-11-01 the frontend had no test runner at all.

## Phased Development Plan

### Phase 1: Robust Connection & Error Handling (Weeks 1-2) — DONE
- **Objective**: Harden the connection between the frontend and the Onyx Edge Bridge.
- **Tasks**:
  - [x] Exponential backoff for reconnections. SSE stream in `useAgentConnection.js`; summon retries in `ChatInterface.jsx`; both via `src/lib/backoff.js` (1s → 30s, clamped, jittered).
  - [x] Global error boundary — `src/components/ErrorBoundary.jsx`, wrapping the app in `main.jsx` and each panel inline in `App.jsx`.
  - [x] Three-state connection badge in `SystemSidebar.jsx` (`ONLINE` / `RECONNECTING` / `OFFLINE`), plus `RECONNECT NEEDED` for the voice trunk.
  - [x] Classified failures no longer overwritten by the generic "Stream failed…" message (`ChatInterface.jsx`).
  - [x] Auth gate fixed: role parsing mirrors `edge-bridge/src/passport.ts` (`src/lib/roles.js`); it no longer throws on real tokens.

### Phase 2: Action Console Expansion & Telemetry (Weeks 2-3) — DONE
- **Objective**: Bring full DevSecOps monitoring capabilities into the `ActionConsole`.
- **Tasks**:
  - [x] Live telemetry polling: `src/hooks/useDlqStatus.js` → `GET /api/v1/telemetry/dlq-status`, rendered as Unsynced / Core Sync / DLQ Feed with `loading|live|stale|offline`.
  - [x] Interactive RCA JSON inspector drawer for micro-app 5xx (`src/components/hud/RcaInspector.jsx`).
  - [x] Playbook trigger UI (`PlaybookTrigger.jsx`) → `POST /api/v1/playbook/trigger`.
  - [ ] Fleet-wide worker health from `GET /api/v1/telemetry` (the current edge exposes `health`, `summary` and `dlq-status`; a per-worker rollup is not an endpoint yet, so the console shows DLQ depth and Core reachability instead of inventing a number).

### Phase 3: Identity & Multi-Persona Context Support (Weeks 3-4) — DONE
- **Objective**: Support dynamic context switching between domain contexts.
- **Tasks**:
  - [x] `useAximAuth.js` parses and stores canonical roles (`super_admin` + legacy spellings reported).
  - [x] Context switcher in `ChatInterface` (`src/components/hud/DomainContextSwitcher.jsx`) sending `domain_context` on every summon.
  - [x] Persona preambles applied server-side in `edge-bridge/src/index.ts` (`DOMAIN_CONTEXT_PREAMBLES`, allow-listed) — the fallback provider path honours them.
  - [x] HITL review UI with Approve/Reject against the canonical `POST /api/v1/hitl/action`, distinguishing applied from recorded-but-unapplied.

### Phase 4: Embedded Daemon (`--daemon`, port 3141, `rust-embed`) — DONE (PR #294)
- **Objective**: Serve the built React bundle from the Rust binary.
- **Current state**: `rust/crates/onyx/src/main.rs` already has `serve-headless` (axum 0.7, default port 4711) with `ServeDir::new("static")` as the fallback service, and `vite build` emits into `rust/crates/onyx/static`. So the serving path exists but depends on the process CWD and is not reachable as `--daemon` on 3141.
- **Remaining work**:
  - [x] `--daemon` flag / `daemon` subcommand defaulting to port 3141 (`rust/crates/onyx/src/main.rs`, `CliAction::Daemon`).
  - [x] `rust-embed` replaces `ServeDir` so the binary is self-contained (`debug-embed` on, so debug builds embed too).
  - [x] Unit tests for the embedded index, the SPA fallback, the deny list and missing-asset 404 (`daemon.rs`, 15 tests).
- **How it was proven**: the authoring sandbox has no C toolchain, so `rust-ci.yml` was the compiler of record — `cargo fmt`, `cargo clippy --workspace`, `cargo test --workspace` and `cargo test --test '*' --features integration` all green on the PR before merge.

### Phase 4b: Decentralized Billing & Web3 Integration Polish (Weeks 4-5) — NOT STARTED
- **Objective**: Finalize the Web3 capabilities and fallback billing in the UI.
- **Tasks**:
  - [ ] Refine `Web3ConnectButton.jsx` and place it in settings.
  - [ ] Wallet connections passively sync telemetry to AXiM Core via the Edge Bridge.
  - [ ] Unified transaction ledger view in the `ActionConsole`.

## Standing defects

### Fixed on 2026-11-03 (`fix/onyx-pregate-route-invariant`)

1. **The pre-gate route surface is now enumerated and guarded.** `edge-bridge/src/preGateRoutes.ts`
   lists all 17 route literals declared above the global HMAC gate plus the one gate
   exemption (`/api/v1/webhooks`), each with the mechanism that authenticates it, the
   evidence that mechanism leaves in its handler, and why. `test/pre-gate-routes.test.ts`
   parses `index.ts` and fails when a route above the gate is unregistered, when a registry
   entry no longer exists, or when a declared auth call has been removed from its handler.
   Both failure modes were demonstrated against a deliberately broken tree. The route-table
   refactor itself is still open — see "Still open" 4.
2. **Error logging is labelled and uniform.** All 34 `console.error` call sites in
   `edge-bridge/src/index.ts` now go through `logError(event, error, context)`
   (`src/logging.ts`), with an `edge.<subsystem>.<what_happened>` vocabulary and a
   `trace_id` wherever one is in scope. Two of them were not errors at all — the 405 branch
   and the idempotent-replay branch — and are now info-level. `console.error` no longer
   appears in the file; `test/logging.test.ts` asserts that.
3. **`fetch()` logged an error on every successful request.** The `console.error("error")`
   at the end of the happy path meant normal traffic filled the error stream, which is
   exactly how a real failure gets overlooked. It is now an `edge.request.completed` info
   record carrying method, path, status, duration and trace id.
4. **Three secret comparisons were not constant time.** The GitHub and WordPress webhook
   handlers signed the body themselves and compared hex with `!==`; the emergency-direct
   bearer did the same. All three now verify in constant time
   (`verifyHexHmacSignature()` via `crypto.subtle.verify`, and `equalSecrets()` for the
   bearer), pinned by `test/webhook-signature.test.ts`.
5. **The embedded HUD bundle was stale.** `rust/crates/onyx/static/assets/index-2CSI7Ry0.js`
   still carried `react-dom` 19.2.8 after #298 bumped the HUD to 19.3.1, so `onyx daemon`
   served the pre-bump runtime from the binary. Regenerated and committed.

### Fixed on 2026-11-02 (`fix/onyx-hitl-digest-links`)

1. **The daily briefing's Approve/Reject buttons were dead.** Phase B moved HITL decisions to
   an authenticated `POST`, and the email kept emitting `?decision=approve|reject` GET links,
   which now answer 405. The email carries no decision at all: it links to the read-only
   ticket view and the cockpit, where the decision is POSTed with an operator credential.
   Pinned by `test/hitl-digest.test.ts` (link liveness asserted against the real handler).
2. **A ticket description could inject markup into the briefing email.** Now escaped.
3. **`scheduled()` logged `console.error("error")` on every tick.** Removed.

### Fixed on 2026-11-01 (`feat/onyx-fleet-health-rollup`)

1. **Daily cron never ran.** `scheduled()` tested `controller.cron === "0 12 * * *"` while
   `wrangler.jsonc` deploys `0 0 * * *` and `*/5 * * * *` — digest email and retention were
   dead code. Now matched through `isDailyCron()`.
2. **Retention deleted the whole telemetry table.** The cutoff was epoch seconds against
   `onyx_telemetry_logs.created_at`, which holds milliseconds, and the batch ran on every
   five-minute tick rather than daily. Fixed in units and cadence; `test/cron-retention.test.ts`
   pins both.

### Still open

1. **`clippy::assert_is_empty` (5 hits) in `rust/crates/plugins/src/lib.rs:2519,2520,2538,2540,2541.**
   New in clippy 1.99. CI runs `cargo clippy --workspace` without `-D warnings`, so CI stays
   green, but the stricter `-D warnings` gate in our runbook fails. Needs a compiled
   environment; clippy's suggestion is `assert_eq!(manifest.tools, [] as [PluginToolManifest; 0])`.
2. **`onyx_command_audit_logs` has no writer.** One reference exists in the whole worker — the
   `DELETE` in the retention batch. Do not build a fleet-health or audit panel over it: it
   will read zeros forever. Either add the writer or drop the table.
3. **Digest send time.** The daily job now runs at 00:00 UTC because that is the deployed
   trigger. If midday was intended, change `edge-bridge/wrangler.jsonc:85` to `0 12 * * *`.
4. **The global HMAC gate still sits mid-chain** in `_fetch`. The routes above it are now
   registered and guarded (fixed 2026-11-03), so a fourteenth cannot land silently, but the
   positional ordering that makes the guard necessary is unchanged: each pre-gate route
   still relies on its own hand-written auth. The seam for the real fix is
   `classifyPreGateRoute(method, pathname)` in `src/preGateRoutes.ts` — the gate should
   consult it instead of the declaration order. That is a router change, not a checklist
   change, and it needs its own PR and a full edge-bridge run.
5. **Nothing regenerates `rust/crates/onyx/static` in CI.** `web-ci.yml` runs `vite build`
   and throws the output away, and `rust-ci.yml` embeds whatever is committed, so the
   bundled HUD can drift from `src/` until someone notices (it did, by one React bump —
   fixed 2026-11-03). Either commit the build output as part of every HUD change (a check
   that fails when `vite build` produces a different hash would do it) or build the bundle
   before `cargo build` in `rust-ci.yml`. Until then, treat `onyx daemon`'s HUD as a
   snapshot, not as the current UI.
6. **Tailwind 4 migration.** PR #263 proposed jumping `tailwindcss` 3.4 → 4.3; it was closed
   because Tailwind 4 drops the v3 config model this repo uses and the worker build failed on
   it. Needs a dedicated PR with a visual check of the HUD.
7. **~29 dependency advisories have no Dependabot PR**: `undici` and `sharp` in
   `edge-bridge/package-lock.json`, and `rustls`, `rustls-webpki`, `quinn-proto`, `protobuf`,
   `rand`, `lru` in `rust/Cargo.lock`. The node ones are transitive under
   `wrangler`/`miniflare`. The Rust ones need `cargo update` in an environment with a C
   toolchain, or a hand-edited `Cargo.lock` proven by `rust-ci.yml` on a PR.
8. **Tailwind/`@tailwindcss/postcss` version skew** (new, noticed 2026-11-03): root
   `package.json` pins `tailwindcss` ^3.4.19 (the v3 build `postcss.config.js` drives) while
   also depending on `@tailwindcss/postcss` ^4.3.3, which is the v4 plugin this repo does not
   use. The build is green because only the v3 path is wired up, but the v4 plugin is a
   migration half-installed. Resolve together with item 6 — either migrate to 4 and delete
   the v3 config, or drop `@tailwindcss/postcss`.
