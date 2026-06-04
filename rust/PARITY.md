# Workspace Parity & System Updates

## Phase 21 Fixes & Integration (Support Triage & HITL)
- Scaffolded the decentralized `support_triage` micro-program in `rust/crates/commands/src/extensions/support_triage.rs` to intercept fleet exceptions and query the `vector_kb` for historical resolutions.
- Implemented `security_mask` utility to strip live credentials from crash payloads and safely replace them with mock variables for Action Agent sandboxing.
- Formalized the JSON packaging schema to pass diagnostic diffs to `OnyxInvestigationPanel` and `AutoDraftWhisper` components within the frontend interface.

## Phase 20 Fixes & Integration
- Integrated `EmailAction` via `rust/crates/commands/src/extensions/email.rs` utilizing the Emailit API. Configured strict allowlists for outbound and inbound alerts.
- Resolved `manager_shutdown_terminates_spawned_children_and_is_idempotent` in `mcp_stdio.rs` by aligning the test's line-count assertion with the actual `initialize`, `tools/list`, and `tools/call` events logged by the python script.
- Hardened `manager_times_out_slow_tool_calls` by ensuring the dummy python script actually honors the `MCP_TOOL_CALL_DELAY_MS` environment variable via `time.sleep()`, guaranteeing authentic timeout triggers.
- Workspace fully passes `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace`.
