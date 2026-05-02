use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static DAILY_USAGE_TRACKER: OnceLock<Mutex<HashMap<String, (u64, u32)>>> = OnceLock::new();

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
    let api_key = match std::env::var("CHATBASE_API_KEY") {
        Ok(k) => k,
        Err(_) => crate::axim_vault::fetch_vault_secret("CHATBASE_API_KEY")
            .await
            .map_err(|e| format!("CHATBASE_API_KEY is not set and vault fetch failed: {e}"))?,
    };

    let agent_id = match input.agent_role.as_str() {
        "CEO" => "fViIyS2-64jXMyakjf70T",
        "CTO" => "CgplD95DZW5tnXRPEGV2A",
        "CFO" => "NHjryFStm6hn2kg6q7KgN",
        "COO" => "7biTg1Hu6DMWXUpTWfCLu",
        "Legal" => "ioJLtMqvhqx69Mokhad64",
        _ => return Err(format!("Invalid agent role: {}", input.agent_role)),
    };

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let current_day = now_secs / 86400;

    let tracker = DAILY_USAGE_TRACKER.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let mut map = tracker.lock().unwrap();
        let entry = map.entry(agent_id.to_string()).or_insert((current_day, 0));
        if entry.0 != current_day {
            entry.0 = current_day;
            entry.1 = 0;
        }
        if entry.1 >= 100 {
            return Err(format!(
                "Daily message limit reached for agent {}",
                input.agent_role
            ));
        }
    }

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

    {
        let mut map = tracker.lock().unwrap();
        let entry = map.entry(agent_id.to_string()).or_insert((current_day, 0));
        entry.1 += 1;
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let parts = body["data"]["parts"]
        .as_array()
        .ok_or("Failed to parse response: missing or invalid data.parts")?;

    let conversation_id = body["data"]["metadata"]["conversationId"]
        .as_str()
        .ok_or("Failed to parse response: missing data.metadata.conversationId")?
        .to_string();

    let finish_reason = body["data"]["metadata"]["finishReason"]
        .as_str()
        .unwrap_or("");

    let text = if finish_reason == "tool-calls" {
        let tool_call = parts
            .iter()
            .find(|p| p["type"] == "tool-call")
            .ok_or("Failed to parse response: missing tool-call part")?;
        let tool_name = tool_call["toolName"].as_str().unwrap_or("unknown");
        let tool_call_id = tool_call["toolCallId"].as_str().unwrap_or("unknown");
        format!("[SYSTEM: Agent requested tool execution for {tool_name} with ID {tool_call_id}. Local execution pending.]")
    } else {
        parts
            .iter()
            .find(|p| p["type"] == "text")
            .and_then(|p| p["text"].as_str())
            .ok_or("Failed to parse response: missing text part")?
            .to_string()
    };

    Ok(ConsultChatbaseAgentOutput {
        text,
        conversation_id,
    })
}

pub async fn submit_chatbase_tool_result(
    agent_role: &str,
    conversation_id: &str,
    tool_call_id: &str,
    output: serde_json::Value,
) -> Result<(), String> {
    let api_key = match std::env::var("CHATBASE_API_KEY") {
        Ok(k) => k,
        Err(_) => crate::axim_vault::fetch_vault_secret("CHATBASE_API_KEY")
            .await
            .map_err(|e| format!("CHATBASE_API_KEY is not set and vault fetch failed: {e}"))?,
    };

    let agent_id = match agent_role {
        "CEO" => "fViIyS2-64jXMyakjf70T",
        "CTO" => "CgplD95DZW5tnXRPEGV2A",
        "CFO" => "NHjryFStm6hn2kg6q7KgN",
        "COO" => "7biTg1Hu6DMWXUpTWfCLu",
        "Legal" => "ioJLtMqvhqx69Mokhad64",
        _ => return Err(format!("Invalid agent role: {agent_role}")),
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://www.chatbase.co/api/v2/agents/{agent_id}/conversations/{conversation_id}/tool-result"
    );

    let payload = serde_json::json!({
        "toolCallId": tool_call_id,
        "output": output
    });

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

    Ok(())
}
