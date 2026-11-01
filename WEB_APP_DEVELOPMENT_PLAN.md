# AXiM Onyx Mk3 Web App - Continued Development Plan

Status as of 2026-11-01 (branch `feat/onyx-hud-phase1-connection-hardening`).
Each item now records where it stands and which file proves it, because "planned" and
"shipped" kept being confused.

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

### Phase 4: Embedded Daemon (`--daemon`, port 3141, `rust-embed`) — DEFERRED, see below
- **Objective**: Serve the built React bundle from the Rust binary.
- **Current state**: `rust/crates/onyx/src/main.rs` already has `serve-headless` (axum 0.7, default port 4711) with `ServeDir::new("static")` as the fallback service, and `vite build` emits into `rust/crates/onyx/static`. So the serving path exists but depends on the process CWD and is not reachable as `--daemon` on 3141.
- **Remaining work**:
  - [ ] `--daemon` flag / `daemon` subcommand defaulting to port 3141 (`parse_args` around `serve-headless`, main.rs:1113).
  - [ ] Replace `ServeDir` with `rust-embed` so the binary is self-contained (new dependency → `Cargo.lock` change).
  - [ ] A unit test that the embedded index is served and a missing asset 404s.
- **Why deferred**: the 2026-11-01 session had no Rust toolchain (no C compiler, no glibc headers), so this could not be compiled or tested. Shipping uncompiled Rust in a 11,000-line `main.rs` is not acceptable; it needs a session with `cargo`.

### Phase 4b: Decentralized Billing & Web3 Integration Polish (Weeks 4-5) — NOT STARTED
- **Objective**: Finalize the Web3 capabilities and fallback billing in the UI.
- **Tasks**:
  - [ ] Refine `Web3ConnectButton.jsx` and place it in settings.
  - [ ] Wallet connections passively sync telemetry to AXiM Core via the Edge Bridge.
  - [ ] Unified transaction ledger view in the `ActionConsole`.

## Standing defects

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
4. **Duplicate PR #284** — already merged; not actionable. The open Dependabot queue (#263,
   #262, #274, #285) needs a decision from the operator.
