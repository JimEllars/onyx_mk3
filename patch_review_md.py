import re
import sys

def patch():
    with open("review.md", "r") as f:
        content = f.read()

    replacement = """

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
"""

    with open("review.md", "a") as f:
        f.write(replacement)

patch()
