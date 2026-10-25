import React, { useState } from 'react';

const PLAYBOOKS = ['support_triage', 'sync_lead_enrich'];

export default function PlaybookTrigger() {
    const [playbook, setPlaybook] = useState(PLAYBOOKS[0]);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    const trigger = async () => {
        setBusy(true);
        setResult(null);
        try {
            const token = localStorage.getItem('axim_passport_token');
            const apiUrl = import.meta.env.VITE_ONYX_WORKER_URL || '';
            const res = await fetch(`${apiUrl}/api/v1/playbook/trigger`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Idempotency-Key': crypto.randomUUID()
                },
                body: JSON.stringify({ playbook })
            });
            const text = await res.text();
            let body;
            try { body = JSON.parse(text); } catch { body = text; }
            setResult({ ok: res.ok, status: res.status, body });
        } catch (e) {
            setResult({ ok: false, status: 0, body: String(e) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="border-t border-slate-700/50 pt-4 flex flex-col gap-2">
            <h3 className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">Playbooks</h3>
            <div className="flex gap-2">
                <select
                    value={playbook}
                    onChange={(e) => setPlaybook(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1.5 text-slate-200"
                >
                    {PLAYBOOKS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button
                    onClick={trigger}
                    disabled={busy}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-bold tracking-wider px-3 py-1.5 rounded"
                >
                    {busy ? 'RUNNING…' : 'RUN'}
                </button>
            </div>
            {result && (
                <details open className="text-[10px]">
                    <summary className={`cursor-pointer font-bold ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                        {result.ok ? 'Triggered' : 'Failed'} ({result.status})
                    </summary>
                    <pre className="bg-slate-900 border border-slate-700 rounded p-2 mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-blue-300">
                        {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
                    </pre>
                </details>
            )}
        </div>
    );
}
