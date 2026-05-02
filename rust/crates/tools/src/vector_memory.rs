use reqwest::Client;
use serde_json::json;

#[allow(clippy::cast_possible_truncation)]
pub async fn generate_embedding(text: &str) -> Result<Vec<f32>, String> {
    let api_key = crate::axim_vault::fetch_vault_secret("OPENAI_API_KEY")
        .await
        .map_err(|e| format!("Failed to fetch OPENAI_API_KEY from vault: {e}"))?;

    let client = Client::new();
    let url = "https://api.openai.com/v1/embeddings";

    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&json!({
            "input": text,
            "model": "text-embedding-3-small"
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("API returned error status: {}", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response body: {e}"))?;

    let embedding = body["data"][0]["embedding"]
        .as_array()
        .ok_or_else(|| "Failed to extract embedding array from response".to_string())?
        .iter()
        .filter_map(|v| v.as_f64().map(|f| f as f32))
        .collect::<Vec<f32>>();

    if embedding.is_empty() {
        return Err("Extracted embedding is empty or invalid format".to_string());
    }

    Ok(embedding)
}
