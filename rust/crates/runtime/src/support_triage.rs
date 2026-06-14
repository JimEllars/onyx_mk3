use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IncidentMetadata {
    pub incident_id: String,
    pub timestamp: String,
    pub target_application: TargetApplication,
    pub telemetry_context: TelemetryContext,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum IncidentRoute {
    DeterministicAutoHeal,
    Tier4ActionLayerStaging,
}

#[must_use]
pub fn evaluate_similarity(score: f32) -> IncidentRoute {
    if score >= 0.85 {
        IncidentRoute::DeterministicAutoHeal
    } else {
        IncidentRoute::Tier4ActionLayerStaging
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OnyxInvestigationPanelData {
    pub incident_id: String,
    pub error_signature: String,
    pub stack_trace: String,
    pub route: IncidentRoute,
    pub context_summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoDraftWhisperData {
    pub incident_id: String,
    pub proposed_fix: String,
    pub git_patch_command: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SupportTriagePayload {
    pub investigation_panel: OnyxInvestigationPanelData,
    pub auto_draft: AutoDraftWhisperData,
}

pub fn mask_secrets(payload_json: &mut serde_json::Value) {
    if let Some(obj) = payload_json.as_object_mut() {
        for (key, value) in obj.iter_mut() {
            if value.is_string() {
                let v_str = value.as_str().unwrap();
                if key == "STRIPE_SECRET_KEY"
                    || v_str.contains("sk_test_")
                    || v_str.contains("sk_live_")
                {
                    *value =
                        serde_json::Value::String("sk_test_mock_axim_cowork_string".to_string());
                } else if key == "SUPABASE_SERVICE_ROLE_KEY" || v_str.starts_with("eyJ") {
                    *value = serde_json::Value::String("sb_mock_service_role".to_string());
                }
            } else if value.is_object() {
                mask_secrets(value);
            } else if value.is_array() {
                for item in value.as_array_mut().unwrap() {
                    mask_secrets(item);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_similarity_evaluation() {
        assert_eq!(
            evaluate_similarity(0.90),
            IncidentRoute::DeterministicAutoHeal
        );
        assert_eq!(
            evaluate_similarity(0.85),
            IncidentRoute::DeterministicAutoHeal
        );
        assert_eq!(
            evaluate_similarity(0.84),
            IncidentRoute::Tier4ActionLayerStaging
        );
    }

    #[test]
    fn test_mask_secrets() {
        let mut payload = json!({
            "target": "test",
            "keys": {
                "STRIPE_SECRET_KEY": "sk_live_123456789",
                "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
                "other": "normal value"
            }
        });

        mask_secrets(&mut payload);

        let keys = payload["keys"].as_object().unwrap();
        assert_eq!(
            keys["STRIPE_SECRET_KEY"].as_str().unwrap(),
            "sk_test_mock_axim_cowork_string"
        );
        assert_eq!(
            keys["SUPABASE_SERVICE_ROLE_KEY"].as_str().unwrap(),
            "sb_mock_service_role"
        );
        assert_eq!(keys["other"].as_str().unwrap(), "normal value");
    }
}
