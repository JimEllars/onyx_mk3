use crate::mcp_stdio::McpTool;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemToolSchema {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    #[serde(default)]
    pub requires_approval: bool,
    pub endpoint: String,
}

pub struct EcosystemToolRegistry {
    tools: Arc<RwLock<Vec<McpTool>>>,
    schemas: Arc<RwLock<Vec<EcosystemToolSchema>>>,
}

impl EcosystemToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: Arc::new(RwLock::new(Vec::new())),
            schemas: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn refresh(&self) -> Result<(), String> {
        let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
        let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
            .unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default());

        if supabase_url.is_empty() || supabase_key.is_empty() {
            return Err("Missing Supabase credentials for ecosystem tools sync".to_string());
        }

        let client = reqwest::Client::new();
        let url = format!("{}/rest/v1/ecosystem_tools?select=*", supabase_url);

        let mut request = client.get(&url).header("apikey", &supabase_key);

        // Use RLS if we have user_jwt
        let auth_header = std::env::var("USER_JWT").unwrap_or_else(|_| supabase_key.clone());
        request = request.header("Authorization", format!("Bearer {}", auth_header));

        let res = match request.send()
            .await
        {
            Ok(res) => res,
            Err(e) => return Err(format!("Network error fetching ecosystem tools: {}", e)),
        };

        if !res.status().is_success() {
            return Err(format!("Supabase API error fetching ecosystem tools: {}", res.status()));
        }

        let schemas: Vec<EcosystemToolSchema> = match res.json().await {
            Ok(s) => s,
            Err(e) => return Err(format!("Failed to parse ecosystem tools schemas: {}", e)),
        };

        let mut mcp_tools = Vec::new();
        for schema in &schemas {
            let tool = McpTool {
                name: schema.name.clone(),
                description: Some(schema.description.clone()),
                input_schema: Some(schema.parameters.clone()),
                annotations: None,
                meta: None,
            };
            mcp_tools.push(tool);
        }

        {
            let mut tools_lock = self.tools.write().unwrap();
            *tools_lock = mcp_tools;
        }

        {
            let mut schemas_lock = self.schemas.write().unwrap();
            *schemas_lock = schemas;
        }

        Ok(())
    }

    pub fn get_tools(&self) -> Vec<McpTool> {
        self.tools.read().unwrap().clone()
    }

    pub fn get_schema(&self, name: &str) -> Option<EcosystemToolSchema> {
        self.schemas.read().unwrap().iter().find(|s| s.name == name).cloned()
    }
}
