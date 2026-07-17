use crate::schemas::{validate_json, SchemaValidationResult};
use crate::session::{ContentBlock, ConversationMessage};
use crate::{ApiClient, ApiRequest, AssistantEvent};
use serde::de::DeserializeOwned;
use telemetry::metrics;

pub fn execute_structured_task<T, C>(
    client: &mut C,
    _model: &str,
    system_prompt: &str,
    initial_prompt: &str,
) -> Result<T, String>
where
    T: DeserializeOwned,
    C: ApiClient,
{
    let mut messages = vec![ConversationMessage::user_text(initial_prompt)];

    for attempt in 1..=3 {
        let request = ApiRequest {
            messages: messages.clone(),
            system_prompt: vec![system_prompt.to_string()],
        };

        let events = client
            .stream(request)
            .map_err(|e| format!("Stream error: {e:?}"))?;

        let mut full_text = String::new();
        for event in events {
            if let AssistantEvent::TextDelta(text) = event {
                full_text.push_str(&text);
            }
        }

        match validate_json::<T>(&full_text) {
            SchemaValidationResult::Valid(parsed) => {
                return Ok(parsed);
            }
            SchemaValidationResult::Invalid(err) => {
                if attempt == 3 {
                    metrics::set_dlq_depth(metrics::get_dlq_depth() + 1);
                    return Err(format!(
                        "Max correction attempts reached. Task pushed to DLQ. Last error: {err}"
                    ));
                }

                messages.push(ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: full_text,
                }]));

                messages.push(ConversationMessage::user_text(
                    format!("Schema validation failed: {err}. Please correct the output and return strictly valid JSON.")
                ));
            }
        }
    }
    Err("Max correction attempts reached. Task pushed to DLQ.".to_string())
}
