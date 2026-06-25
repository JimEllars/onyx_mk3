# AXiM Onyx Mk3 Phase 33 Review & Continued Development Plan

## What We Built

1. **Edge-bridge Chat Routing (Priority 1):** We integrated the `/api/v1/chat` endpoint of our edge-bridge to properly route to AXiM Core proxy (`CORE_INGEST_URL/v1/chat`). We preserved the SSE streaming capabilities ensuring efficient token transmission directly to the browser.
2. **Configuration Validation & Ingest Error Fallbacks (Priority 2):** We ripped out the hardcoded `axim-core.internal` default for `CORE_INGEST_URL`, meaning we fail fast and predictably during misconfigurations. Plus, forward errors are logged straight into the `ONYX_STATE` KV store logic, rather than swallowed into `console.error`.
3. **Dynamic Ai Health Evaluation (Priority 3):** Fixed the constant return `purge_zone_cache` problem in `rust/crates/runtime/src/fleet_health.rs`. Now, `evaluate_health_with_ai_dynamic` correctly parses `HealthDiagnostic` structures (like high error rates, unresponsiveness, or 5xx exceptions) to pick an appropriate action mapped to tools like `restart_mcp_server`, `reduce_request_rate`, and `execute_circuit_breaker`. We also confirmed it integrates with the telemetry engine via `handle_telemetry_event`.
4. **Mutating Route Idempotency (Priority 4):** Integrated a required `Idempotency-Key` mechanism over our billing fallback (`/api/v1/billing/fallback-blockchain`) and support approval (`/api/approve`) endpoints in `edge-bridge/src/index.ts`. All resolved states are persisted in `env.ONYX_STATE` using `{ expirationTtl: 86400 }` to avoid duplications and handle KV cleanup dynamically.
5. **Auth Hardening (Priority 5):** Hardened the Bearer token checks (`checkAuth`) in `edge-bridge` by implementing a timing-safe `Uint8Array` comparison using the Web Crypto API, eliminating length-leakage exploits.

## Looking Forward (Continued Development Plan)

1. **Fix Core Security Issues Outside Onyx:**
   There's existing technical debt outlined regarding plain text API keys in `api_integrations_ax2024.credentials` and `safe_sql_executor` vulnerability. These must be addressed immediately before exposing `CHAT_ROUTING_MODE=proxy` fully into production to ensure we aren't command injecting through compromised endpoints.

2. **Complete the Swarm Logic & Tool Dispatch (`swarm.rs` and `dispatch.rs`):**
   Right now `evaluate_health_with_ai_dynamic` makes hardcoded logic choices based on diagnostic signals, rather than spinning up sub-agents using an LLM. Our priority is to properly feed these signals to an LLM provider and let it autonomously invoke tools using MCP calls. This will finish the bridge to `McpServerManager`'s runtime dynamic tool lists.

3. **Expand Edge Support:**
   Implement a dead-letter queue (DLQ) for failed ingestions when AXiM Core API experiences major latency drops.


## Phase 38

**Done:**
- **P1 — Activate the swarm orchestrator:** SwarmWorker spawns and correctly processes prioritized task packets via async channels. It emits telemetry `SubAgentEvent`s on start and finish. Checked via unit tests.
- **P2 — Close the fleet-health → LLM/MCP loop:** Implemented `evaluate_health_with_ai_dynamic` with dynamic and LLM modes (`FLEET_AI_MODE=llm`). Allows dynamic tool resolution and enforces an allowlist to prevent destructive behavior. Checked via unit tests.
- **P3 — Verify telemetry actually lands end-to-end:** Replaced blocking HTTP calls with non-blocking `tokio::spawn` loops using `reqwest::Client`. Ensures telemetry lands in the Core securely in the background. Checked via unit tests.
- **P4 — Drain/replay the receipt + telemetry fallbacks:** Introduced `telemetry::dlq::start_dlq_drain_loop` that reliably reads off `.claw/unsynced_receipts.jsonl`. Deletes successful transmits and triggers `dispatch_critical_alert` if the queue is oversized or encounters repeated failures. Checked via unit tests.
- **P5 — Reconcile and lock down configuration before full proxy cutover:** Re-secured `CHAT_ROUTING_MODE=proxy` boots. The system refuses to boot if `AXIM_ONYX_SECRET` is missing or the backend URL contains `.internal`/placeholder values.
- **UI / TUI — Dashboard gauges:** Updated `status_bar.rs` to include queue depth for Swarm and Telemetry loops to offer immediate observability into async queues. Checked via GUI.

**Verified:**
- `cargo clippy --workspace` passes cleanly.
- `cargo test --workspace` passes cleanly.
- Tests confirm fallbacks, queue drains, and LLM constraints work as intended.

**Blocking (operator action):**
- **Connection Pool vs. Session Limits:** Ensure Supabase connections use the 6543 connection pooler instead of 5432 to handle async telemetry payload spikes.
- **Row-Level Security (RLS) & Service Keys:** Verify that the telemetry table applies appropriate RLS and `AXIM_SERVICE_KEY` permissions.
- **Realtime/Webhook Throttle Gates:** Make sure Supabase replication layer handles webhook triggers reliably and without throttling during high density task periods.
- Reconcile out-of-repo security issues before full cutover (e.g., Vault secrets, SECURITY DEFINER functions).

**Still open / carried forward:**
- Migrate remaining legacy tools to full MCP standardizations.
- Re-architect connection pooling asserts for async payloads.
