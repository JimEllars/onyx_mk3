import json

with open("edge-bridge/wrangler.jsonc", "r") as f:
    content = f.read()

# Add AI binding
lines = content.split('\n')
for i, line in enumerate(lines):
    if '"vars": {' in line:
        # Insert before "vars"
        lines.insert(i, '  "ai": { "binding": "AI" },')
        break

with open("edge-bridge/wrangler.jsonc", "w") as f:
    f.write('\n'.join(lines))
