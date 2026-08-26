import React from 'react';
import ChatInterface from './components/hud/ChatInterface';
import SystemSidebar from './components/hud/SystemSidebar';
import ActionConsole from './components/hud/ActionConsole';
import { useAximAuth } from './hooks/useAximAuth';

export default function App() {
  const { isAuthenticated } = useAximAuth();

  return (
    <div className="flex h-screen bg-[#0f172a] text-slate-200 overflow-hidden font-sans antialiased selection:bg-emerald-500/30">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 pointer-events-none mix-blend-overlay"></div>
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 z-50"></div>
      <SystemSidebar />
      <div className="flex-1 flex flex-col relative z-0 shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.5)]">
        <ChatInterface />
      </div>
      {isAuthenticated && <ActionConsole />}
    </div>
  );
}
