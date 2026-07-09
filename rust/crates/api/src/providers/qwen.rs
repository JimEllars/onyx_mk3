use crate::error::ApiError;
use crate::http_client::build_http_client_or_default;
use crate::types::{MessageRequest, MessageResponse, ProxyDispatchPayload};

use super::{preflight_message_request, Provider, ProviderFuture};

#[derive(Debug, Clone)]
pub struct QwenProvider {
    pub http: reqwest::Client,
    pub api_key: String,
    pub base_url: String,
}

impl QwenProvider {
    #[must_use]
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client_or_default(),
            api_key: api_key.into(),
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
        }
    }

    pub fn from_env() -> Result<Self, ApiError> {
        let api_key = match std::env::var("QWEN_API_KEY") {
            Ok(key) if !key.is_empty() => key,
            _ => return Err(ApiError::missing_credentials("Qwen", &["QWEN_API_KEY"])),
        };
        Ok(Self::new(api_key))
    }

    #[allow(clippy::unused_self)]
    pub fn build_proxy_payload(&self, request: &MessageRequest) -> ProxyDispatchPayload {
        ProxyDispatchPayload::from_request("Qwen", request)
    }

    #[allow(clippy::unused_async)]
    pub async fn send_message(
        &self,
        request: &MessageRequest,
    ) -> Result<MessageResponse, ApiError> {
        preflight_message_request(request)?;
        let _payload = self.build_proxy_payload(request);

        Err(ApiError::Api {
            status: reqwest::StatusCode::NOT_IMPLEMENTED,
            error_type: None,
            message: Some("Qwen stub not fully wired to llm-proxy yet".to_string()),
            request_id: None,
            body: String::new(),
            retryable: false,
        })
    }

    #[allow(clippy::unused_async)]
    pub async fn stream_message(
        &self,
        request: &MessageRequest,
    ) -> Result<crate::MessageStream, ApiError> {
        preflight_message_request(request)?;
        let _payload = self.build_proxy_payload(request);

        Err(ApiError::Api {
            status: reqwest::StatusCode::NOT_IMPLEMENTED,
            error_type: None,
            message: Some("Qwen stub not fully wired to llm-proxy yet".to_string()),
            request_id: None,
            body: String::new(),
            retryable: false,
        })
    }
}

impl Provider for QwenProvider {
    type Stream = crate::MessageStream;

    fn send_message<'a>(
        &'a self,
        request: &'a MessageRequest,
    ) -> ProviderFuture<'a, MessageResponse> {
        Box::pin(async move { self.send_message(request).await })
    }

    fn stream_message<'a>(
        &'a self,
        request: &'a MessageRequest,
    ) -> ProviderFuture<'a, Self::Stream> {
        Box::pin(async move { self.stream_message(request).await })
    }
}
