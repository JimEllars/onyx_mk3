#!/bin/bash

# Remove | SlashCommand::Fleet from the fallback
perl -pi -e 's/\| SlashCommand::AddDir \{ \.\. \} \| SlashCommand::Fleet => \{/\| SlashCommand::AddDir \{ \.\. \} => \{/g' rust/crates/onyx/src/main.rs

# Insert SlashCommand::Fleet handling exactly before SlashCommand::Unknown
sed -i '/SlashCommand::Unknown(name) => {/i\            SlashCommand::Fleet => {\n                let result = commands::handle_slash_command(\n                    "/fleet",\n                    &self.session,\n                    self.runtime_config.compaction.clone().unwrap_or_default(),\n                );\n                if let Some(r) = result {\n                    println!("{}", r.message);\n                }\n                false\n            }' rust/crates/onyx/src/main.rs
