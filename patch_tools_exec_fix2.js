const fs = require('fs');

const path = 'rust/crates/tools/src/lib.rs';
let code = fs.readFileSync(path, 'utf8');

// we need to fix the tool execution blocks for cloudflare_ops, wordpress_admin and financial_ops
// and ensure we're calling functions that exist.

// For cloudflare_ops:
// "purge_cloudflare_cache" -> execute_purge_zone_cache(PurgeZoneCacheInput)
// For financial_ops:
// audit_financial_metrics(timeframe: &str)
// For wordpress_admin:
// execute_create_wordpress_post(title: &str, content: &str, status: &str)
// execute_update_seo_metadata(UpdateSeoMetadataInput)

// First remove the bad block
const startMarker = '"execute_escalate_to_admin" => {';
const endMarker = '        "EscalateToAdmin" => {';
const startIdx = code.indexOf(startMarker);
const endIdx = code.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  code = code.slice(0, startIdx) + code.slice(endIdx);
}

// Now insert the correct implementations
const newExecs = `
        "execute_escalate_to_admin" => {
            let input = serde_json::from_value::<crate::axim_ops::EscalateToAdminInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::axim_ops::execute_escalate_to_admin(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "execute_trigger_marketing_loop" => {
            let input = serde_json::from_value::<crate::axim_ops::TriggerMarketingLoopInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::axim_ops::execute_trigger_marketing_loop(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "execute_reconcile_micro_app_revenue" => {
            let input = serde_json::from_value::<crate::axim_ops::ReconcileMicroAppRevenueInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::axim_ops::execute_reconcile_micro_app_revenue(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "execute_fetch_ecosystem_manifest" => {
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::axim_ops::execute_fetch_ecosystem_manifest())
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "audit_financial_metrics" => {
            // It expects a timeframe string
            let timeframe = input.get("timeframe").and_then(|v| v.as_str()).unwrap_or("monthly");
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::financial_ops::audit_financial_metrics(timeframe))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "publish_to_wordpress" => {
            let title = input.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let content = input.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let status = input.get("status").and_then(|v| v.as_str()).unwrap_or("draft");
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::wordpress_admin::execute_create_wordpress_post(title, content, status))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "update_wordpress_seo" => {
            let input = serde_json::from_value::<crate::wordpress_admin::UpdateSeoMetadataInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::wordpress_admin::execute_update_seo_metadata(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "purge_cloudflare_cache" => {
            let input = serde_json::from_value::<crate::cloudflare_ops::PurgeZoneCacheInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::cloudflare_ops::execute_purge_zone_cache(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
`;

const insertIdx2 = code.indexOf('"EscalateToAdmin"');
if (insertIdx2 !== -1) {
    code = code.slice(0, insertIdx2) + newExecs + code.slice(insertIdx2);
}

fs.writeFileSync(path, code);
