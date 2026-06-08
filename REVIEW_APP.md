# Onyx AI App (Mk3) - Full App Review and Development Plan

## Current State Assessment
The AXiM Onyx Mk3 app has successfully migrated core functionality to the memory-safe Rust `commands`, `runtime`, and `api` crates.

With the latest implementation sprint, the system has locked in the core backend resilience architecture required for autonomous decentralized processing:
1. **Asynchronous Hand-offs:** Heavy payloads (`generate_demand_letter`, `generate_nda`) securely defer execution and shift processing context to the isolated AXiM Core `satellite_job_queue/spawn`, releasing the proxy connection and preventing browser stalling.
2. **Circuit Breaker Integrity:** The native `reqwest` communication channels (`http_client.rs`) employ a standard `CircuitBreaker` pattern, correctly catching and throttling cascading failure streams if the Core network or external endpoints degrade.
3. **Autonomous Active Sentinel:** The internal `evaluate_fleet_health` routine operates as a true headless cron, detecting spikes in micro-app failures and deploying `HealthDiagnostic` responses immediately.

## Plan for Continued Development

To transition this foundation into full functionality, the following development phases should be prioritized:

### Phase 1: Complete Web Interface & TUI Enhancements (Weeks 1-2)
1. **Integrated Server (Axum):** Complete the web-server scaffolding inside the `onyx` crate (`rusty-claude-cli` wrapper) to fully support `claw server --port 3141`.
2. **WebSocket Chat Client:** Build out the single-page chat UI connecting to `/ws/chat`, resolving legacy terminal formatting issues when responding to non-engineering business queries.
3. **Session Rehydration:** Tie `session.rs` local persistence logic to the `/ws/chat` initialization sequence, verifying browser reloads pull the correct `.claw/sessions/` context.

### Phase 2: Action Agent Handoff Pipeline (Weeks 2-3)
1. **Action Agent Governance Engine:** Scaffold the DB proxy routing for Tier 4 handoffs (Claude Cowork / Google Spark) enforcing the `is_active` quota rules listed in the architectural roadmap.
2. **Spark Ingestion Bridge:** Wire the `sync_lead_enrich` tool to directly interpret the Normalized JSON Ingress Envelopes sent by the Spark Failover systems during web hook failures.
3. **Sandboxed Code Evaluator:** Solidify the `sandboxed_workspace_rules` restriction engine inside the Rust `runner.rs` environment to prevent Action Agents from accidentally modifying core files during `support_triage` patches.

### Phase 3: Telemetry & Ecosystem Finalization (Weeks 3-4)
1. **Blockchain Fallback Ledger:** Implement the AXiM Core `/functions/v1/billing/fallback-blockchain` mirror within `billing_fallback.rs`, confirming that stablecoin (USDC) hashes sync transparently back to the local tracking.
2. **Affiliate Link Enforcement:** Audit `ace_processing.rs` (Content Enricher) inside the `runtime` to guarantee regex patterns execute with zero error against direct WordPress API deliveries.
3. **Web3 Front-end Rollout:** Standardize the `Web3ConnectButton.jsx` distribution to the remaining micro-apps for consistent login flows across the AXiM ecosystem.
