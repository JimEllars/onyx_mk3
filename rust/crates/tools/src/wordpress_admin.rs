use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchPostInput {
    pub post_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchPostOutput {
    pub content: String,
}

pub async fn execute_fetch_post(input: FetchPostInput) -> Result<FetchPostOutput, String> {
    let wp_url = std::env::var("WP_REST_URL").map_err(|_| "WP_REST_URL is not set")?;
    let app_password = std::env::var("WP_APPLICATION_PASSWORD").map_err(|_| "WP_APPLICATION_PASSWORD is not set")?;

    let client = reqwest::Client::new();
    let url = format!("{}/wp/v2/posts/{}", wp_url, input.post_id);

    let wp_user = std::env::var("WP_USER").map_err(|_| "WP_USER is not set")?;

    let res = client
        .get(&url)
        .basic_auth(wp_user, Some(app_password))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let data: Value = res.json().await.map_err(|e| e.to_string())?;
        let content = data["content"]["rendered"].as_str().unwrap_or("").to_string();
        Ok(FetchPostOutput { content })
    } else {
        Err(format!("Failed to fetch post: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePostContentInput {
    pub post_id: u64,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePostContentOutput {
    pub success: bool,
}

pub async fn execute_update_post_content(input: UpdatePostContentInput) -> Result<UpdatePostContentOutput, String> {
    let wp_url = std::env::var("WP_REST_URL").map_err(|_| "WP_REST_URL is not set")?;
    let app_password = std::env::var("WP_APPLICATION_PASSWORD").map_err(|_| "WP_APPLICATION_PASSWORD is not set")?;

    let client = reqwest::Client::new();
    let url = format!("{}/wp/v2/posts/{}", wp_url, input.post_id);

    let wp_user = std::env::var("WP_USER").map_err(|_| "WP_USER is not set")?;

    let res = client
        .post(&url)
        .basic_auth(wp_user, Some(app_password))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "content": input.content
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(UpdatePostContentOutput { success: true })
    } else {
        Err(format!("Failed to update post: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSeoMetadataInput {
    pub post_id: u64,
    pub helmet_payload: Value, // react-helmet-async compatible payload
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSeoMetadataOutput {
    pub success: bool,
}

pub async fn execute_update_seo_metadata(input: UpdateSeoMetadataInput) -> Result<UpdateSeoMetadataOutput, String> {
    let wp_url = std::env::var("WP_REST_URL").map_err(|_| "WP_REST_URL is not set")?;
    let app_password = std::env::var("WP_APPLICATION_PASSWORD").map_err(|_| "WP_APPLICATION_PASSWORD is not set")?;

    let client = reqwest::Client::new();
    let url = format!("{}/wp/v2/posts/{}", wp_url, input.post_id);

    // Assuming SEO metadata is stored in ACF or post meta
    let wp_user = std::env::var("WP_USER").map_err(|_| "WP_USER is not set")?;

    let res = client
        .post(&url)
        .basic_auth(wp_user, Some(app_password))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "meta": {
                "helmet_payload": input.helmet_payload
            }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(UpdateSeoMetadataOutput { success: true })
    } else {
        Err(format!("Failed to update SEO metadata: {}", res.status()))
    }
}
