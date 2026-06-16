import re

with open("rust/crates/tools/src/cloudflare_ops.rs", "r") as f:
    content = f.read()

search_text = """pub async fn execute_verify_edge_deployment(
    input: VerifyEdgeDeploymentInput,
) -> Result<VerifyEdgeDeploymentOutput, String> {
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
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("X-Auth-Email", email)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

        let deployments = body["result"].as_array().ok_or("Invalid response format")?;

        if let Some(latest) = deployments.first() {
            let status = latest["latest_stage"]["status"]
                .as_str()
                .unwrap_or("unknown");

            if status == "success" {
                return Ok(VerifyEdgeDeploymentOutput {
                    is_synced: true,
                    status: status.to_string(),
                });
            }
            let err_msg = format!(
                "CRITICAL: Edge Sync Failure for {}. Latest status: {}",
                input.project_name, status
            );

            // Fire off the emails
            let _ = crate::communication_ops::execute_send_email(
                "jrellars@gmail.com",
                "Edge Sync Failure",
                &err_msg,
            )
            .await;
            let _ = crate::communication_ops::execute_send_email(
                "james.ellars@axim.us.com",
                "Edge Sync Failure",
                &err_msg,
            )
            .await;

            return Ok(VerifyEdgeDeploymentOutput {
                is_synced: false,
                status: status.to_string(),
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
}"""

replace_text = """pub async fn execute_verify_edge_deployment(
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
}"""

content = content.replace(search_text, replace_text)

with open("rust/crates/tools/src/cloudflare_ops.rs", "w") as f:
    f.write(content)
