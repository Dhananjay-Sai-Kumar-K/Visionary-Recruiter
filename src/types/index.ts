/* ─────────────────────── Video Intelligence Types ─────────────────────── */

/**
 * Low-level biometric signals extracted frame-by-frame.
 * These are the raw inputs to the psychometric scoring engine.
 */
export interface BiometricSignals {
  // Eye signals
  eyeContactScore: number;       // 0-100: camera gaze proximity
  gazeStability: number;         // 0-100: low variance = high stability
  gazeShiftRate: number;         // 0-100: frequency of gaze direction changes
  blinkRate: number;             // blinks per minute
  blinkSpike: number;            // 0-100: deviation from 15bpm baseline

  // Head pose signals (degrees)
  headPitch: number;             // up/down tilt
  headYaw: number;               // left/right turn
  headRoll: number;              // lateral tilt (ear-to-shoulder)
  headStability: number;         // 0-100: 100 = perfectly still

  // Facial muscle signals
  smileIntensity: number;        // 0-100: mouth corner activation
  smileAuthenticity: number;     // 0-100: Duchenne smile (mouth × eye squint)
  lipCompression: number;        // 0-100: pressed lips = stress
  jawTension: number;            // 0-100: clenched jaw signal
  eyebrowRaise: number;          // 0-100: curiosity / surprise

  // Nodding detection
  nodFrequency: number;          // 0-100: normalized nods per minute

  // Spatial framing
  faceCenteredness: number;      // 0-100: face centered in frame
}

/**
 * Psychometric composite scores derived from biometric signals.
 * These mirror the scoring engines of HireVue, Talview, etc.
 */
export interface PsychometricScores {
  // Primary interview judgment scores
  confidenceScore: number;       // 0-100
  engagementScore: number;       // 0-100
  stressScore: number;           // 0-100 (lower is better)
  professionalPresenceScore: number; // 0-100
  authenticityScore: number;     // 0-100

  // Overall composite
  compositeScore: number;        // weighted average of above
}

/**
 * A single timestamped behavioral event detected during analysis.
 */
export interface BehaviorEvent {
  id: string;
  type: 'stress_spike' | 'engagement_drop' | 'confidence_recovery' | 'eye_contact_loss' | 'high_presence' | 'authenticity_mismatch';
  severity: 'info' | 'warn' | 'success';
  label: string;
  ts: number;
  /** The composite score at time of detection */
  scoreAtEvent?: number;
}

/**
 * A snapshot entry in the behavioral timeline (taken every 3-5s).
 */
export interface TimelineSnapshot {
  ts: number;
  confidence: number;
  stress: number;
  engagement: number;
  presence: number;
}

/**
 * Full output of the useFaceMesh hook.
 */
export interface FaceMeshState {
  signals: BiometricSignals;
  scores: PsychometricScores;
  events: BehaviorEvent[];
  timeline: TimelineSnapshot[];
}

/* Backward-compat alias used by BiometricsCard, App.tsx, etc.
   Maps to PsychometricScores + key signals for UI convenience. */
export interface FaceMeshMetrics {
  // Kept for backward compat
  eyeContact: number;
  tilt: number;
  smile: number;
  blinkRate: number;
  jawTension: number;
  stress: number;
  presence: number;
  authenticity: number;
  engagement: number;
  // New production fields
  gazeStability: number;
  blinkSpike: number;
  smileAuthenticity: number;
  headStability: number;
  confidenceScore: number;
  compositeScore: number;
}

/* ─────────────────────── Interview Types ─────────────────────── */

export interface StarMetrics {
  confidence: number;
  star_situation: number;
  star_task: number;
  star_action: number;
  star_result: number;
  articulation: number;
  feedback?: string;
}

export interface InterviewTranscript {
  role: 'user' | 'sarah';
  text: string;
  ts?: string;
}

export interface SessionData {
  id?: string;
  startedAt: any; // Firestore Timestamp
  endedAt?: any;
  status: 'in_progress' | 'completed';
  transcript: InterviewTranscript[];
  finalMetrics?: StarMetrics | null;
  videoMetrics?: PsychometricScores | null;
}
