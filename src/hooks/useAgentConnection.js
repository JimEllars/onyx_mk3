import { useState, useEffect, useRef, useCallback } from 'react';
import useDesktopAgentStore from '../store/useDesktopAgentStore';
import { computeBackoffDelay } from '../lib/connectionState';

const MAX_RETRIES = 10;

export default function useAgentConnection(peerConnection) {
    const addHitlAction = useDesktopAgentStore((state) => state.addHitlAction);
    const [status, setStatus] = useState('DISCONNECTED');
    // Mirrored into state (not just a ref) so consumers re-render as it climbs.
    const [retryCount, setRetryCount] = useState(0);
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef(null);

    const bumpRetryCount = useCallback((value) => {
        retryCountRef.current = value;
        setRetryCount(value);
    }, []);

    useEffect(() => {
        if (!peerConnection) return;

        const handleConnectionStateChange = () => {
            const state = peerConnection.connectionState;
            const iceState = peerConnection.iceConnectionState;

            if (state === 'connected' && iceState === 'connected') {
                setStatus('CONNECTED');
                bumpRetryCount(0);
                if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                    retryTimerRef.current = null;
                }
            } else if (
                state === 'disconnected' ||
                state === 'failed' ||
                iceState === 'disconnected' ||
                iceState === 'failed'
            ) {
                if (retryCountRef.current < MAX_RETRIES) {
                    setStatus('RECONNECTING');

                    // Same 1s -> 30s curve as the SSE transport.
                    const delay = computeBackoffDelay(retryCountRef.current);
                    bumpRetryCount(retryCountRef.current + 1);

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

        handleConnectionStateChange();

        return () => {
            peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange);
            peerConnection.removeEventListener('iceconnectionstatechange', handleConnectionStateChange);
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
    }, [peerConnection, bumpRetryCount]);

    useEffect(() => {
        const token = localStorage.getItem('axim_passport_token');
        const EDGE_BRIDGE_URL = import.meta.env.VITE_ONYX_WORKER_URL || '';

        if (!EDGE_BRIDGE_URL || !token) return;

        const setStreamStatus = (streamStatus) => useDesktopAgentStore.setState({ streamStatus });
        let eventSource = null;
        let attempts = 0;
        let timer = null;
        let disposed = false;

        const connect = () => {
            if (disposed) return;
            setStreamStatus(attempts === 0 ? 'CONNECTING' : 'RECONNECTING');
            eventSource = new EventSource(`${EDGE_BRIDGE_URL}/events?token=${token}`);

            eventSource.onopen = () => {
                attempts = 0;
                setStreamStatus('ONLINE');
            };

            eventSource.onerror = () => {
                // Close and reconnect manually so backoff applies to every failure.
                eventSource.close();
                if (disposed) return;
                if (attempts >= MAX_RETRIES) {
                    setStreamStatus('OFFLINE');
                    return;
                }
                setStreamStatus('RECONNECTING');
                const delay = computeBackoffDelay(attempts);
                attempts += 1;
                timer = setTimeout(connect, delay);
            };

            eventSource.addEventListener('action_pending', (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    addHitlAction({
                        id: payload.action_id,
                        tool_name: payload.tool_name,
                        risk_level: payload.risk_level,
                        description: payload.description,
                        params: payload.parameters,
                        timestamp: payload.timestamp || Date.now(),
                    });
                } catch (e) {
                    console.error('Failed to parse action_pending event', e);
                }
            });
        };

        connect();

        return () => {
            disposed = true;
            if (timer) clearTimeout(timer);
            if (eventSource) eventSource.close();
        };
    }, [addHitlAction]);

    return { status, retryCount };
}
