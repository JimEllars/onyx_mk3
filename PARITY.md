# Workspace Parity & Cleanups

- **Phase 22 Updates:**
  - Audited and updated the `security_mask` utility in `support_triage.rs` to aggressively filter credentials using case-insensitive keyword matching (e.g., matching "stripe", "secret", "token", "password", "key", "auth", "credential"). Added comprehensive unit tests to ensure credentials like `MULTILINE_SECRET` or malformed tokens are masked and replaced with mock stubs.
  - Hardened frontend payload validation by wrapping fields in `DiagnosticLog`, `SupportTriageResponse`, `OnyxInvestigationPanel`, `AutoDraftWhisper`, and `DiagnosticPayload` in `Option<T>` with `#[serde(default)]` to prevent missing or null values from crashing the frontend payload serialization.
  - Maintained architectural hygiene by adding explicit documentation in `query_vector_kb` mandating the use of the centralized AXiM Core API for vector memory retrieval to prevent unauthorized external database connections.
