import { describe, it, expect } from 'vitest';
import {
    buildSummonPayload,
    DEFAULT_DOMAIN_CONTEXT_ID,
    DOMAIN_CONTEXT_IDS,
    isKnownDomainContext,
    resolveDomainContext,
} from '../../lib/domainContexts';

describe('domain contexts', () => {
    it('exposes exactly the four personas the edge allow-lists', () => {
        // Keep in sync with DOMAIN_CONTEXT_PREAMBLES in edge-bridge/src/index.ts.
        expect([...DOMAIN_CONTEXT_IDS].sort()).toEqual([
            'axim-academy',
            'axim-core',
            'robotics-lab',
            'speedreport-network',
        ]);
    });

    it('defaults to AXiM Core', () => {
        expect(DEFAULT_DOMAIN_CONTEXT_ID).toBe('axim-core');
        expect(resolveDomainContext(undefined).id).toBe('axim-core');
    });

    it('falls back to the default for an unknown id instead of throwing', () => {
        expect(resolveDomainContext('not-a-context').id).toBe(DEFAULT_DOMAIN_CONTEXT_ID);
    });

    it('resolves a known id to its own label', () => {
        expect(resolveDomainContext('robotics-lab').label).toBe('Robotics Lab');
        expect(resolveDomainContext('speedreport-network').label).toBe('SpeedReport Network');
    });

    it('reports membership for the widget and the payload builder', () => {
        expect(isKnownDomainContext('axim-academy')).toBe(true);
        expect(isKnownDomainContext('toString')).toBe(false);
    });
});

describe('buildSummonPayload', () => {
    it('always carries an explicit domain_context', () => {
        expect(buildSummonPayload('hello', 'robotics-lab')).toEqual({
            message: 'hello',
            domain_context: 'robotics-lab',
        });
    });

    it('normalises an unknown persona to the default', () => {
        expect(buildSummonPayload('hello', 'bogus').domain_context).toBe(DEFAULT_DOMAIN_CONTEXT_ID);
    });
});
