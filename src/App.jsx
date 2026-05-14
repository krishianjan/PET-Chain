import { useState } from 'react'

function App() {
  return (
    <div className="w-80 p-4 bg-slate-900 text-white font-sans">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
          Pet Chains
        </h1>
        <div className="px-2 py-1 bg-slate-800 rounded text-xs text-slate-400">v1.0.0</div>
      </header>
      
      <main className="space-y-4">
        <div className="p-4 bg-slate-800 rounded-xl border border-slate-700 hover:border-cyan-500 transition-colors">
          <h2 className="text-sm font-medium text-slate-300 mb-1">Current State</h2>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-lg font-semibold uppercase tracking-wider">Idle</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
            <div className="text-xs text-slate-500 uppercase">Tokens</div>
            <div className="text-xl font-bold">0</div>
          </div>
          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
            <div className="text-xs text-slate-500 uppercase">Chains</div>
            <div className="text-xl font-bold">0</div>
          </div>
        </div>
      </main>

      <footer className="mt-6 pt-4 border-t border-slate-800 text-center">
        <p className="text-xs text-slate-500 italic">"Rewriting the future, one treat at a time."</p>
      </footer>
    </div>
  )
}

export default App
