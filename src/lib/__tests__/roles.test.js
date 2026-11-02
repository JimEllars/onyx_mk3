import { describe, it, expect, vi } from 'vitest';
import {
    adminRoleFromClaims,
    isLegacyAdminRole,
    isSuperAdminClaims,
    SUPER_ADMIN_ROLE,
    SUPER_ADMIN_ROLES,
} from '../../lib/roles';
import { hasSuperAdminRole, parseJwt } from '../../hooks/useAximAuth';

function base64Url(value) {
    return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Minimal unsigned JWT — the HUD only decodes claims, the worker verifies. */
function jwt(claims) {
    return `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url(claims)}.signature`;
}

const futureExp = () => Math.floor(Date.now() / 1000) + 3600;
const pastExp = () => Math.floor(Date.now() / 1000) - 60;

describe('role parsing (mirrors edge-bridge/src/passport.ts)', () => {
    it('accepts the canonical super_admin spelling in app_metadata', () => {
        expect(adminRoleFromClaims({ app_metadata: { role: SUPER_ADMIN_ROLE } })).toBe(SUPER_ADMIN_ROLE);
    });

    it('accepts the canonical spelling at the top level', () => {
        expect(adminRoleFromClaims({ role: 'SUPER_ADMIN' })).toBe(SUPER_ADMIN_ROLE);
    });

    it('reports legacy spellings but still grants them', () => {
        for (const role of SUPER_ADMIN_ROLES) {
            const resolved = adminRoleFromClaims({ app_metadata: { role } });
            expect(resolved).toBe(role);
        }
        expect(isLegacyAdminRole('super_user')).toBe(true);
        expect(isLegacyAdminRole(SUPER_ADMIN_ROLE)).toBe(false);
    });

    it('denies ordinary users and empty claims without throwing', () => {
        expect(isSuperAdminClaims({ app_metadata: { role: 'user' } })).toBe(false);
        expect(isSuperAdminClaims({})).toBe(false);
        expect(isSuperAdminClaims(null)).toBe(false);
        expect(adminRoleFromClaims({ role: 42 })).toBeUndefined();
    });
});

describe('hasSuperAdminRole', () => {
    it('grants a valid super-admin token', () => {
        const token = jwt({ sub: 'u1', exp: futureExp(), app_metadata: { role: 'super_admin' } });
        expect(hasSuperAdminRole(token)).toBe(true);
    });

    it('warns when the token carries a legacy spelling', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const token = jwt({ sub: 'u1', exp: futureExp(), app_metadata: { role: 'super_user' } });
        expect(hasSuperAdminRole(token)).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('legacy admin role'));
    });

    it('denies an expired token', () => {
        const token = jwt({ sub: 'u1', exp: pastExp(), app_metadata: { role: 'super_admin' } });
        expect(hasSuperAdminRole(token)).toBe(false);
    });

    it('does not throw on a token whose app_metadata has no role claim', () => {
        // The regression: the old implementation read app_metadata.SUPER_ADMIN_ROLES
        // and referenced an undeclared `role`, so this threw instead of denying.
        const token = jwt({ sub: 'u1', exp: futureExp(), app_metadata: { provider: 'email' } });
        expect(() => hasSuperAdminRole(token)).not.toThrow();
        expect(hasSuperAdminRole(token)).toBe(false);
    });

    it('does not throw on a token with no app_metadata at all', () => {
        const token = jwt({ sub: 'u1', exp: futureExp() });
        expect(() => hasSuperAdminRole(token)).not.toThrow();
        expect(hasSuperAdminRole(token)).toBe(false);
    });

    it('denies garbage instead of throwing', () => {
        expect(hasSuperAdminRole('not-a-jwt')).toBe(false);
        expect(hasSuperAdminRole('')).toBe(false);
        expect(parseJwt('a.b.c')).toBeNull();
    });
});
