import re

with open("rust/crates/tools/src/supabase_ops.rs", "r") as f:
    content = f.read()

target = """#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckMicroAppTransactionsInput {"""

replacement = """#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordIncidentResolutionInput {
    pub incident: String,
    pub tool_executed: String,
    pub approval_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordIncidentResolutionOutput {
    pub success: bool,
    pub log_only: Option<bool>,
}

pub async fn execute_record_incident_resolution(input: RecordIncidentResolutionInput, config: &RuntimeConfig) -> Result<RecordIncidentResolutionOutput, String> {
    let supabase_url = config.get("SUPABASE_URL").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_URL").unwrap_or_default(), String::from);
    let supabase_key = config.get("SUPABASE_SERVICE_ROLE_KEY").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(), String::from);

    if input.approval_token.is_none() {
        println!("[Dry Run] Would record incident resolution: {} via {}", input.incident, input.tool_executed);
        return Ok(RecordIncidentResolutionOutput { success: true, log_only: Some(true) });
    }

    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/incident_memory", supabase_url);

    let payload = serde_json::json!({
        "incident": input.incident,
        "tool_executed": input.tool_executed,
    });

    let res = client
        .post(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(RecordIncidentResolutionOutput { success: true, log_only: None })
    } else {
        Err(format!("Supabase API error recording incident: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckMicroAppTransactionsInput {"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/tools/src/supabase_ops.rs", "w") as f:
        f.write(content)
    print("Added record_incident_resolution")
