Currently evaluate_health_with_ai is hardcoded to return `purge_zone_cache`. We need it to be dynamic.
1. Add `mcp_client` dispatcher. We need to query McpManager or ToolRegistry.
Let's see how `evaluate_health_with_ai` gets called and what we have available.
