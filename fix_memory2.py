with open("rust/crates/runtime/src/memory.rs", "r") as f:
    text = f.read()

import re

# find `pub fn sync_summary_to_cloud(session_id: String, summary: String) {`
# to `}`

new_body = """pub fn sync_summary_to_cloud(session_id: String, summary: String) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap_or_else(|_| tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap());
        rt.block_on(async move {
            let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
            let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default());

            if supabase_url.is_empty() || supabase_key.is_empty() {
                eprintln!("[Memory Sync] Missing Supabase credentials, skipping sync.");
                return;
            }

            let client = reqwest::Client::new();
            let url = format!("{supabase_url}/rest/v1/ai_chat_history_ax2024");

            let payload = json!({
                "session_id": session_id,
                "summary": summary,
                "created_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
            });

            match client.post(&url)
                .header("apikey", &supabase_key)
                .header("Authorization", format!("Bearer {supabase_key}"))
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .json(&payload)
                .send()
                .await
            {
                Ok(res) => {
                    if !res.status().is_success() {
                        eprintln!("[Memory Sync] Failed to sync to cloud: {}", res.status());
                    }
                }
                Err(e) => {
                    eprintln!("[Memory Sync] Error syncing to cloud: {e}");
                }
            }
        });
    });
}"""

text = re.sub(r'pub fn sync_summary_to_cloud.*', new_body, text, flags=re.DOTALL)

with open("rust/crates/runtime/src/memory.rs", "w") as f:
    f.write(text)
