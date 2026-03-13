import React from 'react';
import { motion } from 'framer-motion';

interface InsightRadarProps {
  metrics: {
    label: string;
    value: number;
  }[];
  size?: number;
}

export function InsightRadar({ metrics, size = 260 }: InsightRadarProps) {
  const center = size / 2;
  const radius = (size / 2) * 0.75;
  const numPoints = metrics.length;
  const angleStep = (Math.PI * 2) / numPoints;

  // Generate polygon points
  const points = metrics.map((m, i) => {
    const r = (m.value / 100) * radius;
    const x = center + r * Math.sin(i * angleStep);
    const y = center - r * Math.cos(i * angleStep);
    return `${x},${y}`;
  }).join(' ');

  // Generate background grid
  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <div className="relative flex items-center justify-center p-4 bg-slate-950/20 rounded-3xl border border-white/5 backdrop-blur-sm group">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id="radarGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.4" />
          </radialGradient>
        </defs>

        {/* Background Grid Circles */}
        {gridLevels.map((lvl, idx) => (
          <circle 
            key={idx}
            cx={center} 
            cy={center} 
            r={radius * lvl} 
            fill="none" 
            stroke="rgba(255,255,255,0.05)" 
            strokeWidth="1" 
          />
        ))}

        {/* Axis Lines */}
        {metrics.map((_, i) => {
          const x = center + radius * Math.sin(i * angleStep);
          const y = center - radius * Math.cos(i * angleStep);
          return (
            <line 
              key={`axis-${i}`}
              x1={center} y1={center} 
              x2={x} y2={y} 
              stroke="rgba(255,255,255,0.08)" 
              strokeWidth="1" 
            />
          );
        })}

        {/* The Data Shape */}
        <motion.polygon
          points={points}
          fill="url(#radarGrad)"
          stroke="#6366f1"
          strokeWidth="2"
          initial={false}
          animate={{ points }}
          transition={{ type: "spring", stiffness: 60, damping: 15 }}
          className="drop-shadow-[0_0_12px_rgba(99,102,241,0.5)]"
        />

        {/* Labels & Data Points */}
        {metrics.map((m, i) => {
          const x = center + (radius + 24) * Math.sin(i * angleStep);
          const y = center - (radius + 24) * Math.cos(i * angleStep);
          const dotX = center + (m.value / 100) * radius * Math.sin(i * angleStep);
          const dotY = center - (m.value / 100) * radius * Math.cos(i * angleStep);

          return (
            <g key={i}>
              <motion.circle
                cx={dotX} cy={dotY} r="3"
                fill="#fff"
                animate={{ cx: dotX, cy: dotY }}
              />
              <text
                x={x} y={y}
                textAnchor="middle"
                className="text-[9px] font-black fill-slate-500 uppercase tracking-tighter"
              >
                {m.label}
              </text>
              <text
                x={x} y={y + 10}
                textAnchor="middle"
                className="text-[10px] font-mono fill-white font-bold"
              >
                {Math.round(m.value)}
              </text>
            </g>
          );
        })}
      </svg>
      
      {/* Decorative Corners */}
      <div className="absolute top-4 left-4 w-4 h-4 border-l-2 border-t-2 border-indigo-500/30" />
      <div className="absolute top-4 right-4 w-4 h-4 border-r-2 border-t-2 border-indigo-500/30" />
      <div className="absolute bottom-4 left-4 w-4 h-4 border-l-2 border-b-2 border-indigo-500/30" />
      <div className="absolute bottom-4 right-4 w-4 h-4 border-r-2 border-b-2 border-indigo-500/30" />
    </div>
  );
}
