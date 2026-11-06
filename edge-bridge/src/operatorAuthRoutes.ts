/**
 * Mutating routes that authenticate the caller with an operator credential
 * instead of a body HMAC.
 *
 * Why this list exists: the global gate in `index.ts` ("Strict HMAC Validation
 * for payload-mutating requests") refuses any POST/PUT/DELETE that does not
 * carry `X-Axim-Signature` — an HMAC over the raw body keyed with
 * `AXIM_INTERNAL_KEY`. Only a server can produce one. The key must never reach
 * a browser, so every cockpit POST was answered by the gate before its handler
 * ran:
 *
 *   POST /api/v1/hitl/action      -> 401 "Missing x-axim-signature header"
 *   POST /api/v1/playbook/trigger -> 401 "Missing x-axim-signature header"
 *
 * The Approve/Reject buttons in `ActionConsole` and the playbook controls in
 * `PlaybookTrigger` both send an operator Passport bearer and nothing else, so
 * both were dead against the deployed worker while their handler-level tests
 * kept passing (the tests signed with `AXIM_INTERNAL_KEY`, i.e. they exercised
 * the server-to-server path only).
 *
 * A route belongs here only when its handler calls `checkAuth()` itself — the
 * gate accepts the operator credential *in place of* the signature and the
 * handler re-checks it, so the gate is a gate and not the only door. Routes
 * that do not re-check stay HMAC-only: adding one of them here would widen
 * auth, not fix it.
 *
 * Each entry carries `evidence`: the exact snippet that must remain in the
 * handler block. `test/operator-auth-routes.test.ts` reads `src/index.ts` and
 * fails when an entry is stale, when its handler moved, or when the `checkAuth`
 * call it relies on was deleted.
 */

export type OperatorAuthMode =
  /** `checkAuth(request, env)` — operator secret, service key or Passport JWT. */
  | "operator"
  /** `checkAuth(request, env, true)` — super-admin only. */
  | "operator-superuser";

export interface OperatorAuthRoute {
  /** Exact path. These are action endpoints; none of them is a prefix router. */
  path: string;
  /** Mutating verbs the gate would otherwise demand a signature for. */
  methods: string[];
  auth: OperatorAuthMode;
  /** Normalised source snippets that must still appear in the handler block. */
  evidence: string[];
  why: string;
}

export const OPERATOR_AUTH_ROUTES: OperatorAuthRoute[] = [
  {
    path: "/api/v1/hitl/action",
    methods: ["POST"],
    auth: "operator-superuser",
    evidence: ["const authError = await checkAuth(request, env, true);"],
    why: "A human decides on a ticket from the cockpit and presents a Passport JWT. Mutating, so super-admin; the handler re-checks before relaying to Core.",
  },
  {
    path: "/api/v1/playbook/trigger",
    methods: ["POST"],
    auth: "operator-superuser",
    evidence: ["const authError = await checkAuth(request, env, true);"],
    why: "Runs a named playbook. Control-plane action from the cockpit, super-admin, and the handler re-checks.",
  },
];

/**
 * Look up an operator-authenticated route. Exact match only: a prefix here would
 * quietly exempt anything nested beneath it from the signature requirement.
 */
export function findOperatorAuthRoute(
  method: string,
  pathname: string,
  routes: OperatorAuthRoute[] = OPERATOR_AUTH_ROUTES,
): OperatorAuthRoute | undefined {
  const upper = method.toUpperCase();
  return routes.find(
    (route) => route.path === pathname && route.methods.includes(upper),
  );
}

/** The `checkAuth` flag a registered route requires, in one place. */
export function requiresSuperUser(route: OperatorAuthRoute): boolean {
  return route.auth === "operator-superuser";
}
