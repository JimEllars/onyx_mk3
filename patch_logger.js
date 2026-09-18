const fs = require('fs');
let code = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');
code = code.replace(/void 0;/g, 'console.log("Replaced void 0 with logger");');
fs.writeFileSync('edge-bridge/src/index.ts.tmp', code);
