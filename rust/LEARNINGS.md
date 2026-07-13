# Learnings

## Support Triage
* Need to enforce `must_use` manually inside module functions to ensure compliance with strict `clippy` checks.
* `serde_json::Value` offers great mutability via `.as_object_mut()` and `.as_array_mut()` to recursively scan and mask private keys for complex dynamic JSON payloads dynamically.

## Phase 64: AXiM Pulse Integration - Persona Isolation Foundation

- **Struct Expansion Strategies:** When modifying a central struct like `Session`, ensure the added field (e.g. `brand_id`) is correctly initialized in all constructor functions (`new`, `fork`, `load_from_path`, etc.). This requires locating all points where the struct is instantiated to avoid compiler errors.
- **Cognitive Isolation:** By intercepting forbidden terms inside `ConversationRuntime::run_turn()`, we prevent prompt drift and save resources on the LLM proxy level.
- **TUI Updates:** Formatting the status bar to accommodate `Option` fields requires using `.map_or_else()` properly. Using formatted strings dynamically avoids manual checking and improves conciseness.
