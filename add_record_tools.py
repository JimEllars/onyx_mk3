import re

with open("rust/crates/tools/src/lib.rs", "r") as f:
    content = f.read()

target = """        "check_micro_app_transactions" => {
            maybe_enforce_permission_check(enforcer, name, input)?;
            from_value::<supabase_ops::CheckMicroAppTransactionsInput>(input).and_then(|i| {
                let config = ConfigLoader::default_for(".").load().unwrap_or_else(|_| runtime::RuntimeConfig::empty());
                tokio::runtime::Handle::current().block_on(supabase_ops::execute_check_micro_app_transactions(i, &config)).map_err(|e| e.to_string()).and_then(|o| serde_json::to_string(&o).map_err(|e| e.to_string()))
            })
        }"""

replacement = """        "check_micro_app_transactions" => {
            maybe_enforce_permission_check(enforcer, name, input)?;
            from_value::<supabase_ops::CheckMicroAppTransactionsInput>(input).and_then(|i| {
                let config = ConfigLoader::default_for(".").load().unwrap_or_else(|_| runtime::RuntimeConfig::empty());
                tokio::runtime::Handle::current().block_on(supabase_ops::execute_check_micro_app_transactions(i, &config)).map_err(|e| e.to_string()).and_then(|o| serde_json::to_string(&o).map_err(|e| e.to_string()))
            })
        }
        "record_incident_resolution" => {
            maybe_enforce_permission_check(enforcer, name, input)?;
            from_value::<supabase_ops::RecordIncidentResolutionInput>(input).and_then(|i| {
                let config = ConfigLoader::default_for(".").load().unwrap_or_else(|_| runtime::RuntimeConfig::empty());
                tokio::runtime::Handle::current().block_on(supabase_ops::execute_record_incident_resolution(i, &config)).map_err(|e| e.to_string()).and_then(|o| serde_json::to_string(&o).map_err(|e| e.to_string()))
            })
        }"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/tools/src/lib.rs", "w") as f:
        f.write(content)
    print("Added tool route")
