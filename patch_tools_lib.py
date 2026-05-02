with open("rust/crates/tools/src/lib.rs", "r") as f:
    content = f.read()

import re

match = re.search(r'pub mod wordpress_admin;\n', content)
if match:
    insert_pos = match.end()
    content = content[:insert_pos] + "pub mod vector_memory;\n" + content[insert_pos:]
else:
    print("Could not find pub mod wordpress_admin;")

with open("rust/crates/tools/src/lib.rs", "w") as f:
    f.write(content)
