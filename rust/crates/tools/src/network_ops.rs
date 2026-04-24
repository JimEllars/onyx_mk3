use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyUrlStatusInput {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyUrlStatusOutput {
    pub status_code: u16,
    pub response_time_ms: u64,
    pub success: bool,
}

pub async fn execute_verify_url_status(
    input: VerifyUrlStatusInput,
) -> Result<VerifyUrlStatusOutput, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let start_time = Instant::now();
    let res = client
        .get(&input.url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let duration = u64::try_from(start_time.elapsed().as_millis()).unwrap_or(u64::MAX);

    Ok(VerifyUrlStatusOutput {
        status_code: res.status().as_u16(),
        response_time_ms: duration,
        success: res.status().is_success(),
    })
}
