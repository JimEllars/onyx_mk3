import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """    // In a real implementation, this would make a network call to the LLM
    // with a prompt like:
    // "You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them: {logs}"

    // For this sprint, we mock the LLM network call and its response.
    // We simulate the AI analyzing logs and finding a degradation.
    let _prompt = format!("You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them: {}", telemetry_logs);"""

replacement = """    // Fetch recent incidents
    let mut recent_incidents = serde_json::json!([]);
    let workspace_root = std::env::current_dir().unwrap_or_default();
    let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home).join(".onyx")
    });
    let loader = crate::config::ConfigLoader::new(&workspace_root, &config_home_dir);
    let runtime_config = loader.load().unwrap_or_else(|_| crate::config::RuntimeConfig::empty());
    let supabase_url = runtime_config.get("SUPABASE_URL").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_URL").unwrap_or_default(), String::from);
    let supabase_key = runtime_config.get("SUPABASE_SERVICE_ROLE_KEY").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(), String::from);

    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/incident_memory?order=created_at.desc&limit=10", supabase_url);
    if let Ok(res) = client.get(&url).header("apikey", &supabase_key).header("Authorization", format!("Bearer {}", supabase_key)).send().await {
        if let Ok(json) = res.json::<serde_json::Value>().await {
            recent_incidents = json;
        }
    }

    // In a real implementation, this would make a network call to the LLM
    // with a prompt like:
    // "You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them: {logs}"

    // For this sprint, we mock the LLM network call and its response.
    // We simulate the AI analyzing logs and finding a degradation.
    let _prompt = format!("You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs: {}. Also consider recent incident memory to avoid loops: {}. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them.", telemetry_logs, recent_incidents);"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Fixed evaluate health inject")
else:
    print("Could not find target")
