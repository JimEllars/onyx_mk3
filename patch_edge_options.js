const fs = require('fs');
let content = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');

const searchStr = `
			if (request.method === "POST" && url.pathname === "/api/v1/onyx/summon") {
`;

const replaceStr = `
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: addOnyxHeaders(getCorsHeaders(request, env), edgeStatus, "MISS", traceId)
			});
		}

			if (request.method === "POST" && url.pathname === "/api/v1/onyx/summon") {
`;

content = content.replace(searchStr, replaceStr);
fs.writeFileSync('edge-bridge/src/index.ts', content);
