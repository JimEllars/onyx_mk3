use reqwest::Client;
use serde_json::json;
use std::env;

#[allow(clippy::cast_possible_truncation)]
pub async fn generate_embedding(text: &str) -> Result<Vec<f32>, String> {
    // Generate embedding through AXiM Core instead of local API call to OpenAI
    let core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let api_key =
        env::var("AXIM_ONYX_SECRET").map_err(|_| "AXIM_ONYX_SECRET not set".to_string())?;

    let client = Client::new();
    let url = format!("{core_url}/api/v1/embeddings");

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&json!({ "input": text }))
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

    let embedding = body["embedding"]
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
    let core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let api_key =
        env::var("AXIM_ONYX_SECRET").map_err(|_| "AXIM_ONYX_SECRET not set".to_string())?;

    let client = Client::new();
    // AXiM Core Edge Function for upserting memory
    let url = format!("{core_url}/api/v1/memory-banks/upsert");

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&json!({
            "content": text,
            "metadata": metadata
        }))
        .send()
        .await
        .map_err(|e| format!("AXiM Core memory upsert request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "AXiM Core memory API returned error status: {}",
            response.status()
        ));
    }

    Ok(())
}

pub async fn query_memory(query_text: &str, top_k: u32) -> Result<Vec<serde_json::Value>, String> {
    let core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let api_key =
        env::var("AXIM_ONYX_SECRET").map_err(|_| "AXIM_ONYX_SECRET not set".to_string())?;

    let client = Client::new();
    let url = format!("{core_url}/api/v1/memory-retrieval");

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&json!({
            "query": query_text,
            "top_k": top_k
        }))
        .send()
        .await
        .map_err(|e| format!("AXiM Core memory query request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "AXiM Core memory API returned error status: {}",
            response.status()
        ));
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

#[derive(Debug, serde::Deserialize, serde::Serialize, sqlx::FromRow)]
pub struct MemoryBankRecord {
    pub id: String,
    pub content: String,
    pub metadata: serde_json::Value,
}

// Stub for search_memory_banks
pub async fn search_memory_banks(
    pool: &sqlx::PgPool,
    query_embedding: Vec<f32>,
    limit: i64,
) -> Result<Vec<MemoryBankRecord>, sqlx::Error> {
    let records = sqlx::query_as::<_, MemoryBankRecord>(
        r"
        SELECT id::text as id, content, metadata
        FROM memory_banks
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        ",
    )
    .bind(format!("{query_embedding:?}")) // passing as string to cast to vector
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(records)
}
