#!/bin/bash

sed -i '/text = format!("{text}{playbook_str}");/c\    let delegated = DELEGATED_NODE_ID.read().unwrap_or_else(|e| e.into_inner()).clone();\n    if let Some(node_id) = delegated {\n        text = format!("{text} | ⠼ Onyx is delegating to peer node [{}]...", node_id);\n    }\n    text = format!("{text}{playbook_str}");' rust/crates/onyx/src/tui/status_bar.rs
