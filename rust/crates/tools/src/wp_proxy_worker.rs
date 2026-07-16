use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WpProxyPayload {
    pub content: String,
    pub brand_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WpProxyResponse {
    pub success: bool,
}

pub async fn execute_publish_to_proxy(
    payload: WpProxyPayload,
) -> Result<WpProxyResponse, String> {
    let proxy_url = std::env::var("WP_PROXY_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());

    let client = reqwest::Client::new();
    let res = client
        .post(&format!("{}/publish", proxy_url))
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("HTTP Error: {}", e))?;

    if res.status().is_success() {
        Ok(WpProxyResponse { success: true })
    } else {
        Err(format!("Proxy returned status: {}", res.status()))
    }
}
