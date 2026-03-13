import React from 'react';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

export function Header({ mpLoaded }: { mpLoaded: boolean }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pt-6 border-b border-slate-800 pb-6"
    >
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-white flex items-center gap-2 tracking-tight">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <span className="text-white text-lg">V</span>
          </div>
          Visionary <span className="text-slate-400 font-light">Recruiter</span>
        </h1>
        <p className="text-[12px] text-slate-500 font-medium">
          Advanced AI Interview Intelligence • <span className="text-indigo-400">v6.4.0</span>
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden md:flex flex-col items-end">
          <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Vision Engine</span>
          <span className="text-xs text-slate-300">468p Facial Tracking</span>
        </div>
        <div className={cn(
          "h-9 px-4 flex items-center gap-2.5 rounded-full border transition-all duration-500",
          mpLoaded ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-slate-800 border-slate-700 text-slate-500"
        )}>
          <div className={cn("w-1.5 h-1.5 rounded-full", mpLoaded ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-slate-600")} />
          <span className="text-[11px] font-bold uppercase tracking-wider">
            {mpLoaded ? "System Online" : "Connecting..."}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function Box({ title, children, className, delay = 0 }: { title?: React.ReactNode, children: React.ReactNode, className?: string, delay?: number }) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.4 }}
      className={cn("glass-card", className)}
    >
      {title && (
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1 h-3 bg-indigo-500 rounded-full" />
            {title}
          </h3>
          <div className="h-px flex-1 bg-slate-800/50 ml-4" />
        </div>
      )}
      <div className="relative">
        {children}
      </div>
    </motion.div>
  );
}

export function MainGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8 items-start">
      {children}
    </div>
  );
}
