import React, { useState, useEffect, useRef } from 'react';
import { useAximAuth } from '../../hooks/useAximAuth';
import { computeBackoffDelay, isRetryableStatus } from '../../lib/connectionState';
import {
    describeJsonResponse,
    extractSseData,
    isEventStream,
    normalizeStreamPayload,
    splitSseFrames,
} from '../../lib/chatStream';
import {
    DOMAIN_CONTEXTS,
    buildSummonPayload,
    readStoredDomainContext,
    resolveDomainContext,
    writeStoredDomainContext,
} from '../../lib/domainContexts';

const MAX_RETRIES = 3;

export default function ChatInterface() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamStatus, setStreamStatus] = useState('');
    const [hasError, setHasError] = useState(false);
    const [domainContextId, setDomainContextId] = useState(() => readStoredDomainContext());
    const messagesEndRef = useRef(null);
    const { isAuthenticated, token, loginWithPassport, authError } = useAximAuth();

    const domainContext = resolveDomainContext(domainContextId);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const selectDomainContext = (id) => {
        const stored = writeStoredDomainContext(id);
        setDomainContextId(stored);
    };

    const appendAssistantText = (text) => {
        if (!text) return;
        setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, content: last.content + text };
            } else {
                next.push({ role: 'assistant', content: text });
            }
            return next;
        });
    };

    const consumeStream = async (response) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const { frames, rest } = splitSseFrames(buffer);
            buffer = rest;

            for (const frame of frames) {
                for (const data of extractSseData(frame)) {
                    const event = normalizeStreamPayload(data);

                    if (event.kind === 'delta') {
                        appendAssistantText(event.text);
                    } else if (event.kind === 'done') {
                        setStreamStatus('');
                        return;
                    } else if (event.kind === 'status') {
                        handleStatusEvent(event.state);
                    } else if (event.kind === 'tool') {
                        setMessages((prev) => [
                            ...prev,
                            {
                                role: 'system',
                                isStart: event.started,
                                content: event.started
                                    ? `⚡ Swarm Agent executing: [${event.name}]...`
                                    : `✅ Swarm Agent completed: [${event.name}]`,
                            },
                        ]);
                    }
                }
            }
        }
    };

    const handleStatusEvent = (state) => {
        if (state === 'WAITING_ON_USER') {
            window.dispatchEvent(new CustomEvent('onyx_waiting_on_user'));
        } else if (state === 'PROVIDER_FAILOVER') {
            setStreamStatus('PROVIDER_FAILOVER');
            setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                    next[next.length - 1] = { ...last, isFailover: true };
                }
                return next;
            });
        }
    };

    const attemptFetch = async (userMessage, retryCount = 0) => {
        try {
            setHasError(false);
            const response = await fetch('/api/v1/onyx/summon', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(buildSummonPayload({ message: userMessage, domainContextId })),
            });

            if (!response.ok) {
                if (response.status === 429) {
                    setHasError(true);
                    setStreamStatus('Rate Limited (Asguard). Please slow down.');
                    return;
                }
                if (response.status === 401 || response.status === 403) {
                    setHasError(true);
                    setStreamStatus('Authentication Failure (Asguard). Unauthorized request.');
                    return;
                }
                if (isRetryableStatus(response.status) && retryCount < MAX_RETRIES) {
                    const delay = computeBackoffDelay(retryCount);
                    setStreamStatus(
                        `Re-routing connection... (Attempt ${retryCount + 1}, retrying in ${Math.round(delay / 1000)}s)`,
                    );
                    await new Promise((r) => setTimeout(r, delay));
                    return attemptFetch(userMessage, retryCount + 1);
                }
                setHasError(true);
                setStreamStatus(`Network error! status: ${response.status}`);
                return;
            }

            setStreamStatus('Connected');

            if (isEventStream(response.headers.get('content-type'))) {
                await consumeStream(response);
                return;
            }

            // Core accepted the payload and answered with a queued acknowledgement
            // rather than a stream. Render it instead of leaving an empty bubble.
            const body = await response.json().catch(() => null);
            const { text } = describeJsonResponse(body, response.status);
            appendAssistantText(text);
            setStreamStatus('');
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                const delay = computeBackoffDelay(retryCount);
                setStreamStatus(`Stream failed. Reconnecting in ${Math.round(delay / 1000)}s...`);
                await new Promise((r) => setTimeout(r, delay));
                return attemptFetch(userMessage, retryCount + 1);
            }
            setHasError(true);
            setStreamStatus('Stream failed. Attempting reconnect without refresh...');
        } finally {
            setIsStreaming(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isStreaming) return;

        const userMessage = input;
        setInput('');
        setMessages((prev) => [
            ...prev,
            { role: 'user', content: userMessage },
            { role: 'assistant', content: '' },
        ]);
        setIsStreaming(true);
        setStreamStatus('Initializing Stream...');

        await attemptFetch(userMessage);
    };

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col h-full bg-slate-900 rounded-lg shadow-xl overflow-hidden border border-slate-700 items-center justify-center">
                <div className="text-center p-8 bg-slate-800 rounded-xl shadow-2xl border border-slate-600 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-white mb-4">Onyx Swarm Hub</h2>
                    <p className="text-slate-400 mb-8">Strictly firewalled. Please authenticate via AXiM Passport to gain access.</p>

                    {authError && (
                        <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">
                            {authError}
                        </div>
                    )}

                    <button
                        onClick={loginWithPassport}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-all shadow-md flex items-center justify-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" /></svg>
                        Login with AXiM Passport
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-900 rounded-lg shadow-xl overflow-hidden border border-slate-700">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/60 bg-slate-900/80">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Domain</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Domain context">
                    {DOMAIN_CONTEXTS.map((ctx) => {
                        const active = ctx.id === domainContext.id;
                        return (
                            <button
                                key={ctx.id}
                                type="button"
                                onClick={() => selectDomainContext(ctx.id)}
                                aria-pressed={active}
                                data-domain-context={ctx.id}
                                title={ctx.blurb}
                                className={`text-[10px] font-mono tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
                                    active
                                        ? 'bg-indigo-500/20 border-indigo-400/60 text-indigo-200'
                                        : 'bg-slate-800/60 border-slate-700/70 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                                }`}
                            >
                                {ctx.label}
                            </button>
                        );
                    })}
                </div>
                <span className="ml-auto text-[9px] font-mono text-slate-500 truncate max-w-[45%]" title={domainContext.blurb}>
                    {domainContext.blurb}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {messages.map((msg, index) => {
                    if (msg.role === 'system') {
                        return (
                            <div key={`sys-${index}`} className="flex justify-center my-2">
                                <span className={`bg-slate-800/80 border border-blue-500/20 text-blue-300/80 text-xs px-3 py-1.5 rounded-full font-mono shadow-sm ${msg.isStart ? 'animate-pulse' : 'opacity-75'}`}>
                                    {msg.content}
                                </span>
                            </div>
                        );
                    }
                    const isPendingAssistant = msg.role === 'assistant' && msg.content === '' && isStreaming;
                    return (
                        <div key={`msg-${index}`} className={`p-4 rounded-xl shadow-md max-w-[85%] whitespace-pre-wrap ${msg.role === 'user' ? 'bg-indigo-600/90 text-white ml-auto border border-indigo-500/50' : 'bg-slate-800/80 text-emerald-300 border border-slate-700/80 self-start'}`}>
                            {isPendingAssistant ? (
                                <span className="flex gap-1 items-center">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></span>
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-75"></span>
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-150"></span>
                                </span>
                            ) : (
                                msg.content
                            )}
                            {msg.isFailover && (
                                <span className="block mt-2 text-[10px] uppercase tracking-widest text-amber-400 font-mono">
                                    Provider failover active
                                </span>
                            )}
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {streamStatus && (
                <div className={`text-xs p-2 text-center font-mono transition-colors ${hasError ? 'bg-red-900/80 text-red-100 border-t border-red-700' : 'bg-slate-800 text-slate-400 border-t border-slate-700'}`}>
                    {streamStatus}
                </div>
            )}

            <form onSubmit={handleSubmit} className="p-4 bg-slate-900 flex gap-2 border-t border-slate-700/50 relative z-10">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isStreaming}
                    placeholder={`Summon Onyx Mk3 — ${domainContext.label}...`}
                    className="flex-1 bg-slate-900 text-white rounded p-3 border border-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder-slate-500"
                />
                <button
                    type="submit"
                    disabled={isStreaming || !input.trim()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 transition-colors shadow-md flex items-center justify-center gap-2"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                </button>
            </form>
        </div>
    );
}
