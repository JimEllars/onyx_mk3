import re

with open('rust/crates/rusty-claude-cli/src/main.rs', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.startswith('struct LiveCli'):
        print(f"LiveCli struct at line {i+1}")
    if line.startswith('impl LiveCli'):
        print(f"LiveCli impl at line {i+1}")
    if 'struct SessionManager' in line:
        print(f"SessionManager struct at line {i+1}")
    if 'impl SessionManager' in line:
        print(f"SessionManager impl at line {i+1}")
