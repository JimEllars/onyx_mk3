# Onyx AI (Mk3) System Review and Future Development Plan

## Current State Summary
The Onyx Mk3 Rust engine is now exceptionally stable. The recent system hardening efforts during Phase 20 have culminated in 100% test pass rates and a pristine `clippy` report.

### Key Achievements:
- **Resilient Process Management:** `McpServerManager` correctly handles unexpected process disconnections, ungraceful server terminations, and enforces strict execution timeouts via `MCP_TOOL_CALL_DELAY_MS`.
- **Bi-Directional Email Integration:** Onyx now has an active outbound/inbound email pipeline utilizing the Emailit API, bounded safely by the C-Suite allowlist (`jrellars@gmail.com`, `james.ellars@axim.us.com`).
- **Workspace Parity & Security:** Tenant separation logic within the persistent JSONL sessions and strict filesystem trust-resolving have verified production viability.

## Plan for Continued Development (Towards Full Functionality)

To transition Onyx Mk3 and the AXiM ecosystem into their final production phase, we need to focus on extending Onyx's proactive DevSecOps capabilities and finalizing the public decentralized micro-apps.

### Phase 21: DevSecOps Autonomous Tooling
- **WP REST Bridge:** Build the `wp_rest_bridge` Rust crate to allow Onyx to manage the Headless WordPress backend via Application Passwords. Enable automated affiliate link injection and SEO updates (react-helmet-async).
- **GitHub & Cloudflare Tooling:** Finalize internal MCP plugins for Onyx to autonomously open PRs (using GitHub PATs) and trigger Cloudflare Workers caching and deployments during root-cause anomalies.

### Phase 22: Web3 and Decentralized Billing Fallbacks
- **Arbitrum One Payment Processing:** Extend the frontend Stripe fallback (`PaymentModal.jsx`) to smoothly surface Thirdweb's embedded wallets on Arbitrum One (Chain ID 42161).
- **On-Chain Log Syncing:** Build the AXiM Core endpoints that ingest smart-contract transaction receipts and mirror them securely to the `api_usage_logs` and `blockchain_transactions` tables using service-role functions.

### Phase 23: Action Agent Escalation (Tier 4)
- **Claude Cowork Sandboxing:** Finalize the structured JSON envelope payload for handing off zero-day deployment anomalies to the Claude Cowork sandbox.
- **Google Spark Integrations:** Arm Google Spark to intercept unstructured emails and legacy partner portals (e.g., Solar B2B leads) and convert them into our standard ingress AES-256 payload.

### Phase 24: Operator TUI and Dashboard Polish
- Enhance the Onyx CLI TUI (Terminal User Interface) to expose live telemetry and "Action Required" SLA escalation badges.
- Finalize the `AutoDraftWhisper.jsx` component for human operators handling HITL validations triggered by Onyx.

With the core routing, task scheduling, and isolated tool execution pathways functioning flawlessly, the application is primed for these final enterprise-level integrations.
