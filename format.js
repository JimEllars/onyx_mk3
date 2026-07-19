const fs = require('fs');
let content = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');

content = content.replace(/console.warn\(\`\[Unauthorized Access Attempt\] Origin: \$\{request.headers.get\("Origin"\) \|\| "Unknown"\}, IP: \$\{request.headers.get\("cf-connecting-ip"\) \|\| "Unknown"\}\`\);/,
    `console.warn(\`[Unauthorized Access Attempt] Origin: \${request.headers.get("Origin") || "Unknown"}, IP: \${request.headers.get("cf-connecting-ip") || "Unknown"}\`);`);

fs.writeFileSync('edge-bridge/src/index.ts', content);
