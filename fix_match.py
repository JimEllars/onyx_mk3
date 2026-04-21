import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

content = content.replace("Err((mut returned_runtime, error)) => {", "Err(box_err) => {\n                let mut returned_runtime = box_err.0;\n                let error = box_err.1;")

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
