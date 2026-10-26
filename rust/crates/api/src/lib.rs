mod client;
mod error;
pub mod http_client;
mod prompt_cache;
pub mod providers;
pub mod router;
mod sse;
pub mod types;
pub mod worker_pool;

pub use client::{
    oauth_token_is_expired, read_base_url, read_xai_base_url, resolve_saved_oauth_token,
    resolve_startup_auth_source, MessageStream, OAuthTokenSet, ProviderClient,
};
pub use error::ApiError;
pub use http_client::{
    build_http_client, build_http_client_or_default, build_http_client_with, ProxyConfig,
};
pub use prompt_cache::{
    CacheBreakEvent, PromptCache, PromptCacheConfig, PromptCachePaths, PromptCacheRecord,
    PromptCacheStats,
};
pub use providers::anthropic::{AnthropicClient, AnthropicClient as ApiClient, AuthSource};
pub use providers::openai_compat::{OpenAiCompatClient, OpenAiCompatConfig};
pub use providers::{
    detect_provider_kind, heuristic_router, max_tokens_for_model,
    max_tokens_for_model_with_override, resolve_model_alias, spawn_provider_health_heartbeat,
    ProviderKind,
};
pub use sse::{parse_frame, SseParser};
pub use types::{
    ContentBlockDelta, ContentBlockDeltaEvent, ContentBlockStartEvent, ContentBlockStopEvent,
    InputContentBlock, InputMessage, MessageDelta, MessageDeltaEvent, MessageRequest,
    MessageResponse, MessageStartEvent, MessageStopEvent, OutputContentBlock, StreamEvent,
    ToolChoice, ToolDefinition, ToolResultContentBlock, Usage,
};

pub use telemetry::{
    AnalyticsEvent, AnthropicRequestProfile, ClientIdentity, JsonlTelemetrySink,
    MemoryTelemetrySink, SessionTraceRecord, SessionTracer, TelemetryEvent, TelemetrySink,
    DEFAULT_ANTHROPIC_VERSION,
};

#[async_trait::async_trait]
impl runtime::fleet_health::FleetLlmEvaluator for client::ProviderClient {
    async fn evaluate_diagnostic(
        &self,
        system_prompt: &str,
        model: &str,
    ) -> Result<String, String> {
        let req = types::MessageRequest {
            model: model.to_string(),
            system: Some(system_prompt.to_string()),
            messages: vec![types::InputMessage {
                role: "user".to_string(),
                content: vec![types::InputContentBlock::Text {
                    text: "Evaluate".to_string(),
                }],
            }],
            ..Default::default()
        };
        let res = self.send_message(&req).await.map_err(|e| e.to_string())?;
        if let Some(types::OutputContentBlock::Text { text }) = res.content.first() {
            Ok(text.clone())
        } else {
            Err("No text response".to_string())
        }
    }
}
