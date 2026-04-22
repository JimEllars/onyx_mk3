#!/bin/bash

sed -i '/pub fn handle_slash_command(/i\#[allow(clippy::too_many_lines)]' rust/crates/commands/src/lib.rs
