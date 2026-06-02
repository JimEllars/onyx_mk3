# AXiM Core - Onyx AI (Mk3) Next Development Phase Plan

## Current State Review
- **Routing Engine Scaffolded**: Phase 18 and Phase 19 are functionally complete. A fully decentralized and extensible routing engine now exists within `api::router::handle_dispatch`.
- **Trait-Based Handlers**: `MicroProgram` serves as the contract to seamlessly add any new self-contained logic block without convoluting the core HTTP framework.
- **Isolated Generator Scaffolds**: The system now contains initial models for `PredictiveLeadScoring`, `DemandLetterGenerator`, and `NDAGenerator`, isolated under `rust/crates/commands/src/extensions`.
- **Flaky Tests Addressed**: We reverted the volatile, nondeterministic python OS test modifications back to their original behavior, recognizing that test flakiness primarily lied within the external Python environment teardown limits rather than core Rust logic errors.

## Recommended Next Steps (Phase 20+)

### 1. Concrete Intelligence Implementation
Currently, `PredictiveLeadScoring`, `DemandLetterGenerator`, and `NDAGenerator` return mock data. The very next step should be integrating these exact structs with actual intelligence logic or external PDF-generation webhooks.
- Connect `DemandLetterGenerator` via the core payload to interact with the true backend Cloudflare edge worker (which generates and stores the PDF).
- Provide true heuristic math or an internal LLM routing loop inside the `PredictiveLeadScoring` execute function.

### 2. Idempotency Check Mechanism
All of these generated documents and enriched leads cost processing time. Introduce a standardized idempotency layer (likely through Supabase RPC checks or simple KV store lookup within the extensions) to ensure duplicate webhook intents don't re-trigger paid tasks.

### 3. Extend the Trait for Asynchronous Handoffs
Currently, `execute` awaits and returns `Value`. In a highly decentralized system, heavy tasks (like generating an NDA) might require the process to immediately return a `202 Accepted` with a Job ID, and asynchronously fire the result back via a webhook or database update. Modify the `MicroProgram` trait or add a separate `MicroProgramAsync` trait that accommodates long-running detached tasks using the `satellite_job_queue`.

### 4. Human-In-The-Loop Validation Scaffold
Integrate the high-stakes constraint (The "Resilient Edge" architecture mandate) directly into the router logic. Before a `MicroProgram` execution finishes, if it flags itself as `requires_hitl: true`, it should route the proposal payload to `hitl_audit_logs` instead of immediately returning `Success` to the caller.
