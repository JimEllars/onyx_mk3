const fs = require('fs');

let content = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');

content = content.replace('if (request.method === "POST" && url.pathname === "/api/v1/chat") {', '} else if (request.method === "POST" && url.pathname === "/api/v1/chat") {');

fs.writeFileSync('edge-bridge/src/index.ts', content);
