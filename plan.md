1. **Task 1: WordPress Article Management (`rust/crates/tools/src/wordpress_admin.rs`)**
   - Add structures `CreatePostInput` and `CreatePostOutput`.
   - Implement `execute_create_wordpress_post(input: CreatePostInput) -> Result<CreatePostOutput, String>`. It will use `/wp/v2/posts` endpoint with a `POST` request.
   - The user asked to implement: `pub async fn execute_create_wordpress_post(title: &str, content: &str, status: &str) -> Result<serde_json::Value, String>`. Wait, let me check the instruction again. "Implement two new async functions: pub async fn execute_create_wordpress_post(title: &str, content: &str, status: &str) -> Result<serde_json::Value, String> and pub async fn execute_update_wordpress_post(post_id: u64, content: &str) -> Result<serde_json::Value, String>."
   - Ah! Wait, the instruction says to implement functions with these specific signatures. Or maybe I should just use the structs like `execute_update_post_content` already does? Let's implement the specific signature as requested or a close variant that works with `Value` if needed. Let's see how they are called from `main.rs`. Wait, in `main.rs`, we just have a match over `tool_name` and then parse arguments. If I implement exactly `pub async fn execute_create_wordpress_post(title: &str, content: &str, status: &str) -> Result<serde_json::Value, String>`, then in `main.rs` I will have to parse these fields from `serde_json::Value`.
   - In `execute_update_post_content` it takes a struct. I'll just write exactly what's requested but also maybe the struct way is safer. No, I must follow the prompt: "Implement two new async functions: pub async fn execute_create_wordpress_post(title: &str, content: &str, status: &str) -> Result<serde_json::Value, String> and pub async fn execute_update_wordpress_post(post_id: u64, content: &str) -> Result<serde_json::Value, String>." So I will implement them exactly with that signature.
   - Use `std::env::var("WP_API_URL")` and `std::env::var("WP_API_KEY")`. Wait, existing tools use `WP_REST_URL`, `WP_APPLICATION_PASSWORD`, `WP_USER`. The instructions specifically said: "Pull the API URL from std::env::var("WP_API_URL") and the Application Password from std::env::var("WP_API_KEY"). Use HTTP Basic Auth."

2. **Task 2: Email Management (`rust/crates/tools/src/communication_ops.rs`)**
   - Implement `pub async fn execute_send_email(to: &str, subject: &str, body: &str) -> Result<(), String>`. Hit `std::env::var("AXIM_CORE_URL") + "/api/v1/email/send"` using `AXIM_SERVICE_KEY`.
   - Implement `pub async fn execute_read_recent_emails(limit: u32) -> Result<serde_json::Value, String>`. Hit `/api/v1/email/inbox`.

3. **Task 3: MCP Tool Registration**
   - Modify `rust/crates/runtime/src/internal_mcp.rs` to register the tool schemas for `create_wordpress_post`, `update_wordpress_post`, `send_email`, and `read_recent_emails`.
   - Modify `rust/crates/onyx/src/main.rs` to map these schemas to the execution functions. The instructions specify to map them so when the LLM requests a tool call, the logic fires.

4. **Testing**
   - Pre-commit checks.
   - `cargo check` and `cargo test` in the `rust/` directory.

