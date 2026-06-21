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
