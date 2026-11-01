# AXiM Onyx Mk3 Web App - Continued Development Plan

## Status — 2026-11-01 (cycle audit)

**Merged (`main`, through PR #291):** edge containment (Phase A), HITL relay + operator auth
(Phase B), canonical `super_admin`, versioned HMAC signatures with a dual-accept window.

**Phases 1-3 of this plan are implemented and awaiting merge in PR #292**
(`feat/onyx-hud-phase1-connection-hardening`, CI fully green: `cargo fmt`, `cargo clippy`,
`cargo test --workspace`, integration tests, edge worker build, web build, deploy-and-verify).
That branch adds `src/lib/backoff.js`, `useDlqStatus.js`, `RcaInspector.jsx`,
`DomainContextSwitcher.jsx`, `hitlDecision.js`/`roles.js` plus their tests, and hardens the
edge `domain-context` path. **Do not re-implement Phases 1-3 on a new branch** — extend #292.

**PR #293** (`feat/onyx-fleet-health-rollup`) stacks the edge cron/retention fix on top of
#292. Because its base is a feature branch, CI only runs two checks for it (edge worker build
+ GitGuardian); retarget it to `main` once #292 merges so the Rust and web gates run.

**Phase 4 (embedded daemon) landed this cycle** on `feat/onyx-daemon-embedded-hud`:
`onyx daemon` / `onyx --daemon` serves the compiled HUD from the binary on `127.0.0.1:3141`
with `/api/v1/health`, `/api/telemetry/summary`, `/metrics`, a SPA fallback, a
traversal/CGI-injection deny list and CSP hardening. See `CHANGELOG.md` and
`AGENTS_VERIFICATION.md`.

**Housekeeping for the operator:** `feat/onyx-hud-phase2-3-telemetry-personas` (commit
`b10bec1`) is superseded by #292 — same scope, no PR, smaller test surface. Recommend
retiring it rather than merging. Four Dependabot PRs (#262, #263, #274, #285) are open on
root `package.json`/`package-lock.json` and overlap with the lockfile churn in #292; rebase
the winner after #292 lands.

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

### Phase 1: Robust Connection & Error Handling (Weeks 1-2)
- **Objective**: Harden the connection between the frontend and the Onyx Edge Bridge.
- **Tasks**:
  - Implement exponential backoff for WebSocket/SSE reconnections in `useAgentConnection.js`.
  - Add global error boundary components to prevent UI crashes during transient network failures.
  - Expose visual connection status (Online, Reconnecting, Offline) cleanly in the `SystemSidebar`.

### Phase 2: Action Console Expansion & Telemetry (Weeks 2-3)
- **Objective**: Bring full DevSecOps monitoring capabilities into the `ActionConsole`.
- **Tasks**:
  - Integrate real-time telemetry streaming into the Action Console to display fleet worker health (parsing `/api/v1/telemetry`).
  - Add interactive payload viewers for inspecting Root-Cause Analysis (RCA) JSON structures when micro-apps report 5xx errors.
  - Implement a manual trigger UI for Onyx Playbooks (e.g., `support_triage`, `sync_lead_enrich`) directly from the Action Console.

### Phase 3: Identity & Multi-Persona Context Support (Weeks 3-4)
- **Objective**: Support dynamic context switching (e.g., between standard AXiM Systems logic and specific domain contexts).
- **Tasks**:
  - Enhance `useAximAuth.js` to parse and store organizational roles or domain contexts.
  - Add a context-switcher in the `ChatInterface` to explicitly pass `domain_context` tags with each request to the Edge Bridge, ensuring Onyx adopts the correct persona.
  - Build UI indications when a Human-in-the-Loop (HITL) authorization is required, allowing administrators to review and approve proposed JSON payloads (e.g., `OnyxInvestigationPanel.jsx` integration).

### Phase 4: Decentralized Billing & Web3 Integration Polish (Weeks 4-5)
- **Objective**: Finalize the Web3 capabilities and fallback billing in the UI.
- **Tasks**:
  - Refine the `Web3ConnectButton.jsx` implementation and place it in the application's configuration or settings view.
  - Ensure all wallet connections passively sync telemetry back to AXiM Core via the Edge Bridge.
  - Integrate a unified transaction ledger view inside the `ActionConsole` for auditing smart contract executions or fallback blockchain payments.
