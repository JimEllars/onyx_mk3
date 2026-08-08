import { create } from 'zustand';

const useDesktopAgentStore = create((set, get) => ({
    telemetryEvents: [],

    // Throttle incoming agent_telemetry_stream events
    agent_telemetry_stream: (event) => {
        if (!get().pendingUpdate) {
            set({ pendingUpdate: true });
            requestAnimationFrame(() => {
                set((state) => ({
                    telemetryEvents: [...state.telemetryEvents, ...state.eventBuffer].slice(-50), // keep last 50
                    eventBuffer: [],
                    pendingUpdate: false
                }));
            });
        }

        set((state) => ({
            eventBuffer: [...(state.eventBuffer || []), event]
        }));
    },
    eventBuffer: [],
    pendingUpdate: false
}));

export default useDesktopAgentStore;
