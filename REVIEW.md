# AXiM Onyx AI Mk3 - Architecture Review & Continued Development Plan

## Current State Assessment
The Onyx Mk3 repository has successfully transitioned from its original Python/CLI framework (`src/`) into a highly performant, modular Rust architecture (`rust/crates/`).

### Core Strengths & Baseline Hardening
* **Edge Resilience:** We have established the `onyx-mk3` Cloudflare Worker inside the `edge-bridge/`. This stateless Node.js compatible boundary successfully handles webhook ingestion (GitHub, WordPress) and authenticates telemetry requests before passing them to the protected backend. It is now properly wired to the `ONYX_STATE` KV namespace for decentralized approvals.
* **Rust Intelligence Core:** The `api` crate effectively routes multi-model AI logic via the `ProviderClient`, now robustly including the `CloudflareProvider` for Tier 4 operations mapping to `@cf/moonshotai/kimi-k2.6`.
* **Frontend Web Upgrade:** The CLI REPL has been replaced by a lightweight Axum web server (`rust/crates/onyx/src/server.rs`) capable of serving a real-time WebSocket chat UI.
* **Clean Repository Hygiene:** All legacy `.diff`, `.sh`, and orphaned debugging scripts have been purged. The `docs/` folder now accurately contains only essential consolidated documents (`ARCHITECTURE.md`, `DEPLOYMENT.md`, `OPERATIONS.md`, `container.md`).

---

## Strategic Roadmap for Full Functionality

To advance AXiM Core and Onyx Mk3 to complete operational functionality, we must execute the following targeted development tracks:

### Phase 30: Frontend Session Hardening
* **Objective:** Ensure the Axum WebSocket server natively handles context persistence.
* **Execution:** We need to fully wire the `ConversationRuntime` and `SessionStore` into `server.rs`. When a user disconnects and reconnects via the UI (`static/index.html`), Onyx must hydrate previous conversation turns from the `.claw/sessions/` JSONL architecture.
* **UI Polish:** Expand the chat UI to render markdown natively and support custom theming dynamically sourced from `theme.js`.

### Phase 31: Tier 4 Action Agent Sandboxing
* **Objective:** Securely route complex non-deterministic browser operations to `Claude Cowork` and `Google Spark`.
* **Execution:** Hard-code the `execute_sandboxed_action` protocol inside the Onyx `tools` crate. We must enforce the rule that Onyx spins up these agents via MCP while continuously monitoring their token outputs via the Supabase logging mechanism to prevent quota exhaustion.

### Phase 32: Web3 Fallback Billing Implementation
* **Objective:** Prevent transactional bottlenecks across the edge fleet.
* **Execution:** When the frontend detects a Stripe failure inside the micro-apps (NDA, Demand Letter), Onyx must orchestrate the Thirdweb SDK (`Web3ConnectButton.jsx`) to request an Arbitrum One Layer 2 settlement. Onyx will act as the validation bridge, verifying the `on_chain_tx_hash` against the `blockchain_transactions` ledger before delivering the secure PDF artifacts.

### Phase 33: Affiliate Content Engine (ACE) Full Loop
* **Objective:** Automate direct recurring revenue generation.
* **Execution:** Finalize the `/v1/ace/wp-callback` routing. Onyx will autonomously catch Roundups.ai webhooks, inject the immutable affiliate link strings defined in the Rust core, and publish them back to the headless WordPress frontend via secure `service_role` keys.

---
*End of Review. Execution sequence complete.*
