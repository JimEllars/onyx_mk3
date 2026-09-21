# Learnings

## Support Triage
* Need to enforce `must_use` manually inside module functions to ensure compliance with strict `clippy` checks.
* `serde_json::Value` offers great mutability via `.as_object_mut()` and `.as_array_mut()` to recursively scan and mask private keys for complex dynamic JSON payloads dynamically.

## Phase 64: AXiM Pulse Integration - Persona Isolation Foundation

- **Struct Expansion Strategies:** When modifying a central struct like `Session`, ensure the added field (e.g. `brand_id`) is correctly initialized in all constructor functions (`new`, `fork`, `load_from_path`, etc.). This requires locating all points where the struct is instantiated to avoid compiler errors.
- **Cognitive Isolation:** By intercepting forbidden terms inside `ConversationRuntime::run_turn()`, we prevent prompt drift and save resources on the LLM proxy level.
- **TUI Updates:** Formatting the status bar to accommodate `Option` fields requires using `.map_or_else()` properly. Using formatted strings dynamically avoids manual checking and improves conciseness.

## Telemetry & Resilience Update
- **Structured JSON Logging:** Migrated from generic `console.log/error` patterns to structured JSON logging using RFC-7807 compliant schemas inside the Edge Bridge. Added telemetry injection into `env.ONYX_EDGE_METRICS`.
- **Trace Context Propagation:** Implemented robust propagation of `x-onyx-trace-id`, `x-onyx-session-id`, and `x-onyx-source` headers across both the TS Edge Bridge and the Rust `reqwest` clients. These headers allow unified cross-ecosystem correlation mapping.
- **SQLite WAL Performance:** Enabling WAL mode alongside `busy_timeout = 5000` via connection pragmas efficiently resolves multi-reader lock contention errors between asynchronous API threads and synchronous TUI components.
- **TUI Channel Decoupling:** Replaced the standard blocking `std::sync::mpsc` channels with `tokio::sync::mpsc::unbounded_channel` to allow TUI column resizing and high-frequency event ingestion without jitter or keyboard IO frame drops.
