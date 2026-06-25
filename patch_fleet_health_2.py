import re
import sys

def patch():
    with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
        content = f.read()

    replacement = """
pub async fn evaluate_health_with_ai_dynamic(
    diagnostic_data: HealthDiagnostic,
    mcp_manager: &McpServerManager,
) -> Result<RemediationAction, String> {
    let _ = crate::lane_events::handle_telemetry_event(&crate::lane_events::TelemetryEvent {
        r#type: "health_evaluation_started".to_string(),
        payload: serde_json::json!({
            "app_id": diagnostic_data.app_id,
            "status_code": diagnostic_data.status_code,
            "error_rate": diagnostic_data.error_rate,
        }),
    })
    .await;

    let ai_mode = std::env::var("FLEET_AI_MODE").unwrap_or_else(|_| "dynamic".to_string());

    let allowlist = vec![
        "restart_mcp_server",
        "reduce_request_rate",
        "purge_zone_cache",
        "execute_circuit_breaker",
        "log_incident"
    ];

    let action = if ai_mode == "llm" {
        // We'll trust the allowlist and dynamic tools
        // A full MCP server inspection via `discover_tools_best_effort` can be done here if needed.
        let mut available_tools = allowlist.clone();

        let system_prompt = format!(
            "You are an AI DevOps agent. Given the diagnostic: {:?}\n\
            And the available tools: {:?}\n\
            Choose the best tool to resolve the issue. You MUST respond with a JSON object: {{\\"tool_name\\": \\"name\\", \\"arguments\\": {{}}, \\"reason\\": \\"why\\"}}",
            diagnostic_data, available_tools
        );

        let mut llm_action = None;
        if let Ok(simulated_response) = std::env::var("SIMULATED_LLM_FLEET_RESPONSE") {
            if let Ok(action) = serde_json::from_str::<RemediationAction>(&simulated_response) {
                if allowlist.contains(&action.tool_name.as_str()) {
                    llm_action = Some(action);
                } else {
                    println!("[Fleet Health] LLM suggested tool outside allowlist: {}", action.tool_name);
                }
            }
        }

        llm_action.unwrap_or_else(|| fallback_dynamic_eval(&diagnostic_data))
    } else {
        fallback_dynamic_eval(&diagnostic_data)
    };

    let _ = crate::lane_events::handle_telemetry_event(&crate::lane_events::TelemetryEvent {
        r#type: "health_evaluation_completed".to_string(),
        payload: serde_json::json!({
            "app_id": diagnostic_data.app_id,
            "action": action.tool_name,
            "automated": true,
        }),
    })
    .await;

    Ok(action)
}
"""

    # find `pub async fn evaluate_health_with_ai_dynamic` and replace it entirely up to the `fn fallback_dynamic_eval`
    start_idx = content.find("pub async fn evaluate_health_with_ai_dynamic(")
    end_idx = content.find("fn fallback_dynamic_eval(")

    if start_idx == -1 or end_idx == -1:
        print("Function not found!")
        sys.exit(1)

    new_content = content[:start_idx] + replacement + "\n" + content[end_idx:]

    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(new_content)

patch()
