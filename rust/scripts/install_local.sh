#!/bin/bash
set -e
cd "$(dirname "$0")/.."
cargo install --path crates/onyx --locked --force
