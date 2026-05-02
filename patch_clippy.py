with open("rust/crates/runtime/src/worker_boot.rs", "r") as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    if i == 704 and "if std::fs::create_dir_all(&state_dir).is_err() {" in line:
        new_lines.append(line.replace("&state_dir", "state_dir"))
    else:
        new_lines.append(line)

with open("rust/crates/runtime/src/worker_boot.rs", "w") as f:
    f.write("".join(new_lines))
