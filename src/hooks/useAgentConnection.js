import { useState, useEffect, useRef } from 'react';

export default function useAgentConnection(peerConnection) {
    const [status, setStatus] = useState('DISCONNECTED');
    const retryCountRef = useRef(0);
    const maxRetries = 3;

    useEffect(() => {
        if (!peerConnection) return;

        const handleConnectionStateChange = () => {
            const state = peerConnection.connectionState;
            const iceState = peerConnection.iceConnectionState;

            if (state === 'connected' && iceState === 'connected') {
                setStatus('CONNECTED');
                retryCountRef.current = 0; // reset on successful connection
            } else if (state === 'disconnected' || state === 'failed' || iceState === 'disconnected' || iceState === 'failed') {
                if (retryCountRef.current < maxRetries) {
                    setStatus('RECONNECTING');
                    retryCountRef.current += 1;
                    console.log(`WebRTC disconnected, attempting ICE restart (${retryCountRef.current}/${maxRetries})...`);
                    peerConnection.restartIce();
                } else {
                    setStatus('RECONNECT NEEDED');
                    console.error('WebRTC reconnection failed after maximum retries.');
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
        };
    }, [peerConnection]);

    return { status, retryCount: retryCountRef.current };
}
