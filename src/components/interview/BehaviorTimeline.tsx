/**
 * BehaviorTimeline.tsx
 *
 * Real-time SVG timeline visualizer for behavioral scoring over time.
 * Renders confidence, stress, and engagement as multi-track waveform charts,
 * similar to HireVue / Talview post-session report panels.
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { TimelineSnapshot } from '../../types/index';

interface BehaviorTimelineProps {
  timeline: TimelineSnapshot[];
}

interface TrackConfig {
  key: keyof Omit<TimelineSnapshot, 'ts'>;
  label: string;
  color: string;
  glow: string;
}

const TRACKS: TrackConfig[] = [
  { key: 'confidence', label: 'Confidence', color: '#818cf8', glow: 'rgba(129,140,248,0.4)' },
  { key: 'engagement', label: 'Engagement',  color: '#34d399', glow: 'rgba(52,211,153,0.4)' },
  { key: 'stress',     label: 'Stress',      color: '#f87171', glow: 'rgba(248,113,113,0.4)' },
  { key: 'presence',   label: 'Presence',    color: '#fb923c', glow: 'rgba(251,146,60,0.4)' },
];

const W = 560;
const H = 110;
const PADDING = { top: 10, bottom: 18, left: 8, right: 8 };

function toPath(data: TimelineSnapshot[], key: keyof Omit<TimelineSnapshot, 'ts'>): string {
  if (data.length < 2) return '';
  const xStep = (W - PADDING.left - PADDING.right) / Math.max(1, data.length - 1);
  const yRange = H - PADDING.top - PADDING.bottom;

  return data.map((d, i) => {
    const x = PADDING.left + i * xStep;
    const y = PADDING.top + yRange - (d[key] / 100) * yRange;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function toFill(data: TimelineSnapshot[], key: keyof Omit<TimelineSnapshot, 'ts'>): string {
  if (data.length < 2) return '';
  const path = toPath(data, key);
  if (!path) return '';
  const lastX = (PADDING.left + (data.length - 1) * (W - PADDING.left - PADDING.right) / Math.max(1, data.length - 1)).toFixed(1);
  const baseY = (H - PADDING.bottom).toFixed(1);
  return `${path} L ${lastX} ${baseY} L ${PADDING.left} ${baseY} Z`;
}

/* ── Single metric micro-chart ── */
function Track({ track, data }: { track: TrackConfig; data: TimelineSnapshot[] }) {
  const linePath = useMemo(() => toPath(data, track.key), [data, track.key]);
  const fillPath = useMemo(() => toFill(data, track.key), [data, track.key]);
  const lastVal  = data.length > 0 ? data[data.length - 1][track.key] : 0;

  if (data.length < 2) {
    return (
      <div className="flex-1 bg-slate-950/30 rounded-xl border border-slate-800/50 p-3 flex items-center justify-center">
        <span className="text-[9px] font-mono text-slate-700 uppercase tracking-wider">Collecting data...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-slate-950/30 rounded-xl border border-slate-800/50 p-3 relative overflow-hidden group hover:border-slate-700 transition-all">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: track.color, boxShadow: `0 0 6px ${track.glow}` }} />
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{track.label}</span>
        </div>
        <span className="text-[11px] font-black font-mono text-white tabular-nums">{lastVal}%</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`fill-${track.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={track.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={track.color} stopOpacity="0" />
          </linearGradient>
          <filter id={`glow-${track.key}`}>
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Grid lines */}
        {[25, 50, 75].map(v => (
          <line
            key={v}
            x1={PADDING.left} y1={PADDING.top + (1 - v / 100) * (H - PADDING.top - PADDING.bottom)}
            x2={W - PADDING.right} y2={PADDING.top + (1 - v / 100) * (H - PADDING.top - PADDING.bottom)}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1"
          />
        ))}
        {/* Fill */}
        <path d={fillPath} fill={`url(#fill-${track.key})`} />
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={track.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#glow-${track.key})`}
        />
        {/* Last point dot */}
        {data.length > 1 && (() => {
          const xStep = (W - PADDING.left - PADDING.right) / Math.max(1, data.length - 1);
          const lastX = PADDING.left + (data.length - 1) * xStep;
          const lastY = PADDING.top + (H - PADDING.top - PADDING.bottom) - (lastVal / 100) * (H - PADDING.top - PADDING.bottom);
          return <circle cx={lastX} cy={lastY} r="3" fill={track.color} filter={`url(#glow-${track.key})`} />;
        })()}
      </svg>
    </div>
  );
}

/* ── Timeline summary stats ── */
function SummaryBar({ timeline }: { timeline: TimelineSnapshot[] }) {
  if (timeline.length < 3) return null;
  const avg = (key: keyof Omit<TimelineSnapshot, 'ts'>) =>
    Math.round(timeline.reduce((s, t) => s + t[key], 0) / timeline.length);

  const phase = () => {
    if (timeline.length < 6) return 'Calibrating';
    const firstHalf  = timeline.slice(0, Math.floor(timeline.length / 2));
    const confDelta  = avg.call(null, 'confidence') - (firstHalf.reduce((s, t) => s + t.confidence, 0) / firstHalf.length);
    if (confDelta > 10) return 'Recovering';
    if (avg('stress') > 60) return 'Under Pressure';
    if (avg('confidence') > 70) return 'Performing Well';
    return 'Moderate';
  };

  return (
    <div className="flex items-center gap-3 mt-3 px-1">
      <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Session avg:</span>
      {TRACKS.map(t => (
        <span key={t.key} className="text-[10px] font-black font-mono" style={{ color: t.color }}>
          {t.label[0]}:{avg(t.key)}
        </span>
      ))}
      <span className="ml-auto text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border" 
            style={{ color: '#a5b4fc', borderColor: 'rgba(165,180,252,0.2)', background: 'rgba(165,180,252,0.05)' }}>
        Phase: {phase()}
      </span>
    </div>
  );
}

/* ── Main export ── */
export function BehaviorTimeline({ timeline }: BehaviorTimelineProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {[1,2,3].map(i => (
              <motion.div
                key={i}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.25 }}
                className="w-1 h-3 bg-indigo-500 rounded-full"
              />
            ))}
          </div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Behavioral Timeline</span>
        </div>
        <span className="text-[9px] font-mono text-slate-700">{timeline.length} snapshots</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TRACKS.map(t => (
          <Track key={t.key} track={t} data={timeline} />
        ))}
      </div>

      <SummaryBar timeline={timeline} />
    </div>
  );
}
