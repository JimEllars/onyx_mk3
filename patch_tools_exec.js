const fs = require('fs');

const path = 'rust/crates/tools/src/lib.rs';
let code = fs.readFileSync(path, 'utf8');

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
        "sync_payment_transaction" => {
            let input = serde_json::from_value::<crate::financial_ops::SyncPaymentTransactionInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::financial_ops::execute_sync_payment_transaction(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "query_treasury_balance" => {
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::financial_ops::execute_query_treasury_balance())
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "publish_to_wordpress" => {
            let input = serde_json::from_value::<crate::wordpress_admin::PublishToWordpressInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::wordpress_admin::execute_publish_to_wordpress(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "update_wordpress_seo" => {
            let input = serde_json::from_value::<crate::wordpress_admin::UpdateWordpressSeoInput>(input.clone())
                .map_err(|e| e.to_string())?;
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::wordpress_admin::execute_update_wordpress_seo(input))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "purge_cloudflare_cache" => {
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::cloudflare_ops::execute_purge_cloudflare_cache())
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "get_cloudflare_metrics" => {
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::cloudflare_ops::execute_get_cloudflare_metrics())
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
`;

const insertIdx2 = code.indexOf('"EscalateToAdmin"');
code = code.slice(0, insertIdx2) + newExecs + code.slice(insertIdx2);

fs.writeFileSync(path, code);
