# AXiM Onyx AI App Review & Continued Development Plan

## Current State
- **Stateless Intake API & Async Queueing**: The application successfully ingests Webhooks from external systems through `/v1/commands/dispatch` and converts them into `TaskPacket` requests.
- **Priority-Based Swarm Routing**: Multi-tenancy queueing safely handles inbound telemetry and alerts, with MPSC mechanisms correctly prioritizing Critical workflows (Auto-Healer) over low-impact batch queries.
- **Agent Handoffs**: Full internal Playbook matrices are online via MCP, executing natively using safe Rust boundaries.
- **Edge Deployment Ready**: The TypeScript Edge Bridge provides solid ingress filtering before dropping secure payload data into this new Rust execution core.

## Immediate Development Directives (Next Sprint)
1. **Deeper CRM Integrations**: We must finalize the deskera data sync structures outlined in `sync_lead_enrich`. The current internal command logic is in place, but we need the exact API payload formats integrated directly into `rust/crates/tools/src/crm.rs`.
2. **Auto-Healer & RCA Output Refinement**: Implement actual generation logic that populates vector matching inside the `AutoDraftWhisper` UI rather than placeholders in `triage_support`. Ensure `vector_memory.rs` properly intercepts stack traces during these events.
3. **HITL Notification Bridge**: When Onyx halts for executive signoff on high-stakes operations (like WordPress publishing), wire the Rust runtime to actively broadcast a notification via Discord/Slack or internal AXiM dashboards, so executives aren't forced to poll actively.
