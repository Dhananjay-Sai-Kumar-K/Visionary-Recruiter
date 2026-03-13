import { useRef, useState, useEffect } from 'react';
import { Header, Box, MainGrid } from './components/layout';
import { VideoPreview } from './components/vision/VideoPreview';
import { BiometricsCard } from './components/vision/BiometricsCard';
import { LiveChat, StarMetricsDisplay } from './components/interview';
import { FirebasePanel } from './components/setup';
import { useFaceMesh } from './hooks/useFaceMesh';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useFirebase } from './hooks/useFirebase';
import { cn } from './lib/utils';
import './index.css';

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [scanInterval, setScanInterval] = useState(5);
  const [toastMsg, setToastMsg] = useState('');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const fb = useFirebase();
  const { 
    isConnected, isStreaming, isMicHeld, 
    startStreaming, micDown, micUp, connect,
    youTranscript, sarahTranscript, metrics, sendTextMessage
  } = useGeminiLive({ apiKey });
  
  const { isLoaded: mpLoaded, metrics: mpMetrics } = useFaceMesh(videoRef, canvasRef, isStreaming);

  // Fusion Loop: MediaPipe talks to Gemini
  useEffect(() => {
    if (!isStreaming || !mpLoaded) return;

    const intervalId = setInterval(() => {
      // Periodic check based on scanInterval
      if (mpMetrics.eyeContact < 40) {
        sendTextMessage("SYSTEM INJECTION: The candidate is looking away from the camera. Politely remind them that eye contact is important for engagement before asking your next question.");
        showToast("Look into the camera!");
      } else if (mpMetrics.stress > 80) {
        sendTextMessage("SYSTEM INJECTION: The candidate's biometrics show high stress (rapid blinking, jaw tension). Offer a brief word of encouragement to calm them down.");
        showToast("Breathe and relax.");
      }
    }, scanInterval * 1000);

    return () => clearInterval(intervalId);
  }, [isStreaming, mpLoaded, mpMetrics, scanInterval, sendTextMessage]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const handleConnect = (key: string) => {
    setApiKey(key);
    connect(key);
  };

  const mpScore = Math.max(0, 100 - (100 - mpMetrics.eyeContact) - mpMetrics.stress - (Math.abs(mpMetrics.tilt) > 15 ? 10 : 0));
  const aiScore = metrics ? Math.round((metrics.confidence + metrics.starProgress.situation + metrics.starProgress.task + metrics.starProgress.action + metrics.starProgress.result + metrics.articulation) / 6) : 0;
  const compScore = Math.round((mpScore * 0.4) + (aiScore * 0.6));

  return (
    <div className="font-sans bg-[#020617] text-slate-200 p-6 min-h-screen relative overflow-x-hidden selection:bg-indigo-500/30">
      <div className="absolute inset-0 pointer-events-none z-[-1] opacity-20 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:40px_40px]"></div>
      
      <div className="max-w-[1280px] mx-auto pb-24">
        <Header mpLoaded={mpLoaded} />
        
        <Box title="System Authentication" className="mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <input 
              type="password" 
              value={apiKey} 
              onChange={e => setApiKey(e.target.value)} 
              placeholder="Enter your Gemini API Key" 
              className="input-field flex-1 min-w-[240px]"
            />
            <button 
              onClick={() => handleConnect(apiKey)} 
              className="btn-primary"
            >
              1. Initialize AI
            </button>
            <button 
              onClick={() => startStreaming(videoRef.current)} 
              disabled={!isConnected || isStreaming}
              className="btn-outline disabled:opacity-30"
            >
              2. Mount Media
            </button>
            <div className="flex items-center gap-3 ml-4 bg-slate-950/50 px-4 py-2 rounded-full border border-slate-800">
              <div className={cn("w-2 h-2 rounded-full", isConnected ? isStreaming ? "bg-amber-500 animate-pulse" : "bg-emerald-500" : "bg-rose-500")} />
              <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                {!isConnected ? "Idle" : !isStreaming ? "System Ready" : "Live Stream"}
              </span>
            </div>
          </div>
        </Box>
        
        <MainGrid>
          {/* LEFT COL */}
          <div className="space-y-6">
            <Box title="Visual Intelligence">
              <VideoPreview ref={videoRef} canvasRef={canvasRef} isWarnFlash={!!toastMsg} />
              
              <div className="flex items-center gap-4 mt-6">
                <button
                  onMouseDown={micDown}
                  onMouseUp={micUp}
                  onMouseLeave={micUp}
                  onTouchStart={micDown}
                  onTouchEnd={micUp}
                  className={cn(
                    "w-24 h-24 rounded-3xl border-2 border-indigo-500/30 bg-indigo-500/5 text-indigo-400 font-bold text-[10px] tracking-widest uppercase transition-all duration-300 active:scale-90",
                    isMicHeld && "bg-indigo-600 text-white border-indigo-500 scale-105 shadow-2xl shadow-indigo-500/40"
                  )}
                >
                  Hold to<br/>Interact
                </button>
                <div className="flex-1 space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <span>Sampling Rate</span>
                      <span className="text-indigo-400">{scanInterval}s</span>
                    </div>
                    <input 
                      type="range" 
                      min="3" max="15" step="1" 
                      value={scanInterval} 
                      onChange={e => setScanInterval(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/50">
                      <div className="text-[9px] text-slate-500 font-bold uppercase mb-1">Latency</div>
                      <div className="text-xs text-white font-mono">14ms</div>
                    </div>
                    <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/50">
                      <div className="text-[9px] text-slate-500 font-bold uppercase mb-1">Blinks</div>
                      <div className="text-xs text-white font-mono">{mpMetrics.blinkRate}<span className="text-[10px] text-slate-500 ml-1">/min</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </Box>
            
            <Box title="Neural Biometrics">
              <div className="grid grid-cols-2 gap-3 mt-1">
                <BiometricsCard isEyeContact label="Visual Engagement" value={mpMetrics.eyeContact} rawVal={mpMetrics.eyeContact} subLabel={mpMetrics.eyeContact > 70 ? "High Focus" : "Reduced Attention"} />
                <BiometricsCard label="Head Geometry" value={`${Math.abs(mpMetrics.tilt)}°`} rawVal={Math.abs(mpMetrics.tilt)} progressFn={v => Math.min(100, v*2)} subLabel={mpMetrics.tilt < 0 ? "Offset Left" : "Offset Right"} />
                <BiometricsCard label="Affect Score" value={mpMetrics.smile} rawVal={mpMetrics.smile} progressFn={v => v} subLabel="Neutral Positivity" />
                <BiometricsCard label="Ocular Cycle" value={mpMetrics.blinkRate} rawVal={mpMetrics.blinkRate} progressFn={v => Math.min(100, v*3)} subLabel="Normal Frequency" />
                <BiometricsCard label="Jaw Tension" value={mpMetrics.jawTension} rawVal={mpMetrics.jawTension} progressFn={v => v} subLabel="Micro-muscle Stress" />
                <BiometricsCard label="Cognitive Stress" value={mpMetrics.stress} rawVal={mpMetrics.stress} progressFn={v => v} sourceTag="MP CORE" />
              </div>
            </Box>
          </div>
          
          {/* RIGHT COL */}
          <div className="space-y-6">
            <FirebasePanel hook={fb} />
            
            <Box title="Intelligence Feed">
              <LiveChat you={youTranscript} sarah={sarahTranscript} />
            </Box>
            
            <Box title="Performance Evaluation">
              <StarMetricsDisplay metrics={{
                confidence: metrics.confidence,
                star_situation: metrics.starProgress.situation,
                star_task: metrics.starProgress.task,
                star_action: metrics.starProgress.action,
                star_result: metrics.starProgress.result,
                articulation: metrics.articulation,
                feedback: metrics.lastFeedback
              }} />
            </Box>
            
            <Box title="Fused Aggregate Score">
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-slate-950/50 border border-slate-800 p-4 rounded-2xl group transition-all hover:border-indigo-500/30 text-center">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Manual Signal</div>
                  <div className="text-3xl font-black text-white">{mpScore === 100 && mpMetrics.eyeContact === 0 ? "--" : mpScore}</div>
                </div>
                <div className="bg-slate-950/50 border border-slate-800 p-4 rounded-2xl group transition-all hover:border-violet-500/30 text-center">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Neural Signal</div>
                  <div className="text-3xl font-black text-white">{aiScore || "--"}</div>
                </div>
                <div className="bg-indigo-600/10 border border-indigo-500/30 p-4 rounded-2xl text-center shadow-lg shadow-indigo-500/5">
                  <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2 font-mono">Composite</div>
                  <div className="text-4xl font-black text-white">{compScore || "--"}</div>
                </div>
              </div>
            </Box>
          </div>
        </MainGrid>
      </div>

      <div className={cn(
        "fixed bottom-8 right-8 translate-y-[100px] bg-rose-600 text-white px-6 py-3 rounded-2xl font-semibold text-sm shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex items-center gap-3 z-[9999]",
        toastMsg && "translate-y-0"
      )}>
        <span className="w-5 h-5 flex items-center justify-center bg-white/20 rounded-full text-[10px]">!</span>
        {toastMsg}
      </div>
    </div>
  );
}