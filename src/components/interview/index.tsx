import React from 'react';
import { cn } from '../../lib/utils';
import type { StarMetrics } from '../../types/index';
import { motion, AnimatePresence } from 'framer-motion';

export function LiveChat({ you, sarah }: { you: string, sarah: string }) {
  return (
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        {you && (
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col gap-1.5"
          >
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Candidate</span>
            <div className="bg-slate-900 border border-slate-800 text-slate-200 px-4 py-3 rounded-2xl rounded-tl-none font-medium text-sm leading-relaxed shadow-sm">
              {you}
            </div>
          </motion.div>
        )}
        
        {sarah && (
          <motion.div 
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col items-end gap-1.5"
          >
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest px-1">Sarah (AI)</span>
            <div className="bg-indigo-600 text-white px-4 py-3 rounded-2xl rounded-tr-none font-medium text-sm leading-relaxed shadow-lg shadow-indigo-500/10">
              {sarah}
            </div>
          </motion.div>
        )}

        {!you && !sarah && (
          <div className="h-32 flex items-center justify-center text-slate-600 text-xs font-medium italic border border-dashed border-slate-800 rounded-3xl">
            Awaiting conversation initialization...
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function StarMetricsDisplay({ metrics }: { metrics: StarMetrics }) {
  const m = metrics;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricItem label="Confidence" val={m.confidence} />
        <MetricItem label="Situation" val={m.star_situation} />
        <MetricItem label="Task" val={m.star_task} />
        <MetricItem label="Action" val={m.star_action} />
        <MetricItem label="Result" val={m.star_result} />
        <MetricItem label="Articulation" val={m.articulation} />
      </div>
      
      {m.feedback && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">AI Coaching Note</span>
          </div>
          <p className="text-sm text-amber-100/80 italic leading-relaxed">
            "{m.feedback}"
          </p>
        </motion.div>
      )}
    </div>
  );
}

function MetricItem({ label, val }: { label: string, val: number }) {
  return (
    <div className="bg-slate-950/40 border border-slate-800/50 p-3 rounded-xl hover:border-slate-700 transition-colors">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-white tabular-nums">{val || "0"}</span>
        <span className="text-[10px] text-slate-600">%</span>
      </div>
      <div className="h-1 bg-slate-800 rounded-full mt-2.5 overflow-hidden">
        <motion.div 
          className="h-full bg-indigo-500" 
          initial={{ width: 0 }}
          animate={{ width: `${val || 0}%` }}
          transition={{ duration: 1, ease: "circOut" }}
        />
      </div>
    </div>
  );
}
