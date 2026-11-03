/**
 * Invariant test for the pre-gate route surface.
 *
 * `_fetch` answers a dozen routes before the global HMAC gate, so those routes
 * authenticate themselves — or they fail open. This test reads `src/index.ts`
 * and enforces three things:
 *
 *   1. Every route literal declared above the gate marker is registered in
 *      `src/preGateRoutes.ts`. A new route above the gate therefore cannot land
 *      without an explicit, reviewable statement of how it authenticates.
 *   2. Every registered route is still actually declared (no stale checklist
 *      entries that would mask a rename).
 *   3. Every route that is not `public` still contains its declared auth
 *      evidence in its handler block — so a check cannot be quietly deleted.
 *
 * The extraction deliberately over-captures: it takes any `"/path"` literal on
 * a line that mentions `pathname` above the gate. Over-capture fails the test
 * (an unregistered path), which is the safe direction.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GATE_MARKER,
  GATE_EXEMPT_ROUTES,
  PRE_GATE_ROUTES,
  classifyPreGateRoute,
  requiresAuthEvidence,
  type PreGateRoute,
} from '../src/preGateRoutes';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../src/index.ts'), 'utf8');
const lines = source.split('\n');

const ROUTE_LITERAL = /"(\/[A-Za-z0-9._\-/]*)"/g;

function literalsIn(line: string): string[] {
  return [...line.matchAll(ROUTE_LITERAL)].map((match) => match[1]);
}

const markerLines = lines
  .map((line, index) => (line.includes(GATE_MARKER) ? index : -1))
  .filter((index) => index >= 0);

const gateIndex = markerLines[0];

/** Every path literal declared above the gate marker, in source order. */
const declaredAboveGate = new Set<string>();
for (const line of lines.slice(0, gateIndex)) {
  if (!line.includes('pathname')) continue;
  for (const literal of literalsIn(line)) {
    declaredAboveGate.add(literal);
  }
}

/**
 * The handler block for a path: from the line that declares it, to the next line
 * that declares a *different* route (or 250 lines, whichever comes first).
 */
function declaresRoute(line: string, path: string): boolean {
  // `url.pathname !== "/x"` is the gate's exclusion clause, not a route handler,
  // so it must not be mistaken for the place the route is served.
  return (
    line.includes('pathname') &&
    !line.includes('!==') &&
    literalsIn(line).includes(path)
  );
}

function handlerBlock(path: string, fromIndex: number): string {
  const start = lines.findIndex((line, index) => index >= fromIndex && declaresRoute(line, path));
  if (start < 0) return '';

  let end = Math.min(lines.length, start + 250);
  for (let index = start + 1; index < end; index++) {
    const candidates = literalsIn(lines[index]);
    if (lines[index].includes('pathname') && candidates.some((c) => c !== path)) {
      end = index;
      break;
    }
  }

  return lines
    .slice(start, end)
    .join('\n')
    .replace(/\s+/g, ' ');
}

/**
 * Whitespace-insensitive comparison: an evidence snippet must be present in the
 * handler, but prettier's line breaks are not part of the claim.
 */
const squash = (text: string): string => text.replace(/\s+/g, '');

function isCovered(path: string, routes: PreGateRoute[]): boolean {
  return routes.some((route) =>
    route.match === 'exact' ? path === route.path : path.startsWith(route.path),
  );
}

describe('the gate marker', () => {
  it('appears exactly once, so "above the gate" is unambiguous', () => {
    expect(markerLines).toHaveLength(1);
  });
});

describe('routes declared above the HMAC gate', () => {
  it('are actually found by the extractor (guards against the test going quiet)', () => {
    expect(declaredAboveGate.size).toBeGreaterThanOrEqual(17);
    // Spot-check the two that matter most, so a regex change cannot silently
    // stop matching while the count assertion still passes on noise.
    expect(declaredAboveGate.has('/functions/v1/telemetry-ingress')).toBe(true);
    expect(declaredAboveGate.has('/api/v1/onyx/emergency-direct')).toBe(true);
    expect(declaredAboveGate.has('/api/v1/telemetry/dlq-status')).toBe(true);
  });

  it('are all registered with an auth mode', () => {
    const unregistered = [...declaredAboveGate].filter(
      (path) => !isCovered(path, PRE_GATE_ROUTES),
    );

    expect(
      unregistered,
      'Routes declared above the global HMAC gate must be listed in src/preGateRoutes.ts ' +
        'with the mechanism that authenticates them. An unregistered pre-gate route is a ' +
        'silent fail-open.',
    ).toEqual([]);
  });

  it('have no registry entries that no longer exist in the source', () => {
    const stale = PRE_GATE_ROUTES.filter((route) => !declaredAboveGate.has(route.path)).map(
      (route) => route.path,
    );

    expect(stale, 'Registered pre-gate route is no longer declared in index.ts').toEqual([]);
  });

  it('declare auth evidence for every route that is not public', () => {
    const unevidenced = PRE_GATE_ROUTES.filter(
      (route) => requiresAuthEvidence(route) && route.evidence.length === 0,
    ).map((route) => route.path);

    expect(unevidenced).toEqual([]);
  });

  it('still contain the auth call each entry claims', () => {
    const missing: string[] = [];

    for (const route of PRE_GATE_ROUTES) {
      const block = handlerBlock(route.path, 0);
      expect(block, `no handler block found for ${route.path}`).not.toBe('');

      for (const needle of route.evidence) {
        if (!squash(block).includes(squash(needle))) {
          missing.push(`${route.path} → ${needle}`);
        }
      }
    }

    expect(
      missing,
      'Auth evidence declared in preGateRoutes.ts is absent from the handler, so the check ' +
        'was removed, renamed or moved out of the block.',
    ).toEqual([]);
  });
});

describe('routes exempted from the HMAC gate', () => {
  it('are declared after the gate, where the exemption actually applies', () => {
    for (const route of GATE_EXEMPT_ROUTES) {
      const index = lines.findIndex((line, i) => i > gateIndex && declaresRoute(line, route.path));
      expect(index, `${route.path} should be declared after the gate marker`).toBeGreaterThan(gateIndex);
    }
  });

  it('authenticate inside their own handler', () => {
    const missing: string[] = [];

    for (const route of GATE_EXEMPT_ROUTES) {
      const block = handlerBlock(route.path, gateIndex);
      expect(block, `no handler block found for ${route.path}`).not.toBe('');

      for (const needle of route.evidence) {
        if (!squash(block).includes(squash(needle))) {
          missing.push(`${route.path} → ${needle}`);
        }
      }
    }

    expect(
      missing,
      'A gate-exempt route must verify the caller itself; it gets no help from the global gate.',
    ).toEqual([]);
  });
});

describe('classifyPreGateRoute', () => {
  it('matches exact routes regardless of method case', () => {
    expect(classifyPreGateRoute('get', '/health')?.auth).toBe('public');
  });

  it('does not match a different verb', () => {
    expect(classifyPreGateRoute('POST', '/health')).toBeUndefined();
  });

  it('prefers the longest prefix match', () => {
    expect(classifyPreGateRoute('POST', '/api/v1/generate/nda')?.path).toBe(
      '/api/v1/generate/nda',
    );
    expect(classifyPreGateRoute('POST', '/api/v1/generate/invoice')?.path).toBe(
      '/api/v1/generate/',
    );
  });

  it('matches prefixes the way _fetch does (plain startsWith, no segment boundary)', () => {
    // Deliberate: the registry has to describe what _fetch actually answers, and
    // _fetch uses `url.pathname.startsWith(...)`. Tightening this to a segment
    // boundary is a change to the router, not to the checklist.
    expect(classifyPreGateRoute('GET', '/api/v1/schemaX')?.path).toBe('/api/v1/schema');
  });

  it('returns nothing for unregistered paths', () => {
    expect(classifyPreGateRoute('POST', '/api/v1/not-a-route')).toBeUndefined();
  });
});
