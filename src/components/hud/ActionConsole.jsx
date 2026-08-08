import React, { useState, useEffect } from 'react';

// Mock hook for useAgentConnection if it doesn't exist yet, else use actual one.
const useAgentConnection = () => {
    return { status: 'CONNECTED' };
};

export default function ActionConsole() {
    const { status } = useAgentConnection();

    const voiceColor = status === 'CONNECTED' ? 'text-emerald-500' : 'text-red-500';

    return (
        <div className="action-console p-4 bg-gray-900 text-white">
            <div className={`badge border border-gray-700 px-2 py-1 rounded text-sm ${voiceColor}`}>
                [VOICE: {status}]
            </div>
        </div>
    );
}
