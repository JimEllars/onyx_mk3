use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::error::ApiError;
use crate::http_client::build_http_client_or_default;
use crate::types::{MessageRequest, MessageResponse, Usage};
use crate::MessageStream;

use super::{Provider, ProviderFuture};

#[allow(dead_code)]
pub const DEFAULT_CLOUDFLARE_BASE_URL: &str = "https://api.cloudflare.com/client/v4/accounts";

#[derive(Debug, Clone)]
pub struct CloudflareProvider {
    http: reqwest::Client,
    api_key: String,
    account_id: String,
    base_url: String,
}

impl CloudflareProvider {
    #[allow(dead_code)]
    #[must_use]
    pub fn new(api_key: impl Into<String>, account_id: impl Into<String>) -> Self {
        let default_base_url = std::env::var("CLOUDFLARE_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_CLOUDFLARE_BASE_URL.to_string());

        Self {
            http: build_http_client_or_default(),
            api_key: api_key.into(),
            account_id: account_id.into(),
            base_url: default_base_url,
        }
    }

    #[allow(dead_code)]
    pub fn from_env() -> Result<Self, ApiError> {
        let api_key = std::env::var("CLOUDFLARE_API_TOKEN")
            .map_err(|_| ApiError::missing_credentials("Cloudflare", &["CLOUDFLARE_API_TOKEN"]))?;

        let account_id = std::env::var("CLOUDFLARE_ACCOUNT_ID")
            .map_err(|_| ApiError::missing_credentials("Cloudflare", &["CLOUDFLARE_ACCOUNT_ID"]))?;

        Ok(Self::new(api_key, account_id))
    }
}

impl Provider for CloudflareProvider {
    type Stream = MessageStream;

    fn send_message<'a>(
        &'a self,
        request: &'a MessageRequest,
    ) -> ProviderFuture<'a, MessageResponse> {
        let url = format!("{}/{}/ai/run", self.base_url, self.account_id);

        let mut messages = Vec::new();
        if let Some(system_prompt) = &request.system {
            messages.push(json!({
                "role": "system",
                "content": system_prompt
            }));
        }

        for msg in &request.messages {
            // Very simplified for now just for tests
            let text = match &msg.content[0] {
                crate::types::InputContentBlock::Text { text } => text.clone(),
                _ => String::new(),
            };

            messages.push(json!({
                "role": msg.role,
                "content": text
            }));
        }

        let model = request.model.clone();

        let payload = json!({
            "model": model,
            "input": {
                "messages": messages
            }
        });

        let http = self.http.clone();
        let api_key = self.api_key.clone();

        Box::pin(async move {
            let res = http
                .post(&url).header("X-Request-ID", uuid::Uuid::new_v4().to_string())
                .header("Authorization", format!("Bearer {api_key}"))
                .header("cf-aig-gateway-id", "default")
                .json(&payload)
                .send()
                .await
                .map_err(ApiError::Http)?;

            if !res.status().is_success() {
                let status = res.status();
                let body = res.text().await.unwrap_or_default();
                return Err(ApiError::Api {
                    status,
                    error_type: None,
                    message: None,
                    request_id: None,
                    body,
                    retryable: false,
                });
            }

            let body_text = res.text().await.map_err(ApiError::Http)?;
            let data: Value = serde_json::from_str(&body_text)
                .map_err(|e| ApiError::json_deserialize("Cloudflare", &model, &body_text, e))?;

            // Expected format: { "result": { "response": "..." }, "success": true }
            let response_text = data
                .get("result")
                .and_then(|r| r.get("response"))
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string();

            Ok(MessageResponse {
                id: format!(
                    "msg_{}",
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_millis()
                ),
                kind: "message".to_string(),
                role: "assistant".to_string(),
                content: vec![crate::types::OutputContentBlock::Text {
                    text: response_text,
                }],
                model: model.clone(),
                stop_reason: Some("stop".to_string()),
                stop_sequence: None,
                usage: Usage {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
                request_id: None,
            })
        })
    }

    fn stream_message<'a>(
        &'a self,
        _request: &'a MessageRequest,
    ) -> ProviderFuture<'a, Self::Stream> {
        // Mock stream implementation for now just returning an error
        Box::pin(async move {
            Err(ApiError::Api {
                status: reqwest::StatusCode::NOT_IMPLEMENTED,
                error_type: None,
                message: Some("Streaming not implemented yet for Cloudflare".to_string()),
                request_id: None,
                body: String::new(),
                retryable: false,
            })
        })
    }
}
