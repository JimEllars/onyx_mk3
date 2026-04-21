import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

content = content.replace("#[allow(clippy::too_many_lines)]\nfn resume_session(session_path: &Path, commands: &[String], output_format: CliOutputFormat) {", "fn resume_session(session_path: &Path, commands: &[String], output_format: CliOutputFormat) {")
content = content.replace("fn resume_session(session_path: &Path, commands: &[String], output_format: CliOutputFormat) {", "#[allow(clippy::too_many_lines)]\nfn resume_session(session_path: &Path, commands: &[String], output_format: CliOutputFormat) {")

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)

