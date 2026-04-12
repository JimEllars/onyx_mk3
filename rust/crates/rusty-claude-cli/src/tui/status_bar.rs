use runtime::TokenUsage;
use std::io::Write;

pub fn render_status_bar(model: &str, session_id: &str, usage: &TokenUsage, cost: f64) -> String {
    format!(
        "Model: {} | Session: {} | Tokens: In {}, Out {} | Cost: ${:.4}",
        model, session_id, usage.input_tokens, usage.output_tokens, cost
    )
}
