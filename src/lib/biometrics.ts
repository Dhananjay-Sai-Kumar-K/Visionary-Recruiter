export function getEyeAspectRatio(eye: { x: number; y: number }[]): number {
  if (!eye || eye.length < 6) return 0;
  
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  // EAR = (|p2-p6| + |p3-p5|) / (2*|p1-p4|)
  /*
  Left eye: 33,160,158,133,153,144
  Right eye: 362,385,387,263,373,380
  */
  const v1 = dist(eye[1], eye[5]);
  const v2 = dist(eye[2], eye[4]);
  const h = dist(eye[0], eye[3]);

  return h < 0.001 ? 0 : (v1 + v2) / (2 * h);
}

export function calcEyeContact(
  nose: { x: number; y: number },
  lCheek: { x: number; y: number },
  rCheek: { x: number; y: number },
  leftEyeCenterY: number,
  rightEyeCenterY: number
): number {
  const faceW = Math.abs(rCheek.x - lCheek.x);
  const faceCenterX = (lCheek.x + rCheek.x) / 2;

  // Horizontal deviation from camera center (0.5)
  const hDev = Math.abs(faceCenterX - 0.5) / Math.max(0.001, faceW);
  
  // Vertical: nose y relative to eyes midpoint
  const eyeMidY = (leftEyeCenterY + rightEyeCenterY) / 2;
  const vDev = Math.abs(nose.y - eyeMidY - 0.08) / 0.15; // calibrated offset

  const rawEyeContact = Math.max(
    0,
    Math.min(100, Math.round((1 - Math.sqrt(hDev * hDev + vDev * vDev) * 1.5) * 100))
  );

  return rawEyeContact;
}

export function calcTilt(leftEye: { x: number; y: number }, rightEye: { x: number; y: number }): number {
  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}

export function calcSmile(mouthL: { x: number; y: number }, mouthR: { x: number; y: number }, faceW: number): number {
  const w = Math.hypot(mouthR.x - mouthL.x, mouthR.y - mouthL.y);
  return Math.min(100, Math.max(0, Math.round((w / faceW - 0.3) * 300)));
}

export function calcJawTension(
  mouthTop: { x: number; y: number },
  mouthBot: { x: number; y: number },
  jawTop: { x: number; y: number },
  jawBot: { x: number; y: number },
  faceH: number
): number {
  const mouthOpen = Math.hypot(mouthBot.x - mouthTop.x, mouthBot.y - mouthTop.y) / faceH;
  const jawD = Math.hypot(jawBot.x - jawTop.x, jawBot.y - jawTop.y) / faceH;
  
  const rawJaw = Math.max(0, Math.min(100, Math.round(((jawD * 1.5 - mouthOpen) - 0.4) * 500)));
  return rawJaw;
}
