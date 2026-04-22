with open("rust/crates/runtime/src/memory.rs", "r") as f:
    text = f.read()

text = text.replace('format!("{}/rest/v1/ai_chat_history_ax2024", supabase_url)', 'format!("{supabase_url}/rest/v1/ai_chat_history_ax2024")')
text = text.replace('format!("Bearer {}", supabase_key)', 'format!("Bearer {supabase_key}")')
text = text.replace('eprintln!("[Memory Sync] Error syncing to cloud: {}", e)', 'eprintln!("[Memory Sync] Error syncing to cloud: {e}")')

with open("rust/crates/runtime/src/memory.rs", "w") as f:
    f.write(text)

with open("rust/crates/runtime/src/playbook.rs", "r") as f:
    text = f.read()

text = text.replace('the workflows_ax2024 table', 'the `workflows_ax2024` table')
text = text.replace('format!(\n            "{}/rest/v1/workflows_ax2024?id=eq.{}&select=*",\n            supabase_url, cloud_id\n        )', 'format!("{supabase_url}/rest/v1/workflows_ax2024?id=eq.{cloud_id}&select=*")')
text = text.replace('format!("{}/rest/v1/workflows_ax2024?id=eq.{}&select=*", supabase_url, cloud_id)', 'format!("{supabase_url}/rest/v1/workflows_ax2024?id=eq.{cloud_id}&select=*")')
text = text.replace('format!("Bearer {}", supabase_key)', 'format!("Bearer {supabase_key}")')
text = text.replace('format!("Network error fetching playbook: {}", e)', 'format!("Network error fetching playbook: {e}")')
text = text.replace('format!("Failed to parse response: {}", e)', 'format!("Failed to parse response: {e}")')
text = text.replace('format!("Failed to parse playbook definition: {}", e)', 'format!("Failed to parse playbook definition: {e}")')

with open("rust/crates/runtime/src/playbook.rs", "w") as f:
    f.write(text)
