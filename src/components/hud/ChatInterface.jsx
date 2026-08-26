import React, { useState, useEffect, useRef } from 'react';
import { useAximAuth } from '../../hooks/useAximAuth';

export default function ChatInterface() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamStatus, setStreamStatus] = useState('');
    const messagesEndRef = useRef(null);
    const [hasError, setHasError] = useState(false);
    const { isAuthenticated, token, loginWithPassport, authError } = useAximAuth();

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const attemptFetch = async (userMessage, retryCount = 0) => {
        try {
            setHasError(false);
            const response = await fetch('/api/v1/onyx/summon', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ message: userMessage })
            });

            if (!response.ok) {
                if (response.status === 429) {
                    setHasError(true);
                    setStreamStatus('Rate Limited (Asguard). Please slow down.');
                    throw new Error(`Asguard rate limit exceeded.`);
                }
                if (response.status === 401 || response.status === 403) {
                    setHasError(true);
                    setStreamStatus('Authentication Failure (Asguard). Unauthorized request.');
                    throw new Error(`Authentication failure.`);
                }
                if (response.status === 502 || response.status === 503) {
                    if (retryCount < 3) {
                         setStreamStatus(`Re-routing connection... (Attempt ${retryCount + 1})`);
                         await new Promise(r => setTimeout(r, 2000));
                         return attemptFetch(userMessage, retryCount + 1);
                    }
                    setHasError(true);
                    throw new Error(`Network error! status: ${response.status}`);
                } else {
                    setHasError(true);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } else {
                setStreamStatus('Connected');
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const parts = buffer.split('\n\n');
                    buffer = parts.pop() || '';

                    for (const part of parts) {
                        if (part.startsWith('data: ')) {
                            const dataStr = part.slice(6);
                            if (dataStr === '[DONE]') {
                                setIsStreaming(false);
                                setStreamStatus('');
                                return;
                            }
                            try {
                                const parsed = JSON.parse(dataStr);
                                if (parsed.type === 'status' && parsed.state === 'WAITING_ON_USER') {
                                    window.dispatchEvent(new CustomEvent('onyx_waiting_on_user'));
                                } else if (parsed.type === 'status' && parsed.state === 'PROVIDER_FAILOVER') {
                                    setStreamStatus('PROVIDER_FAILOVER');
                                    setMessages(prev => {
                                        const newMsgs = [...prev];
                                        const last = newMsgs[newMsgs.length - 1];
                                        if (last && last.role === 'assistant') {
                                            last.isFailover = true;
                                        }
                                        return newMsgs;
                                    });
                                } else if (parsed.type === 'tool_start') {
                                    setMessages(prev => [...prev, { role: 'system', isStart: true, content: `⚡ Swarm Agent executing: [${parsed.tool_name}]...` }]);
                                } else if (parsed.type === 'tool_finish') {
                                    setMessages(prev => [...prev, { role: 'system', content: `✅ Swarm Agent completed: [${parsed.tool_name}]` }]);
                                } else {
                                    setMessages(prev => {
                                        const newMessages = [...prev];
                                        const lastMessage = newMessages[newMessages.length - 1];
                                        if (lastMessage && lastMessage.role === 'assistant') {
                                            lastMessage.content += (parsed.chunk || '');
                                        }
                                        return newMessages;
                                    });
                                }
                            } catch (err) {
                                /* void 0; */
                            }
                        }
                    }
                }
            }
        } catch (error) {
            /* void 0; */
            if (!hasError) {
                setStreamStatus('Stream failed. Attempting reconnect without refresh...');
                setHasError(true);
            }
        } finally {
            setIsStreaming(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isStreaming) return;

        const userMessage = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
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
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {messages.map((msg, index) => {
                    if (msg.role === 'system') {
                        return (
                            <div key={`sys-${index}`} className="flex justify-center my-2">
                                <span className={`bg-slate-800/80 border border-blue-500/20 text-blue-300/80 text-xs px-3 py-1.5 rounded-full font-mono shadow-sm ${msg.isStart ? "animate-pulse" : "opacity-75"}`}>
                                    {msg.content}
                                </span>
                            </div>
                        );
                    }
                    return (
                        <div key={`msg-${index}`} className={`p-4 rounded-xl shadow-md max-w-[85%] ${msg.role === 'user' ? 'bg-indigo-600/90 text-white ml-auto border border-indigo-500/50' : 'bg-slate-800/80 text-emerald-300 border border-slate-700/80 self-start'}`}>
                            {msg.content}
                        </div>
                    );
                })}
                {isStreaming && (
                     <div className="bg-slate-700 text-slate-100 self-start p-3 rounded-lg flex gap-1 items-center max-w-[85%]">
                         <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                         <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-75"></div>
                         <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-150"></div>
                     </div>
                )}
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
                    placeholder="Summon Onyx Mk3..."
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
