/**
 * Multi-persona domain context.
 *
 * The cockpit lets an operator pin which AXiM domain Onyx should reason in. The
 * selection travels to Core inside the summon body — `edge-bridge` forwards the
 * parsed body to `CORE_INGEST_URL` opaquely, so no edge change is required.
 *
 * Keep ids stable: they are persisted in localStorage and read by Core.
 */

export const DEFAULT_DOMAIN_CONTEXT = 'axim_core';

/**
 * @typedef {{ id: string, label: string, blurb: string }} DomainContext
 */

/** @type {ReadonlyArray<DomainContext>} */
export const DOMAIN_CONTEXTS = Object.freeze([
    {
        id: 'axim_core',
        label: 'AXiM Core',
        blurb: 'Fleet orchestration, edge relays, HITL approvals.',
    },
    {
        id: 'robotics_lab',
        label: 'Robotics Lab',
        blurb: 'Simulation, policy evaluation, OTA rollout. No CAD/BOM detail.',
    },
    {
        id: 'speedreport_network',
        label: 'SpeedReport Network',
        blurb: 'White-label reporting. Zero AXiM branding in output.',
    },
    {
        id: 'axim_academy',
        label: 'AXiM Academy',
        blurb: 'Curriculum, learner progress, certification.',
    },
]);

const STORAGE_KEY = 'onyx_domain_context';

/**
 * Resolve an id to a context, falling back to AXiM Core.
 *
 * @param {string | null | undefined} id
 * @returns {DomainContext}
 */
export function resolveDomainContext(id) {
    const match = DOMAIN_CONTEXTS.find((ctx) => ctx.id === id);
    return match ?? DOMAIN_CONTEXTS.find((ctx) => ctx.id === DEFAULT_DOMAIN_CONTEXT);
}

/**
 * Read the persisted selection. Safe in non-browser contexts.
 *
 * @returns {string} a valid context id
 */
export function readStoredDomainContext() {
    try {
        const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
        return resolveDomainContext(stored).id;
    } catch {
        return DEFAULT_DOMAIN_CONTEXT;
    }
}

/**
 * Persist the selection. Failures are non-fatal (private mode, quota).
 *
 * @param {string} id
 * @returns {string} the id actually stored
 */
export function writeStoredDomainContext(id) {
    const resolved = resolveDomainContext(id).id;
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, resolved);
    } catch {
        /* storage unavailable — keep the in-memory selection */
    }
    return resolved;
}

/**
 * Build the body for `POST /api/v1/onyx/summon`.
 *
 * @param {{ message: string, domainContextId?: string }} params
 * @returns {{ message: string, domain_context: string }}
 */
export function buildSummonPayload({ message, domainContextId }) {
    return {
        message,
        domain_context: resolveDomainContext(domainContextId).id,
    };
}
