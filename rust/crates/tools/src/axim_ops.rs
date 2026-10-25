use crate::http_client::send_with_circuit_breaker;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalateToAdminInput {
    pub subject: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalateToAdminOutput {
    pub success: bool,
}

pub async fn execute_escalate_to_admin(
    input: EscalateToAdminInput,
) -> Result<EscalateToAdminOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/send-email");

    let payload = serde_json::json!({
        "to": "james.ellars@axim.us.com",
        "cc": "jrellars@gmail.com",
        "subject": input.subject,
        "severity": input.severity,
        "message": input.message,
    });

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload);
    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        Ok(EscalateToAdminOutput { success: true })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerMarketingLoopInput {
    pub topic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerMarketingLoopOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_trigger_marketing_loop(
    input: TriggerMarketingLoopInput,
) -> Result<TriggerMarketingLoopOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/functions/roundups-connector");

    let payload = serde_json::json!({
        "topic": input.topic,
    });

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload);
    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        Ok(TriggerMarketingLoopOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileMicroAppRevenueInput {
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileMicroAppRevenueOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_reconcile_micro_app_revenue(
    input: ReconcileMicroAppRevenueInput,
) -> Result<ReconcileMicroAppRevenueOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    // As per instruction, fetches latest conversion events from Supabase and prepares them for Tabby accounting webhook.
    // In AXiM Core this might be exposed via an endpoint.
    let url = format!("{axim_core_url}/api/v1/functions/reconcile-revenue");

    let payload = serde_json::json!({
        "limit": input.limit.unwrap_or(100),
    });

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload);
    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        Ok(ReconcileMicroAppRevenueOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

pub async fn execute_fetch_ecosystem_manifest() -> Result<serde_json::Value, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/system/manifest");

    let request = client
        .get(&url)
        .header("Authorization", format!("Bearer {service_key}"));
    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        let json: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse JSON: {e}"))?;
        Ok(json)
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

use hmac::{Hmac, Mac};
use sha2::Sha256;
type HmacSha256 = Hmac<Sha256>;

fn sign_payload(payload: &serde_json::Value, secret: &str) -> Result<String, String> {
    let payload_str =
        serde_json::to_string(payload).map_err(|e| format!("Failed to serialize payload: {e}"))?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| format!("Invalid key length: {e}"))?;
    mac.update(payload_str.as_bytes());
    let result = mac.finalize().into_bytes();
    Ok(hex::encode(result))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotCreateProjectInput {
    pub name: String,
    pub robot_class: String,
    pub target_specs: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotCreateProjectOutput {
    pub success: bool,
    pub project_id: Option<String>,
    pub error: Option<String>,
}

pub async fn execute_robot_create_project(
    input: RobotCreateProjectInput,
) -> Result<RobotCreateProjectOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/robotics/projects");
    let payload = serde_json::json!({
        "name": input.name,
        "robot_class": input.robot_class, "target_specs": input.target_specs,
    });

    let signature = sign_payload(&payload, &service_key)?;

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("X-Signature", signature)
        .header("Content-Type", "application/json")
        .json(&payload);

    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.unwrap_or_default();
        Ok(RobotCreateProjectOutput {
            success: true,
            project_id: json["project_id"]
                .as_str()
                .map(std::string::ToString::to_string),
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotSpawnSimInput {
    pub scene_type: String,
    pub duration_sec: f64,
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotSpawnSimOutput {
    pub success: bool,
    pub sim_id: Option<String>,
    pub error: Option<String>,
}

pub async fn execute_robot_spawn_sim(
    input: RobotSpawnSimInput,
) -> Result<RobotSpawnSimOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/robotics/sim");
    let payload = serde_json::json!({
        "scene_type": input.scene_type,
        "duration_sec": input.duration_sec, "project_id": input.project_id,
    });

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload);

    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.unwrap_or_default();
        Ok(RobotSpawnSimOutput {
            success: true,
            sim_id: json["sim_id"]
                .as_str()
                .map(std::string::ToString::to_string),
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotEvaluatePolicyInput {
    pub policy_id: String,
    pub benchmark_suite: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotEvaluatePolicyOutput {
    pub success: bool,
    pub evaluation_id: Option<String>,
    pub error: Option<String>,
}

pub async fn execute_robot_evaluate_policy(
    input: RobotEvaluatePolicyInput,
) -> Result<RobotEvaluatePolicyOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!(
        "{}/api/v1/robotics/policies/{}/evaluate",
        axim_core_url, input.policy_id
    );
    let request = client
        .get(&url)
        .query(&[("benchmark_suite", &input.benchmark_suite)])
        .header("Authorization", format!("Bearer {service_key}"));

    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.unwrap_or_default();
        Ok(RobotEvaluatePolicyOutput {
            success: true,
            evaluation_id: json["evaluation_id"]
                .as_str()
                .map(std::string::ToString::to_string),
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotDeployOtaInput {
    pub policy_id: String,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotDeployOtaOutput {
    pub success: bool,
    pub deployment_id: Option<String>,
    pub error: Option<String>,
}

pub async fn execute_robot_deploy_ota(
    input: RobotDeployOtaInput,
) -> Result<RobotDeployOtaOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let release_key = crate::axim_vault::fetch_vault_secret("INTERNAL_RELEASE_KEY")
        .await
        .unwrap_or_else(|_| service_key.clone());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/robotics/firmware/ota");
    let payload = serde_json::json!({
        "policy_id": input.policy_id,
        "node_id": input.node_id,
    });

    let signature = sign_payload(&payload, &release_key)?;

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("X-Release-Signature", signature)
        .header("Content-Type", "application/json")
        .json(&payload);

    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.unwrap_or_default();
        Ok(RobotDeployOtaOutput {
            success: true,
            deployment_id: json["deployment_id"]
                .as_str()
                .map(std::string::ToString::to_string),
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotEmergencyStopInput {
    pub node_id_or_fleet: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotEmergencyStopOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_robot_emergency_stop(
    input: RobotEmergencyStopInput,
) -> Result<RobotEmergencyStopOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/robotics/fleet/emergency-stop");
    let payload = serde_json::json!({
        "node_id_or_fleet": input.node_id_or_fleet,
        "reason": input.reason,
    });

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("X-Priority", "HIGH")
        .header("Content-Type", "application/json")
        .json(&payload);

    let res = send_with_circuit_breaker(request).await?;

    if res.status().is_success() {
        Ok(RobotEmergencyStopOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}
