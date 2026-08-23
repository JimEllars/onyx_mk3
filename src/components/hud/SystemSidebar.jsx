import React, { useEffect, useState } from 'react';
import useDesktopAgentStore from '../../store/useDesktopAgentStore';

export default function SystemSidebar() {
    const [llmHealth, setLlmHealth] = useState({ healthy: 0, total: 0 });
    const [status, setStatus] = useState('DEGRADED');
    const [telemetry, setTelemetry] = useState({ latency: null, gatewayStatus: 'DEGRADED', cacheHitRate: 0 });
    const activeVoiceTrunk = useDesktopAgentStore((state) => state.activeVoiceTrunk || 'DISCONNECTED');
    const agentMode = useDesktopAgentStore((state) => state.agentMode || 'STANDBY');

    useEffect(() => {
        const checkHealth = async () => {
            try {
                const res = await fetch('/api/v1/llm/health');
                const data = await res.json();
                if (data.healthy !== undefined && data.total !== undefined) {
                    setLlmHealth({ healthy: data.healthy, total: data.total });
                    setStatus(data.healthy === data.total ? 'OK' : 'DEGRADED');
                }
            } catch (err) {
                console.error("Failed to fetch LLM health", err);
            }
        };

        const checkTelemetry = async () => {
            try {
                const start = performance.now();
                const res = await fetch('/api/v1/telemetry/health');
                const end = performance.now();
                const latency = Math.round(end - start);

                if (res.ok) {
                    const data = await res.json();
                    setTelemetry({
                        latency,
                        gatewayStatus: data.status === 'success' || data.status === 'ok' ? 'OPERATIONAL' : 'DEGRADED',
                        cacheHitRate: data.cache_hit_rate || 0
                    });
                } else {
                }
            } catch (err) {
                console.error("Failed to fetch telemetry health", err);
            }
        };

        checkHealth();
        checkTelemetry();

        const healthInterval = setInterval(checkHealth, 5000);
        const telemetryInterval = setInterval(checkTelemetry, 15000);

        return () => {
            clearInterval(healthInterval);
            clearInterval(telemetryInterval);
        };
    }, []);

    const healthColor = status === 'OK' ? 'text-emerald-500' : 'text-amber-500';
    const gatewayColor = telemetry.gatewayStatus === 'OPERATIONAL' ? 'text-emerald-500' : 'text-amber-500';
    const latencyColor = telemetry.latency !== null && telemetry.latency < 100 ? 'bg-emerald-500' : 'bg-amber-500';

    return (
        <div className="system-sidebar p-4 bg-slate-900 text-slate-200 flex flex-col space-y-3 font-mono">
            <div className="badge border border-slate-700 bg-slate-800 px-3 py-2 rounded text-sm flex items-center justify-between shadow-sm">
                <span>[CF_EDGE_LATENCY]</span>
                <span className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${telemetry.latency !== null ? latencyColor : 'bg-slate-500'}`}></span>
                    <span>{telemetry.latency !== null ? `< ${telemetry.latency}ms` : '---'}</span>
                </span>
            </div>

            <div className="badge border border-slate-700 bg-slate-800 px-3 py-2 rounded text-sm flex items-center justify-between shadow-sm">
                <span>[GATEWAY]</span>
                <span className={`${gatewayColor} font-bold`}>{telemetry.gatewayStatus}</span>
            </div>

            <div className="badge border border-slate-700 bg-slate-800 px-3 py-2 rounded text-sm flex items-center justify-between shadow-sm">
                <span>[KV_CACHE_HIT]</span>
                <span className="text-blue-400">{telemetry.cacheHitRate}%</span>
            </div>

            <div className={`badge border border-slate-700 bg-slate-800 px-3 py-2 rounded text-sm flex items-center justify-between shadow-sm ${healthColor} animate-pulse`}>
                <span>[LLM_NODES]</span>
                <span>{llmHealth.healthy}/{llmHealth.total} {status}</span>
            </div>

            <div className="badge border border-slate-700 bg-slate-800 px-3 py-2 rounded text-sm flex items-center justify-between shadow-sm">
                <span>[VOICE_TRUNK]</span>
                <span className={activeVoiceTrunk === 'ACTIVE' ? 'text-emerald-500' : 'text-slate-500'}>{activeVoiceTrunk}</span>
            </div>

            <div className="badge border border-slate-700 bg-slate-800 px-3 py-2 rounded text-sm flex items-center justify-between shadow-sm">
                <span>[AGENT_MODE]</span>
                <span className="text-blue-400">{agentMode}</span>
            </div>
        </div>
    );
}
