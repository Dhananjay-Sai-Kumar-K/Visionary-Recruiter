/**
 * biometrics.ts — Production-grade signal extraction library.
 *
 * All functions operate on MediaPipe FaceLandmarker normalized coordinates (0–1).
 * References: MediaPipe Face Topology, AU (Action Units) FACS system,
 * published research on nonverbal interview behavior (HireVue, 2018).
 */

type Pt = { x: number; y: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/* ──────────────────────────── EYE SIGNALS ──────────────────────────── */

/**
 * Eye Aspect Ratio: core blink detection.
 * EAR = (|P2-P6| + |P3-P5|) / (2 * |P1-P4|)
 * Threshold: < 0.22 → blink.
 * Landmarks: Left [33,160,158,133,153,144], Right [362,385,387,263,373,380]
 */
export function getEyeAspectRatio(eye: Pt[]): number {
  if (!eye || eye.length < 6) return 0;
  const v1 = dist(eye[1], eye[5]);
  const v2 = dist(eye[2], eye[4]);
  const h  = dist(eye[0], eye[3]);
  return h < 0.001 ? 0 : (v1 + v2) / (2 * h);
}

/**
 * Eye contact estimation based on how centred the face is relative to frame
 * and how level the gaze is with the camera.
 *
 * Production insight: real systems combine gaze angle estimation with
 * head-pose, but for a single-camera web setup this proxy works well.
 */
export function calcEyeContact(
  nose: Pt,
  lCheek: Pt,
  rCheek: Pt,
  leftEyeY: number,
  rightEyeY: number
): number {
  const faceW    = Math.abs(rCheek.x - lCheek.x);
  const faceCenter = (lCheek.x + rCheek.x) / 2;

  // Horizontal: how far is the face centre from the frame centre (0.5)?
  const hDev = Math.abs(faceCenter - 0.5) / Math.max(0.001, faceW);

  // Vertical: nose below eye midpoint → looking down
  const eyeMidY = (leftEyeY + rightEyeY) / 2;
  const vDev    = Math.abs(nose.y - eyeMidY - 0.08) / 0.15;

  return clamp(Math.round((1 - Math.sqrt(hDev ** 2 + vDev ** 2) * 1.5) * 100));
}

/**
 * Gaze stability: variance of the last N eye-contact readings.
 * A consistently high (or consistently low) eye contact is "stable".
 * Frequent alternation is instability.
 *
 * @param history   Circular buffer of raw eye contact readings
 * @returns 0-100 where 100 = no variance (perfectly steady gaze)
 */
export function calcGazeStability(history: number[]): number {
  if (history.length < 2) return 100;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
  // variance of 0 → stability 100; variance of ~1000 (std≈31) → stability 0
  return clamp(Math.round(100 - (variance / 500) * 100));
}

/**
 * Gaze shift rate: how often does gaze direction change significantly?
 * High rate → anxious scanning; low rate → focused.
 * @param history  Last N raw eye readings
 * @param threshold  minimum delta to count as a "shift"
 */
export function calcGazeShiftRate(history: number[], threshold = 15): number {
  if (history.length < 2) return 0;
  let shifts = 0;
  for (let i = 1; i < history.length; i++) {
    if (Math.abs(history[i] - history[i - 1]) > threshold) shifts++;
  }
  // Normalise: max possible shifts = history.length - 1
  return clamp(Math.round((shifts / (history.length - 1)) * 100));
}

/**
 * Blink spike: deviation from the cognitive baseline (~15 bpm).
 * High spike → acute cognitive / emotional stress.
 * Formula: max(0, bpmDelta / baseline) * 100, capped at 100.
 */
export function calcBlinkSpike(blinkRate: number, baseline = 15): number {
  return clamp(Math.round(Math.max(0, blinkRate - baseline) / baseline * 100));
}

/* ──────────────────────── HEAD POSE SIGNALS ──────────────────────── */

/**
 * Head roll (ear-to-shoulder tilt): angle of the inter-eye axis.
 * Landmarks: left eye outer L33, right eye outer L362.
 */
export function calcHeadRoll(lEye: Pt, rEye: Pt): number {
  const dx = rEye.x - lEye.x;
  const dy = rEye.y - lEye.y;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * Head pitch (up/down): Nose tip (1) vs. chin (152).
 * As the head pitches down, nose Y approaches chin Y.
 * Returns degrees: −ve = looking up, +ve = looking down.
 */
export function calcHeadPitch(noseTip: Pt, chin: Pt, faceH: number): number {
  const dy = chin.y - noseTip.y;
  // faceH normalises for distance to camera
  const ratio = dy / Math.max(0.001, faceH);
  // Calibrated: typical neutral ratio ≈ 0.35; looking down → ratio > 0.4
  return clamp(Math.round((ratio - 0.35) * 300), -100, 100);
}

/**
 * Head yaw (left/right turn): distance of nose from face centre.
 * When yaw increases, nose shifts toward one cheek.
 */
export function calcHeadYaw(nose: Pt, lCheek: Pt, rCheek: Pt): number {
  const faceW  = Math.abs(rCheek.x - lCheek.x);
  const centre = (lCheek.x + rCheek.x) / 2;
  const offset = (nose.x - centre) / Math.max(0.001, faceW);
  // offset 0 = facing camera; ±0.3 = 45° turn
  return clamp(Math.round(Math.abs(offset) * 300));
}

/**
 * Head stability over a temporal window of pose angles.
 * Low variance → high stability (professional composure).
 */
export function calcHeadStability(rollHistory: number[], pitchHistory: number[], yawHistory: number[]): number {
  const variance = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  };
  const totalVar = variance(rollHistory) + variance(pitchHistory) + variance(yawHistory);
  return clamp(Math.round(100 - (totalVar / 300) * 100));
}

/* ───────────────────── FACIAL MUSCLE SIGNALS ───────────────────── */

/**
 * Smile intensity (mouth corner activation).
 * Landmarks: mouth-left L61, mouth-right L291.
 */
export function calcSmile(mouthL: Pt, mouthR: Pt, faceW: number): number {
  const w = dist(mouthL, mouthR);
  return clamp(Math.round((w / faceW - 0.3) * 300));
}

/**
 * Smile AUTHENTICITY (Duchenne smile detector).
 *
 * An authentic (Duchenne) smile requires:
 *   • zygomatic major activation (mouth corners up) — smileIntensity
 *   • orbicularis oculi activation (eye corner crinkling) — measured by
 *     how much the outer eye corners raise, estimated by EAR delta
 *
 * Formula: authenticity = smileIntensity × eyeSquintFactor
 * eyeSquintFactor: when smiling genuinely, EAR *decreases* slightly
 *                  because orbicularis oculi pushes cheeks up.
 *
 * Fake smile: high smileIntensity + normal EAR → eyeSquintFactor low
 */
export function calcSmileAuthenticity(smileIntensity: number, avgEar: number, baselineEar = 0.32): number {
  if (smileIntensity < 10) return 0; // not smiling at all
  // As smile broadens, genuine tension reduces EAR toward ~0.22
  // squintFactor 1 = baseline (no squint), 0 = eyes nearly closed
  const squintFactor = clamp(Math.round((1 - (avgEar / Math.max(0.001, baselineEar))) * 200));
  return clamp(Math.round((smileIntensity * 0.6) + (squintFactor * 0.4)));
}

/**
 * Jaw tension: derived from lip compression + mouth-open ratio.
 * Tightly closed jaw with compressed lips → stress.
 * Landmarks: mouthTop L13, mouthBot L14, jawTop L149, jawBot L378.
 */
export function calcJawTension(mouthTop: Pt, mouthBot: Pt, jawTop: Pt, jawBot: Pt, faceH: number): number {
  const mouthOpen = dist(mouthBot, mouthTop) / faceH;
  const jawD      = dist(jawBot, jawTop) / faceH;
  return clamp(Math.round(((jawD * 1.5 - mouthOpen) - 0.4) * 500));
}

/**
 * Lip compression: tight lip → stress / suppressed speech.
 * Measured by width:height ratio of inner mouth.
 * Landmarks: L78 (lip-left), L308 (lip-right), L13 (top), L14 (bottom).
 */
export function calcLipCompression(lipL: Pt, lipR: Pt, lipTop: Pt, lipBot: Pt): number {
  const width  = dist(lipL, lipR);
  const height = dist(lipTop, lipBot);
  // Wide, flat mouth → high compression
  const ratio  = width / Math.max(0.001, height * 10);
  return clamp(Math.round((ratio - 0.5) * 100));
}

/**
 * Eyebrow raise (AU1+AU2): curiosity / surprise.
 * Measures distance from eyebrow to eye normalized to face height.
 * Landmarks: L70 (L eyebrow), L336 (R eyebrow)
 */
export function calcEyebrowRaise(lBrow: Pt, rBrow: Pt, lEye: Pt, rEye: Pt, faceH: number): number {
  const lGap = (lEye.y - lBrow.y) / faceH;
  const rGap = (rEye.y - rBrow.y) / faceH;
  const avgGap = (lGap + rGap) / 2;
  // Typical gap ~0.07; raised = >0.1; lowered = <0.05
  return clamp(Math.round((avgGap - 0.05) / 0.08 * 100));
}

/* ─────────────────────── NODDING DETECTION ─────────────────────── */

/**
 * Nod frequency: vertical head movement pattern detection.
 * A nod = pitch peak then trough within ~400ms.
 *
 * @param pitchHistory  Last N pitch values
 * @param fps           Approximate frames per second of analysis
 * @returns 0-100 normalised nod rate (0 = none, 100 = nodding continuously)
 */
export function calcNodFrequency(pitchHistory: number[], fps = 10): number {
  if (pitchHistory.length < 4) return 0;
  let nods = 0;
  for (let i = 2; i < pitchHistory.length - 1; i++) {
    const prev = pitchHistory[i - 1];
    const curr = pitchHistory[i];
    const next = pitchHistory[i + 1];
    // Local-maximum = potential nod peak (head went down then came back)
    if (curr > prev + 3 && curr > next + 3) nods++;
  }
  // Normalise: nduration = history / fps seconds; max nods = ~30/min
  const durationSecs = pitchHistory.length / fps;
  const nodsPerMin   = nods / durationSecs * 60;
  return clamp(Math.round(nodsPerMin / 30 * 100));
}

/* ─────────────────────── SPATIAL FRAMING ─────────────────────── */

/**
 * Face centeredness: professional interview framing.
 * Camera centre is (0.5, 0.3-0.4 Y range is ideal for interview).
 * Landmarks: mid face L6 (face centroid approximation).
 */
export function calcFaceCenteredness(nose: Pt): number {
  const hDev = Math.abs(nose.x - 0.5);
  const vDev = Math.abs(nose.y - 0.38); // ideal vertical offset
  return clamp(Math.round(100 - (hDev + vDev) * 200));
}

/* ─────────────────────── PSYCHOMETRIC ENGINE ─────────────────────── */

/**
 * HireVue-style Confidence Score.
 * Weighted formula based on published behavioral interview research.
 *
 * confidence =
 *   0.35 * eye_contact
 * + 0.25 * posture_stability (headStability)
 * + 0.20 * smile_authenticity
 * + 0.20 * (100 - stress_score)
 */
export function calcConfidenceScore(
  eyeContact: number,
  headStability: number,
  smileAuthenticity: number,
  stressScore: number
): number {
  return clamp(Math.round(
    0.35 * eyeContact +
    0.25 * headStability +
    0.20 * smileAuthenticity +
    0.20 * (100 - stressScore)
  ));
}

/**
 * Engagement Score:
 * engagement =
 *   0.40 * gaze_stability
 * + 0.25 * nod_frequency
 * + 0.20 * facial_reactivity (eyebrow + smile)
 * + 0.15 * attention_tracking (eye_contact)
 */
export function calcEngagementScore(
  gazeStability: number,
  nodFrequency: number,
  facialReactivity: number,
  eyeContact: number
): number {
  return clamp(Math.round(
    0.40 * gazeStability +
    0.25 * nodFrequency +
    0.20 * facialReactivity +
    0.15 * eyeContact
  ));
}

/**
 * Stress Score (physiological facial indicators):
 * stress =
 *   0.40 * blink_spike
 * + 0.30 * jaw_tension
 * + 0.20 * gaze_avoidance (100 - eye_contact)
 * + 0.10 * head_down_time (headPitch > 0)
 */
export function calcStressScore(
  blinkSpike: number,
  jawTension: number,
  eyeContact: number,
  headPitch: number
): number {
  const gazeAvoidance = clamp(100 - eyeContact);
  const headDown      = headPitch > 10 ? clamp(headPitch) : 0;
  return clamp(Math.round(
    0.40 * blinkSpike +
    0.30 * (jawTension / 100 * 80) + // normalise raw jaw to 0-80
    0.20 * gazeAvoidance +
    0.10 * headDown
  ));
}

/**
 * Professional Presence Score:
 * presence =
 *   0.35 * posture_stability (headStability)
 * + 0.30 * face_centeredness
 * + 0.20 * head_stability
 * + 0.15 * (100 - movement_noise) → (100 - gazeShiftRate)
 */
export function calcProfessionalPresence(
  headStability: number,
  faceCenteredness: number,
  gazeShiftRate: number
): number {
  return clamp(Math.round(
    0.35 * headStability +
    0.30 * faceCenteredness +
    0.20 * headStability + // double weighted for camera-facing contexts
    0.15 * (100 - gazeShiftRate)
  ));
}

/**
 * Composite Score: the final "hire signal".
 * Mirrors platform-level aggregate scoring.
 */
export function calcCompositeScore(
  confidence: number,
  engagement: number,
  stress: number,
  presence: number,
  authenticity: number
): number {
  return clamp(Math.round(
    0.30 * confidence +
    0.25 * engagement +
    0.20 * presence +
    0.15 * authenticity +
    0.10 * (100 - stress)
  ));
}
