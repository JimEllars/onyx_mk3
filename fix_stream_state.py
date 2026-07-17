import re
with open("rust/crates/onyx/src/render.rs", "r") as f:
    code = f.read()

new_struct = r"""pub struct MarkdownStreamState {
    pending: String,
}

impl MarkdownStreamState {
    #[must_use]
    pub fn push(&mut self, renderer: &TerminalRenderer, delta: &str) -> Option<String> {
        self.pending.push_str(delta);
        let split = find_stream_safe_boundary(&self.pending)?;
        let ready = self.pending[..split].to_string();
        self.pending.drain(..split);

        let mut out_rendered = renderer.markdown_to_ansi(&ready);

        if out_rendered.contains("[WARN] Schema mismatch, triggering correction prompt") {
            out_rendered = format!("\x1b[33m{out_rendered}\x1b[0m"); // yellow for warn
        } else if out_rendered.contains("[SCHEMA OK]") {
            out_rendered = format!("\x1b[32m{out_rendered}\x1b[0m"); // green for ok
        }

        Some(out_rendered)
    }

    #[must_use]
    pub fn flush(&mut self, renderer: &TerminalRenderer) -> Option<String> {
        if self.pending.trim().is_empty() {
            self.pending.clear();
            None
        } else {
            let pending = std::mem::take(&mut self.pending);
            let mut out_rendered = renderer.markdown_to_ansi(&pending);
            if out_rendered.contains("[WARN] Schema mismatch, triggering correction prompt") {
                out_rendered = format!("\x1b[33m{out_rendered}\x1b[0m");
            } else if out_rendered.contains("[SCHEMA OK]") {
                out_rendered = format!("\x1b[32m{out_rendered}\x1b[0m");
            }
            Some(out_rendered)
        }
    }
}"""

pattern = re.compile(r'pub struct MarkdownStreamState \{.*?\}\s*impl MarkdownStreamState \{.*?\}\n\}', re.DOTALL)
if pattern.search(code):
    new_code = code.replace(pattern.search(code).group(0), new_struct)
    with open("rust/crates/onyx/src/render.rs", "w") as f:
        f.write(new_code)
    print("Replaced!")
else:
    print("Not found.")
