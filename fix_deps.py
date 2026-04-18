import sys

content = open("rust/crates/runtime/Cargo.toml", "r").read()

content = content.replace("tools = { path = \"../tools\" }\n", "")

with open("rust/crates/runtime/Cargo.toml", "w") as f:
    f.write(content)
