use crate::chatbase_ops::{execute_consult_chatbase_agent, ConsultChatbaseAgentInput};
use crate::communication_ops::{execute_dispatch_executive_brief, DispatchExecutiveBriefInput};
use std::fmt::Write;

pub async fn run_daily_department_sync(company_update: &str) -> Result<(), String> {
    let roles = ["CEO", "CTO", "CFO", "COO", "Legal"];
    let mut compiled_report = String::new();

    compiled_report.push_str("Daily Department Sync Report\n");
    compiled_report.push_str("============================\n\n");

    for role in roles {
        let input = ConsultChatbaseAgentInput {
            agent_role: role.to_string(),
            message: company_update.to_string(),
            conversation_id: None,
        };

        match execute_consult_chatbase_agent(input).await {
            Ok(output) => {
                let _ = writeln!(compiled_report, "--- Report from {role} ---");
                compiled_report.push_str(&output.text);
                compiled_report.push_str("\n\n");
            }
            Err(e) => {
                let _ = writeln!(compiled_report, "--- Error from {role} ---");
                let _ = write!(compiled_report, "Failed to consult agent: {e}\n\n");
            }
        }
    }

    let brief_input = DispatchExecutiveBriefInput {
        message_body: compiled_report,
        priority: "high".to_string(),
    };

    execute_dispatch_executive_brief(brief_input).await?;

    Ok(())
}

pub async fn execute_sync_directives(
    directives: &str,
    milestones: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let base_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let api_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY not set".to_string())?;

    let url = format!("{base_url}/api/v1/executive/sync");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let payload = serde_json::json!({
        "directives": directives,
        "milestones": milestones,
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if res.status().is_success() {
        let data: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok(data)
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}
