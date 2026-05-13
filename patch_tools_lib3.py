import re

with open('rust/crates/tools/src/lib.rs', 'r') as f:
    content = f.read()

# Add axim_gateway module
content = content.replace("pub mod axim_ops;", "pub mod axim_gateway;\npub mod axim_ops;")

# Add tool spec to mvp_tool_specs
tool_spec = """        ToolSpec {
            name: "invoke_axim_micro_app",
            description: "Invoke an external AXiM micro-app, CRM (SuiteDash), or automation (Albato) via the universal gateway.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "app_target": { "type": "string", "description": "The target app (e.g., 'albato', 'suitedash')" },
                    "action": { "type": "string", "description": "The action to perform (e.g., 'trigger_webhook', 'create_contact')" },
                    "payload": { "type": "object", "description": "JSON payload required by the target action" }
                },
                "required": ["app_target", "action", "payload"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::Prompt,
        },
"""
content = content.replace("pub fn mvp_tool_specs() -> Vec<ToolSpec> {\n    vec![", "pub fn mvp_tool_specs() -> Vec<ToolSpec> {\n    vec![\n" + tool_spec)

# Add matching branch in execute_tool_with_enforcer
execute_branch = """        "invoke_axim_micro_app" => {
            maybe_enforce_permission_check(enforcer, name, input)?;
            let target = input["app_target"].as_str().unwrap_or_default();
            let action = input["action"].as_str().unwrap_or_default();
            let payload = input["payload"].clone();
            let result = tokio::runtime::Handle::current().block_on(
                axim_gateway::invoke_axim_micro_app(target, action, payload)
            );
            result.map_err(|e| e.to_string())
        }
"""
content = content.replace("        \"consult_chatbase_agent\" => {", execute_branch + "        \"consult_chatbase_agent\" => {")

with open('rust/crates/tools/src/lib.rs', 'w') as f:
    f.write(content)
