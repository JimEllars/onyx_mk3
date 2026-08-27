use async_trait::async_trait;
use chrono::Utc;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::fs;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalTokenQueue {
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub token_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct BillingFallbackRequest {
    #[serde(default)]
    pub on_chain_tx_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillingFallbackResponse {
    pub payment_gateway: String,
    pub on_chain_tx_hash: String,
    pub status: String,
    pub verification_message: String,
}

#[derive(Debug)]
pub struct BillingFallback;

#[async_trait]
impl MicroProgram for BillingFallback {
    fn name(&self) -> &'static str {
        "Arbitrum Fallback Billing"
    }

    fn signature(&self) -> &'static str {
        "billing_fallback"
    }

    async fn check_idempotency(
        &self,
        payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        let req: BillingFallbackRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();
        if let Some(h) = req.on_chain_tx_hash {
            // Mock API call to check if this transaction has already been verified
            if h == "0x_already_verified" {
                return Ok(Some(json!({
                    "status": "Verified",
                    "payment_gateway": "arbitrum_layer2",
                    "on_chain_tx_hash": h,
                    "verification_message": "Transaction verified previously (idempotent cache hit)"
                })));
            }
        }
        Ok(None)
    }

    async fn execute_internal(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        // Retrieve transaction hash from payload
        let req: BillingFallbackRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();

        let tx_hash = match req.on_chain_tx_hash {
            Some(h) if !h.is_empty() => h,
            _ => return Err("Missing required field: on_chain_tx_hash".to_string()),
        };

        // Query Arbitrum JSON-RPC (stub/mock)
        // In production, this would make an actual RPC call to Arbitrum layer 2.
        // For testing/parity, we simulate verifying the transaction receipt.
        let is_verified = Self::verify_arbitrum_transaction_stub(&tx_hash);

        if is_verified {
            let res = BillingFallbackResponse {
                payment_gateway: "arbitrum_layer2".to_string(),
                on_chain_tx_hash: tx_hash.clone(),
                status: "Verified".to_string(),
                verification_message: format!(
                    "Transaction {tx_hash} successfully verified on Arbitrum L2"
                ),
            };
            Ok(json!(res))
        } else {
            Err(format!(
                "Transaction {tx_hash} could not be verified on-chain"
            ))
        }
    }
}

impl BillingFallback {
    pub async fn queue_failed_transaction(
        provider: &str,
        model: &str,
        token_count: usize,
    ) -> Result<(), String> {
        let queue_item = LocalTokenQueue {
            timestamp: Utc::now().to_rfc3339(),
            provider: provider.to_string(),
            model: model.to_string(),
            token_count,
        };

        let path = std::path::PathBuf::from("billing_fallback.json");

        let mut existing_queue: Vec<LocalTokenQueue> = match fs::read_to_string(&path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        };

        existing_queue.push(queue_item);

        let json_str = serde_json::to_string_pretty(&existing_queue)
            .map_err(|e| format!("Serialization error: {e}"))?;

        fs::write(&path, json_str)
            .await
            .map_err(|e| format!("File write error: {e}"))?;

        Ok(())
    }

    fn verify_arbitrum_transaction_stub(tx_hash: &str) -> bool {
        // Stub: assume transaction is valid if it starts with "0x"
        tx_hash.starts_with("0x") && tx_hash.len() > 10
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use runtime::dispatch::TaskPriority;

    fn create_payload(meta_data: Value) -> AximWebhookPayload {
        AximWebhookPayload {
            source_channel: format!("channel_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)),
            intent: "billing_fallback".to_string(),
            priority: TaskPriority::Standard,
            meta_data,
            timestamp: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_billing_fallback_verified() {
        let program = BillingFallback;
        let tx_hash = "0x1234567890abcdef";
        let meta = json!({
            "on_chain_tx_hash": tx_hash
        });

        let payload = create_payload(meta);
        let result = program.execute(&payload).await.unwrap();
        let res: BillingFallbackResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Verified");
        assert_eq!(res.payment_gateway, "arbitrum_layer2");
        assert_eq!(res.on_chain_tx_hash, tx_hash);
    }

    #[tokio::test]
    async fn test_billing_fallback_invalid_hash() {
        let program = BillingFallback;
        let tx_hash = "invalid_hash_no_0x";
        let meta = json!({
            "on_chain_tx_hash": tx_hash
        });

        let payload = create_payload(meta);
        let result = program.execute(&payload).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("could not be verified"));
    }

    #[tokio::test]
    async fn test_billing_fallback_missing_hash() {
        let program = BillingFallback;
        let meta = json!({});

        let payload = create_payload(meta);
        let result = program.execute(&payload).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Missing required field"));
    }
}
