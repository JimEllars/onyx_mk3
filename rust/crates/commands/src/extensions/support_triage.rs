use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use crate::micro_program::MicroProgram;
use std::collections::HashMap;

// -----------------------------------------------------------------------------
// Core Request/Response Schemas
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticLog {
    pub incident_id: Option<String>,
    pub app_id: Option<String>,
    pub endpoint: Option<String>,
    pub http_status: Option<u16>,
    pub error_signature: Option<String>,
    pub stack_trace: Option<String>,
    pub execution_time_ms: Option<i32>,
    #[serde(default)]
    pub raw_env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SupportTriageResponse {
    pub incident_id: Option<String>,
    pub confidence_score: f64,
    pub investigation_panel: OnyxInvestigationPanel,
    pub auto_draft_whisper: AutoDraftWhisper,
    pub escalation_payload: Option<DiagnosticPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OnyxInvestigationPanel {
    pub code_difference_metrics: Option<String>,
    pub error_analysis: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoDraftWhisper {
    pub deployment_commands: Option<String>,
    pub proposed_fix: Option<String>,
}

// -----------------------------------------------------------------------------
// Escalation Schemas (Tier 4)
// -----------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticPayload {
    pub incident_id: Option<String>,
    pub timestamp: String,
    pub target_application: TargetApplication,
    pub telemetry_context: TelemetryContext,
    pub sandboxed_workspace_rules: SandboxedWorkspaceRules,
    pub security_mask: SecurityMask,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TargetApplication {
    pub app_id: Option<String>,
    pub runtime_environment: String,
    pub active_branch: String,
    pub repository_source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TelemetryContext {
    pub endpoint: Option<String>,
    pub http_status: Option<u16>,
    pub error_signature: Option<String>,
    pub stack_trace: Option<String>,
    pub last_10_transaction_logs: Vec<TransactionLog>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionLog {
    pub tx_id: String,
    pub latency_ms: i32,
    pub status: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SandboxedWorkspaceRules {
    pub allowed_file_paths: Vec<String>,
    pub verification_command: String,
    pub max_execution_time_seconds: u32,
    pub quota_token_allocation: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityMask {
    pub stripped_variables: Vec<String>,
    pub mock_variable_stubs: HashMap<String, String>,
}

// -----------------------------------------------------------------------------
// Security Mask Utility
// -----------------------------------------------------------------------------

/// Masks sensitive production credentials from telemetry/env data
/// replacing them with safe mock stubs.
#[must_use]
pub fn apply_security_mask<S: ::std::hash::BuildHasher + Default>(raw_env: &HashMap<String, String, S>) -> (HashMap<String, String>, SecurityMask) {
    let mut masked_env: HashMap<String, String> = raw_env.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let mut stripped_variables = Vec::new();
    let mut mock_variable_stubs = HashMap::default();

    for key in raw_env.keys() {
        let k_lower = key.to_lowercase();
        if k_lower.contains("stripe") || k_lower.contains("secret") || k_lower.contains("token")
            || k_lower.contains("key") || k_lower.contains("password") || k_lower.contains("auth")
            || k_lower.contains("credential")
        {
            stripped_variables.push(key.clone());
            let mock_stub = format!("mock_{}_stub_safe_for_sandboxing", key.to_lowercase());
            mock_variable_stubs.insert(key.clone(), mock_stub.clone());
            masked_env.insert(key.clone(), mock_stub);
        }
    }

    let mask = SecurityMask {
        stripped_variables,
        mock_variable_stubs,
    };

    (masked_env, mask)
}

// -----------------------------------------------------------------------------
// MicroProgram Implementation
// -----------------------------------------------------------------------------

#[derive(Debug)]
pub struct SupportTriage;

impl SupportTriage {
    /// Executes a semantic search query against the internal `vector_kb`.
    /// Architectural Note: This module must remain fully self-contained.
    /// It must query the central `AXiM` Core API (or an approved local vector index)
    /// rather than attempting to spin up unauthorized external database connections.
    #[allow(clippy::unused_async)]
    async fn query_vector_kb(&self, error_signature: &str) -> Result<(f64, String), String> {
        // TODO: Implement actual AXiM Core API pgvector connection
        // For now, mock the similarity score and retrieved historical fix
        let is_known = error_signature.contains("Cannot read properties of undefined");
        if is_known {
            Ok((0.92, "Found historical match: Null-check required for stripe_session_id.".to_string()))
        } else {
            Ok((0.45, "No high-confidence match found in vector_kb.".to_string()))
        }
    }
}

#[async_trait]
impl MicroProgram for SupportTriage {
    fn name(&self) -> &'static str {
        "Support Triage & RCA"
    }

    fn signature(&self) -> &'static str {
        "triage_support"
    }

    async fn execute(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let diagnostic_log: DiagnosticLog = serde_json::from_value(payload.meta_data.clone())
            .map_err(|e| format!("Failed to parse diagnostic log: {e}"))?;

        // 1. Semantic search to query internal vector_kb
        let error_sig = diagnostic_log.error_signature.clone().unwrap_or_default();
        let (confidence_score, historical_analysis) = self
            .query_vector_kb(&error_sig)
            .await?;

        // 2. Prepare base investigation panel and auto-draft whisper
        let investigation_panel = OnyxInvestigationPanel {
            code_difference_metrics: Some("diff --git a/worker.js b/worker.js\n+ if (!session_id) return;".to_string()),
            error_analysis: Some(historical_analysis),
        };

        let auto_draft_whisper = AutoDraftWhisper {
            deployment_commands: Some("npm run test && npx wrangler deploy".to_string()),
            proposed_fix: Some("Apply null-safety check before accessing stripe_session_id properties.".to_string()),
        };

        // 3. Escalation Scaffold (Tier 4)
        let escalation_payload = if confidence_score < 0.85 {
            let (_, security_mask) = apply_security_mask(&diagnostic_log.raw_env);

            Some(DiagnosticPayload {
                incident_id: diagnostic_log.incident_id.clone(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                target_application: TargetApplication {
                    app_id: diagnostic_log.app_id.clone(),
                    runtime_environment: "cloudflare_workers".to_string(),
                    active_branch: "main".to_string(),
                    repository_source: "axim-systems/micro-app".to_string(),
                },
                telemetry_context: TelemetryContext {
                    endpoint: diagnostic_log.endpoint.clone(),
                    http_status: diagnostic_log.http_status,
                    error_signature: diagnostic_log.error_signature.clone(),
                    stack_trace: diagnostic_log.stack_trace.clone(),
                    last_10_transaction_logs: vec![], // In a real scenario, fetch recent logs
                },
                sandboxed_workspace_rules: SandboxedWorkspaceRules {
                    allowed_file_paths: vec![
                        "worker.js".to_string(),
                        "wrangler.jsonc".to_string(),
                    ],
                    verification_command: "npm run test && npm run build".to_string(),
                    max_execution_time_seconds: 180,
                    quota_token_allocation: 45000,
                },
                security_mask,
            })
        } else {
            None
        };

        let response = SupportTriageResponse {
            incident_id: diagnostic_log.incident_id,
            confidence_score,
            investigation_panel,
            auto_draft_whisper,
            escalation_payload,
        };

        Ok(json!(response))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_security_mask_strips_sensitive_keys() {
        let mut raw_env = HashMap::new();
        raw_env.insert("STRIPE_SECRET_KEY".to_string(), "sk_live_12345".to_string());
        raw_env.insert("NORMAL_VAR".to_string(), "hello_world".to_string());
        raw_env.insert("MY_token_123".to_string(), "tkn_xyz".to_string());
        raw_env.insert("database_password".to_string(), "p@ssw0rd".to_string());
        raw_env.insert("MULTILINE_SECRET".to_string(), "abc\ndef".to_string());

        let (masked_env, security_mask) = apply_security_mask(&raw_env);

        assert_eq!(masked_env.get("NORMAL_VAR").unwrap(), "hello_world");
        assert_ne!(masked_env.get("STRIPE_SECRET_KEY").unwrap(), "sk_live_12345");
        assert_eq!(masked_env.get("STRIPE_SECRET_KEY").unwrap(), "mock_stripe_secret_key_stub_safe_for_sandboxing");

        assert_ne!(masked_env.get("MY_token_123").unwrap(), "tkn_xyz");
        assert_ne!(masked_env.get("database_password").unwrap(), "p@ssw0rd");
        assert_ne!(masked_env.get("MULTILINE_SECRET").unwrap(), "abc\ndef");

        assert!(security_mask.stripped_variables.contains(&"STRIPE_SECRET_KEY".to_string()));
        assert!(security_mask.stripped_variables.contains(&"MY_token_123".to_string()));
        assert!(security_mask.stripped_variables.contains(&"database_password".to_string()));
        assert!(security_mask.stripped_variables.contains(&"MULTILINE_SECRET".to_string()));
    }

    #[test]
    fn test_diagnostic_log_deserialization_with_missing_fields() {
        let json_data = r#"{
            "incident_id": "inc_123"
        }"#;

        let log: Result<DiagnosticLog, _> = serde_json::from_str(json_data);
        assert!(log.is_ok());
        let log = log.unwrap();
        assert_eq!(log.incident_id, Some("inc_123".to_string()));
        assert_eq!(log.app_id, None);
        assert_eq!(log.http_status, None);
    }
}
