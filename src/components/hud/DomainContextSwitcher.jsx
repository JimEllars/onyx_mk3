import React from 'react';
import {
    DEFAULT_DOMAIN_CONTEXT_ID,
    DOMAIN_CONTEXTS,
    resolveDomainContext,
} from '../../lib/domainContexts';

/**
 * Persona switcher for the chat surface.
 *
 * Selecting a context changes the `domain_context` sent with every summon so Onyx
 * answers from the right body of knowledge instead of guessing.
 */
export default function DomainContextSwitcher({ value, onChange, disabled = false }) {
    const active = resolveDomainContext(value || DEFAULT_DOMAIN_CONTEXT_ID);

    return (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/80 border-b border-slate-700/50">
            <label
                htmlFor="domain-context"
                className="text-[10px] uppercase tracking-widest text-slate-500 whitespace-nowrap"
            >
                Persona
            </label>
            <select
                id="domain-context"
                value={active.id}
                disabled={disabled}
                onChange={(event) => onChange?.(event.target.value)}
                className="bg-slate-800 text-slate-200 text-xs rounded border border-slate-600 px-2 py-1 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
                {DOMAIN_CONTEXTS.map((context) => (
                    <option key={context.id} value={context.id}>
                        {context.label}
                    </option>
                ))}
            </select>
            <span className="text-[10px] text-slate-500 truncate" title={active.blurb}>
                {active.blurb}
            </span>
        </div>
    );
}
