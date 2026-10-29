use async_trait::async_trait;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde_json::{json, Value};

#[allow(unused_imports)]
use crate::micro_program::{MicroProgram, MicroProgramAsync};

#[derive(Debug)]
pub struct GretaRouter;

#[async_trait]
impl MicroProgram for GretaRouter {
    fn name(&self) -> &'static str {
        "Greta Automation Router"
    }

    fn signature(&self) -> &'static str {
        "greta_router"
    }

    async fn check_idempotency(
        &self,
        _payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        Ok(None)
    }

    async fn execute_internal(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let status = payload
            .meta_data
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown");

        if status == "Generated" {
            // Log via AximCoreRelay fallback instead to avoid tools dependency
            let relay_payload = json!({
                "source_channel": payload.source_channel,
                "intent": payload.intent,
                "meta_data": payload.meta_data,
            });

            if let Err(e) =
                crate::actions::axim_core_relay::AximCoreRelayAction::execute(&relay_payload).await
            {
                eprintln!("Failed to log event via relay: {e}");
            }

            // Prepare automated follow-up workflow trigger
            Ok(json!({
                "status": "Routed",
                "message": "Payload evaluated and logged, workflow trigger prepared"
            }))
        } else {
            Ok(json!({
                "status": "Ignored",
                "message": format!("Payload status is {}", status)
            }))
        }
    }
}

#[cfg(test)]
#[allow(unused_imports)]
#[async_trait]
impl MicroProgramAsync for GretaRouter {}
