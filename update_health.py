import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

# Since we can't import tools directly due to circular dependency, we can execute the tool via reqwest manually, or we can use the ToolRegistry/ToolExecutor if we can access it.
# Actually, the tools code `execute_purge_zone_cache` is extremely simple. We can just reimplement the API call here or make a helper if needed. But it's better to just inline the cloudflare api call in fleet_health.rs so we don't have circular dependencies, OR we decouple `cloudflare_ops` and `supabase_ops` into a separate crate, OR we just do the reqwest call inline.

search = """                    match tools::cloudflare_ops::execute_purge_zone_cache(tools::cloudflare_ops::PurgeZoneCacheInput { zone_id: zone_id.to_string() }).await {"""

replace = """                    let api_key = std::env::var("CLOUDFLARE_API_TOKEN").unwrap_or_default();
                    let email = std::env::var("CLOUDFLARE_EMAIL").unwrap_or_default();
                    let cf_client = reqwest::Client::new();
                    let cf_url = format!("https://api.cloudflare.com/client/v4/zones/{}/purge_cache", zone_id);
                    match cf_client.post(&cf_url)
                        .header("X-Auth-Key", api_key)
                        .header("X-Auth-Email", email)
                        .header("Content-Type", "application/json")
                        .json(&serde_json::json!({ "purge_everything": true }))
                        .send()
                        .await {
                        Ok(res) if res.status().is_success() => {
                            let output = serde_json::json!({ "success": true });
                            Ok(output)
                        }
                        Ok(res) => {
                            Err(format!("Cloudflare API error: {}", res.status()))
                        }
                        Err(e) => {
                            Err(e.to_string())
                        }
                    } {
                        Ok(_) => {"""

content = content.replace(search, replace)
with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
