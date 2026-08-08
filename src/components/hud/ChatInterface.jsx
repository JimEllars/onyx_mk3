import React, { useState, useEffect, useRef } from 'react';

export default function ChatInterface() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamStatus, setStreamStatus] = useState('');
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isStreaming) return;

        const userMessage = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
        setIsStreaming(true);
        setStreamStatus('');

        try {
            const response = await fetch('/api/v1/onyx/summon', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer test-token' // In a real app, use the actual token
                },
                body: JSON.stringify({ message: userMessage })
            });

            if (!response.ok) {
                if (response.status === 502 || response.status === 503) {
                    setStreamStatus('Re-routing connection...');
                } else {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } else {
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
                                return;
                            }
                            try {
                                const parsed = JSON.parse(dataStr);
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    const lastMessage = newMessages[newMessages.length - 1];
                                    if (lastMessage.role === 'assistant') {
                                        lastMessage.content += parsed.chunk;
                                    }
                                    return newMessages;
                                });
                            } catch (err) {
                                console.error('Error parsing SSE payload:', err);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in stream:', error);
            setStreamStatus('Stream failed.');
        } finally {
            setIsStreaming(false);
        }
    };

    return (
        <div className="chat-interface">
            <div className="messages-container">
                {messages.map((msg, index) => (
                    <div key={index} className={`message ${msg.role}`}>
                        {msg.content}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {streamStatus && <div className="status-badge">{streamStatus}</div>}

            <form onSubmit={handleSubmit} className="input-form">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isStreaming}
                    placeholder="Type your message..."
                />
                <button type="submit" disabled={isStreaming || !input.trim()}>Send</button>
            </form>
        </div>
    );
}
