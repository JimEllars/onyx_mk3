const fs = require('fs');

const path = 'rust/crates/tools/src/lib.rs';
let code = fs.readFileSync(path, 'utf8');

// Fix audit_financial_metrics serialization error
const oldBlock = `
        "audit_financial_metrics" => {
            // It expects a timeframe string
            let timeframe = input.get("timeframe").and_then(|v| v.as_str()).unwrap_or("monthly");
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::financial_ops::audit_financial_metrics(timeframe))
            });
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
`;

const newBlock = `
        "audit_financial_metrics" => {
            let timeframe = input.get("timeframe").and_then(|v| v.as_str()).unwrap_or("monthly");
            let res = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(crate::financial_ops::audit_financial_metrics(timeframe))
            });
            match res {
                Ok(data) => Ok(data),
                Err(e) => Err(e.to_string())
            }
        }
`;

code = code.replace(oldBlock.trim(), newBlock.trim());

fs.writeFileSync(path, code);
