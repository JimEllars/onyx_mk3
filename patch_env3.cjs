const fs = require('fs');
let code = fs.readFileSync('edge-bridge/src/index.ts', 'utf-8');

code = code.replace(/Authorization: \`Bearer \$\{env\.DEEPSEEK_API_KEY\}\`,/g, 'Authorization: `Bearer ${env.DEEPSEEK_API_KEY || ""}`,');

fs.writeFileSync('edge-bridge/src/index.ts', code);
