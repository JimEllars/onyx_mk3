#!/bin/bash

# A quick hack to display "delegating to peer node" instead of "Thinking..."
# if delegating flag was somehow set, but since `tools::lib.rs` executes the agent tool asynchronously,
# and we just return an Err("Task delegated to peer node") from execute_agent,
# the `execute_tool` handles it. The TUI doesn't naturally know about this unless we look at the error string or similar.
# Wait! Phase 4 says "In your existing status_bar.rs, if a task has successfully been delegated to a peer node (from Phase 3), simply update the inline spinner string to reflect the network action: format!("⠼ Onyx is delegating to peer node [{}]...", target_node_id) instead of a local thinking state."

# But `status_bar.rs` does not own the spinner. It formats the bottom status bar.
# Oh, the prompt says "In your existing status_bar.rs, if a task has successfully been delegated... update the inline spinner string"
# Let's just add it to `status_bar.rs`!

sed -i '/pub fn render_status_bar(/i\use std::sync::atomic::{AtomicBool, AtomicString, Ordering};\n\nstatic DELEGATED_NODE_ID: std::sync::LazyLock<std::sync::RwLock<Option<String>>> = std::sync::LazyLock::new(|| std::sync::RwLock::new(None));\n\npub fn set_delegated_node(node_id: String) {\n    if let Ok(mut lock) = DELEGATED_NODE_ID.write() {\n        *lock = Some(node_id);\n    }\n}\n\npub fn clear_delegated_node() {\n    if let Ok(mut lock) = DELEGATED_NODE_ID.write() {\n        *lock = None;\n    }\n}\n' rust/crates/onyx/src/tui/status_bar.rs
