import React from 'react';
import ChatInterface from './components/hud/ChatInterface';
import SystemSidebar from './components/hud/SystemSidebar';
import ActionConsole from './components/hud/ActionConsole';
import { useAximAuth } from './hooks/useAximAuth';

export default function App() {
  const { isAuthenticated } = useAximAuth();

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200">
      <SystemSidebar />
      <div className="flex-1 flex flex-col">
        <ChatInterface />
      </div>
      {isAuthenticated && <ActionConsole />}
    </div>
  );
}
