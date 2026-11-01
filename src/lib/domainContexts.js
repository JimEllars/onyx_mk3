// Domain contexts (personas) the operator can steer Onyx with.
//
// The HUD only ever sends an allow-listed *id*. The wording of each persona
// preamble is owned by the edge bridge (`DOMAIN_CONTEXT_PREAMBLES` in
// `edge-bridge/src/index.ts`) so a browser cannot inject its own system prompt,
// and so the text can be tuned without shipping a new bundle.
//
// Keep `DOMAIN_CONTEXT_IDS` in sync with the edge allow-list; both sides have a
// test asserting the exact set.

export const DEFAULT_DOMAIN_CONTEXT_ID = 'axim-core';

export const DOMAIN_CONTEXTS = [
    {
        id: 'axim-core',
        label: 'AXiM Core',
        blurb: 'Ecosystem orchestration, edge workers, DLQ and signing.',
    },
    {
        id: 'robotics-lab',
        label: 'Robotics Lab',
        blurb: 'Commissioning, telemetry and safety interlocks.',
    },
    {
        id: 'speedreport-network',
        label: 'SpeedReport Network',
        blurb: 'White-label client network (never brands as AXiM).',
    },
    {
        id: 'axim-academy',
        label: 'AXiM Academy',
        blurb: 'Curriculum, onboarding and operator enablement.',
    },
];

export const DOMAIN_CONTEXT_IDS = DOMAIN_CONTEXTS.map((context) => context.id);

/** The context for `id`, falling back to the default rather than throwing. */
export function resolveDomainContext(id) {
    return (
        DOMAIN_CONTEXTS.find((context) => context.id === id) ??
        DOMAIN_CONTEXTS.find((context) => context.id === DEFAULT_DOMAIN_CONTEXT_ID)
    );
}

/** True when `id` is one the edge bridge will accept. */
export function isKnownDomainContext(id) {
    return DOMAIN_CONTEXT_IDS.includes(id);
}

/**
 * Body for `POST /api/v1/onyx/summon`.
 *
 * `domain_context` is always explicit: an omitted field would leave Core guessing
 * the persona, which is what the switcher exists to prevent.
 */
export function buildSummonPayload(message, domainContextId) {
    const context = resolveDomainContext(domainContextId);
    return { message, domain_context: context.id };
}
