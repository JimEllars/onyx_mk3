use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsultDepartmentInput {
    pub department: String, // "cfo", "cto", "legal", "coo", "sales", "support"
    pub query: String,
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsultDepartmentOutput {
    pub reply: String,
    pub conversation_id: Option<String>,
    pub credits_used: Option<f64>,
}

pub async fn execute_consult_chatbase_agent(
    input: ConsultDepartmentInput,
) -> Result<ConsultDepartmentOutput, String> {
    let api_key = match std::env::var("AXIM_SERVICE_KEY") {
        Ok(k) => k,
        Err(_) => crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
            .await
            .map_err(|e| format!("AXIM_SERVICE_KEY is not set and vault fetch failed: {e}"))?,
    };

    let client = reqwest::Client::new();
    let url = "https://core.axim.us.com/functions/v1/chatbase-gateway";

    let mut payload = serde_json::json!({
        "app_key": input.department.to_lowercase(),
        "message": input.query
    });

    if let Some(conv_id) = &input.conversation_id {
        payload.as_object_mut().unwrap().insert(
            "conversationId".to_string(),
            serde_json::Value::String(conv_id.clone()),
        );
    }

    let res = client
        .post(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("X-Axim-Call-Depth", "2")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Chatbase Gateway API error: {}", res.status()));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let reply = body["reply"].as_str().unwrap_or("").to_string();
    let conversation_id = body["conversation_id"].as_str().map(|s| s.to_string());
    let credits_used = body["credits"].as_f64();

    let output = ConsultDepartmentOutput {
        reply,
        conversation_id,
        credits_used,
    };

    if let Some(sink) = telemetry::supabase::SupabaseTelemetrySink::new() {
        let mut metadata = serde_json::Map::new();
        metadata.insert("department".to_string(), serde_json::Value::String(input.department.clone()));
        if let Some(c) = credits_used {
            if let Ok(c_json) = serde_json::to_value(c) {
                metadata.insert("credits".to_string(), c_json);
            }
        }

        use telemetry::TelemetrySink;
        sink.record(telemetry::TelemetryEvent::ChatbaseConsultation {
            app_id: "onyx_mk3".to_string(),
            event_type: "chatbase_consultation".to_string(),
            metadata,
        });
    }

    Ok(output)
}
