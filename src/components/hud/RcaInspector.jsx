import React, { useMemo, useState } from 'react';

function pretty(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
}

/**
 * Root-cause analysis inspector for micro-app 5xx reports.
 *
 * Opens as a drawer over the Action Console and shows the structured RCA payload
 * the micro-app shipped with the failure, plus the untouched event so the operator
 * can see what was actually received. Read-only by design: nothing here mutates
 * the fleet.
 */
export default function RcaInspector({ event, onClose }) {
    const [showRaw, setShowRaw] = useState(false);
    const [copied, setCopied] = useState(false);

    const rca = useMemo(() => event?.rca ?? event?.payload?.rca ?? null, [event]);
    const document = showRaw || !rca ? event : rca;

    if (!event) return null;

    const microApp = event.micro_app || event.source || event.service || 'unknown micro-app';
    const status = event.status_code || event.status || event.code || 'n/a';
    const received = event.timestamp || event.received_at || null;

    const copy = async () => {
        try {
            await navigator.clipboard?.writeText(pretty(document));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (error) {
            setCopied(false);
        }
    };

    return (
        <div
            className="rca-inspector absolute inset-y-0 right-0 w-full sm:w-[28rem] bg-slate-950/98 border-l border-slate-700 shadow-2xl flex flex-col z-30"
            role="dialog"
            aria-label="RCA inspector"
        >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-700/60">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-widest text-slate-500">Root cause analysis</span>
                    <span className="text-xs font-bold text-slate-200">{microApp}</span>
                    <span className="text-[10px] text-rose-400 font-mono">HTTP {status}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={copy}
                        className="text-[10px] font-bold tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                        {copied ? 'COPIED' : 'COPY'}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close RCA inspector"
                        className="text-slate-400 hover:text-slate-100 text-sm leading-none px-2 py-1"
                    >
                        ✕
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-800 text-[10px] tracking-wider">
                <button
                    type="button"
                    onClick={() => setShowRaw(false)}
                    aria-pressed={!showRaw && Boolean(rca)}
                    className={`px-2 py-1 rounded ${!showRaw && rca ? 'bg-slate-800 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    RCA
                </button>
                <button
                    type="button"
                    onClick={() => setShowRaw(true)}
                    aria-pressed={showRaw || !rca}
                    className={`px-2 py-1 rounded ${showRaw || !rca ? 'bg-slate-800 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    RAW EVENT
                </button>
                {received && (
                    <span className="ml-auto text-slate-600 font-mono normal-case">
                        {new Date(received).toISOString()}
                    </span>
                )}
            </div>

            <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                {rca ? null : (
                    <p className="text-[10px] text-amber-400 mb-2">
                        This event carried no structured RCA block; showing the raw payload.
                    </p>
                )}
                <pre className="text-[10px] leading-relaxed text-blue-200 whitespace-pre-wrap break-all font-mono">
                    {pretty(document)}
                </pre>
            </div>
        </div>
    );
}
