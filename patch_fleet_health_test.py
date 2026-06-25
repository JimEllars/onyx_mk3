import re
import sys

def patch():
    with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
        content = f.read()

    replacement = """
    #[tokio::test]
    async fn test_llm_mode_fallback_on_invalid_response() {
        std::env::set_var("FLEET_AI_MODE", "llm");
        std::env::remove_var("SIMULATED_LLM_FLEET_RESPONSE");

        let manager = McpServerManager::new();

        let diag = HealthDiagnostic {
            app_id: "test2".to_string(),
            status_code: Some(502),
            error_rate: 0.1,
            mcp_server_status: "ok".to_string(),
        };

        let action = evaluate_health_with_ai_dynamic(diag, &manager).await.unwrap();
        assert_eq!(action.tool_name, "restart_mcp_server");
    }

    #[tokio::test]
    async fn test_llm_mode_rejects_unallowed_tool() {
        std::env::set_var("FLEET_AI_MODE", "llm");
        let simulated_resp = serde_json::json!({
            "tool_name": "rm_rf_slash",
            "arguments": {},
            "reason": "because"
        });
        std::env::set_var("SIMULATED_LLM_FLEET_RESPONSE", simulated_resp.to_string());

        let manager = McpServerManager::new();

        let diag = HealthDiagnostic {
            app_id: "test3".to_string(),
            status_code: Some(502),
            error_rate: 0.1,
            mcp_server_status: "ok".to_string(),
        };

        let action = evaluate_health_with_ai_dynamic(diag, &manager).await.unwrap();
        // Since `rm_rf_slash` is blocked, it falls back to dynamic eval which picks `restart_mcp_server`
        assert_eq!(action.tool_name, "restart_mcp_server");
    }
"""

    start_idx = content.find("    #[tokio::test]\n    async fn test_llm_mode_fallback_on_invalid_response() {")
    end_idx = content.find("}\n}\n", start_idx) + 1

    if start_idx == -1 or end_idx == -1:
        print("Function not found!")
        sys.exit(1)

    new_content = content[:start_idx] + replacement.strip() + "\n" + content[end_idx:]

    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(new_content)

patch()
