import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const useDesktopAgentStore = create(
  persist(
    (set, get) => ({
      telemetryEvents: [],
      pendingHitlActions: [],

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
      addHitlAction: (action) => set((state) => ({
          pendingHitlActions: [...state.pendingHitlActions, { ...action, timestamp: Date.now(), status: 'PENDING' }]
      })),
      updateHitlActionStatus: (id, status) => set((state) => ({
          pendingHitlActions: state.pendingHitlActions.map(a => a.id === id ? { ...a, status } : a)
      })),
      eventBuffer: [],
      pendingUpdate: false
    }),
    {
      name: 'onyx-desktop-agent-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ pendingHitlActions: state.pendingHitlActions }),
    }
  )
);

export default useDesktopAgentStore;
