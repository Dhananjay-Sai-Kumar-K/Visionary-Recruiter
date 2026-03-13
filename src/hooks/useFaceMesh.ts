import { useEffect, useRef, useState, MutableRefObject } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { getEyeAspectRatio, calcEyeContact, calcTilt, calcSmile, calcJawTension } from '../lib/biometrics';
import type { FaceMeshMetrics } from '../types/index';

export function useFaceMesh(
  videoRef: MutableRefObject<HTMLVideoElement | null>, 
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
  active: boolean
) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [metrics, setMetrics] = useState<FaceMeshMetrics>({
    eyeContact: 0,
    tilt: 0,
    smile: 0,
    blinkRate: 0,
    jawTension: 0,
    stress: 0
  });
  
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  
  // Rolling averages and trackers
  const eyeContactHistory = useRef<number[]>(new Array(60).fill(0));
  const eyeHistoryIdx = useRef<number>(0);
  const blinkCount = useRef<number>(0);
  const blinkStartTime = useRef<number>(Date.now());
  const wasBlinking = useRef<boolean>(false);
  const lastMetricsUpdate = useRef<number>(Date.now());
  const currentMetrics = useRef<FaceMeshMetrics>(metrics);

  useEffect(() => {
    let unmounted = false;
    async function loadModel() {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });
        
        if (!unmounted) {
          faceLandmarkerRef.current = landmarker;
          setIsLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load MediaPipe model:", err);
      }
    }
    loadModel();
    return () => {
      unmounted = true;
      faceLandmarkerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!active || !isLoaded || !videoRef.current) return;
    
    let lastVideoTime = -1;

    function renderLoop() {
      const video = videoRef.current;
      if (!video || !faceLandmarkerRef.current || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      
      const currentTime = performance.now();
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = faceLandmarkerRef.current.detectForVideo(video, currentTime);
        processResults(results);
      }
      
      rafRef.current = requestAnimationFrame(renderLoop);
    }
    
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, isLoaded]);

  function processResults(results: FaceLandmarkerResult) {
    if (!results.faceLandmarks || results.faceLandmarks.length === 0) return;
    
    const lm = results.faceLandmarks[0];
    const pt = (i: number) => ({ x: lm[i].x, y: lm[i].y });
    
    // Draw on canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        
        ctx.save();
        ctx.strokeStyle = `rgba(0,212,255,0.35)`;
        ctx.lineWidth = 1;

        // Left Eye
        ctx.beginPath();
        [33, 160, 158, 133, 153, 144, 33].forEach((idx, i) => {
          const p = pt(idx);
          i === 0 ? ctx.moveTo(p.x * W, p.y * H) : ctx.lineTo(p.x * W, p.y * H);
        });
        ctx.stroke();

        // Right Eye
        ctx.beginPath();
        [362, 385, 387, 263, 373, 380, 362].forEach((idx, i) => {
          const p = pt(idx);
          i === 0 ? ctx.moveTo(p.x * W, p.y * H) : ctx.lineTo(p.x * W, p.y * H);
        });
        ctx.stroke();

        // Nose bridge
        const noseP = pt(1);
        ctx.fillStyle = `rgba(0,212,255,0.6)`;
        ctx.beginPath();
        ctx.arc(noseP.x * W, noseP.y * H, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    
    // 1. Eye Contact
    const nose = pt(1);
    const lCheek = pt(234);
    const rCheek = pt(454);
    const rawEye = calcEyeContact(nose, lCheek, rCheek, pt(33).y, pt(362).y);
    
    const hist = eyeContactHistory.current;
    const idx = eyeHistoryIdx.current;
    hist[idx % hist.length] = rawEye;
    eyeHistoryIdx.current++;
    const avgEye = Math.round(hist.reduce((a, b) => a + b, 0) / hist.length);
    
    // 2. Head Tilt
    const rawTilt = calcTilt(pt(33), pt(362));
    
    // 3. Smile
    const faceW = Math.abs(pt(454).x - pt(234).x);
    const rawSmile = calcSmile(pt(61), pt(291), faceW);
    
    // 4. Blinks
    const lEar = getEyeAspectRatio([pt(33), pt(160), pt(158), pt(133), pt(153), pt(144)]);
    const rEar = getEyeAspectRatio([pt(362), pt(385), pt(387), pt(263), pt(373), pt(380)]);
    const avgEar = (lEar + rEar) / 2;
    
    const isBlinkingNow = avgEar < 0.22;
    if (isBlinkingNow && !wasBlinking.current) {
      blinkCount.current++;
    }
    wasBlinking.current = isBlinkingNow;
    
    const now = Date.now();
    const elapsedMinutes = (now - blinkStartTime.current) / 60000;
    const rate = elapsedMinutes > 0 ? Math.round(blinkCount.current / elapsedMinutes) : 0;
    
    // 5. Jaw
    const faceH = Math.abs(pt(152).y - pt(10).y);
    const rawJaw = calcJawTension(pt(13), pt(14), pt(149), pt(378), faceH);
    
    // 6. Stress
    const isHighBlink = rate > 25 ? (rate - 25) * 2 : 0;
    const isTense = rawJaw > 30 ? rawJaw : 0;
    const isFrowning = rawSmile < 10 ? 10 : 0;
    const isErratic = Math.abs(rawTilt) > 15 ? 20 : 0;
    const rawStress = Math.min(100, isHighBlink + (isTense * 0.5) + isFrowning + isErratic);
    
    currentMetrics.current = {
      eyeContact: avgEye,
      tilt: rawTilt,
      smile: rawSmile,
      blinkRate: rate,
      jawTension: rawJaw,
      stress: Math.round((currentMetrics.current.stress * 4 + rawStress) / 5) // Smooth stress
    };
    
    // Throttle React state updates to ~2fps
    if (now - lastMetricsUpdate.current > 500) {
      setMetrics({ ...currentMetrics.current });
      lastMetricsUpdate.current = now;
    }
  }

  return { isLoaded, metrics };
}
