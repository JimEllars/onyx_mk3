use async_trait::async_trait;
use regex::Regex;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticLog {
    pub incident_id: Option<String>,
    pub app_id: Option<String>,
    pub http_status: Option<u16>,
    pub endpoint: Option<String>,
    pub error_signature: Option<String>,
    pub stack_trace: Option<String>,
    #[serde(default)]
    pub raw_env: HashMap<String, String>,
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
    pub last_10_transaction_logs: Vec<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SandboxedWorkspaceRules {
    pub allowed_file_paths: Vec<String>,
    pub verification_command: String,
    pub max_execution_time_seconds: u32,
    pub quota_token_allocation: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecurityMask {
    pub stripped_variables: Vec<String>,
    pub mock_variable_stubs: HashMap<String, String>,
}

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
pub struct OnyxInvestigationPanel {
    pub code_difference_metrics: Option<String>,
    pub error_analysis: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoDraftWhisper {
    pub deployment_commands: Option<String>,
    pub proposed_fix: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SupportTriageResponse {
    pub resolution_state: String,
    pub incident_id: Option<String>,
    pub confidence_score: f64,
    pub investigation_panel: OnyxInvestigationPanel,
    pub auto_draft_whisper: AutoDraftWhisper,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escalation_payload: Option<DiagnosticPayload>,
}

/// Identifies sensitive environment keys (Stripe, API keys, passwords, etc)
/// and replaces their values with safe mock stubs. Returns the masked map
/// along with the `SecurityMask` summary for Claude Cowork.
#[must_use]
pub fn apply_security_mask<S: ::std::hash::BuildHasher + Default>(
    raw_env: &HashMap<String, String, S>,
) -> (HashMap<String, String>, SecurityMask) {
    let mut masked_env = HashMap::default();
    let mut stripped_variables = Vec::new();
    let mut mock_variable_stubs = HashMap::default();

    for key in raw_env.keys() {
        let k_lower = key.to_lowercase();

        let is_sensitive = k_lower.contains("stripe")
            || k_lower.contains("secret")
            || k_lower.contains("token")
            || k_lower.contains("api")
            || k_lower.contains("password")
            || k_lower.contains("auth")
            || k_lower.contains("supabase");

        if is_sensitive {
            stripped_variables.push(key.clone());

            let mock_stub = if k_lower.contains("stripe") {
                "[STRIPE_MASKED]".to_string()
            } else if k_lower.contains("supabase") {
                "[SUPABASE_MASKED]".to_string()
            } else if k_lower.contains("axim") {
                "[AXIM_MASKED]".to_string()
            } else {
                "[CREDENTIAL_MASKED]".to_string()
            };

            mock_variable_stubs.insert(key.clone(), mock_stub.clone());
            masked_env.insert(key.clone(), mock_stub);
        } else {
            masked_env.insert(key.clone(), raw_env[key].clone());
        }
    }

    let mask = SecurityMask {
        stripped_variables,
        mock_variable_stubs,
    };

    (masked_env, mask)
}

/// Scrub explicit keys/tokens from freeform text like error signatures and stack traces.
#[must_use]
pub fn scrub_error_log(text: &str) -> String {
    let mut scrubbed = text.to_string();

    let _re_assignment = Regex::new(r#"(?i)("?'?(stripe_secret_key|supabase_service_role_key|api_key|secret_key|password|token|auth)"?'?\s*[:=]\s*)("?'?[^"'\s,{}]+?"?'?)"#).unwrap();

    let re_assignment_safe = Regex::new(r#"(?i)("?'?(stripe_secret_key|supabase_service_role_key|api_key|secret_key|password|token|auth)"?'?\s*[:=]\s*)("?'?)[^"'\s,{}]+("?'?)"#).unwrap();
    scrubbed = re_assignment_safe
        .replace_all(&scrubbed, "${1}${3}[CREDENTIAL_MASKED]${4}")
        .to_string();

    let re_stripe = Regex::new(r"(?i)\b(sk_(live|test)_[a-zA-Z0-9]+)\b").unwrap();
    let re_jwt = Regex::new(r"\b(ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b").unwrap();

    scrubbed = re_stripe
        .replace_all(&scrubbed, "[STRIPE_MASKED]")
        .to_string();
    scrubbed = re_jwt
        .replace_all(&scrubbed, "[CREDENTIAL_MASKED]")
        .to_string();

    scrubbed
}

/// Truncate logs to avoid overflowing serialization blocks and crashing frontends.
#[must_use]
pub fn truncate_log(text: &str, max_len: usize) -> String {
    if text.len() > max_len {
        let mut truncated = text[..max_len].to_string();
        truncated.push_str("\n...[TRUNCATED_DUE_TO_SIZE]...");
        truncated
    } else {
        text.to_string()
    }
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
            Ok((
                0.92,
                "Found historical match: Null-check required for stripe_session_id.".to_string(),
            ))
        } else {
            Ok((
                0.45,
                "No high-confidence match found in vector_kb.".to_string(),
            ))
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

    async fn check_idempotency(
        &self,
        payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        let diagnostic_log: DiagnosticLog = serde_json::from_value(payload.meta_data.clone())
            .map_err(|e| format!("Failed to parse diagnostic log: {e}"))?;

        if let Some(id) = diagnostic_log.incident_id {
            if id == "cached_inc_999" {
                return Ok(Some(json!({
                    "incident_id": id,
                    "confidence_score": 0.99,
                    "investigation_panel": {
                        "error_analysis": "Cached historical RCA"
                    },
                    "idempotent": true
                })));
            }
        }
        Ok(None)
    }

    async fn execute(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let diagnostic_log: DiagnosticLog = serde_json::from_value(payload.meta_data.clone())
            .map_err(|e| format!("Failed to parse diagnostic log: {e}"))?;

        // 1. Semantic search to query internal vector_kb
        let raw_error_sig = diagnostic_log.error_signature.clone().unwrap_or_default();
        let error_sig = truncate_log(&scrub_error_log(&raw_error_sig), 2000);

        let (confidence_score, historical_analysis) = self.query_vector_kb(&error_sig).await?;

        // 2. Prepare base investigation panel and auto-draft whisper
        let investigation_panel = OnyxInvestigationPanel {
            code_difference_metrics: Some(
                "diff --git a/worker.js b/worker.js\n+ if (!session_id) return;".to_string(),
            ),
            error_analysis: Some(historical_analysis),
        };

        let auto_draft_whisper = AutoDraftWhisper {
            deployment_commands: Some("npm run test && npx wrangler deploy".to_string()),
            proposed_fix: Some(
                "Apply null-safety check before accessing stripe_session_id properties."
                    .to_string(),
            ),
        };

        // 3. Escalation Scaffold (Tier 4)
        let escalation_payload = if confidence_score < 0.85 {
            let (_, security_mask) = apply_security_mask(&diagnostic_log.raw_env);

            let stack_trace = diagnostic_log
                .stack_trace
                .clone()
                .map(|st| truncate_log(&scrub_error_log(&st), 4000));

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
                    error_signature: Some(error_sig),
                    stack_trace,
                    last_10_transaction_logs: vec![], // In a real scenario, fetch recent logs
                },
                sandboxed_workspace_rules: SandboxedWorkspaceRules {
                    allowed_file_paths: vec!["worker.js".to_string(), "wrangler.jsonc".to_string()],
                    verification_command: "npm run test && npm run build".to_string(),
                    max_execution_time_seconds: 180,
                    quota_token_allocation: 45000,
                },
                security_mask,
            })
        } else {
            None
        };

        let resolution_state = if confidence_score >= 0.85 { "Deterministic Auto-Heal Staged".to_string() } else { "Tier 4 Action Handoff Routing".to_string() };

        let response = SupportTriageResponse {
            resolution_state,
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
        let timestamp = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        raw_env.insert(
            "STRIPE_SECRET_KEY".to_string(),
            format!("foo_live_{timestamp}"),
        );
        raw_env.insert("NORMAL_VAR".to_string(), "hello_world".to_string());
        raw_env.insert("MY_token_123".to_string(), format!("tkn_{timestamp}"));
        raw_env.insert(
            "database_password".to_string(),
            format!("p@ssw0rd_{timestamp}"),
        );
        raw_env.insert(
            "MULTILINE_SECRET".to_string(),
            format!("abc\ndef_{timestamp}"),
        );
        raw_env.insert("AXIM_API_KEY".to_string(), format!("{timestamp}axim"));
        raw_env.insert(
            "supabase_service_role".to_string(),
            format!("sb_mock_{timestamp}"),
        );

        let (masked_env, security_mask) = apply_security_mask(&raw_env);

        assert_eq!(masked_env.get("NORMAL_VAR").unwrap(), "hello_world");
        assert_eq!(
            masked_env.get("STRIPE_SECRET_KEY").unwrap(),
            "[STRIPE_MASKED]"
        );

        assert_eq!(
            masked_env.get("MY_token_123").unwrap(),
            "[CREDENTIAL_MASKED]"
        );
        assert_eq!(
            masked_env.get("database_password").unwrap(),
            "[CREDENTIAL_MASKED]"
        );
        assert_eq!(masked_env.get("AXIM_API_KEY").unwrap(), "[AXIM_MASKED]");
        assert_eq!(
            masked_env.get("supabase_service_role").unwrap(),
            "[SUPABASE_MASKED]"
        );

        assert!(security_mask
            .stripped_variables
            .contains(&"STRIPE_SECRET_KEY".to_string()));
        assert!(security_mask
            .stripped_variables
            .contains(&"MY_token_123".to_string()));
        assert!(security_mask
            .stripped_variables
            .contains(&"database_password".to_string()));
        assert!(security_mask
            .stripped_variables
            .contains(&"MULTILINE_SECRET".to_string()));
    }

    #[test]
    fn test_scrub_error_log() {
        let timestamp = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        let input1 = format!(
            "Error: Invalid stripe_secret_key=foo_live_abcdef{timestamp} in configuration."
        );
        let out1 = scrub_error_log(&input1);
        assert_eq!(
            out1,
            "Error: Invalid stripe_secret_key=[CREDENTIAL_MASKED] in configuration."
        );

        let input2 =
            format!("Token mismatch: eyJDVU1NWSJ9.eyJEVU1NWSJ9.{timestamp} failed validation");
        let out2 = scrub_error_log(&input2);
        assert_eq!(
            out2,
            "Token mismatch: [CREDENTIAL_MASKED] failed validation"
        );

        let input3 = format!(r#"{{"stripe_secret_key": "foo_test_{timestamp}", "other": 123}}"#);
        let out3 = scrub_error_log(&input3);
        assert_eq!(
            out3,
            r#"{"stripe_secret_key": "[CREDENTIAL_MASKED]", "other": 123}"#
        );

        let input4 = format!("Using sk_live_{timestamp} for initialization.");
        let out4 = scrub_error_log(&input4);
        assert_eq!(out4, "Using [STRIPE_MASKED] for initialization.");
    }

    #[test]
    fn test_truncate_log() {
        let input = "1234567890";
        let out1 = truncate_log(input, 5);
        assert_eq!(out1, "12345\n...[TRUNCATED_DUE_TO_SIZE]...");

        let out2 = truncate_log(input, 20);
        assert_eq!(out2, "1234567890");
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
