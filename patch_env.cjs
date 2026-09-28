const fs = require('fs');
let code = fs.readFileSync('edge-bridge/src/index.ts', 'utf-8');

const regex = /export interface Env extends __BaseEnv_Env \{([^}]*)\}/m;
const match = code.match(regex);
if (match) {
    let body = match[1];

    // Remove conflicting types that are already in __BaseEnv_Env
    const toRemove = [
        'ONYX_STATE', 'ONYX_SESSION_STATE', 'ONYX_PROMPT_CACHE',
        'ONYX_DISPATCH_LOCKS', 'ONYX_KV', 'ONYX_DB', 'ONYX_EDGE_METRICS',
        'AI', 'ASSETS', 'CORE_INGEST_URL', 'ALLOWED_ORIGIN', 'DEEPSEEK_MODEL'
    ];

    let lines = body.split('\n');
    lines = lines.filter(line => {
        const trimmed = line.trim();
        for (const r of toRemove) {
            if (trimmed.startsWith(r + ':') || trimmed.startsWith(r + '?:')) {
                return false;
            }
        }
        return true;
    });

    // Make runtime secrets optional
    const toOptional = [
        'AXIM_SERVICE_KEY', 'AXIM_ONYX_SECRET', 'AXIM_INTERNAL_KEY',
        'GITHUB_WEBHOOK_SECRET', 'WP_WEBHOOK_SECRET'
    ];

    lines = lines.map(line => {
        for (const o of toOptional) {
            if (line.trim().startsWith(o + ':')) {
                return line.replace(o + ':', o + '?:');
            }
        }
        return line;
    });

    const newBody = lines.join('\n');
    code = code.replace(match[0], `export interface Env extends __BaseEnv_Env {${newBody}}`);
    fs.writeFileSync('edge-bridge/src/index.ts', code);
}
