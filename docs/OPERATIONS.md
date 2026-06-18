

<!-- =========================
Source: LEARNINGS.md
========================= -->

# Phase 23 Learnings

- OnceLock with tokio handlers provides an effective decoupled approach to connect runtime generic systems to tools modules without creating direct circular crate dependencies.
- It is vital to decouple predictive_ops to operate purely on telemetry metric fetching without blocking the main event loops.
## Phase 24
- We must enforce that edge-bridge (Cloudflare Worker) deployments remain constantly synchronized with the core API.
- Using Rust to hit Cloudflare's `/deployments` API provides a reliable check that triggers human email alerts on sync failure.
- `execute_send_email` requires the `jrellars@gmail.com` and `james.ellars@axim.us.com` targets as an escalation fallback.

## Cloudflare Workers Sync Hardening (Sprint Phase 26)

- Identified and corrected the Cloudflare API endpoint for validating Worker deployments in `rust/crates/tools/src/cloudflare_ops.rs` to point to `/accounts/{account_id}/workers/deployments/by-script/{script_id}` instead of the Pages endpoint.
- Handled deployment logic accurately by checking the array response length, matching Cloudflare's structural model for worker environments.
- Implemented human alerting fail-safes via `execute_send_email` using `jrellars@gmail.com` and `james.ellars@axim.us.com` to notify administrators of verification failures or edge API desyncs.
- Tested and verified async KV polling behavior simulating missing cryptographic signatures and invalid JSON using integration tests.
- Audited the CI/CD deployment workflows in `.github/workflows/edge-bridge-sync.yml` to confirm successful paths and environment settings.

## Edge Bridge Cloudflare Worker
- When streaming Server-Sent Events (SSE) via Cloudflare Workers, do not parse the response into JSON. Pass `response.body` directly to the `Response` object with headers: `"Content-Type": "text/event-stream"`, `"Cache-Control": "no-cache"`, and `"Connection": "keep-alive"`.
- Cloudflare Workers native `crypto.subtle` should be leveraged for `HMAC SHA-256` payload verification directly at the edge to reject invalid webhooks before they consume downstream resources or block internal queues.


<!-- =========================
Source: NEXT_STEPS.md
========================= -->

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


<!-- =========================
Source: NEXT_STEPS_PLAN.md
========================= -->

# Next Steps & Continued Development Plan

## Immediate Priorities
1. **Frontend Implementation (Phase 26)**
   - Spin up a complete Web3 Frontend Master Template utilizing React, Vite, Tailwind.
   - Abstract theme configuration (`src/config/theme.js`).
   - Integrate `thirdweb-client.js` for blockchain authentication features.
   - Re-establish connection loops between frontend micro-apps and the Edge Bridge.

2. **Edge Bridge Hardening**
   - Implement rate-limiting and actual validation against a Supabase backend instead of simulated success statuses.
   - Add explicit routing for `hitl_audit_logs`.

3. **Core API / Worker State Integration**
   - Connect Onyx Rust runtime's `AXIM_CORE_STATE_ENDPOINT` effectively so that real state changes reflect in the `worker-state.json`.
   - Setup telemetry aggregation loops for actual observability.

4. **Action Agent Spawning Mechanism**
   - Formalize the JSON payload handoff out of the Rust environment into the `Claude Cowork / Google Spark` action layers for `Tier 4` exceptions.

5. **Blockchain Billing Fallback**
   - Setup `public.blockchain_transactions` ledger inside the database.
   - Formalize the smart contract execution loops within the micro-app Edge workers.

## Conclusion
The backend is stable. The edge infrastructure is scaffolded. We must shift focus towards consuming these services safely in a multi-tenant frontend architecture.

## Technical Debt: Circuit Breaker Integration
- **Immediate Priority:** The `circuit_breaker.rs` logic has been successfully scaffolded inside the API crate to provide exponential backoff and graceful degradation for external LLM requests. However, wiring this logic into the individual provider clients (`Anthropic`, `OpenAI`, `Gemini`, `Cloudflare`) was delayed to prevent compiler conflicts caused by regex-based replacements during Phase 25.
- **Next Steps:** In the next execution thread, we must surgically integrate the `CircuitBreaker` instances into each provider's `send_with_retry` and message streaming loops utilizing AST-aware edits rather than aggressive text replacements to avoid duplicate field definition conflicts.
