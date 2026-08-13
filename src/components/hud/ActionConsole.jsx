import React, { useState, useEffect } from 'react';
import useAgentConnection from '../../hooks/useAgentConnection';
import useDesktopAgentStore from '../../store/useDesktopAgentStore';

export default function ActionConsole({ peerConnection }) {
    const { status } = useAgentConnection(peerConnection);
    const { pendingHitlActions, updateHitlActionStatus } = useDesktopAgentStore();

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            pendingHitlActions.forEach(action => {
                if (action.status === 'PENDING' && now - action.timestamp > 300000) {
                    // 300 seconds (5 minutes) expiration
                    updateHitlActionStatus(action.id, 'EXPIRED');
                }
            });
        }, 10000); // check every 10 seconds

        return () => clearInterval(interval);
    }, [pendingHitlActions, updateHitlActionStatus]);

    let voiceColor = 'text-gray-500';
    if (status === 'CONNECTED') voiceColor = 'text-emerald-500';
    else if (status === 'RECONNECTING') voiceColor = 'text-yellow-500';
    else if (status === 'RECONNECT NEEDED' || status === 'DISCONNECTED') voiceColor = 'text-red-500';

    return (
        <div className="action-console p-4 bg-slate-900 text-slate-100 flex flex-col gap-4 rounded-lg shadow-xl border border-slate-700">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <h2 className="font-bold tracking-wide flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    ACTION CONSOLE
                </h2>
                <div className={`badge border border-slate-700 px-3 py-1 rounded-full text-xs font-mono tracking-wider ${voiceColor} bg-slate-800/50 shadow-inner`}>
                    VOICE: {status === 'RECONNECTING' ? 'RECONNECTING...' : status}
                </div>
            </div>

            <div className="hitl-queue flex-1 overflow-y-auto">
                <h3 className="text-xs font-bold text-slate-500 mb-3 tracking-widest uppercase">HITL QUEUE</h3>
                {pendingHitlActions.length === 0 ? (
                    <div className="text-slate-500 text-sm italic flex items-center justify-center h-20 bg-slate-800/30 rounded border border-dashed border-slate-700">
                        No pending actions.
                    </div>
                ) : (
                    <ul className="flex flex-col gap-3">
                        {pendingHitlActions.map(action => (
                            <li key={action.id} className="border border-slate-700 bg-slate-800/50 p-3 rounded hover:bg-slate-800 transition-colors flex justify-between items-start gap-4 text-sm shadow-sm">
                                <span className="leading-snug">{action.description || 'Unknown Action'}</span>
                                <span className={`text-[10px] font-mono tracking-wider px-2 py-1 rounded whitespace-nowrap shadow-inner ${action.status === 'EXPIRED' ? 'bg-red-900/50 text-red-300 border border-red-800' : 'bg-amber-900/50 text-amber-300 border border-amber-800'}`}>
                                    {action.status}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
