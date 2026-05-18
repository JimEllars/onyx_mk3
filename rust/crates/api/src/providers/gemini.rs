#![allow(clippy::too_many_lines)]
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::env;
use std::time::Duration;
use tracing::warn;

use crate::error::ApiError;
use crate::http_client::build_http_client_or_default;
use crate::types::{
    InputContentBlock, MessageRequest, MessageResponse, OutputContentBlock, StreamEvent,
    ToolResultContentBlock, Usage,
};

pub const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_INITIAL_BACKOFF: Duration = Duration::from_secs(5);
const DEFAULT_MAX_BACKOFF: Duration = Duration::from_secs(128);
const DEFAULT_MAX_RETRIES: u32 = 8;

pub fn has_api_key() -> bool {
    env::var("GEMINI_API_KEY").is_ok()
}

#[allow(clippy::too_many_lines)]
#[derive(Debug, Clone)]
pub struct GeminiClient {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
    max_retries: u32,
    initial_backoff: Duration,
    max_backoff: Duration,
}

impl GeminiClient {
    pub fn from_env() -> Result<Self, ApiError> {
        let api_key = env::var("GEMINI_API_KEY").map_err(ApiError::InvalidApiKeyEnv)?;
        let base_url = env::var("GEMINI_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
        Ok(Self {
            http: build_http_client_or_default(),
            api_key,
            base_url,
            max_retries: DEFAULT_MAX_RETRIES,
            initial_backoff: DEFAULT_INITIAL_BACKOFF,
            max_backoff: DEFAULT_MAX_BACKOFF,
        })
    }

    #[allow(clippy::too_many_lines)]
    pub async fn send_message(
        &self,
        request: &MessageRequest,
    ) -> Result<MessageResponse, ApiError> {
        let payload = map_request_to_gemini(request);
        let mut attempts = 0;
        let url = format!(
            "{}/models/{}:generateContent?key={}",
            self.base_url, request.model, self.api_key
        );

        let res = loop {
            attempts += 1;
            let req_res = self.http.post(&url).json(&payload).send().await;

            match req_res {
                Ok(res) => {
                    let status = res.status();
                    if status.is_success() {
                        break res;
                    }

                    let retry_after = res
                        .headers()
                        .get("retry-after")
                        .and_then(|h| h.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok());
                    let body = res.text().await.unwrap_or_default();
                    let retryable = status.as_u16() == 429
                        || status.as_u16() == 503
                        || status.is_server_error();
                    let err = ApiError::Api {
                        status,
                        error_type: None,
                        message: Some(body.clone()),
                        request_id: None,
                        body,
                        retryable,
                    };

                    if retryable && attempts <= self.max_retries {
                        let delay = if let Some(secs) = retry_after {
                            Duration::from_secs(secs)
                        } else {
                            let backoff = self.initial_backoff.as_secs_f64()
                                * 2.0_f64.powi(attempts.cast_signed() - 1);
                            let jitter = backoff * 0.1;
                            Duration::from_secs_f64(backoff + jitter).min(self.max_backoff)
                        };
                        warn!(
                            "Gemini API rate limited ({status}), backing off for {}s",
                            delay.as_secs_f64()
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    if retryable {
                        return Err(ApiError::RetriesExhausted {
                            attempts,
                            last_error: Box::new(err),
                        });
                    }
                    return Err(err);
                }
                Err(e) => {
                    let err = ApiError::Http(e);
                    if attempts <= self.max_retries {
                        let backoff = self.initial_backoff.as_secs_f64()
                            * 2.0_f64.powi(attempts.cast_signed() - 1);
                        let jitter = backoff * 0.1;
                        let delay = Duration::from_secs_f64(backoff + jitter).min(self.max_backoff);
                        warn!(
                            "Gemini API connection error, backing off for {}s",
                            delay.as_secs_f64()
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    return Err(ApiError::RetriesExhausted {
                        attempts,
                        last_error: Box::new(err),
                    });
                }
            }
        };

        let body = res.text().await.map_err(ApiError::Http)?;
        let resp_json: Value = serde_json::from_str(&body).map_err(|e| ApiError::Json {
            provider: "Gemini".to_string(),
            model: request.model.clone(),
            body_snippet: body,
            source: e,
        })?;

        let mut content_blocks = Vec::new();
        if let Some(candidates) = resp_json.get("candidates").and_then(|c| c.as_array()) {
            if let Some(candidate) = candidates.first() {
                if let Some(parts) = candidate
                    .get("content")
                    .and_then(|c| c.get("parts"))
                    .and_then(|p| p.as_array())
                {
                    for part in parts {
                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                            content_blocks.push(OutputContentBlock::Text {
                                text: text.to_string(),
                            });
                        }
                        if let Some(fc) = part.get("functionCall") {
                            content_blocks.push(OutputContentBlock::ToolUse {
                                id: fc
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                name: fc
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                input: fc.get("args").cloned().unwrap_or(json!({})),
                            });
                        }
                    }
                }
            }
        }

        let input_tokens = resp_json
            .get("usageMetadata")
            .and_then(|u| u.get("promptTokenCount"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        let output_tokens = resp_json
            .get("usageMetadata")
            .and_then(|u| u.get("candidatesTokenCount"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);

        Ok(MessageResponse {
            id: "gemini-msg".to_string(),
            kind: "message".to_string(),
            role: "assistant".to_string(),
            content: content_blocks,
            model: request.model.clone(),
            stop_reason: Some("stop_sequence".to_string()),
            stop_sequence: None,
            usage: Usage {
                input_tokens: input_tokens as u32,
                output_tokens: output_tokens as u32,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
            request_id: None,
        })
    }

    #[allow(clippy::unused_async)]
    pub async fn stream_message(
        &self,
        _request: &MessageRequest,
    ) -> Result<MessageStream, ApiError> {
        // Stream not fully implemented; returns empty mock stream
        Ok(MessageStream {
            request_id: None,
            pending: VecDeque::new(),
            done: true,
        })
    }
}

fn map_request_to_gemini(req: &MessageRequest) -> Value {
    let mut contents = Vec::new();

    let mut system_instruction = None;
    if let Some(sys) = &req.system {
        system_instruction = Some(json!({
            "parts": [{ "text": sys }]
        }));
    }

    for msg in &req.messages {
        let mut parts = Vec::new();
        for block in &msg.content {
            match block {
                InputContentBlock::Text { text } => {
                    parts.push(json!({ "text": text }));
                }
                InputContentBlock::ToolUse { id: _, name, input } => {
                    parts.push(json!({
                        "functionCall": {
                            "name": name,
                            "args": input
                        }
                    }));
                }
                InputContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    ..
                } => {
                    let mut text = String::new();
                    for result in content {
                        match result {
                            ToolResultContentBlock::Text { text: t } => {
                                text.push_str(t);
                            }
                            ToolResultContentBlock::Json { value } => {
                                text.push_str(&value.to_string());
                            }
                        }
                    }
                    parts.push(json!({
                        "functionResponse": {
                            "name": tool_use_id,
                            "response": {
                                "name": tool_use_id,
                                "content": text
                            }
                        }
                    }));
                }
                InputContentBlock::Image {
                    media_type,
                    base64_data,
                }
                | InputContentBlock::Audio {
                    media_type,
                    base64_data,
                } => {
                    parts.push(json!({
                        "inlineData": {
                            "mimeType": media_type,
                            "data": base64_data
                        }
                    }));
                }
            }
        }
        let role = match msg.role.as_str() {
            "assistant" => "model",
            _ => "user",
        };
        contents.push(json!({
            "role": role,
            "parts": parts
        }));
    }

    let mut payload = json!({
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": req.max_tokens,
            "temperature": req.temperature.unwrap_or(0.0)
        }
    });

    if let Some(sys) = system_instruction {
        payload["systemInstruction"] = sys;
    }

    if let Some(tools) = &req.tools {
        if !tools.is_empty() {
            let mut gemini_tools = Vec::new();
            for tool in tools {
                let mut schema = tool.input_schema.clone();
                // Scrub deep anyOf which causes Gemini validation errors
                if let Some(obj) = schema.as_object_mut() {
                    if let Some(props) = obj.get_mut("properties").and_then(|p| p.as_object_mut()) {
                        for (_, prop) in props.iter_mut() {
                            if let Some(p_obj) = prop.as_object_mut() {
                                p_obj.remove("anyOf");
                            }
                        }
                    }
                }
                gemini_tools.push(json!({
                    "name": tool.name,
                    "description": tool.description.as_deref().unwrap_or(""),
                    "parameters": schema
                }));
            }
            payload["tools"] = json!([{
                "functionDeclarations": gemini_tools
            }]);
        }
    }

    payload
}

#[derive(Debug)]
pub struct MessageStream {
    request_id: Option<String>,
    pending: VecDeque<StreamEvent>,
    done: bool,
}

impl MessageStream {
    #[must_use]
    pub fn request_id(&self) -> Option<&str> {
        self.request_id.as_deref()
    }

    #[allow(clippy::unused_async)]
    pub async fn next_event(&mut self) -> Result<Option<StreamEvent>, ApiError> {
        if let Some(event) = self.pending.pop_front() {
            return Ok(Some(event));
        }
        if self.done {
            return Ok(None);
        }
        Ok(None)
    }
}

impl super::Provider for GeminiClient {
    type Stream = MessageStream;

    fn send_message<'a>(
        &'a self,
        request: &'a MessageRequest,
    ) -> super::ProviderFuture<'a, MessageResponse> {
        Box::pin(async move { self.send_message(request).await })
    }

    fn stream_message<'a>(
        &'a self,
        request: &'a MessageRequest,
    ) -> super::ProviderFuture<'a, Self::Stream> {
        Box::pin(async move { self.stream_message(request).await })
    }
}
