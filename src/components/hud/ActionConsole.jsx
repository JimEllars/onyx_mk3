import React, { useState, useEffect, useMemo, useCallback } from 'react';
import useAgentConnection from '../../hooks/useAgentConnection';
import useDesktopAgentStore from '../../store/useDesktopAgentStore';
import PlaybookTrigger from './PlaybookTrigger';
import {
    collectRcaRecords,
    computeErrorRate,
    formatRcaJson,
    summarizeDlqStatus,
} from '../../lib/rca';

const DLQ_POLL_MS = 15000;
const TICKET_TTL_MS = 300000; // 5 minutes

const EMPTY_DLQ = summarizeDlqStatus(null);

export default function ActionConsole({ peerConnection }) {
    const { status } = useAgentConnection(peerConnection);
    const { pendingHitlActions, updateHitlActionStatus, telemetryEvents } = useDesktopAgentStore();

    const [isWaiting, setIsWaiting] = useState(false);
    const [loadTimeMs, setLoadTimeMs] = useState(null);
    const [dlq, setDlq] = useState(EMPTY_DLQ);
    const [dlqError, setDlqError] = useState(null);
    const [selectedRcaId, setSelectedRcaId] = useState(null);
    const [hitlNotice, setHitlNotice] = useState(null);

    const apiUrl = import.meta.env.VITE_ONYX_WORKER_URL || '';

    const rcaRecords = useMemo(() => collectRcaRecords(telemetryEvents), [telemetryEvents]);
    const errorRate = useMemo(() => computeErrorRate(telemetryEvents), [telemetryEvents]);
    const selectedRecord = useMemo(
        () => rcaRecords.find((record) => record.id === selectedRcaId) || null,
        [rcaRecords, selectedRcaId],
    );

    useEffect(() => {
        const handleWaiting = () => {
            setIsWaiting(true);
            setTimeout(() => setIsWaiting(false), 3000);
        };
        window.addEventListener('onyx_waiting_on_user', handleWaiting);
        return () => window.removeEventListener('onyx_waiting_on_user', handleWaiting);
    }, []);

    // Expire stale tickets.
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            pendingHitlActions.forEach((action) => {
                if (action.status === 'PENDING' && now - action.timestamp > TICKET_TTL_MS) {
                    updateHitlActionStatus(action.id, 'EXPIRED');
                }
            });
        }, 5000);
        return () => clearInterval(interval);
    }, [pendingHitlActions, updateHitlActionStatus]);

    // Live DLQ depth from the edge bridge.
    useEffect(() => {
        let disposed = false;

        const pollDlq = async () => {
            const token = localStorage.getItem('axim_passport_token');
            const started = performance.now();
            try {
                const res = await fetch(`${apiUrl}/api/v1/telemetry/dlq-status`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (disposed) return;
                setLoadTimeMs(Math.round(performance.now() - started));

                if (!res.ok) {
                    setDlqError(`DLQ status ${res.status}`);
                    return;
                }
                const body = await res.json();
                if (disposed) return;
                setDlq(summarizeDlqStatus(body));
                setDlqError(null);
            } catch (err) {
                if (disposed) return;
                setLoadTimeMs(Math.round(performance.now() - started));
                setDlqError('DLQ unreachable');
            }
        };

        pollDlq();
        const interval = setInterval(pollDlq, DLQ_POLL_MS);
        return () => {
            disposed = true;
            clearInterval(interval);
        };
    }, [apiUrl]);

    let voiceColor = 'text-gray-500';
    if (status === 'CONNECTED') voiceColor = 'text-emerald-500';
    else if (status === 'RECONNECTING') voiceColor = 'text-yellow-500';
    else if (status === 'RECONNECT NEEDED' || status === 'DISCONNECTED') voiceColor = 'text-red-500';

    const submitDecision = useCallback(
        async (actionId, decision) => {
            const pendingLabel = decision === 'approved' ? 'APPROVING...' : 'REJECTING...';
            const settledLabel = decision === 'approved' ? 'APPROVED' : 'REJECTED';
            try {
                updateHitlActionStatus(actionId, pendingLabel);
                const token = localStorage.getItem('axim_passport_token');
                const response = await fetch(`${apiUrl}/api/v1/hitl/action`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ action_id: actionId, decision }),
                });

                let body = null;
                try {
                    body = await response.json();
                } catch {
                    /* non-JSON error page */
                }

                if (response.ok && body?.applied !== false) {
                    updateHitlActionStatus(actionId, settledLabel);
                    setHitlNotice(null);
                    setTimeout(() => {
                        useDesktopAgentStore.setState((state) => ({
                            pendingHitlActions: state.pendingHitlActions.filter((a) => a.id !== actionId),
                        }));
                    }, 1500);
                    return;
                }

                // The edge records the decision locally but reports 502/503 when
                // Core did not apply it. Surface that instead of a bare "FAILED".
                updateHitlActionStatus(actionId, 'FAILED');
                const reason = body?.reason || `HTTP ${response.status}`;
                setHitlNotice({ id: actionId, message: `Decision not applied — ${reason}` });
            } catch (e) {
                updateHitlActionStatus(actionId, 'FAILED');
                setHitlNotice({ id: actionId, message: 'Decision failed — edge unreachable' });
            }
        },
        [apiUrl, updateHitlActionStatus],
    );

    const handleApprove = (actionId) => submitDecision(actionId, 'approved');
    const handleReject = (actionId) => submitDecision(actionId, 'rejected');

    useEffect(() => {
        const handleKeyDown = (e) => {
            const target = e.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            const pendingAction = pendingHitlActions.find((a) => a.status === 'PENDING');
            if (!pendingAction) return;
            if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
                handleApprove(pendingAction.id);
            } else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
                handleReject(pendingAction.id);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pendingHitlActions]);

    const dlqColor = dlqError
        ? 'text-red-400'
        : dlq.total > 0 || !dlq.healthy
          ? 'text-amber-400'
          : 'text-emerald-400';

    return (
        <div className="action-console w-80 lg:w-96 p-5 bg-slate-900 text-slate-100 flex flex-col gap-6 rounded-l-xl shadow-2xl border-l border-t border-b border-slate-800 h-full overflow-hidden font-mono relative z-10">
            <div className="flex flex-col gap-3 border-b border-slate-700/50 pb-4">
                <div className="flex justify-between items-center">
                    <h2 className="font-bold tracking-widest text-sm text-slate-300 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isWaiting ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`}></span>
                        COMMAND HUB
                    </h2>
                    <div className={`badge border border-slate-700 px-2 py-0.5 rounded text-[10px] tracking-wider ${voiceColor} bg-slate-800/80 shadow-inner`}>
                        VOICE: {status === 'RECONNECTING' ? 'RECONNECTING...' : status}
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center mt-2">
                    <div className="bg-slate-800/40 rounded p-2 border border-slate-700/50 flex flex-col justify-center">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Queue Load</span>
                        <span className={`text-xs font-semibold ${loadTimeMs !== null && loadTimeMs < 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {loadTimeMs === null ? '--' : `${loadTimeMs}ms`}
                        </span>
                    </div>
                    <div className="bg-slate-800/40 rounded p-2 border border-slate-700/50 flex flex-col justify-center">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Error Rate</span>
                        <span className={`text-xs font-semibold ${errorRate > 5 ? 'text-red-400' : 'text-emerald-400'}`}>{errorRate}%</span>
                    </div>
                    <div className="bg-slate-800/40 rounded p-2 border border-slate-700/50 flex flex-col justify-center">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">DLQ Depth</span>
                        <span className={`text-xs font-semibold ${dlqColor}`} title={dlqError || `relays ${dlq.relays} · receipts ${dlq.receipts}`}>
                            {dlqError ? 'ERR' : dlq.total}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-between text-[9px] tracking-wider uppercase text-slate-500">
                    <span className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${dlq.healthy ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                        Breaker: {dlq.circuitBreaker}
                    </span>
                    <span className={dlq.upstreamCoreOk ? 'text-emerald-500' : 'text-red-400'}>
                        Core {dlq.upstreamCoreOk ? 'reachable' : 'down'}
                    </span>
                </div>
            </div>

            <div className="hitl-queue flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <h3 className="text-[10px] font-bold text-slate-500 mb-3 tracking-widest uppercase flex justify-between items-center">
                    <span>Active Tickets (HITL)</span>
                    <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">{pendingHitlActions.length}</span>
                </h3>

                {hitlNotice && (
                    <div className="mb-3 text-[10px] text-red-300 bg-red-900/30 border border-red-800/60 rounded p-2 flex justify-between gap-2">
                        <span className="break-all">{hitlNotice.message}</span>
                        <button type="button" onClick={() => setHitlNotice(null)} className="underline shrink-0">dismiss</button>
                    </div>
                )}

                {pendingHitlActions.length === 0 ? (
                    <div className="text-slate-500 text-xs italic flex flex-col items-center justify-center h-32 bg-slate-800/20 rounded-lg border border-dashed border-slate-700/50 gap-2">
                        <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        Queue empty.
                    </div>
                ) : (
                    <ul className="flex flex-col gap-3">
                        {pendingHitlActions.map((action) => (
                            <li key={action.id} className={`border p-3 rounded-lg hover:bg-slate-800/80 transition-all duration-500 flex flex-col gap-3 text-sm shadow-sm group overflow-hidden ${
                                    action.risk_level === 'LOW' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' :
                                    action.risk_level === 'MEDIUM' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                                    action.risk_level === 'HIGH' || action.risk_level === 'CRITICAL' ? 'bg-rose-500/10 border-rose-500/40 text-rose-400 animate-[pulse_2s_ease-in-out_infinite]' :
                                    'border-slate-700/80 bg-slate-800/40'
                                } ${action.status === 'APPROVED' || action.status === 'REJECTED' ? 'opacity-0 scale-95 h-0 p-0 m-0 border-0' : 'opacity-100 scale-100'}`}>
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex flex-col gap-1 flex-1">
                                       <div className="flex items-center gap-2">
                                         {action.risk_level === 'HIGH' || action.risk_level === 'CRITICAL' ? <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span> : null}
                                         <span className="font-bold text-[10px] uppercase tracking-wider">{action.risk_level || 'STANDARD'} RISK</span>
                                       </div>
                                       <span className="leading-snug text-slate-300 text-xs line-clamp-3">{action.description || 'System task awaits approval.'}</span>
                                    </div>
                                    <div className="text-[9px] text-slate-500 mt-0.5 whitespace-nowrap">
                                        {Math.round((Date.now() - action.timestamp) / 1000)}s ago
                                    </div>
                                </div>

                                {action.params && (
                                    <details className="text-[10px] mt-1 group">
                                      <summary className="cursor-pointer font-bold tracking-wider text-slate-400 hover:text-slate-300 transition-colors uppercase select-none flex items-center gap-1">
                                        <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                                        Parameters
                                      </summary>
                                      <div className="bg-slate-900 rounded p-2 overflow-x-auto text-blue-300 border border-slate-700 mt-2 custom-scrollbar max-h-32">
                                          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(action.params, null, 2)}</pre>
                                      </div>
                                    </details>
                                )}

                                <div className="flex justify-between items-center mt-1 pt-2 border-t border-slate-700/50">
                                    <span className="text-[9px] text-slate-500 uppercase tracking-widest truncate max-w-[120px]">
                                        ID: {String(action.id).substring(0, 8)}
                                    </span>
                                    {action.status === 'PENDING' ? (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleReject(action.id)}
                                                className="bg-red-600/90 hover:bg-red-500 text-white text-[10px] font-bold tracking-wider px-3 py-1.5 rounded-md whitespace-nowrap shadow-md transition-all active:scale-95 focus:outline-none focus:ring-1 focus:ring-red-400"
                                            >
                                                REJECT (N)
                                            </button>
                                            <button
                                                onClick={() => handleApprove(action.id)}
                                                className="bg-emerald-600/90 hover:bg-emerald-500 text-white text-[10px] font-bold tracking-wider px-3 py-1.5 rounded-md whitespace-nowrap shadow-md transition-all active:scale-95 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                            >
                                                APPROVE (Y)
                                            </button>
                                        </div>
                                    ) : (
                                        <span className={`text-[9px] font-bold tracking-wider px-2 py-1 rounded shadow-inner uppercase ${action.status === 'APPROVED' ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/60' : action.status === 'EXPIRED' || action.status === 'REJECTED' ? 'bg-red-900/40 text-red-400 border border-red-800/60' : 'bg-amber-900/40 text-amber-400 border border-amber-800/60'}`}>
                                            {action.status}
                                        </span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="mt-6">
                    <h3 className="text-[10px] font-bold text-slate-500 mb-2 tracking-widest uppercase flex justify-between items-center">
                        <span>RCA Inspector</span>
                        <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">{rcaRecords.length}</span>
                    </h3>

                    {rcaRecords.length === 0 ? (
                        <div className="text-slate-500 text-[10px] italic bg-slate-800/20 rounded-lg border border-dashed border-slate-700/50 p-3">
                            No 5xx payloads on the telemetry buffer.
                        </div>
                    ) : (
                        <ul className="flex flex-col gap-1.5">
                            {rcaRecords.map((record) => {
                                const open = record.id === selectedRcaId;
                                return (
                                    <li key={record.id} className="border border-slate-700/70 rounded-lg bg-slate-800/40 overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedRcaId(open ? null : record.id)}
                                            aria-expanded={open}
                                            data-rca-record={record.id}
                                            className="w-full text-left px-2.5 py-2 flex items-center gap-2 hover:bg-slate-800/80 transition-colors"
                                        >
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${record.statusCode && record.statusCode >= 500 ? 'bg-rose-900/40 text-rose-300 border-rose-800/60' : 'bg-amber-900/40 text-amber-300 border-amber-800/60'}`}>
                                                {record.statusCode ?? 'ERR'}
                                            </span>
                                            <span className="text-[10px] text-slate-300 truncate flex-1">{record.app}</span>
                                            <span className="text-[9px] text-slate-500">{open ? '▾' : '▸'}</span>
                                        </button>
                                        {open && (
                                            <div className="border-t border-slate-700/60 p-2">
                                                <p className="text-[10px] text-slate-400 mb-2 break-words">{record.message}</p>
                                                {record.traceId && (
                                                    <p className="text-[9px] text-slate-500 mb-2 break-all">trace: {record.traceId}</p>
                                                )}
                                                <pre className="text-[9px] leading-relaxed text-blue-300 bg-slate-900 rounded p-2 border border-slate-700 overflow-auto max-h-48 custom-scrollbar">
                                                    {formatRcaJson(record.raw)}
                                                </pre>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            <PlaybookTrigger />

            <style jsx="true">{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: rgba(30, 41, 59, 0.5);
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(71, 85, 105, 0.8);
                    border-radius: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(100, 116, 139, 1);
                }
            `}</style>
        </div>
    );
}
