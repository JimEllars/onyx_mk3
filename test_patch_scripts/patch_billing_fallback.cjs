const fs = require('fs');

const targetFile = 'rust/crates/commands/src/extensions/billing_fallback.rs';
let content = fs.readFileSync(targetFile, 'utf8');

// 1. Add tokio::fs import
if (!content.includes('tokio::fs')) {
  content = content.replace('use serde_json::{json, Value};', 'use serde_json::{json, Value};\nuse tokio::fs;\nuse chrono::Utc;');
}

// 2. Define LocalTokenQueue
if (!content.includes('LocalTokenQueue')) {
  const structCode = `
#[derive(Debug, Serialize, Deserialize)]
pub struct LocalTokenQueue {
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub token_count: usize,
}
`;
  content = content.replace('#[derive(Debug, Serialize, Deserialize, Default)]', structCode + '\n#[derive(Debug, Serialize, Deserialize, Default)]');
}

// 3. Implement queue_failed_transaction function inside BillingFallback impl
if (!content.includes('queue_failed_transaction')) {
  const funcCode = `
    pub async fn queue_failed_transaction(
        provider: &str,
        model: &str,
        token_count: usize,
    ) -> Result<(), String> {
        let queue_item = LocalTokenQueue {
            timestamp: Utc::now().to_rfc3339(),
            provider: provider.to_string(),
            model: model.to_string(),
            token_count,
        };

        let path = std::path::PathBuf::from("billing_fallback.json");

        let mut existing_queue: Vec<LocalTokenQueue> = match fs::read_to_string(&path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        };

        existing_queue.push(queue_item);

        let json_str = serde_json::to_string_pretty(&existing_queue)
            .map_err(|e| format!("Serialization error: {}", e))?;

        fs::write(&path, json_str)
            .await
            .map_err(|e| format!("File write error: {}", e))?;

        Ok(())
    }
`;
  content = content.replace('impl BillingFallback {', 'impl BillingFallback {' + funcCode);
}

fs.writeFileSync(targetFile, content);
