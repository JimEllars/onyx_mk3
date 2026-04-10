import re

with open('rust/crates/rusty-claude-cli/src/main.rs', 'r') as f:
    content = f.read()

content = content.replace("mod render;", "mod render;\nmod tui;")

with open('rust/crates/rusty-claude-cli/src/main.rs', 'w') as f:
    f.write(content)
