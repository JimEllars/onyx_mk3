#!/bin/bash

# Fix the field and session
sed -i 's/&self.session,/self.runtime.session(),/' rust/crates/onyx/src/main.rs
sed -i 's/self.runtime_config.compaction.clone().unwrap_or_default(),/runtime::CompactionConfig::default(),/' rust/crates/onyx/src/main.rs
