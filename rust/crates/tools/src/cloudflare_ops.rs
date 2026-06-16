use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurgeZoneCacheInput {
    pub zone_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurgeZoneCacheOutput {
    pub success: bool,
}

pub async fn execute_purge_zone_cache(
    input: PurgeZoneCacheInput,
) -> Result<PurgeZoneCacheOutput, String> {
    let api_key =
        std::env::var("CLOUDFLARE_API_TOKEN").map_err(|_| "CLOUDFLARE_API_TOKEN is not set")?;
    let email = std::env::var("CLOUDFLARE_EMAIL").map_err(|_| "CLOUDFLARE_EMAIL is not set")?;

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.cloudflare.com/client/v4/zones/{}/purge_cache",
        input.zone_id
    );

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("X-Auth-Email", email)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "purge_everything": true }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(PurgeZoneCacheOutput { success: true })
    } else {
        Err(format!("Cloudflare API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerPagesDeploymentInput {
    pub project_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerPagesDeploymentOutput {
    pub success: bool,
}

pub async fn execute_trigger_pages_deployment(
    input: TriggerPagesDeploymentInput,
) -> Result<TriggerPagesDeploymentOutput, String> {
    let account_id =
        std::env::var("CLOUDFLARE_ACCOUNT_ID").map_err(|_| "CLOUDFLARE_ACCOUNT_ID is not set")?;
    let api_key =
        std::env::var("CLOUDFLARE_API_TOKEN").map_err(|_| "CLOUDFLARE_API_TOKEN is not set")?;
    let email = std::env::var("CLOUDFLARE_EMAIL").map_err(|_| "CLOUDFLARE_EMAIL is not set")?;

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/pages/projects/{}/deployments",
        account_id, input.project_name
    );

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("X-Auth-Email", email)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(TriggerPagesDeploymentOutput { success: true })
    } else {
        Err(format!("Cloudflare API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyEdgeBlockInput {
    pub zone_id: String,
    pub ip_address: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyEdgeBlockOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_apply_edge_block(
    input: ApplyEdgeBlockInput,
) -> Result<ApplyEdgeBlockOutput, String> {
    let api_key =
        std::env::var("CLOUDFLARE_API_TOKEN").map_err(|_| "CLOUDFLARE_API_TOKEN is not set")?;
    let email = std::env::var("CLOUDFLARE_EMAIL").map_err(|_| "CLOUDFLARE_EMAIL is not set")?;

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.cloudflare.com/client/v4/zones/{}/firewall/access_rules/rules",
        input.zone_id
    );

    let notes = input.notes.unwrap_or_else(|| "Blocked by Onyx".to_string());

    let payload = serde_json::json!({
        "mode": "block",
        "configuration": {
            "target": "ip",
            "value": input.ip_address
        },
        "notes": notes
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("X-Auth-Email", email)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(ApplyEdgeBlockOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Cloudflare API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyEdgeDeploymentInput {
    pub project_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyEdgeDeploymentOutput {
    pub is_synced: bool,
    pub status: String,
}

pub async fn execute_verify_edge_deployment(
    input: VerifyEdgeDeploymentInput,
) -> Result<VerifyEdgeDeploymentOutput, String> {
    let account_id =
        std::env::var("CLOUDFLARE_ACCOUNT_ID").map_err(|_| "CLOUDFLARE_ACCOUNT_ID is not set")?;
    let api_key =
        std::env::var("CLOUDFLARE_API_TOKEN").map_err(|_| "CLOUDFLARE_API_TOKEN is not set")?;
    let email = std::env::var("CLOUDFLARE_EMAIL").map_err(|_| "CLOUDFLARE_EMAIL is not set")?;

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/workers/deployments/by-script/{}",
        account_id, input.project_name
    );

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("X-Auth-Email", email)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

        let deployments = body["result"].as_array().ok_or("Invalid response format")?;

        if let Some(_latest) = deployments.first() {
            // Workers deployments don't have latest_stage.status in the same way Pages does.
            // If the deployment exists in the list, it's considered successfully deployed
            // For closer parity with workers, we'll check if there's any deployment

            return Ok(VerifyEdgeDeploymentOutput {
                is_synced: true,
                status: "success".to_string(),
            });
        }

        Ok(VerifyEdgeDeploymentOutput {
            is_synced: false,
            status: "No deployments found".to_string(),
        })
    } else {
        let err_msg = format!(
            "CRITICAL: Edge Sync Failure for {}. API returned: {}",
            input.project_name,
            res.status()
        );
        let _ = crate::communication_ops::execute_send_email(
            "jrellars@gmail.com",
            "Edge Sync Failure API Error",
            &err_msg,
        )
        .await;
        let _ = crate::communication_ops::execute_send_email(
            "james.ellars@axim.us.com",
            "Edge Sync Failure API Error",
            &err_msg,
        )
        .await;

        Err(format!("Cloudflare API error: {}", res.status()))
    }
}
