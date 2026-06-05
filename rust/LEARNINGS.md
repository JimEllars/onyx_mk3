# Developer Learnings

## Support Triage & Action Agent Escalation (Tier 4)
We successfully integrated the decentralized Support Triage module (`rust/crates/commands/src/extensions/support_triage.rs`) to act as the primary incident response handler for anomalous micro-app worker crashes.

Key structural learnings:
1. **Frontend-Native JSON Schemas:** Onyx now packages its semantic findings into explicitly mapped JSON schemas (`OnyxInvestigationPanel`, `AutoDraftWhisper`) to match the props structure expected by the AXiM Support React frontend. This prevents tedious re-mapping on the API layer.
2. **Safe Handoff Packaging (security_mask):** The newly implemented `security_mask` utility demonstrates a strict separation of concerns. Before Onyx passes context to a non-deterministic Tier 4 agent (like Claude Cowork), it forcefully scrubs defined environment variable keys (e.g. `STRIPE_SECRET_KEY`) and mocks them, preserving our vault security while providing enough context for sandboxed debugging.

## MCP Stdio Process Management
When writing integration tests for stdio-based MCP servers (like the `mcp_stdio` tests), simply passing an environment variable (like `MCP_TOOL_CALL_DELAY_MS`) to the child process isn't enough to trigger application logic unless the mock server script is explicitly programmed to parse it and act (e.g., `time.sleep()`).

Additionally, when verifying idempotent shutdowns and process kills via log line counts, ensure the expected assertion array precisely matches the emitted JSON-RPC lifecycle events (Initialize -> List Tools -> Call Tool), especially when refactoring tests derived from copy-pasting.

## Cargo Workspace Hygiene
When a Cargo workspace grows (currently 9 crates), tracking test failures requires running `--workspace` globally, but targeting fixes should be done via `-p <crate_name>` to speed up compilation.

## Onyx Mk3 Support Triage Hardening
- Strengthened `support_triage` module with robust regex masking (`scrub_error_log`) to securely strip sensitive credential patterns (Stripe, JWT, etc.) and direct key-value assignments from freeform diagnostic logs.
- Enforced strict payload serialization bounds by implementing `#[serde(default, skip_serializing_if = "Option::is_none")]` across all optional diagnostic schemas.
- Refactored logic to securely truncate excessive stack trace inputs, avoiding JSON bloat and UI crashing on frontend reporting layers.

## Micro-Program Decentralization & Hardening
- Micro-programs (e.g. Demand Letter, NDA generators) must strictly adhere to stateless isolation constraints without local database dependencies. Any data persistence or predictive caching must be routed through `AXiM Core API`.
- Resilient JSON serialization is critical for background webhook ingestion. Instead of panicking on malformed `AximWebhookPayload.meta_data`, modules should use `unwrap_or_default()` and populate `missing_fields` explicitly to enable graceful degradation (e.g., generating a `Partial_Draft` status).
- Test suites must dynamically construct execution strings (like `Utc::now().timestamp_millis()`) instead of using hardcoded mock tokens to avoid false positives and security audits flagging static secrets.
