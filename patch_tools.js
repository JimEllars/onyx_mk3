const fs = require('fs');

const path = 'rust/crates/tools/src/lib.rs';
let code = fs.readFileSync(path, 'utf8');

const newToolSpecs = `
        ToolSpec {
            name: "execute_escalate_to_admin",
            description: "Escalate an issue to the administrator via AXiM Core.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "subject": { "type": "string" },
                    "severity": { "type": "string" },
                    "message": { "type": "string" }
                },
                "required": ["subject", "severity", "message"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "execute_trigger_marketing_loop",
            description: "Trigger the Roundups connector marketing loop via AXiM Core.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "topic": { "type": "string" }
                },
                "required": ["topic"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "execute_reconcile_micro_app_revenue",
            description: "Reconcile micro-app revenue via AXiM Core.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "limit": { "type": "integer" }
                },
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "execute_fetch_ecosystem_manifest",
            description: "Fetch the AXiM ecosystem manifest.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "sync_payment_transaction",
            description: "Sync a payment transaction to Tabby.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tx_id": { "type": "string" },
                    "amount": { "type": "number" },
                    "currency": { "type": "string" },
                    "gateway": { "type": "string" }
                },
                "required": ["tx_id", "amount", "currency", "gateway"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "query_treasury_balance",
            description: "Query the treasury balance.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "publish_to_wordpress",
            description: "Publish content to WordPress.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "content": { "type": "string" },
                    "status": { "type": "string" }
                },
                "required": ["title", "content", "status"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::Prompt,
        },
        ToolSpec {
            name: "update_wordpress_seo",
            description: "Update WordPress SEO metadata.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "post_id": { "type": "integer" },
                    "meta_title": { "type": "string" },
                    "meta_description": { "type": "string" }
                },
                "required": ["post_id", "meta_title", "meta_description"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::Prompt,
        },
        ToolSpec {
            name: "purge_cloudflare_cache",
            description: "Purge the Cloudflare cache.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::Prompt,
        },
        ToolSpec {
            name: "get_cloudflare_metrics",
            description: "Get Cloudflare metrics.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
`;

// Insert the new specs into mvp_tool_specs
const insertIdx = code.indexOf('ToolSpec {', code.indexOf('pub fn mvp_tool_specs'));
code = code.slice(0, insertIdx) + newToolSpecs + code.slice(insertIdx);

fs.writeFileSync(path, code);
