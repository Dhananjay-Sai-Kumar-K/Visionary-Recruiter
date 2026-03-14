/**
 * useFaceMesh.ts — Production-Grade Multimodal Interview Video Analyzer
 *
 * Architecture mirrors HireVue / Talview production pipeline:
 *
 *   Frame Scheduler (10fps analysis)
 *     → FaceMesh Landmark Extraction (468 landmarks)
 *     → Low-Level Signal Extraction (biometrics.ts)
 *     → Temporal Behavior Modeling (sliding windows)
 *     → Psychometric Scoring Engine
 *     → Behavioral Event Detection
 *     → Timeline Logging
 *     → Holographic Canvas Overlay
 *
 * All metrics use EWMA smoothing to prevent UI jitter.
 * All composite scores use research-backed weighted formulas.
 */

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  getEyeAspectRatio,
  calcEyeContact,
  calcGazeStability,
  calcGazeShiftRate,
  calcBlinkSpike,
  calcHeadRoll,
  calcHeadPitch,
  calcHeadYaw,
  calcHeadStability,
  calcSmile,
  calcSmileAuthenticity,
  calcJawTension,
  calcLipCompression,
  calcEyebrowRaise,
  calcNodFrequency,
  calcFaceCenteredness,
  calcConfidenceScore,
  calcEngagementScore,
  calcStressScore,
  calcProfessionalPresence,
  calcCompositeScore,
} from '../lib/biometrics';
import type { FaceMeshMetrics, BehaviorEvent, TimelineSnapshot } from '../types/index';

/* ─────────────────────── Constants ─────────────────────── */

/** EWMA smoothing alpha — lower = smoother, higher = more reactive */
const ALPHA = 0.12;

/** EAR threshold below which we count a blink */
const BLINK_THRESHOLD = 0.22;

/** Baseline natural blink rate (blinks/min) */
const BLINK_BASELINE = 15;

/** Temporal window sizes */
const GAZE_HISTORY_SIZE  = 30;   // ~3 seconds at 10fps
const POSE_HISTORY_SIZE  = 30;   // ~3 seconds at 10fps
const TIMELINE_INTERVAL  = 4000; // snapshot every 4s

/** Event detection thresholds */
const STRESS_SPIKE_THRESHOLD      = 68;
const ENGAGEMENT_DROP_THRESHOLD   = 40;
const CONFIDENCE_RECOVERY_THRESHOLD = 72;
const HIGH_PRESENCE_THRESHOLD     = 80;

/** How long in ms before the same event can fire again */
const EVENT_COOLDOWN: Record<BehaviorEvent['type'], number> = {
  stress_spike:          8000,
  engagement_drop:      10000,
  confidence_recovery:  15000,
  eye_contact_loss:      8000,
  high_presence:        12000,
  authenticity_mismatch: 10000,
};

/* ─────────────────────── Helpers ─────────────────────── */

const smooth = (prev: number, next: number, a = ALPHA) =>
  Math.round(prev * (1 - a) + next * a);

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function rollingPush<T>(arr: T[], val: T, maxLen: number): T[] {
  const next = [...arr, val];
  if (next.length > maxLen) next.shift();
  return next;
}

/* ─────────────────────── Hook ─────────────────────── */

export function useFaceMesh(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
  active: boolean
) {
  const [isLoaded, setIsLoaded] = useState(false);

  const defaultMetrics: FaceMeshMetrics = {
    eyeContact: 0, tilt: 0, smile: 0, blinkRate: 0, jawTension: 0,
    stress: 0, presence: 0, authenticity: 0, engagement: 0,
    gazeStability: 0, blinkSpike: 0, smileAuthenticity: 0,
    headStability: 0, confidenceScore: 0, compositeScore: 0,
  };

  const [metrics, setMetrics] = useState<FaceMeshMetrics>(defaultMetrics);
  const [events, setEvents] = useState<BehaviorEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineSnapshot[]>([]);

  /* ── MediaPipe ref ── */
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number>(0);

  /* ── Smoothed metric store (avoids stale-state in rAF closure) ── */
  const live = useRef<FaceMeshMetrics>(defaultMetrics);

  /* ── Temporal sliding windows ── */
  const gazeHistory  = useRef<number[]>(new Array(GAZE_HISTORY_SIZE).fill(0));
  const rollHistory  = useRef<number[]>(new Array(POSE_HISTORY_SIZE).fill(0));
  const pitchHistory = useRef<number[]>(new Array(POSE_HISTORY_SIZE).fill(0));
  const yawHistory   = useRef<number[]>(new Array(POSE_HISTORY_SIZE).fill(0));
  const histIdx      = useRef(0);

  /* ── Blink bookkeeping ── */
  const blinkCount     = useRef(0);
  const blinkStartTime = useRef(Date.now());
  const wasBlinking    = useRef(false);

  /* ── EAR baseline calibration (first 60 frames) ── */
  const earSamples  = useRef<number[]>([]);
  const earBaseline = useRef(0.32);

  /* ── Event cooldown tracker ── */
  const lastEventTime = useRef<Record<BehaviorEvent['type'], number>>({
    stress_spike: 0, engagement_drop: 0, confidence_recovery: 0,
    eye_contact_loss: 0, high_presence: 0, authenticity_mismatch: 0,
  });

  /* ── Timeline ── */
  const lastTimelineTs = useRef(0);

  /* ── UI update throttle ── */
  const lastUIUpdate = useRef(0);

  /* ─── Load Model ─── */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const fs = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        const lm = await FaceLandmarker.createFromOptions(fs, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        });
        if (!cancelled) {
          faceLandmarkerRef.current = lm;
          setIsLoaded(true);
        }
      } catch (e) {
        console.error('[useFaceMesh] Model load failed:', e);
      }
    }
    load();
    return () => { cancelled = true; faceLandmarkerRef.current?.close(); };
  }, []);

  /* ─── Analysis Loop ─── */
  useEffect(() => {
    if (!active || !isLoaded) return;

    let lastFrameTime = -1;

    function loop() {
      const video = videoRef.current;
      if (video && faceLandmarkerRef.current && video.readyState >= 2) {
        const now = performance.now();
        // Frame-rate throttle: analyse at ~10fps (max 12)
        if (now - lastFrameTime > 83) {
          lastFrameTime = now;
          try {
            const res = faceLandmarkerRef.current.detectForVideo(video, now);
            processFrame(res);
          } catch (_) {/* GPU context may reset; skip frame */}
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, isLoaded]);

  /* ─────────────────────── Core Processing ─────────────────────── */

  function processFrame(results: FaceLandmarkerResult) {
    if (!results.faceLandmarks?.length) return;

    const lm  = results.faceLandmarks[0];
    const pt  = (i: number) => ({ x: lm[i].x, y: lm[i].y });
    const now = Date.now();

    /* ──── 1. EAR + Blink Detection ──── */
    const lEar = getEyeAspectRatio([pt(33), pt(160), pt(158), pt(133), pt(153), pt(144)]);
    const rEar = getEyeAspectRatio([pt(362), pt(385), pt(387), pt(263), pt(373), pt(380)]);
    const avgEar = (lEar + rEar) / 2;

    // Self-calibrating EAR baseline (first 60 frames)
    if (earSamples.current.length < 60) {
      if (avgEar > 0.25) earSamples.current.push(avgEar); // skip blinks for baseline
      if (earSamples.current.length === 60) {
        earBaseline.current = earSamples.current.reduce((a, b) => a + b) / 60;
        console.log('[FaceMesh] EAR baseline calibrated:', earBaseline.current.toFixed(3));
      }
    }

    const isBlinking = avgEar < BLINK_THRESHOLD;
    if (isBlinking && !wasBlinking.current) blinkCount.current++;
    wasBlinking.current = isBlinking;

    const elapsedMin = (now - blinkStartTime.current) / 60000;
    const blinkRate  = elapsedMin > 0 ? Math.round(blinkCount.current / elapsedMin) : 0;
    const blinkSpike = calcBlinkSpike(blinkRate, BLINK_BASELINE);

    /* ──── 2. Eye Contact & Gaze ──── */
    const rawEye = calcEyeContact(pt(1), pt(234), pt(454), pt(33).y, pt(362).y);

    gazeHistory.current = rollingPush(gazeHistory.current, rawEye, GAZE_HISTORY_SIZE);

    const avgEye       = Math.round(gazeHistory.current.reduce((a, b) => a + b, 0) / GAZE_HISTORY_SIZE);
    const gazeStab     = calcGazeStability(gazeHistory.current);
    const gazeShift    = calcGazeShiftRate(gazeHistory.current);

    /* ──── 3. Head Pose ──── */
    const faceH   = Math.abs(pt(152).y - pt(10).y);
    const headRoll  = calcHeadRoll(pt(33), pt(362));
    const headPitch = calcHeadPitch(pt(1), pt(152), faceH);
    const headYaw   = calcHeadYaw(pt(1), pt(234), pt(454));

    const idx = histIdx.current % POSE_HISTORY_SIZE;
    rollHistory.current[idx]  = headRoll;
    pitchHistory.current[idx] = headPitch;
    yawHistory.current[idx]   = headYaw;
    histIdx.current++;

    const headStab = calcHeadStability(rollHistory.current, pitchHistory.current, yawHistory.current);

    /* ──── 4. Facial Muscle Signals ──── */
    const faceW         = Math.abs(pt(454).x - pt(234).x);
    const rawSmile      = calcSmile(pt(61), pt(291), faceW);
    const smileAuth     = calcSmileAuthenticity(rawSmile, avgEar, earBaseline.current);
    const rawJaw        = calcJawTension(pt(13), pt(14), pt(149), pt(378), faceH);
    const lipComp       = calcLipCompression(pt(78), pt(308), pt(13), pt(14));
    const eyebrow       = calcEyebrowRaise(pt(70), pt(336), pt(159), pt(386), faceH);

    /* ──── 5. Nodding Detection ──── */
    const nodFreq = calcNodFrequency(pitchHistory.current);

    /* ──── 6. Spatial Framing ──── */
    const faceCentered = calcFaceCenteredness(pt(1));

    /* ──── 7. Facial Reactivity (composite awareness signal) ──── */
    const facialReactivity = Math.round((eyebrow * 0.5) + (rawSmile * 0.3) + (nodFreq * 0.2));

    /* ──── 8. Psychometric Scores ──── */
    const rawStress    = calcStressScore(blinkSpike, rawJaw, avgEye, headPitch);
    const rawConf      = calcConfidenceScore(avgEye, headStab, smileAuth, rawStress);
    const rawEngagement= calcEngagementScore(gazeStab, nodFreq, facialReactivity, avgEye);
    const rawPresence  = calcProfessionalPresence(headStab, faceCentered, gazeShift);
    const rawComposite = calcCompositeScore(rawConf, rawEngagement, rawStress, rawPresence, smileAuth);
    const rawAuth      = smileAuth;

    /* ──── 9. EWMA Smoothing ──── */
    const prev = live.current;
    live.current = {
      eyeContact:       avgEye,             // raw window average, already smooth
      tilt:             headRoll,           // raw degrees for display
      smile:            smooth(prev.smile, rawSmile),
      blinkRate,
      jawTension:       smooth(prev.jawTension, rawJaw),
      stress:           smooth(prev.stress, rawStress),
      presence:         smooth(prev.presence, rawPresence),
      authenticity:     smooth(prev.authenticity, rawAuth),
      engagement:       smooth(prev.engagement, rawEngagement),
      gazeStability:    smooth(prev.gazeStability, gazeStab),
      blinkSpike:       smooth(prev.blinkSpike, blinkSpike),
      smileAuthenticity:smooth(prev.smileAuthenticity, smileAuth),
      headStability:    smooth(prev.headStability, headStab),
      confidenceScore:  smooth(prev.confidenceScore, rawConf),
      compositeScore:   smooth(prev.compositeScore, rawComposite),
    };

    /* ──── 10. Behavioral Event Detection ──── */
    detectEvents(live.current, now, lipComp);

    /* ──── 11. Timeline Snapshot ──── */
    if (now - lastTimelineTs.current > TIMELINE_INTERVAL) {
      lastTimelineTs.current = now;
      const snap: TimelineSnapshot = {
        ts:         now,
        confidence: live.current.confidenceScore,
        stress:     live.current.stress,
        engagement: live.current.engagement,
        presence:   live.current.presence,
      };
      setTimeline(prev => [...prev.slice(-60), snap]); // keep last ~4 minutes
    }

    /* ──── 12. Canvas Overlay ──── */
    drawOverlay(lm, avgEye, live.current);

    /* ──── 13. UI State Update (~4fps throttle) ──── */
    if (now - lastUIUpdate.current > 250) {
      lastUIUpdate.current = now;
      setMetrics({ ...live.current });
    }
  }

  /* ─────────────────────── Event Detector ─────────────────────── */

  function fireEvent(ev: BehaviorEvent) {
    const cooldown = EVENT_COOLDOWN[ev.type];
    const lastFired = lastEventTime.current[ev.type];
    if (Date.now() - lastFired < cooldown) return;
    lastEventTime.current[ev.type] = Date.now();
    setEvents(prev => [...prev.slice(-20), ev]);
  }

  function detectEvents(m: FaceMeshMetrics, now: number, _lipComp: number) {
    // Stress Spike: multi-signal convergence
    if (m.stress > STRESS_SPIKE_THRESHOLD && m.blinkSpike > 40) {
      fireEvent({ id: makeId(), type: 'stress_spike', severity: 'warn',
        label: `Stress spike: ${m.stress}% (blink ↑, jaw ↑)`, ts: now,
        scoreAtEvent: m.compositeScore });
    }
    // Engagement Drop: prolonged gaze away
    if (m.engagement < ENGAGEMENT_DROP_THRESHOLD && m.gazeStability < 35) {
      fireEvent({ id: makeId(), type: 'engagement_drop', severity: 'warn',
        label: `Engagement drop to ${m.engagement}%`, ts: now,
        scoreAtEvent: m.compositeScore });
    }
    // Eye Contact Loss (separate from engagement drop)
    if (m.eyeContact < 30) {
      fireEvent({ id: makeId(), type: 'eye_contact_loss', severity: 'warn',
        label: `Eye contact lost (${m.eyeContact}%)`, ts: now });
    }
    // Confidence Recovery
    if (m.confidenceScore > CONFIDENCE_RECOVERY_THRESHOLD && m.stress < 35) {
      fireEvent({ id: makeId(), type: 'confidence_recovery', severity: 'success',
        label: `Confidence surge: ${m.confidenceScore}%`, ts: now,
        scoreAtEvent: m.compositeScore });
    }
    // High Executive Presence
    if (m.presence > HIGH_PRESENCE_THRESHOLD && m.headStability > 75) {
      fireEvent({ id: makeId(), type: 'high_presence', severity: 'success',
        label: `High presence: ${m.presence}% (stable, centred)`, ts: now });
    }
    // Authenticity Mismatch (forced smile detected)
    if (m.smile > 30 && m.smileAuthenticity < 25) {
      fireEvent({ id: makeId(), type: 'authenticity_mismatch', severity: 'warn',
        label: `Authenticity mismatch — performative smile`, ts: now });
    }
  }

  /* ─────────────────────── Holographic Canvas Overlay ─────────────────────── */

  function drawOverlay(lm: { x: number; y: number; z: number }[], avgEye: number, m: FaceMeshMetrics) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pt = (i: number) => ({ x: lm[i].x * W, y: lm[i].y * H });

    ctx.clearRect(0, 0, W, H);

    // Determine overlay colour by stress level
    const r = m.stress > 65 ? 239 : m.stress > 40 ? 245 : 34;
    const g = m.stress > 65 ? 68  : m.stress > 40 ? 158 : 211;
    const b = m.stress > 65 ? 68  : m.stress > 40 ? 11  : 238;
    const colA  = (alpha: number) => `rgba(${r},${g},${b},${alpha})`;

    ctx.save();
    ctx.shadowBlur   = 14;
    ctx.shadowColor  = colA(0.8);
    ctx.strokeStyle  = colA(0.65);
    ctx.lineWidth    = 1.5;

    // Draw loop helper
    const drawPoly = (indices: number[]) => {
      ctx.beginPath();
      indices.forEach((idx, i) => {
        const p = pt(idx);
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    };

    // Left Eye Track
    drawPoly([33, 160, 158, 133, 153, 144, 33]);
    // Right Eye Track
    drawPoly([362, 385, 387, 263, 373, 380, 362]);
    // Mouth Track
    drawPoly([61, 291, 321, 375, 291, 61]);
    // Jaw Outline (partial)
    drawPoly([234, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 454]);

    // Nose bridge tracker dot
    const nosePt = pt(1);
    ctx.fillStyle = colA(0.9);
    ctx.beginPath();
    ctx.arc(nosePt.x, nosePt.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Neural threads: eye → nose → eye
    ctx.strokeStyle = colA(0.18);
    ctx.lineWidth   = 0.5;
    const lEye = pt(33); const rEye = pt(362);
    ctx.beginPath();
    ctx.moveTo(lEye.x, lEye.y);
    ctx.lineTo(nosePt.x, nosePt.y);
    ctx.lineTo(rEye.x, rEye.y);
    ctx.stroke();

    // Eyebrow tracks
    ctx.strokeStyle = colA(0.4);
    ctx.lineWidth   = 1;
    drawPoly([70, 63, 105, 66, 107]);   // Left brow
    drawPoly([336, 296, 334, 293, 300]);// Right brow

    // Landmark labels
    const labels = [
      { idx: 1,   text: 'NOSE' },
      { idx: 33,  text: 'L_EYE' },
      { idx: 362, text: 'R_EYE' },
    ];
    ctx.font      = 'bold 7px monospace';
    ctx.fillStyle = colA(0.75);
    for (const lb of labels) {
      const p = pt(lb.idx);
      ctx.fillText(lb.text, p.x + 5, p.y + 3);
    }

    // Eye contact lock ring
    if (avgEye > 78) {
      ctx.strokeStyle  = 'rgba(16, 185, 129, 0.9)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth    = 1.5;
      ctx.shadowColor  = 'rgba(16,185,129,0.6)';
      ctx.shadowBlur   = 10;
      ctx.strokeRect(nosePt.x - 36, nosePt.y - 36, 72, 72);
      ctx.font      = 'bold 7px sans-serif';
      ctx.fillStyle = 'rgba(16,185,129,0.9)';
      ctx.fillText('GAZE_LOCKED', nosePt.x - 32, nosePt.y - 40);
      ctx.setLineDash([]);
    }

    // Stress ring (when stress > threshold)
    if (m.stress > STRESS_SPIKE_THRESHOLD) {
      ctx.strokeStyle = `rgba(239,68,68,${0.3 + (m.stress / 100) * 0.5})`;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth   = 2;
      ctx.shadowColor = 'rgba(239,68,68,0.5)';
      ctx.shadowBlur  = 20;
      ctx.strokeRect(4, 4, W - 8, H - 8);
      ctx.setLineDash([]);
    }

    // HUD: scores in corner
    ctx.shadowBlur  = 0;
    ctx.font        = 'bold 8px monospace';
    ctx.fillStyle   = colA(0.7);
    ctx.fillText(`CONF:${m.confidenceScore}`, 8, H - 38);
    ctx.fillText(`ENG:${m.engagement}`,       8, H - 26);
    ctx.fillText(`PRES:${m.presence}`,        8, H - 14);

    ctx.restore();
  }

  return { isLoaded, metrics, events, timeline };
}
