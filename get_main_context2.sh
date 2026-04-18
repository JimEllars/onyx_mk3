#!/bin/bash
cat rust/crates/onyx/src/main.rs | grep -n -B 50 "start_approval_polling_loop"
