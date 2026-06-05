# AXiM Core/Onyx Mk3 Continued Development Plan

## 1. Frontend Integration (Web Chat/UI)
- The codebase requires full web integration via `axum` and WebSockets.
- Expose the HTTP API endpoints in the `onyx` crate to allow the UI to communicate with the `runtime`.
- Integrate `Chatbase` widgets as per the documentation to provide domain-specific user interfaces, routing back to `Onyx Mk3`.

## 2. DevSecOps Workflows & "Overwatch" Agent
- Fully flesh out the tools required for DevSecOps workflows: GitHub API interaction for code reviews/PRs and Cloudflare tools.
- Flesh out tools to integrate directly with Bluehost/WordPress using headless REST APIs, implementing strict RLS and HITL (Human-in-the-loop).

## 3. Web3 & Payments Integration
- Complete the fallback payment mechanisms on Arbitrum. Ensure transactions fallback to the `blockchain_transactions` table inside AXiM Core when Stripe checks fail.
- Implement Thirdweb integrations smoothly into the frontend apps, recording `telemetry` through the `api_usage_logs` and routing to Deskera CRM.

## 4. Support Cockpit
- Finish the implementation of `AutoDraftWhisper.jsx` and `OnyxInvestigationPanel.jsx` equivalent integrations within the Rust stack, surfacing `[ACTION_REQUIRED]` elements and ensuring SLAs are strictly tracked and required approvals processed securely via MCP.

## 5. Security & Multi-tenant Audits
- Deeply inspect all telemetry logs, RLS checks, and MCP configurations. Ensure any file writes from sub-agents operate strictly within configured `sandboxed_workspace_rules`. Ensure zero cross-contamination of personas (e.g. AXiM vs ELLARS).

## 6. Edge Bridge Typescript Refinements
- The TypeScript `edge-bridge` requires more robust dead-letter queue, signature validation, and payload serialization before sending webhook packets down into the AXiM Core payload tunnel.
