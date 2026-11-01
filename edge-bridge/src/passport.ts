export interface PassportEnv {
  PASSPORT_JWT_ISSUER?: string;
  PASSPORT_JWKS_URL?: string;
  PASSPORT_JWT_AUDIENCE?: string;
}

export interface PassportClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  role?: string;
  app_metadata?: { role?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * The canonical administrator role string. Standardised on by the Sprint 8.4
 * decision: the edge verifier used `super-admin` (hyphen), the cockpit wrote
 * `super_admin` (underscore) into its store, and AXiM Core's AuthContext issues
 * `super_user`. A token carrying anything but the hyphenated form was silently
 * treated as a normal user, so privileged routes returned 403 in production
 * while every test passed.
 */
export const SUPER_ADMIN_ROLE = "super_admin";

/**
 * Legacy spellings still accepted during the migration window. They are strictly
 * fallbacks: `super_admin` is authoritative, and any other match is reported so
 * the usage can be tracked and eventually removed.
 */
const LEGACY_SUPER_ADMIN_ROLES = ["super-admin", "superadmin", "super_user", "superuser"];

const SUPER_ADMIN_ROLES = new Set([SUPER_ADMIN_ROLE, ...LEGACY_SUPER_ADMIN_ROLES]);

/** The role string a token actually carries, lower-cased, if it grants admin. */
export function adminRoleFrom(claims: PassportClaims): string | undefined {
  const candidates = [claims.app_metadata?.role, claims.role];
  return candidates
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .find((value) => SUPER_ADMIN_ROLES.has(value));
}

/** True when the token carries a legacy spelling rather than the canonical one. */
export function isLegacyAdminRole(role: string | undefined): boolean {
  return Boolean(role) && role !== SUPER_ADMIN_ROLE && SUPER_ADMIN_ROLES.has(role as string);
}
const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 30;

let jwksCache: { url: string; keys: JsonWebKey[]; fetchedAt: number } | null = null;

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

async function loadJwks(url: string, forceRefresh: boolean): Promise<JsonWebKey[]> {
  const now = Date.now();
  if (!forceRefresh && jwksCache && jwksCache.url === url && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { url, keys, fetchedAt: now };
  return keys;
}

function algorithmFor(alg: string): { import: any; verify: any } | null {
  switch (alg) {
    case "RS256":
      return {
        import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        verify: { name: "RSASSA-PKCS1-v1_5" },
      };
    case "ES256":
      return {
        import: { name: "ECDSA", namedCurve: "P-256" },
        verify: { name: "ECDSA", hash: "SHA-256" },
      };
    default:
      return null;
  }
}

/**
 * Verifies a Supabase-issued passport JWT (RS256/ES256) against the configured
 * JWKS, issuer and audience. Returns the claims, or null when invalid or when
 * passport validation is not configured.
 */
export async function verifyPassportJwt(token: string, env: PassportEnv): Promise<PassportClaims | null> {
  const issuer = env.PASSPORT_JWT_ISSUER;
  const jwksUrl = env.PASSPORT_JWKS_URL;
  if (!issuer || !jwksUrl) return null;
  const audience = env.PASSPORT_JWT_AUDIENCE || "authenticated";

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
    const algo = algorithmFor(header.alg || "");
    if (!algo || !header.kid) return null;

    let keys = await loadJwks(jwksUrl, false);
    let jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) {
      keys = await loadJwks(jwksUrl, true);
      jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
    }
    if (!jwk) return null;

    const key = await crypto.subtle.importKey("jwk", jwk, algo.import, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      algo.verify,
      key,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;

    const claims = decodeJson<PassportClaims>(parts[1]);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (claims.iss !== issuer) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!audiences.includes(audience)) return null;
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) return null;
    if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) return null;
    if (!claims.sub) return null;

    return claims;
  } catch {
    return null;
  }
}

export function isSuperAdmin(claims: PassportClaims): boolean {
  return adminRoleFrom(claims) !== undefined;
}
