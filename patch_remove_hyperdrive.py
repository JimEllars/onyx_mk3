with open('./edge-bridge/src/index.ts', 'r') as f:
    content = f.read()

content = content.replace('import { Hyperdrive } from "@cloudflare/workers-types";\n', '')

with open('./edge-bridge/src/index.ts', 'w') as f:
    f.write(content)
