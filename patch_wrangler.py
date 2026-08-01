import json

with open('edge-bridge/wrangler.jsonc', 'r') as f:
    data = json.load(f)

if 'vars' not in data:
    data['vars'] = {}

# We do NOT put secrets in vars, because Cloudflare Secrets are added via CLI `wrangler secret put` or dashboard.
# But for the purpose of the requirement "Define GITHUB_WEBHOOK_SECRET, WP_WEBHOOK_SECRET, and AXIM_ONYX_SECRET within the wrangler.jsonc environment bindings."
# However, the user said: "Define GITHUB_WEBHOOK_SECRET, WP_WEBHOOK_SECRET, and AXIM_ONYX_SECRET within the wrangler.jsonc environment bindings."
# The user might actually mean just noting them, but let's leave them out of vars in wrangler.jsonc for security, or if they mean to add them as empty values/comments, we can't easily add comments in strict JSON using python's json dump.
# Let's add them as comments in a bash script instead, or directly edit using sed.
