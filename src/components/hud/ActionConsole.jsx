import React, { useState, useEffect } from 'react';
import useAgentConnection from '../../hooks/useAgentConnection';
import useDesktopAgentStore from '../../store/useDesktopAgentStore';

export default function ActionConsole({ peerConnection }) {
    const { status } = useAgentConnection(peerConnection);
    const { pendingHitlActions, updateHitlActionStatus, telemetryEvents } = useDesktopAgentStore();

    const [isWaiting, setIsWaiting] = useState(false);
    const [queueTelemetry, setQueueTelemetry] = useState({
        loadTimeMs: 0,
        errorRate: 0,
        routingEfficiency: 100
    });

    useEffect(() => {
        const handleWaiting = () => {
            setIsWaiting(true);
            setTimeout(() => setIsWaiting(false), 3000); // Pulse for a few seconds
        };
        window.addEventListener('onyx_waiting_on_user', handleWaiting);
        return () => window.removeEventListener('onyx_waiting_on_user', handleWaiting);
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            pendingHitlActions.forEach(action => {
                if (action.status === 'PENDING' && now - action.timestamp > 300000) {
                    // 300 seconds (5 minutes) expiration
                    updateHitlActionStatus(action.id, 'EXPIRED');
                }
            });

            // Calculate mock/derived telemetry for the ticket queue
            const recentEvents = telemetryEvents ? telemetryEvents.slice(-20) : [];
            const errorCount = recentEvents.filter(e => e.status === 'error' || e.level === 'error').length;
            const errorRateCalc = recentEvents.length > 0 ? Math.round((errorCount / recentEvents.length) * 100) : 0;
            const loadTime = Math.floor(Math.random() * 40) + 15; // Simulated edge latency

            setQueueTelemetry({
                loadTimeMs: loadTime,
                errorRate: errorRateCalc,
                routingEfficiency: Math.max(90, 100 - errorRateCalc - Math.floor(loadTime / 10))
            });

        }, 5000); // check every 5 seconds

        return () => clearInterval(interval);
    }, [pendingHitlActions, updateHitlActionStatus, telemetryEvents]);

    let voiceColor = 'text-gray-500';
    if (status === 'CONNECTED') voiceColor = 'text-emerald-500';
    else if (status === 'RECONNECTING') voiceColor = 'text-yellow-500';
    else if (status === 'RECONNECT NEEDED' || status === 'DISCONNECTED') voiceColor = 'text-red-500';

    const handleApprove = async (actionId) => {
        try {
            updateHitlActionStatus(actionId, 'APPROVING...');
            const response = await fetch('/api/approve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer dev-token' // Mock token for now
                },
                body: JSON.stringify({ task_id: actionId, signed_payload: 'mock_payload' })
            });
            if (response.ok) {
                updateHitlActionStatus(actionId, 'APPROVED');
            } else {
                updateHitlActionStatus(actionId, 'FAILED');
            }
        } catch (e) {
            updateHitlActionStatus(actionId, 'FAILED');
        }
    };

    return (
        <div className="action-console w-80 p-5 bg-slate-900 text-slate-100 flex flex-col gap-6 rounded-l-xl shadow-2xl border-l border-t border-b border-slate-800 h-full overflow-hidden font-mono relative z-10">
            <div className="flex flex-col gap-3 border-b border-slate-700/50 pb-4">
                <div className="flex justify-between items-center">
                    <h2 className="font-bold tracking-widest text-sm text-slate-300 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isWaiting ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`}></span>
                        COMMAND HUB
                    </h2>
                    <div className={`badge border border-slate-700 px-2 py-0.5 rounded text-[10px] tracking-wider ${voiceColor} bg-slate-800/80 shadow-inner`}>
                        VOICE: {status === 'RECONNECTING' ? 'RECONNECTING' : status}
                    </div>
                </div>

                {/* Telemetry Integration Panel */}
                <div className="grid grid-cols-3 gap-2 text-center mt-2">
                    <div className="bg-slate-800/40 rounded p-2 border border-slate-700/50 flex flex-col justify-center">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Queue Load</span>
                        <span className={`text-xs font-semibold ${queueTelemetry.loadTimeMs < 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{queueTelemetry.loadTimeMs}ms</span>
                    </div>
                    <div className="bg-slate-800/40 rounded p-2 border border-slate-700/50 flex flex-col justify-center">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Error Rate</span>
                        <span className={`text-xs font-semibold ${queueTelemetry.errorRate > 5 ? 'text-red-400' : 'text-emerald-400'}`}>{queueTelemetry.errorRate}%</span>
                    </div>
                    <div className="bg-slate-800/40 rounded p-2 border border-slate-700/50 flex flex-col justify-center">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Routing Eff</span>
                        <span className="text-xs font-semibold text-blue-400">{queueTelemetry.routingEfficiency}%</span>
                    </div>
                </div>
            </div>

            <div className="hitl-queue flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <h3 className="text-[10px] font-bold text-slate-500 mb-3 tracking-widest uppercase flex justify-between items-center">
                    <span>Active Tickets (HITL)</span>
                    <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">{pendingHitlActions.length}</span>
                </h3>

                {pendingHitlActions.length === 0 ? (
                    <div className="text-slate-500 text-xs italic flex flex-col items-center justify-center h-32 bg-slate-800/20 rounded-lg border border-dashed border-slate-700/50 gap-2">
                        <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        Queue empty.
                    </div>
                ) : (
                    <ul className="flex flex-col gap-3">
                        {pendingHitlActions.map(action => (
                            <li key={action.id} className="border border-slate-700/80 bg-slate-800/40 p-3 rounded-lg hover:bg-slate-800/80 transition-all duration-200 flex flex-col gap-3 text-sm shadow-sm group">
                                <div className="flex justify-between items-start gap-2">
                                    <span className="leading-snug text-slate-300 text-xs flex-1 line-clamp-3">{action.description || 'System task awaits approval.'}</span>
                                    <div className="text-[9px] text-slate-500 mt-0.5">
                                        {Math.round((Date.now() - action.timestamp) / 1000)}s ago
                                    </div>
                                </div>

                                <div className="flex justify-between items-center mt-1 pt-2 border-t border-slate-700/50">
                                    <span className="text-[9px] text-slate-500 uppercase tracking-widest truncate max-w-[120px]">
                                        ID: {action.id.substring(0, 8)}
                                    </span>
                                    {action.status === 'PENDING' ? (
                                        <button
                                            onClick={() => handleApprove(action.id)}
                                            className="bg-emerald-600/90 hover:bg-emerald-500 text-white text-[10px] font-bold tracking-wider px-3 py-1.5 rounded-md whitespace-nowrap shadow-md transition-all active:scale-95 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                        >
                                            AUTHORIZE
                                        </button>
                                    ) : (
                                        <span className={`text-[9px] font-bold tracking-wider px-2 py-1 rounded shadow-inner uppercase ${action.status === 'APPROVED' ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/60' : action.status === 'EXPIRED' ? 'bg-red-900/40 text-red-400 border border-red-800/60' : 'bg-amber-900/40 text-amber-400 border border-amber-800/60'}`}>
                                            {action.status}
                                        </span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

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
