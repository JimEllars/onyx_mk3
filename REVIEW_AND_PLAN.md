# Codebase Review and Continued Development Plan

## Current State
- The Onyx AI App (Mk3) serves as a decentralized Edge AI node and orchestrator for AXiM Systems.
- We have fully implemented the Phase 21 Sprint objectives: the `support_triage` extension is in place, the `security_mask` prevents credentials leak, the payload outputs to UI (InvestigationPanel/DraftWhisper), and the entire system compiles cleanly with 0 clippy warnings. Test suite shows stable green operations.

## Immediate Next Steps (Phase 22 / Polish)
1. **Connect Real pgvector Storage:** The `query_vector_kb` method inside `support_triage.rs` currently mocks out the semantic similarity lookup. Next phase must bind `pgvector` inside Supabase to read the `vector_kb` database directly for true historical hit matching.
2. **Hitl-Gate API Integration:** The `SupportTriage` microprogram prepares escalating payloads. We need an overarching `execute_tier4_sandbox` mechanism that connects this scaffolded JSON object to the live Claude Cowork/Google Spark instances via an external MCP bridge.
3. **Telemetry Refinement:** We need to parse more explicit telemetry back to the database. The `telemetry` crate should be wired to ingest the `DiagnosticLog` payload output and push standard reporting structures back for observability.
4. **Deploy:** Deploy the updated router logic and test the Cloudflare worker integration natively to ensure `OnyxInvestigationPanel.jsx` receives the serialized payloads appropriately.
