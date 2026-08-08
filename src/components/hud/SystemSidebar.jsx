import React, { useEffect, useState } from 'react';

export default function SystemSidebar() {
    const [llmHealth, setLlmHealth] = useState({ healthy: 0, total: 0 });
    const [status, setStatus] = useState('DEGRADED');

    useEffect(() => {
        const checkHealth = async () => {
            try {
                const res = await fetch('/api/v1/llm/health');
                const data = await res.json();
                if (data.healthy && data.total) {
                    setLlmHealth({ healthy: data.healthy, total: data.total });
                    setStatus(data.healthy === data.total ? 'OK' : 'DEGRADED');
                }
            } catch (err) {
                console.error("Failed to fetch LLM health", err);
            }
        };

        checkHealth();
        const interval = setInterval(checkHealth, 5000);
        return () => clearInterval(interval);
    }, []);

    const healthColor = status === 'OK' ? 'text-emerald-500' : 'text-red-500';

    return (
        <div className="system-sidebar p-4 bg-gray-900 text-white flex flex-col space-y-2">
            <div className="badge border border-gray-700 px-2 py-1 rounded text-sm">
                [CF_EDGE]
            </div>
            <div className="badge border border-gray-700 px-2 py-1 rounded text-sm">
                [D1_DB]
            </div>
            <div className={`badge border border-gray-700 px-2 py-1 rounded text-sm ${healthColor} animate-pulse`}>
                [LLM: {llmHealth.healthy}/{llmHealth.total} {status}]
            </div>
        </div>
    );
}
