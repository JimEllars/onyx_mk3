const fs = require('fs');

const path = 'edge-bridge/src/index.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /result\.error\.errors/g,
  'result.error.issues'
);

fs.writeFileSync(path, code);
