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
        <div className="action-console p-4 bg-gray-900 text-white flex flex-col gap-4">
            <div className="flex justify-between items-center">
                <div className={`badge border border-gray-700 px-2 py-1 rounded text-sm ${voiceColor}`}>
                    [VOICE: {status === 'RECONNECTING' ? 'RECONNECTING...' : status}]
                </div>
            </div>

            <div className="hitl-queue">
                <h3 className="text-sm font-bold text-gray-400 mb-2">HITL QUEUE</h3>
                {pendingHitlActions.length === 0 ? (
                    <div className="text-gray-600 text-sm">No pending actions.</div>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {pendingHitlActions.map(action => (
                            <li key={action.id} className="border border-gray-700 p-2 rounded flex justify-between items-center text-sm">
                                <span>{action.description || 'Unknown Action'}</span>
                                <span className={`text-xs px-2 py-1 rounded ${action.status === 'EXPIRED' ? 'bg-red-900 text-red-200' : 'bg-yellow-900 text-yellow-200'}`}>
                                    [{action.status}]
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
