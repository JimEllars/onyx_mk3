// Canonical administrator-role logic for the HUD.
//
// This is a deliberate JavaScript mirror of `edge-bridge/src/passport.ts`
// (`adminRoleFrom` / `isLegacyAdminRole`). The HUD gate is cosmetic — the worker
// re-verifies the JWT signature and the role on every privileged call — but the
// two implementations must agree, or the cockpit hides panels the API allows.

export const SUPER_ADMIN_ROLE = 'super_admin';

// Legacy spellings still accepted during the migration window. Strictly
// fallbacks: `super_admin` is authoritative, everything else is reported.
export const LEGACY_SUPER_ADMIN_ROLES = ['super-admin', 'superadmin', 'super_user', 'superuser'];

export const SUPER_ADMIN_ROLES = [SUPER_ADMIN_ROLE, ...LEGACY_SUPER_ADMIN_ROLES];

const SUPER_ADMIN_ROLE_SET = new Set(SUPER_ADMIN_ROLES);

/**
 * The role string a token actually carries, lower-cased, if it grants admin.
 *
 * Passport issues the role in `app_metadata.role`; some satellites and older
 * tokens put it at the top level. Both are accepted, exactly as the edge does.
 */
export function adminRoleFromClaims(claims) {
    if (!claims || typeof claims !== 'object') return undefined;
    const candidates = [claims.app_metadata?.role, claims.role];
    return candidates
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .find((value) => SUPER_ADMIN_ROLE_SET.has(value));
}

/** True when the role is a legacy spelling rather than the canonical one. */
export function isLegacyAdminRole(role) {
    return Boolean(role) && role !== SUPER_ADMIN_ROLE && SUPER_ADMIN_ROLE_SET.has(role);
}

/** True when these claims carry any spelling that grants administrator access. */
export function isSuperAdminClaims(claims) {
    return adminRoleFromClaims(claims) !== undefined;
}
