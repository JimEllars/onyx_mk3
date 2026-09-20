import { useState, useEffect, useRef } from 'react';

export default function useAgentConnection(peerConnection) {
    const [status, setStatus] = useState('DISCONNECTED');
    const retryCountRef = useRef(0);
    const maxRetries = 10;
    const retryTimerRef = useRef(null);

    useEffect(() => {
        if (!peerConnection) return;

        const handleConnectionStateChange = () => {
            const state = peerConnection.connectionState;
            const iceState = peerConnection.iceConnectionState;

            if (state === 'connected' && iceState === 'connected') {
                setStatus('CONNECTED');
                retryCountRef.current = 0; // reset on successful connection
                if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                    retryTimerRef.current = null;
                }
            } else if (state === 'disconnected' || state === 'failed' || iceState === 'disconnected' || iceState === 'failed') {
                if (retryCountRef.current < maxRetries) {
                    setStatus('RECONNECTING');

                    const backoff = Math.min(10000, 500 * Math.pow(2, retryCountRef.current));
                    const jitter = Math.random() * 500;
                    const delay = backoff + jitter;

                    retryCountRef.current += 1;

                    if (retryTimerRef.current) {
                        clearTimeout(retryTimerRef.current);
                    }
                    retryTimerRef.current = setTimeout(() => {
                        peerConnection.restartIce();
                    }, delay);
                } else {
                    setStatus('RECONNECT NEEDED');
                }
            } else if (state === 'connecting' || iceState === 'checking') {
                setStatus('CONNECTING');
            }
        };

        peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange);
        peerConnection.addEventListener('iceconnectionstatechange', handleConnectionStateChange);

        // Initial check
        handleConnectionStateChange();

        return () => {
            peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange);
            peerConnection.removeEventListener('iceconnectionstatechange', handleConnectionStateChange);
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
            }
        };
    }, [peerConnection]);

    return { status, retryCount: retryCountRef.current };
}
