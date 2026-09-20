const fs = require('fs');
let code = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');
code = code.replace(/void 0;/g, 'console.error("error");');
fs.writeFileSync('edge-bridge/src/index.ts', code);
