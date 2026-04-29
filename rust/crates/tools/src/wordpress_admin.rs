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
    let app_password = std::env::var("WP_APPLICATION_PASSWORD")
        .map_err(|_| "WP_APPLICATION_PASSWORD is not set")?;

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
        let content = data["content"]["rendered"]
            .as_str()
            .unwrap_or("")
            .to_string();
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

pub async fn execute_update_post_content(
    input: UpdatePostContentInput,
) -> Result<UpdatePostContentOutput, String> {
    let wp_url = std::env::var("WP_REST_URL").map_err(|_| "WP_REST_URL is not set")?;
    let app_password = std::env::var("WP_APPLICATION_PASSWORD")
        .map_err(|_| "WP_APPLICATION_PASSWORD is not set")?;

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

pub async fn execute_update_seo_metadata(
    input: UpdateSeoMetadataInput,
) -> Result<UpdateSeoMetadataOutput, String> {
    let wp_url = std::env::var("WP_REST_URL").map_err(|_| "WP_REST_URL is not set")?;
    let app_password = std::env::var("WP_APPLICATION_PASSWORD")
        .map_err(|_| "WP_APPLICATION_PASSWORD is not set")?;

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

pub async fn execute_create_wordpress_post(
    title: &str,
    content: &str,
    status: &str,
) -> Result<serde_json::Value, String> {
    let wp_url = std::env::var("WP_API_URL").map_err(|_| "WP_API_URL is not set")?;
    let app_password = match std::env::var("WP_API_KEY") { Ok(k) => k, Err(_) => crate::axim_vault::fetch_vault_secret("WP_API_KEY").await.map_err(|e| format!("WP_API_KEY is not set and vault fetch failed: {e}"))? };
    let wp_user = std::env::var("WP_USER").unwrap_or_else(|_| "admin".to_string()); // Assume admin if not set? Actually instructions didn't specify WP_USER, but basic auth needs a username. I'll use WP_USER or empty. Let's use WP_USER like other functions.

    let client = reqwest::Client::new();
    let url = format!("{wp_url}/wp/v2/posts");

    let res = client
        .post(&url)
        .basic_auth(wp_user, Some(app_password))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "title": title,
            "content": content,
            "status": status
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let data: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(data)
    } else {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        Err(format!("Failed to create post: {status} - {text}"))
    }
}

pub async fn execute_update_wordpress_post(
    post_id: u64,
    content: &str,
) -> Result<serde_json::Value, String> {
    let wp_url = std::env::var("WP_API_URL").map_err(|_| "WP_API_URL is not set")?;
    let app_password = match std::env::var("WP_API_KEY") { Ok(k) => k, Err(_) => crate::axim_vault::fetch_vault_secret("WP_API_KEY").await.map_err(|e| format!("WP_API_KEY is not set and vault fetch failed: {e}"))? };
    let wp_user = std::env::var("WP_USER").unwrap_or_else(|_| "admin".to_string());

    let client = reqwest::Client::new();
    let url = format!("{wp_url}/wp/v2/posts/{post_id}");

    let res = client
        .post(&url)
        .basic_auth(wp_user, Some(app_password))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "content": content
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let data: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(data)
    } else {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        Err(format!("Failed to update post: {status} - {text}"))
    }
}
