# AXiM Onyx Mk3 - Continued Development Plan

Based on the strategic documents (`rust/TUI-ENHANCEMENT-PLAN.md`, memory blueprints, and the Phase 1/Phase 2 instructions), here is the action plan to move the app towards full operational functionality with a built-in chat UI and core integrations.

## Phase 1: Built-in Chat Interface (Axum Web Server)

**Goal:** Shift Onyx from a strict CLI/REPL harness to an accessible web service with a modern chat UI.

*   **Task 1.1: Embedded HTTP Listener:** Integrate `axum` and `tower-http` into the `onyx` (formerly `rusty-claude-cli`) crate. Modify `main.rs` to support starting an HTTP server via a `--daemon` or `server` flag on a designated port (e.g., `3141`).
*   **Task 1.2: Chat UI Frontend (Static Assets):** Create a minimal HTML/CSS/JS single-page app served by the Axum server. The UI will implement a WebSocket client connecting to `/ws/chat`.
*   **Task 1.3: WebSocket Handler & Routing:** Build `server.rs` to handle WebSocket upgrades, bridging incoming JSON payloads to the existing `ConversationRuntime::handle_tool_call()` loop. Implement real-time SSE or WebSocket message streaming for responses.
*   **Task 1.4: Web Session Persistence:** Tie the WebSocket connection ID to the existing `.claw/sessions/` structure. Ensure browser refresh gracefully resumes the active Onyx session using `localStorage`.

## Phase 2: AXiM Core Orchestration & Headless Integration

**Goal:** Solidify the "Headless Node" operations by connecting Onyx securely to the AXiM Supabase/Cloudflare backend without relying on interactive prompts.

*   **Task 2.1: AXiM Service Registry:** Build a `service_registry.rs` component in the `api` crate that auto-discovers internal endpoints (e.g., `AXIM_*_URL`) from environment variables and `.onyx.json` config.
*   **Task 2.2: The Webhook Ingestion Pipeline:** Hardening the `edge-bridge/src/index.ts` worker to reliably map incoming GitHub/WordPress/Telemetry payloads into the `AximWebhookPayload` format. Build the corresponding asynchronous ingestion loop in the Rust `runtime` to pick up these payloads without blocking.
*   **Task 2.3: Action Agent Escalations (Tier 4):** Finish wiring the `support_triage` escalation output to actual execution endpoints for Claude Cowork/Google Spark, including managing the HITL (Human-in-the-Loop) approval state.

## Phase 3: DevSecOps "Overwatch" Tooling

**Goal:** Empower Onyx to manage the fleet.

*   **Task 3.1: Cloudflare Ops Tooling:** Extend `tools::cloudflare_ops` to manage WAF rules and purge caches dynamically based on incoming anomaly alerts.
*   **Task 3.2: WordPress Admin Tooling:** Finalize `tools::wordpress_admin` utilizing Application Passwords to publish ACE content and update SEO metadata seamlessly via REST.

## Phase 4: Containerization & Deployment Hardening

**Goal:** Make deployment zero-touch.

*   **Task 4.1: Local Stack Dockerization:** Finalize a `docker-compose.yml` to spin up Onyx (listening on 3141) alongside a mocked AXiM Core for local development.
*   **Task 4.2: Edge Worker Sync:** Deploy the updated `edge-bridge` TypeScript worker to Cloudflare, ensuring CORS headers restrict access strictly to verified AXiM domains.
