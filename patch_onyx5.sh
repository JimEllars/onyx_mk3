#!/bin/bash

# We just need to add | SlashCommand::Fleet into the fallback match arm where AddDir is.
perl -pi -e 's/\| SlashCommand::AddDir \{ \.\. \} => \{/\| SlashCommand::AddDir \{ \.\. \} \| SlashCommand::Fleet => \{/g' rust/crates/onyx/src/main.rs
