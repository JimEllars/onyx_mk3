import re

with open("rust/crates/tools/src/supabase_ops.rs", "r") as f:
    content = f.read()

content = content.replace('format!("{}/rest/v1/incident_memory", supabase_url)', 'format!("{supabase_url}/rest/v1/incident_memory")')

with open("rust/crates/tools/src/supabase_ops.rs", "w") as f:
    f.write(content)
