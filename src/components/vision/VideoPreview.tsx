import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export const VideoPreview = forwardRef<HTMLVideoElement, { 
  isWarnFlash?: boolean, 
  canvasRef?: React.RefObject<HTMLCanvasElement | null>, 
  audioLevel?: number,
  stress?: number,
  presence?: number
}>(({ isWarnFlash, canvasRef, audioLevel = 0, stress = 0, presence = 100 }, ref) => {
  return (
    <div className={cn(
      "relative rounded-3xl overflow-hidden bg-slate-950 aspect-video border border-slate-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] transition-all duration-500",
      isWarnFlash && "ring-4 ring-rose-500/50 shadow-[0_0_80px_rgba(244,63,94,0.3)]"
    )}>
      {/* Neural Scanline Effect Overlay */}
      <div className="absolute inset-0 pointer-events-none z-20 opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%]" />
      
      {/* Biometric Wavefronts (Holographic Oscillations) */}
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden opacity-40">
        <svg vertical-align="middle" className="w-full h-full opacity-60">
          <defs>
            <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
              <stop offset="50%" stopColor="#6366f1" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <motion.path
            d="M 0 100 Q 150 50 300 100 T 600 100"
            fill="none"
            stroke="url(#waveGrad)"
            strokeWidth="1"
            filter="url(#glow)"
            animate={{
              d: [
                `M 0 ${100 + audioLevel} Q 150 ${50 - audioLevel} 300 ${100 + audioLevel} T 600 ${100 - audioLevel}`,
                `M 0 ${100 - audioLevel} Q 150 ${150 + audioLevel} 300 ${100 - audioLevel} T 600 ${100 + audioLevel}`
              ]
            }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          />
        </svg>
      </div>

      <video 
        ref={ref}
        autoPlay 
        playsInline 
        muted 
        className="block w-full h-full object-cover rounded-3xl grayscale-[15%] contrast-[1.15] brightness-[1.05]"
      />
      
      {/* Neural Grid Overlay */}
      <div className="absolute inset-0 pointer-events-none z-20 opacity-10 bg-[radial-gradient(#6366f1_1px,transparent_1px)] bg-[size:24px_24px]" />

      <canvas 
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full rounded-3xl pointer-events-none z-15 brightness-150 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" 
      />
      
      {/* Header UI */}
      <div className="absolute top-6 left-6 z-30 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
          <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] bg-indigo-600/20 px-3 py-1 rounded-full border border-indigo-500/30 backdrop-blur-xl">
            SARAH_LENS v4.0
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[9px] font-mono text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded-sm border border-slate-800">
            PRESENCE: {Math.round(presence)}%
          </span>
          <span className="text-[9px] font-mono text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded-sm border border-slate-800">
            STRESS: {Math.round(stress)}%
          </span>
        </div>
      </div>

      <div className="absolute top-6 right-6 z-30 flex items-center gap-3">
         <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Signal_Lock</span>
            <span className="text-[12px] font-mono text-indigo-400 font-bold">100% STABLE</span>
         </div>
         <div className="w-10 h-10 border-2 border-indigo-500/30 rounded-full flex items-center justify-center bg-indigo-500/5 backdrop-blur-md">
            <div className="w-5 h-5 rounded-full border-t-2 border-indigo-400 animate-spin" />
         </div>
      </div>

      {/* Footer Interface */}
      <div className="absolute bottom-6 left-6 right-6 z-30 flex items-end justify-between">
        <div className="flex items-center gap-4 bg-slate-950/40 backdrop-blur-xl p-3 rounded-2xl border border-white/5">
          <div className="flex gap-1.5 h-8 items-end">
            {Array.from({ length: 12 }).map((_, i) => (
              <motion.div 
                key={i}
                animate={{ height: [Math.random()*10 + 4, Math.random()*20 + 8, Math.random()*10 + 4] }}
                transition={{ repeat: Infinity, duration: 1, delay: i * 0.1 }}
                className="w-1 bg-indigo-500/80 rounded-full"
              />
            ))}
          </div>
          <div className="pr-4 border-r border-slate-800">
            <div className="text-[8px] font-bold text-slate-500 uppercase">Input_Gain</div>
            <div className="text-xs font-mono text-white tabular-nums">+{audioLevel.toFixed(1)}dB</div>
          </div>
          <div>
            <div className="text-[8px] font-bold text-slate-500 uppercase">Identity_Match</div>
            <div className="text-xs font-mono text-emerald-400 font-bold">VERIFIED</div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="px-3 py-1 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Bio_Tele_Active</span>
          </div>
          <div className="text-[8px] font-mono text-slate-600">FRM_TIMESTAMP_{Date.now().toString().slice(-6)}</div>
        </div>
      </div>

      {/* Warning Overlay */}
      <AnimatePresence>
        {isWarnFlash && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-rose-500/10 border-8 border-rose-500/30 pointer-events-none"
          />
        )}
      </AnimatePresence>
    </div>
  );
});

VideoPreview.displayName = 'VideoPreview';
