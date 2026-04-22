#!/bin/bash

sed -i '/"help" => {/i\        "fleet" | "swarm" => {\n            validate_no_args(command, \&args)?;\n            SlashCommand::Fleet\n        }\n' rust/crates/commands/src/lib.rs
