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
      <div className="bg-slate-950/40 border border-slate-800/50 rounded-2xl p-5 col-span-full flex items-center gap-8 relative group overflow-hidden shadow-inner">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 70 70" className="w-full h-full drop-shadow-[0_0_12px_rgba(99,102,241,0.15)]">
            <circle cx="35" cy="35" r="28" fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-800" />
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
            <span className="text-xl font-bold text-white leading-none">{value}%</span>
            <span className="text-[10px] text-slate-500 font-medium uppercase mt-1">Focus</span>
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="badge-premium">Live Biometrics</span>
            <span className="text-[10px] text-emerald-500 font-bold tracking-widest uppercase">Verified</span>
          </div>
          <h4 className="text-xl font-bold text-white tracking-tight">
            {label}
          </h4>
          <p className="text-xs text-slate-400 font-medium leading-relaxed">
            {subLabel} • <span className="text-slate-600 font-mono">ID: MP_VIZ_B1</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-950/30 border border-slate-800/50 rounded-xl p-4 transition-all hover:bg-slate-900/40 hover:border-slate-700/50">
      <div className="flex justify-between items-start mb-2">
        <span className="stat-label">{label}</span>
        {sourceTag && <span className="text-[9px] font-bold text-slate-600 px-1.5 py-0.5 rounded-md bg-slate-900 border border-slate-800">{sourceTag}</span>}
      </div>
      
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-white leading-tight tracking-tight">{value}</span>
        {pct > 0 && <span className="text-[11px] text-slate-500 font-semibold">%</span>}
      </div>

      {(rawVal !== undefined && progressFn) && (
        <div className="h-1 bg-slate-800 rounded-full mt-4 overflow-hidden">
          <motion.div 
            className="h-full" 
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8 }}
            style={{ backgroundColor: color }}
          />
        </div>
      )}
    </div>
  );
}
