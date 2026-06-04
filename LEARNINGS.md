# Learnings

- When modifying Rust asynchronous contexts, always manage lifetimes carefully, especially when dropping lock guards (`MutexGuard`) to prevent holding locks across `await` points which causes compilation errors.
- Do not use string replacements or Python scripts to edit Rust files—use raw CLI or manual edits to maintain precision.
- The `MicroProgram` architecture is used for routing internal AXiM tools. Each tool exposes a specific string via the `signature()` method which gets hit when routing payloads to it.

## Phase 21: Support Triage & Action Agent Escalation (Decentralized Modules)
- We shifted Onyx Mk3 to function as an active, autonomous diagnostic orchestrator through the `support_triage` micro-program.
- Scaffolded strongly-typed JSON structs (e.g. `DiagnosticLog`, `SupportTriageResponse`, `DiagnosticPayload`) matching AXiM Core definitions.
- The `apply_security_mask` utility was written to programmatically parse environment variable payloads and strip active credentials (like `STRIPE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`), replacing them with safe mock stubs, ensuring that Sandboxed Action Agents never gain live production secrets.
- Completed integration testing verified that no MCP state leakage occurred and overall workspace architectural hygiene remains pristine with zero warnings.
