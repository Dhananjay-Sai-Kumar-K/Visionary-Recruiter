import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface InsightTickerProps {
  events: { id: string; text: string; type: 'info' | 'warn' | 'success'; ts: number }[];
}

export function InsightTicker({ events }: InsightTickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="bg-slate-950/40 border border-slate-800/50 rounded-2xl p-4 h-32 overflow-hidden flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Neural_Insight_Stream</span>
        <div className="flex gap-1">
          <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
          <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse delay-75" />
          <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse delay-150" />
        </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
        <AnimatePresence mode="popLayout">
          {events.map((ev) => (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex items-center gap-2"
            >
              <span className="text-[9px] font-mono text-slate-600">[{new Date(ev.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
              <div className={`w-1 h-1 rounded-full ${
                ev.type === 'success' ? 'bg-emerald-500' : 
                ev.type === 'warn' ? 'bg-rose-500' : 'bg-indigo-500'
              }`} />
              <span className={`text-[10px] font-bold tracking-tight ${
                ev.type === 'success' ? 'text-emerald-400/80' : 
                ev.type === 'warn' ? 'text-rose-400/80' : 'text-slate-400'
              }`}>
                {ev.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {events.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <span className="text-[9px] font-mono text-slate-700 uppercase">Synchronizing Telemetry...</span>
          </div>
        )}
      </div>
    </div>
  );
}
