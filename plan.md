1. **Task 1: Strict Persona Partitioning**
   - In `rust/crates/runtime/src/prompt.rs`, add `domain_context: &str` parameter to `load_system_prompt`.
   - Update `SystemPromptBuilder` to store and use `domain_context`.
   - Update `get_simple_intro_section` to inject the correct persona based on `domain_context` matching "axim" or "ellars".
   - Fix all calls to `load_system_prompt` in `main.rs`, `tools/src/lib.rs`, and tests to pass `""` or `&domain_context`.

2. **Task 2: Dynamic Ecosystem Discovery**
   - In `rust/crates/runtime/src/ecosystem_tools.rs`, implement `pub async fn fetch_active_micro_app_schemas() -> Result<Vec<serde_json::Value>, String>`.
   - The function should make a GET request to `$AXIM_CORE_URL/api/v1/system/discovery`, auth with `Bearer $AXIM_SERVICE_KEY`, and return the parsed JSON array.

3. **Task 3: Sliding Context Compression**
   - In `rust/crates/runtime/src/summary_compression.rs`, implement `pub fn compress_old_messages(messages: &[ConversationMessage]) -> ConversationMessage` (or similar). The prompt says: "The compression logic should replace the oldest 10 messages with a single System message: `[COMPRESSED SYSTEM MEMORY]: {summarized_text}`, keeping the 10 most recent messages intact."
   - In `rust/crates/runtime/src/conversation.rs` (or where the `Vec<ConversationMessage>` context is processed, perhaps before the API call), add a check to compress if `messages.len() > 20`.

4. **Testing & Pre-commit**
   - Ensure everything compiles and passes tests. Run `cargo check` and `cargo test`. Ensure pre-commit checks are passed.
