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
    pub incident_id: String,
    pub app_id: String,
    pub endpoint: String,
    pub http_status: u16,
    pub error_signature: String,
    pub stack_trace: String,
    pub execution_time_ms: i32,
    #[serde(default)]
    pub raw_env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SupportTriageResponse {
    pub incident_id: String,
    pub confidence_score: f64,
    pub investigation_panel: OnyxInvestigationPanel,
    pub auto_draft_whisper: AutoDraftWhisper,
    pub escalation_payload: Option<DiagnosticPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OnyxInvestigationPanel {
    pub code_difference_metrics: String,
    pub error_analysis: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoDraftWhisper {
    pub deployment_commands: String,
    pub proposed_fix: String,
}

// -----------------------------------------------------------------------------
// Escalation Schemas (Tier 4)
// -----------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticPayload {
    pub incident_id: String,
    pub timestamp: String,
    pub target_application: TargetApplication,
    pub telemetry_context: TelemetryContext,
    pub sandboxed_workspace_rules: SandboxedWorkspaceRules,
    pub security_mask: SecurityMask,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TargetApplication {
    pub app_id: String,
    pub runtime_environment: String,
    pub active_branch: String,
    pub repository_source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TelemetryContext {
    pub endpoint: String,
    pub http_status: u16,
    pub error_signature: String,
    pub stack_trace: String,
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

    let sensitive_keys = vec![
        "STRIPE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "AXIM_ONYX_SECRET",
        "CLOUDFLARE_API_TOKEN",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "CORE_CRYPTO_KEY",
    ];

    for key in sensitive_keys {
        if masked_env.contains_key(key) {
            stripped_variables.push(key.to_string());
            let mock_stub = format!("mock_{}_stub_safe_for_sandboxing", key.to_lowercase());
            mock_variable_stubs.insert(key.to_string(), mock_stub.clone());
            masked_env.insert(key.to_string(), mock_stub);
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
    /// Scaffolds a semantic search query against the internal `vector_kb`.
    #[allow(clippy::unused_async)]
    async fn query_vector_kb(&self, error_signature: &str) -> Result<(f64, String), String> {
        // TODO: Implement actual pgvector connection
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
        let (confidence_score, historical_analysis) = self
            .query_vector_kb(&diagnostic_log.error_signature)
            .await?;

        // 2. Prepare base investigation panel and auto-draft whisper
        let investigation_panel = OnyxInvestigationPanel {
            code_difference_metrics: "diff --git a/worker.js b/worker.js\n+ if (!session_id) return;".to_string(),
            error_analysis: historical_analysis,
        };

        let auto_draft_whisper = AutoDraftWhisper {
            deployment_commands: "npm run test && npx wrangler deploy".to_string(),
            proposed_fix: "Apply null-safety check before accessing stripe_session_id properties.".to_string(),
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
