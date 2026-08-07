#!/bin/bash
# Modify rewrite_content_blocks_for_anthropic to inject prompt caching cache_control

sed -i 's/fn rewrite_content_blocks_for_anthropic(body: &mut Value) {/fn rewrite_content_blocks_for_anthropic(body: \&mut Value) {\n    if let Some(system) = body.get_mut("system") {\n        if system.is_string() {\n            let s = system.as_str().unwrap().to_string();\n            *system = serde_json::json!([\n                {\n                    "type": "text",\n                    "text": s,\n                    "cache_control": {"type": "ephemeral"}\n                }\n            ]);\n        }\n    }\n/' rust/crates/api/src/providers/anthropic.rs
