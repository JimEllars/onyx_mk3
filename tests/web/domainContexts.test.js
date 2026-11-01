import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_DOMAIN_CONTEXT,
    DOMAIN_CONTEXTS,
    buildSummonPayload,
    readStoredDomainContext,
    resolveDomainContext,
    writeStoredDomainContext,
} from '../../src/lib/domainContexts.js';

test('the four AXiM personas are present with stable ids', () => {
    assert.deepEqual(
        DOMAIN_CONTEXTS.map((ctx) => ctx.id),
        ['axim_core', 'robotics_lab', 'speedreport_network', 'axim_academy'],
    );
    assert.equal(DEFAULT_DOMAIN_CONTEXT, 'axim_core');
});

test('contexts are frozen so a component cannot mutate shared state', () => {
    assert.equal(Object.isFrozen(DOMAIN_CONTEXTS), true);
});

test('unknown ids fall back to AXiM Core', () => {
    assert.equal(resolveDomainContext('does_not_exist').id, 'axim_core');
    assert.equal(resolveDomainContext(undefined).id, 'axim_core');
    assert.equal(resolveDomainContext(null).id, 'axim_core');
});

test('known ids resolve to their own context', () => {
    assert.equal(resolveDomainContext('robotics_lab').label, 'Robotics Lab');
    assert.equal(resolveDomainContext('speedreport_network').label, 'SpeedReport Network');
    assert.equal(resolveDomainContext('axim_academy').label, 'AXiM Academy');
});

test('summon payload always carries a valid domain_context', () => {
    assert.deepEqual(buildSummonPayload({ message: 'status?', domainContextId: 'robotics_lab' }), {
        message: 'status?',
        domain_context: 'robotics_lab',
    });
    assert.deepEqual(buildSummonPayload({ message: 'status?' }), {
        message: 'status?',
        domain_context: 'axim_core',
    });
    assert.deepEqual(buildSummonPayload({ message: 'x', domainContextId: 'bogus' }), {
        message: 'x',
        domain_context: 'axim_core',
    });
});

test('stored context round-trips and rejects junk', () => {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
    };

    assert.equal(readStoredDomainContext(), 'axim_core');
    assert.equal(writeStoredDomainContext('axim_academy'), 'axim_academy');
    assert.equal(readStoredDomainContext(), 'axim_academy');
    assert.equal(writeStoredDomainContext('not_a_persona'), 'axim_core');
    assert.equal(readStoredDomainContext(), 'axim_core');

    delete globalThis.localStorage;
});

test('readStoredDomainContext survives unavailable storage', () => {
    assert.equal(readStoredDomainContext(), 'axim_core');
    assert.equal(writeStoredDomainContext('robotics_lab'), 'robotics_lab');
});
