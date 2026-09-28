const fs = require('fs');
let code = fs.readFileSync('rust/crates/commands/src/lib.rs', 'utf-8');

// The instructions say:
// In render_mcp_summary_report and render_mcp_server_report:
// Follow the 2-space indented key-value reporting style established by render_mcp_summary_report and render_skill_install_report:
//     MCP
//       Result           connected <server_name>
//       Transport        stdio (<command>) [or sse (<url>)]
//       Status           connected
//       Tools discovered <count>
//         - mcp__<server_name>__<tool_name>

// In rust/crates/commands/src/lib.rs, we need to update the disconnect and connect reports to follow this format too.
