with open("rust/crates/tools/src/vector_memory.rs", "r") as f:
    content = f.read()

content = content.replace('#[allow(clippy::cast_possible_truncation)]\n        .filter_map', '.filter_map')

with open("rust/crates/tools/src/vector_memory.rs", "w") as f:
    f.write(content)
