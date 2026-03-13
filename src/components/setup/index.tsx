import React, { useState } from 'react';
import { useFirebase } from '../../hooks/useFirebase';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

export function FirebasePanel({ hook }: { hook: ReturnType<typeof useFirebase> }) {
  const [fbApiKey, setFbApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [appId, setAppId] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const handleConnect = () => {
    if (!fbApiKey || !projectId || !appId) {
      alert('Please provide all Firebase configuration parameters.');
      return;
    }
    hook.connect(fbApiKey, projectId, appId);
  };

  const handleLoad = () => {
    hook.loadHistory();
    setShowHistory(true);
  };

  return (
    <div className="glass-card mb-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-2">
          <span className="w-1 h-3 bg-indigo-500 rounded-full" />
          Data Persistence
        </h3>
        <span className={cn(
          "px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider transition-colors",
          hook.isConnected ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-slate-800 text-slate-500 border border-slate-700"
        )}>
          {hook.isConnected ? "Cloud Connected" : "Local Only"}
        </span>
      </div>
      
      <div className="space-y-3 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input className="input-field" type="text" placeholder="Project ID" value={projectId} onChange={e => setProjectId(e.target.value)} />
          <input className="input-field" type="text" placeholder="App ID" value={appId} onChange={e => setAppId(e.target.value)} />
          <input className="input-field" type="password" placeholder="API Key" value={fbApiKey} onChange={e => setFbApiKey(e.target.value)} />
        </div>
      </div>
      
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleConnect} className="btn-primary">Sync Database</button>
        <button onClick={handleLoad} disabled={!hook.isConnected} className="btn-outline disabled:opacity-30">View Archives</button>
      </div>
      
      {showHistory && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-8 pt-8 border-t border-slate-800"
        >
          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Historical Records</h4>
          <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {hook.sessions.length === 0 ? (
              <div className="text-slate-500 text-xs py-10 text-center border border-dashed border-slate-800 rounded-2xl">No archived sessions found.</div>
            ) : (
              hook.sessions.map(s => {
                const date = s.startedAt?.toDate?.()?.toLocaleString() || 'N/A';
                const m = s.finalMetrics || {};
                const avg = ['confidence', 'star_situation', 'star_task', 'star_action', 'star_result', 'articulation']
                  .map(k => (m as any)[k] ?? 0).reduce((a, b:any) => a + b, 0) / 6;
                
                return (
                  <div key={s.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-indigo-500/30 transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Session Protocol</div>
                        <div className="text-xs text-white font-medium">{date}</div>
                      </div>
                      <div className="bg-indigo-500/10 px-2 py-1 rounded text-[10px] font-bold text-indigo-400 border border-indigo-500/10">
                        Score: {avg.toFixed(0)}%
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                       {['confidence', 'situation', 'task', 'action', 'result'].map(k => (
                         <div key={k} className="text-[9px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                           {k.substring(0, 3).toUpperCase()}: <span className="text-indigo-400">{(m as any)[k === 'confidence' ? k : 'star_'+k] ?? '--'}</span>
                         </div>
                       ))}
                    </div>
                    {m.feedback && (
                      <div className="mt-3 py-2 px-3 bg-amber-500/5 border-l-2 border-amber-500/50 text-amber-100/70 text-[11px] italic rounded-r-lg">
                        "{m.feedback}"
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
