#!/bin/bash
cd rust
cargo test -p tools --lib -- tests::repl_executes_python_code --exact
