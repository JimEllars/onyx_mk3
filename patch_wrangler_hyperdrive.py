import json

with open('edge-bridge/wrangler.jsonc', 'r') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if '"d1_databases": [' in line:
        new_lines.append('  "hyperdrive": [\n')
        new_lines.append('    {\n')
        new_lines.append('      "binding": "HYPERDRIVE",\n')
        new_lines.append('      "id": "e0e290f6a2fb4fb9a12c8ffb089c1622",\n')
        new_lines.append('      "localConnectionString": "postgresql://postgres.your_supabase_project_ref:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"\n')
        new_lines.append('    }\n')
        new_lines.append('  ],\n')
    new_lines.append(line)

with open('edge-bridge/wrangler.jsonc', 'w') as f:
    f.writelines(new_lines)
