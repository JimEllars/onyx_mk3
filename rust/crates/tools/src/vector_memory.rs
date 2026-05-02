use reqwest::Client;
use serde_json::json;
use uuid::Uuid;

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

pub async fn upsert_memory(text: &str, metadata: serde_json::Value) -> Result<(), String> {
    let vector = generate_embedding(text).await?;

    let api_key = crate::axim_vault::fetch_vault_secret("PINECONE_API_KEY")
        .await
        .map_err(|e| format!("Failed to fetch PINECONE_API_KEY from vault: {e}"))?;

    let host = crate::axim_vault::fetch_vault_secret("PINECONE_HOST")
        .await
        .map_err(|e| format!("Failed to fetch PINECONE_HOST from vault: {e}"))?;

    let id = Uuid::new_v4().to_string();

    let client = Client::new();
    let url = format!("{host}/vectors/upsert");

    let response = client
        .post(&url)
        .header("Api-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&json!({
            "vectors": [{
                "id": id,
                "values": vector,
                "metadata": metadata
            }]
        }))
        .send()
        .await
        .map_err(|e| format!("Pinecone upsert request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Pinecone API returned error status: {}", response.status()));
    }

    Ok(())
}

pub async fn query_memory(query_text: &str, top_k: u32) -> Result<Vec<serde_json::Value>, String> {
    let vector = generate_embedding(query_text).await?;

    let api_key = crate::axim_vault::fetch_vault_secret("PINECONE_API_KEY")
        .await
        .map_err(|e| format!("Failed to fetch PINECONE_API_KEY from vault: {e}"))?;

    let host = crate::axim_vault::fetch_vault_secret("PINECONE_HOST")
        .await
        .map_err(|e| format!("Failed to fetch PINECONE_HOST from vault: {e}"))?;

    let client = Client::new();
    let url = format!("{host}/query");

    let response = client
        .post(&url)
        .header("Api-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&json!({
            "vector": vector,
            "topK": top_k,
            "includeMetadata": true
        }))
        .send()
        .await
        .map_err(|e| format!("Pinecone query request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Pinecone API returned error status: {}", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response body: {e}"))?;

    let matches = body["matches"]
        .as_array()
        .ok_or_else(|| "Failed to extract matches array from response".to_string())?
        .iter()
        .filter_map(|v| v["metadata"].as_object().map(|_| v["metadata"].clone()))
        .collect::<Vec<serde_json::Value>>();

    Ok(matches)
}
