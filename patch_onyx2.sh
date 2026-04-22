#!/bin/bash

# Replace the AddDir line in run_resume_command
sed -i 's/| SlashCommand::AddDir { .. } => Err("unsupported resumed slash command".into()),/| SlashCommand::AddDir { .. }\n        | SlashCommand::Fleet => Err("unsupported resumed slash command".into()),/' rust/crates/onyx/src/main.rs

# In run_direct_slash_command, we need to match Fleet
sed -i 's/| SlashCommand::AddDir { .. } => {/| SlashCommand::AddDir { .. }\n            | SlashCommand::Fleet => {\n                eprintln!("Command registered but not yet implemented.");\n                false\n            }/' rust/crates/onyx/src/main.rs
