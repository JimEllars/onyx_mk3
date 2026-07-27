import re

with open('edge-bridge/src/index.ts', 'r') as f:
    content = f.read()

# Fix the Env interface properties
content = re.sub(
    r'export interface Env {.*?\n}',
    '''export interface Env {
  ONYX_DB: D1Database;
  ONYX_STATE: KVNamespace;
  ONYX_SESSION_STATE: KVNamespace;
  ONYX_DISPATCH_LOCKS: KVNamespace;
  ONYX_PROMPT_CACHE: KVNamespace;
  AXIM_ONYX_SECRET: string;
  ANTHROPIC_API_KEY: string;
  CORE_INGEST_URL: string;
  GITHUB_WEBHOOK_SECRET: string;
  WP_WEBHOOK_SECRET: string;
  AXIM_INTERNAL_KEY: string;
  EMAILIT_API_KEY?: string;
  ALLOWED_ORIGIN?: string;
  ONYX_CLIENT_SECRET?: string;
  CHAT_MODEL?: string;
}''',
    content,
    flags=re.DOTALL
)

# Convert export default {} to handle the functions correctly
content = content.replace('export default {', 'const onyx_handler: any = {')

# Find the end. The original file ends with:
#     }
#   },
# };
#
# I will replace `};\n` or `};` at the very end of the file.
content = re.sub(r'};\s*$', '''};

export default {
  async fetch(request: any, env: Env, ctx: any): Promise<Response> {
    return onyx_handler._fetch(request, env, ctx);
  },
  async scheduled(controller: any, env: Env, ctx: any): Promise<void> {
    return onyx_handler.scheduled(controller, env, ctx);
  }
};
''', content)

# Change scheduled parameter type
content = content.replace('event: ScheduledEvent,', 'controller: any,')

# We'll just cast the promises if needed, but since we are omitting `satisfies ExportedHandler<Env>` it will be fine.
# We also need to fix `kvWriteWithTimeout`.
# Let's remove the generic kvWriteWithTimeout and the Duplicate `TIMEOUT_SYMBOL` logic completely from the file first.
content = re.sub(r'const TIMEOUT_SYMBOL = Symbol\("TIMEOUT"\);\s*', '', content)
content = re.sub(r'async function kvWriteWithTimeout.*?return null;\s*\}\s*\}\s*', '', content, flags=re.DOTALL)
content = re.sub(r'async function kvWriteWithTimeout.*?return false;\s*\}\s*\}\s*', '', content, flags=re.DOTALL)


kv_write_function = '''
const TIMEOUT_SYMBOL = Symbol("TIMEOUT");

async function kvWriteWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 500,
  status?: { degraded: boolean },
): Promise<T | null> {
  try {
    const timeout = new Promise<typeof TIMEOUT_SYMBOL>((resolve) =>
      setTimeout(() => resolve(TIMEOUT_SYMBOL), timeoutMs),
    );
    const result = await Promise.race([promise, timeout]);
    if (result === TIMEOUT_SYMBOL) {
      console.warn("KV write timed out");
      if (status) status.degraded = true;
      return null;
    }
    return result as T;
  } catch (e) {
    console.error("KV write error:", e);
    if (status) status.degraded = true;
    return null;
  }
}
'''
content = content.replace('];\n', '];\n' + kv_write_function + '\n')


with open('edge-bridge/src/index.ts', 'w') as f:
    f.write(content)
