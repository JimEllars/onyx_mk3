#!/bin/bash

sed -i 's/| SlashCommand::AddDir { .. } => Err("unsupported resumed slash command".into()),/| SlashCommand::AddDir { .. }\n        | SlashCommand::Fleet => Err("unsupported resumed slash command".into()),/' rust/crates/onyx/src/main.rs
