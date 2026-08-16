import React, { useState, useEffect, useRef } from 'react';

export default function ChatInterface() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamStatus, setStreamStatus] = useState('');
    const messagesEndRef = useRef(null);
    const [hasError, setHasError] = useState(false);

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
                    'Authorization': 'Bearer test-token'
                },
                body: JSON.stringify({ message: userMessage })
            });

            if (!response.ok) {
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
                                } else {
                                    setMessages(prev => {
                                        const newMessages = [...prev];
                                        const lastMessage = newMessages[newMessages.length - 1];
                                        if (lastMessage.role === 'assistant') {
                                            lastMessage.content += parsed.chunk;
                                        }
                                        return newMessages;
                                    });
                                }
                            } catch (err) {
                                console.error('Error parsing SSE payload:', err);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in stream:', error);
            setStreamStatus('Stream failed. Attempting reconnect without refresh...');
            setHasError(true);
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

    return (
        <div className="chat-interface flex flex-col h-full bg-slate-900 rounded-lg shadow-xl overflow-hidden border border-slate-700">
            <div className="messages-container flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {messages.map((msg, index) => (
                    <div key={index} className={`message p-3 rounded-lg max-w-[85%] ${msg.role === 'user' ? 'bg-blue-600 self-end text-white' : 'bg-slate-700 text-slate-100 self-start'}`}>
                        {msg.content}
                    </div>
                ))}
                {isStreaming && (
                     <div className="message bg-slate-700 text-slate-100 self-start p-3 rounded-lg flex gap-1 items-center">
                         <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                         <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-75"></div>
                         <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-150"></div>
                     </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {streamStatus && (
                <div className={`status-badge text-xs p-2 text-center ${hasError ? 'bg-red-900/50 text-red-200' : 'bg-slate-800 text-slate-400'}`}>
                    {streamStatus}
                </div>
            )}

            <form onSubmit={handleSubmit} className="input-form p-4 bg-slate-800 flex gap-2 border-t border-slate-700">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isStreaming}
                    placeholder="Type your message..."
                    className="flex-1 bg-slate-900 text-white rounded p-2 border border-slate-600 focus:outline-none focus:border-blue-500"
                />
                <button
                    type="submit"
                    disabled={isStreaming || !input.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50 transition-colors"
                >
                    Send
                </button>
            </form>
        </div>
    );
}
