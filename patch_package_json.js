const fs = require('fs');
let content = fs.readFileSync('edge-bridge/package.json', 'utf8');

content = content.replace(
    /"typegen": "wrangler types \.\/src\/worker-configuration\.d\.ts --config wrangler\.jsonc",/,
    '"typegen": "wrangler types ./src/worker-configuration.d.ts --config wrangler.jsonc",\n    "typecheck": "tsc --noEmit",'
);

content = content.replace(
    /"build": "npm run typegen && tsc --noEmit",/,
    '"build": "npm run typegen && npm run typecheck",'
);

content = content.replace(
    /"dev": "wrangler dev --config wrangler.jsonc",/,
    '"dev": "wrangler dev --config wrangler.jsonc",\n    "format": "prettier --write src/**/*.ts",'
);

fs.writeFileSync('edge-bridge/package.json', content);
