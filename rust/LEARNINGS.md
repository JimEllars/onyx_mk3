# Developer Learnings

## MCP Stdio Process Management
When writing integration tests for stdio-based MCP servers (like the `mcp_stdio` tests), simply passing an environment variable (like `MCP_TOOL_CALL_DELAY_MS`) to the child process isn't enough to trigger application logic unless the mock server script is explicitly programmed to parse it and act (e.g., `time.sleep()`).

Additionally, when verifying idempotent shutdowns and process kills via log line counts, ensure the expected assertion array precisely matches the emitted JSON-RPC lifecycle events (Initialize -> List Tools -> Call Tool), especially when refactoring tests derived from copy-pasting.

## Cargo Workspace Hygiene
When a Cargo workspace grows (currently 9 crates), tracking test failures requires running `--workspace` globally, but targeting fixes should be done via `-p <crate_name>` to speed up compilation.
