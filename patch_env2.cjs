const fs = require('fs');
let code = fs.readFileSync('edge-bridge/src/index.ts', 'utf-8');

const replacement = `"x-api-key": env.ANTHROPIC_API_KEY || "",`;
code = code.replace(/"x-api-key": env\.ANTHROPIC_API_KEY,/g, replacement);

fs.writeFileSync('edge-bridge/src/index.ts', code);
