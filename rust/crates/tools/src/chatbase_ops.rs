use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsultChatbaseAgentInput {
    pub agent_role: String,
    pub message: String,
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsultChatbaseAgentOutput {
    pub text: String,
    pub conversation_id: String,
}

pub async fn execute_consult_chatbase_agent(
    input: ConsultChatbaseAgentInput,
) -> Result<ConsultChatbaseAgentOutput, String> {
    let api_key = std::env::var("CHATBASE_API_KEY").map_err(|_| "CHATBASE_API_KEY is not set")?;

    let agent_id = match input.agent_role.as_str() {
        "CEO" => "fViIyS2-64jXMyakjf70T",
        "CTO" => "CgplD95DZW5tnXRPEGV2A",
        "CFO" => "NHjryFStm6hn2kg6q7KgN",
        "COO" => "7biTg1Hu6DMWXUpTWfCLu",
        "Legal" => "ioJLtMqvhqx69Mokhad64",
        _ => return Err(format!("Invalid agent role: {}", input.agent_role)),
    };

    let client = reqwest::Client::new();
    let url = format!("https://www.chatbase.co/api/v2/agents/{agent_id}/chat");

    let mut payload = serde_json::json!({
        "message": input.message,
        "stream": false
    });

    if let Some(conv_id) = &input.conversation_id {
        payload.as_object_mut().unwrap().insert(
            "conversationId".to_string(),
            serde_json::Value::String(conv_id.clone()),
        );
    }

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Chatbase API error: {}", res.status()));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let parts = body["data"]["parts"]
        .as_array()
        .ok_or("Failed to parse response: missing or invalid data.parts")?;

    let text = parts
        .iter()
        .find(|p| p["type"] == "text")
        .and_then(|p| p["text"].as_str())
        .ok_or("Failed to parse response: missing text part")?
        .to_string();

    let conversation_id = body["data"]["metadata"]["conversationId"]
        .as_str()
        .ok_or("Failed to parse response: missing data.metadata.conversationId")?
        .to_string();

    Ok(ConsultChatbaseAgentOutput {
        text,
        conversation_id,
    })
}
