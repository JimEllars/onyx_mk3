#!/bin/bash
cat rust/crates/onyx/src/main.rs | grep -n -A 50 "start_approval_polling_loop"
