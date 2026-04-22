#!/bin/bash

# Modify tools/src/lib.rs to set the delegated node ID
sed -i 's/println!(\"\[Swarm\] Delegating Agent Playbook to idle peer node: {}\", node_array\[0\]\["node_id"\]);/let node_id = node_array[0]["node_id"].as_str().unwrap_or("unknown");\n                        println!("[Swarm] Delegating Agent Playbook to idle peer node: {}", node_id);\n                        if let Ok(mut lock) = runtime::fleet_health::DELEGATED_NODE_ID.write() {\n                            *lock = Some(node_id.to_string());\n                        }/g' rust/crates/tools/src/lib.rs
