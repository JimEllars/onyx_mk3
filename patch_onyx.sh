#!/bin/bash

# Fix non-exhaustive patterns in rust/crates/onyx/src/main.rs
sed -i '/| SlashCommand::AddDir { .. } => Err("unsupported resumed slash command".into()),/c\        | SlashCommand::AddDir { .. } \n        | SlashCommand::Fleet => Err("unsupported resumed slash command".into()),' rust/crates/onyx/src/main.rs

sed -i '/SlashCommand::Agent { .. } => {/i\            SlashCommand::Fleet => {\n                // Just run the normal handler\n                let result = commands::handle_slash_command(\n                    &format!("/fleet"),\n                    session,\n                    runtime_config.compaction.clone().unwrap_or_default(),\n                );\n                if let Some(r) = result {\n                    println!("{}", r.message);\n                }\n                return Ok(true);\n            },' rust/crates/onyx/src/main.rs
