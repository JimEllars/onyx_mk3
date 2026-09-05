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
                    setStatus(data.healthy === data.total ? "OK" : (data.healthy > 0 ? "DEGRADED" : "CRITICAL"));
                }
            } catch (err) {
                /* void 0; */
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
                        gatewayStatus: data.status === "healthy" || data.status === "success" || data.status === "ok" ? 'OPERATIONAL' : 'DEGRADED',
                        cacheHitRate: data.cache_hit_rate || 0
                    });
                } else {
                }
            } catch (err) {
                /* void 0; */
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

    const healthColor = status === "OK" ? "text-emerald-500" : (status === "CRITICAL" ? "text-red-500" : "text-amber-500");
    const gatewayColor = telemetry.gatewayStatus === 'OPERATIONAL' ? 'text-emerald-500' : 'text-amber-500';
    const latencyColor = telemetry.latency !== null && telemetry.latency < 100 ? 'bg-emerald-500' : 'bg-amber-500';

    return (
        <div className="system-sidebar w-64 p-5 bg-slate-900 border-r border-slate-800 flex flex-col space-y-4 font-mono shadow-2xl relative z-10">
            <div className="mb-4 pb-4 border-b border-slate-700/50 flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
                <div>
                    <h1 className="text-sm font-bold text-slate-100 tracking-wider">AXiM CORE</h1>
                    <p className="text-[10px] text-slate-500 tracking-widest uppercase">System Telemetry</p>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="group border border-slate-700/80 bg-slate-800/40 p-3 rounded-lg hover:bg-slate-800/80 transition-all duration-200 shadow-sm flex flex-col gap-1.5">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center justify-between">
                        CF Edge Latency
                        <span className={`w-1.5 h-1.5 rounded-full ${telemetry.latency !== null ? latencyColor : 'bg-slate-500'} shadow-[0_0_8px_rgba(52,211,153,0.5)]`}></span>
                    </span>
                    <span className="text-sm font-semibold text-slate-200 flex items-baseline gap-1">
                        {telemetry.latency !== null ? telemetry.latency : '--'} <span className="text-xs text-slate-500 font-normal">ms</span>
                    </span>
                </div>

                <div className="group border border-slate-700/80 bg-slate-800/40 p-3 rounded-lg hover:bg-slate-800/80 transition-all duration-200 shadow-sm flex flex-col gap-1.5">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center justify-between">
                        Gateway Status
                        <svg className={`w-3 h-3 ${gatewayColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </span>
                    <span className={`text-xs font-bold tracking-wider ${gatewayColor}`}>{telemetry.gatewayStatus}</span>
                </div>

                <div className="group border border-slate-700/80 bg-slate-800/40 p-3 rounded-lg hover:bg-slate-800/80 transition-all duration-200 shadow-sm flex flex-col gap-1.5">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center justify-between">
                        KV Cache Hit
                        <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path></svg>
                    </span>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-900 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-blue-500 h-full rounded-full" style={{ width: `${telemetry.cacheHitRate}%` }}></div>
                        </div>
                        <span className="text-xs font-semibold text-blue-400">{telemetry.cacheHitRate}%</span>
                    </div>
                </div>

                <div className={`group border border-slate-700/80 bg-slate-800/40 p-3 rounded-lg hover:bg-slate-800/80 transition-all duration-200 shadow-sm flex flex-col gap-1.5 ${status === 'OK' ? '' : 'border-red-900/50 bg-red-900/10'}`}>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center justify-between">
                        LLM Nodes
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shadow-inner ${healthColor} ${status === 'OK' ? 'bg-emerald-900/40' : 'bg-red-900/40 animate-pulse'}`}>{status}</span>
                    </span>
                    <span className="text-sm font-semibold text-slate-200">
                        {llmHealth.healthy} <span className="text-slate-500 font-normal">/ {llmHealth.total} online</span>
                    </span>
                </div>
            </div>

            <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-slate-700/50">
                <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest">Voice Trunk</span>
                    <span className={`text-[10px] font-bold tracking-wider ${activeVoiceTrunk === 'ACTIVE' ? 'text-emerald-500' : activeVoiceTrunk === 'RECONNECTING' ? 'text-yellow-500' : 'text-slate-500'}`}>{activeVoiceTrunk}</span>
                </div>
                <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest">Agent Mode</span>
                    <span className="text-[10px] font-bold tracking-wider text-blue-400">{agentMode}</span>
                </div>
            </div>
        </div>
    );
}
