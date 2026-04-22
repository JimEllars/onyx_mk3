#!/bin/bash

# Instead of using sed /i which can mess up if lines aren't exact, let's use a perl script or just exact line numbers.
perl -pi -e 's/(SlashCommand::Agents \{ args \} => \{)/SlashCommand::Fleet => {\n                let result = commands::handle_slash_command(\n                    "\/fleet",\n                    &self.session,\n                    self.runtime_config.compaction.clone().unwrap_or_default(),\n                );\n                if let Some(r) = result {\n                    println!("{}", r.message);\n                }\n                false\n            }\n            $1/g' rust/crates/onyx/src/main.rs
