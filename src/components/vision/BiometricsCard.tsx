import React from 'react';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

interface BiometricsCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  progressFn?: (v: any) => number;
  rawVal?: number;
  sourceTag?: string;
  isEyeContact?: boolean;
}

export function BiometricsCard({ label, value, subLabel, rawVal, progressFn, sourceTag, isEyeContact }: BiometricsCardProps) {
  const pct = rawVal !== undefined && progressFn ? progressFn(rawVal) : 0;
  const color = (rawVal as number || 0) >= 70 ? '#10b981' : (rawVal as number || 0) >= 45 ? '#f59e0b' : '#ef4444';
  
  if (isEyeContact) {
    const strokeOffset = 175.9 * (1 - (rawVal as number || 0) / 100);
    
    return (
      <motion.div 
        whileHover={{ scale: 1.01 }}
        className="bg-slate-950/40 border border-slate-800/50 rounded-2xl p-5 col-span-full flex items-center gap-8 relative group overflow-hidden shadow-inner"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 70 70" className="w-full h-full drop-shadow-[0_0_12px_rgba(99,102,241,0.25)]">
            <circle cx="35" cy="35" r="28" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-900" />
            <motion.circle 
              cx="35" cy="35" r="28" 
              fill="none" 
              stroke={color} 
              strokeWidth="4" 
              strokeLinecap="round" 
              strokeDasharray="175.9" 
              initial={{ strokeDashoffset: 175.9 }}
              animate={{ strokeDashoffset: strokeOffset }}
              transition={{ duration: 1, ease: "circOut" }}
              className="origin-center -rotate-90" 
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-black text-white leading-none font-mono">{value}%</span>
            <span className="text-[8px] text-slate-500 font-black uppercase mt-1 tracking-widest">Focus_Lock</span>
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
               <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-1 h-3 bg-indigo-500 rounded-full" />
               <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-1 h-3 bg-indigo-500 rounded-full" />
               <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-1 h-3 bg-indigo-500 rounded-full" />
            </div>
            <span className="text-[10px] text-indigo-400 font-black tracking-[.2em] uppercase">Neural Signal Target</span>
          </div>
          <h4 className="text-xl font-bold text-white tracking-tight">
            {label}
          </h4>
          <p className="text-xs text-slate-400 font-medium leading-relaxed">
            {subLabel} • <span className="text-slate-600 font-mono text-[9px]">SIG_ID: VIZ_{label.slice(0, 3).toUpperCase()}</span>
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      whileHover={{ y: -2 }}
      className="bg-slate-950/30 border border-slate-800/50 rounded-xl p-4 transition-all hover:bg-slate-900/40 hover:border-indigo-500/20"
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
        <div className="w-1 h-1 rounded-full bg-slate-800 animate-pulse" />
      </div>
      
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-black text-white leading-tight tracking-tight font-mono">{value}</span>
        <span className="text-[10px] text-slate-600 font-bold">%</span>
      </div>

      {(rawVal !== undefined && progressFn) && (
        <div className="h-1 bg-slate-900 rounded-full mt-4 overflow-hidden relative">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)] animate-[shimmer_2s_infinite]" />
          <motion.div 
            className="h-full relative z-10" 
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8 }}
            style={{ 
              backgroundColor: color,
              boxShadow: `0 0 10px ${color}40`
            }}
          />
        </div>
      )}
      
      {subLabel && (
        <div className="mt-2 text-[8px] font-bold text-slate-600 uppercase tracking-tighter">{subLabel}</div>
      )}
    </motion.div>
  );
}
