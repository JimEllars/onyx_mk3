/**
 * Structured logging for the edge bridge.
 *
 * A bare `console.error("error")` inside a catch names neither the subsystem nor
 * the request, so a production log line is unactionable: you cannot tell a KV
 * timeout from an LLM fallback, and you cannot join the line to a trace. Every
 * error site now carries an `event` (stable, dotted, greppable) plus whatever
 * request context the caller already holds.
 *
 * Each line is one `JSON.stringify` call so Cloudflare Logs shows a single
 * parseable record rather than an object inspection.
 *
 * Rules for callers:
 * - `event` is `<subsystem>.<what_happened>`, e.g. `edge.kv.read_timeout`.
 * - Pass the caught value as `error`; do not stringify it at the call site.
 * - Never put a secret, token, cookie or request body in `context`.
 */

export interface LogContext {
  [key: string]: unknown;
}

function errorDetail(error: unknown): Record<string, unknown> {
  if (error === undefined || error === null) {
    return {};
  }
  if (error instanceof Error) {
    const detail: Record<string, unknown> = {
      message: error.message || error.name || "Error",
    };
    if (error.name) {
      detail.error_name = error.name;
    }
    return detail;
  }
  if (typeof error === "string") {
    return { message: error };
  }
  return { message: String(error) };
}

/**
 * Logging must never turn a handled failure into an unhandled one, so a context
 * value that cannot be serialised (a cycle, a BigInt) degrades to the event name
 * instead of throwing inside a catch block.
 */
function stringify(record: Record<string, unknown>, event: string): string {
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({ level: record.level, event, unserializable_context: true });
  }
}

export function logError(event: string, error?: unknown, context: LogContext = {}): void {
  console.error(stringify({ level: "error", event, ...errorDetail(error), ...context }, event));
}

/**
 * Request-level info logging. `event` is still dotted and stable so the two
 * log levels can be filtered with the same vocabulary.
 */
export function logRequest(event: string, context: LogContext = {}): void {
  console.log(stringify({ level: "info", event, ...context }, event));
}
