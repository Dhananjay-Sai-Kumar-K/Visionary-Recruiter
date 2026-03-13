import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export const VideoPreview = forwardRef<HTMLVideoElement, { isWarnFlash?: boolean, canvasRef?: React.RefObject<HTMLCanvasElement | null>, audioLevel?: number }>(({ isWarnFlash, canvasRef, audioLevel = 0 }, ref) => {
  return (
    <div className={cn(
      "relative rounded-2xl overflow-hidden bg-slate-950 aspect-video border border-slate-800 shadow-2xl transition-all duration-500",
      isWarnFlash && "ring-4 ring-rose-500/50"
    )}>
      {/* Neural Scanline Effect Overlay */}
      <div className="absolute inset-0 pointer-events-none z-20 opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%]" />
      
      <video 
        ref={ref}
        autoPlay 
        playsInline 
        muted 
        className="block w-full h-full object-cover rounded-2xl grayscale-[20%] contrast-[1.1]"
      />
      
      {/* Real-time Audio Waveform Overlay */}
      <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none z-30 overflow-hidden flex items-end justify-center gap-[2px] pb-4 px-10">
        {Array.from({ length: 40 }).map((_, i) => (
          <motion.div
            key={i}
            animate={{ 
              height: Math.max(4, audioLevel * (0.6 + Math.random() * 0.4) * (1 - Math.abs(i - 20) / 20))
            }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="w-1 bg-indigo-500/60 rounded-full"
          />
        ))}
      </div>

      <canvas 
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full rounded-2xl pointer-events-none z-10 brightness-125" 
      />
      
      {/* Corner UI Elements */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
        <span className="text-[10px] font-bold text-white uppercase tracking-widest bg-slate-950/80 px-2 py-0.5 rounded border border-white/10 backdrop-blur-md">
          Neural Feed 01
        </span>
      </div>

      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
         <span className="text-[10px] font-mono text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-white/10 backdrop-blur-md">
           30 FPS [LIVE]
         </span>
      </div>

      {/* Warning Overlay */}
      <AnimatePresence>
        {isWarnFlash && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-rose-500/10 border-4 border-rose-500 pointer-events-none"
          />
        )}
      </AnimatePresence>

      <div className="absolute bottom-4 left-4 z-30 flex items-center gap-3">
        <div className="flex gap-1">
          {[1, 2, 3].map(i => (
            <motion.div 
              key={i}
              animate={{ height: [4, 12, 4] }}
              transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
              className="w-1 bg-indigo-500 rounded-full"
            />
          ))}
        </div>
        <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">Biometric Lock Active</span>
      </div>
    </div>
  );
});

VideoPreview.displayName = 'VideoPreview';
