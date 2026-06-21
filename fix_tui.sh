cat << 'INNER_EOF' > process_tui.py
import re

with open("rust/crates/onyx/src/tui/status_bar.rs", "r") as f:
    content = f.read()

content = content.replace(
    'std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),',
    'std::thread::available_parallelism().map(std::num::NonZero::get).unwrap_or(1),'
)

with open("rust/crates/onyx/src/tui/status_bar.rs", "w") as f:
    f.write(content)
INNER_EOF
python3 process_tui.py
