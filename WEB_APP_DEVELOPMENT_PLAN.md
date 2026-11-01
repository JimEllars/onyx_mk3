# AXiM Onyx Mk3 Web App - Continued Development Plan

## Current State Review
The Onyx Mk3 Web App currently features a React/Vite-based frontend, serving as a Headless UI wrapper for the core Onyx Rust engine.
1. **Architecture & Styling**: The application is structured with a central `App.jsx` orchestrating the main layout. It uses a modern dark-themed aesthetic powered by Tailwind CSS. The layout includes:
   - `SystemSidebar`: Provides navigation and system status indicators.
   - `ChatInterface`: The primary conversational UI for interacting with Onyx.
   - `ActionConsole`: Rendered conditionally upon authentication to provide deeper system controls.
2. **Authentication**: Handled via a custom `useAximAuth` hook which currently gates access to the `ActionConsole`.
3. **State Management**: Zustand is utilized (e.g., `useDesktopAgentStore.js`) for managing local UI and agent connection states without unnecessary prop drilling.
4. **Agent Connection**: `useAgentConnection.js` handles WebSocket or SSE streaming with the Onyx Edge Bridge (`/api/v1/chat`).

## Phased Development Plan

### Phase 1: Robust Connection & Error Handling (Weeks 1-2) — **DONE (2026-11-01)**
- **Objective**: Harden the connection between the frontend and the Onyx Edge Bridge.
- **Tasks**:
  - [x] Implement exponential backoff for WebSocket/SSE reconnections in `useAgentConnection.js`.
    Both transports now share `src/lib/connectionState.js:computeBackoffDelay()` — 1s → 30s
    with full jitter. The WebRTC path previously capped at 10s while the SSE path used 30s.
  - [x] Add global error boundary components to prevent UI crashes during transient network failures.
    `src/components/ErrorBoundary.jsx`, mounted globally in `main.jsx` and inline (labelled) around
    `ChatInterface` and `ActionConsole` in `App.jsx`.
  - [x] Expose visual connection status (Online, Reconnecting, Offline) cleanly in the `SystemSidebar`.
    Both rows render through `toConnectionBadge()`; raw transport enums are no longer surfaced.
- **Known gap**: `retryCount` is now reactive state, but nothing renders it yet. Surface it in the
  reconnect tooltip when the next transport change lands.

### Phase 2: Action Console Expansion & Telemetry (Weeks 2-3) — **DONE (2026-11-01)**
- **Objective**: Bring full DevSecOps monitoring capabilities into the `ActionConsole`.
- **Tasks**:
  - [x] Integrate real-time telemetry into the Action Console to display fleet worker health.
    `GET /api/v1/telemetry/dlq-status` polled every 15s with the Passport bearer; renders
    unsynced relay/receipt depth, circuit-breaker state and Core reachability. (`/api/v1/telemetry`
    itself has no aggregate route on the edge — `dlq-status` is the real endpoint.)
  - [x] Add interactive payload viewers for inspecting Root-Cause Analysis (RCA) JSON structures when
    micro-apps report 5xx errors. `src/lib/rca.js` + an expandable drawer in `ActionConsole`.
  - [x] Implement a manual trigger UI for Onyx Playbooks — `src/components/hud/PlaybookTrigger.jsx`
    (pre-existing, verified wired to `POST /api/v1/playbook/trigger`).

### Phase 3: Identity & Multi-Persona Context Support (Weeks 3-4) — **PARTIAL (2026-11-01)**
- **Objective**: Support dynamic context switching (e.g., between standard AXiM Systems logic and specific domain contexts).
- **Tasks**:
  - [ ] Enhance `useAximAuth.js` to parse and store organizational roles or domain contexts.
    Roles are still read from Passport claims at request time (`isSuperAdmin()` on the edge);
    the HUD does not cache them. Persona selection lives in `src/lib/domainContexts.js` today.
  - [x] Add a context-switcher in the `ChatInterface` to explicitly pass `domain_context` tags with
    each request to the Edge Bridge. Four personas (AXiM Core, Robotics Lab, SpeedReport Network,
    AXiM Academy), persisted in `localStorage`, sent in the summon body. **Core-side handling of
    `domain_context` must be confirmed** — the edge forwards it opaquely.
  - [x] Build UI indications when a Human-in-the-Loop (HITL) authorization is required, allowing
    administrators to review and approve proposed JSON payloads. Tickets arrive over `/events`
    (`action_pending`) and are decided via `POST /api/v1/hitl/action`.

### Phase 4: Embedded Daemon (`--daemon`) — **BLOCKED, see AGENTS_VERIFICATION.md**

- **Remaining work**: `rust/crates/onyx/src/main.rs` already has
  `CliAction::ServeHeadless { port }` binding an axum router (`main.rs:2060`), and the built HUD
  assets already live in `rust/crates/onyx/static/`. The gap is a `--daemon` flag alias plus
  `rust-embed` in place of `tower-http`'s `fs` feature, so assets ship inside the binary.
- **Why not done here**: this environment cannot link Rust binaries (no `cc`, no root, no glibc
  CRT objects), so the change could not be type-checked. Do it on a runner with `build-essential`.

### Phase 5: Decentralized Billing & Web3 Integration Polish (Weeks 4-5)
- **Objective**: Finalize the Web3 capabilities and fallback billing in the UI.
- **Tasks**:
  - Refine the `Web3ConnectButton.jsx` implementation and place it in the application's configuration or settings view.
  - Ensure all wallet connections passively sync telemetry back to AXiM Core via the Edge Bridge.
  - Integrate a unified transaction ledger view inside the `ActionConsole` for auditing smart contract executions or fallback blockchain payments.
