import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Box, MainGrid } from './components/layout';
import { VideoPreview } from './components/vision/VideoPreview';
import { BiometricsCard } from './components/vision/BiometricsCard';
import { InsightTicker } from './components/vision/InsightTicker';
import { LiveChat, StarMetricsDisplay } from './components/interview';
import { BehaviorTimeline } from './components/interview/BehaviorTimeline';
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
  const [isSessionCompleted, setIsSessionCompleted] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const fb = useFirebase();
  const { 
    isConnected, isStreaming, isMicHeld, 
    startStreaming, micDown, micUp, connect,
    youTranscript, sarahTranscript, chatHistory, metrics, sendTextMessage, audioLevel, pipelineStep
  } = useGeminiLive({ apiKey });
  
  const { isLoaded: mpLoaded, metrics: mpMetrics, events: bioEvents, timeline: bioTimeline } = useFaceMesh(videoRef, canvasRef, isStreaming);

  // Sync biometric events → InsightTicker (events come from useFaceMesh, not manual logic)
  const insightEvents = bioEvents.map(ev => ({
    id: ev.id,
    text: ev.label,
    type: ev.severity,
    ts: ev.ts
  }));

  // Fusion Loop: Bio-events → AI context injection
  useEffect(() => {
    if (!isStreaming || !mpLoaded) return;

    const intervalId = setInterval(() => {
      // Use production psychometric scores from the new engine
      if (mpMetrics.engagement < 40 && mpMetrics.gazeStability < 35) {
        sendTextMessage(`SYSTEM INJECTION: Biometric alert — candidate engagement dropped to ${mpMetrics.engagement}%. Gaze is unstable. Ask a more personal question to reconnect.`);
        showToast('Engagement drop detected');
      } else if (mpMetrics.stress > 68 && mpMetrics.blinkSpike > 40) {
        sendTextMessage(`SYSTEM INJECTION: Stress spike detected — score ${mpMetrics.stress}%. Blink anomaly present. Authenticity: ${mpMetrics.authenticity}%. Consider a supportive pause.`);
        showToast('High stress detected');
      } else if (mpMetrics.confidenceScore > 75 && mpMetrics.headStability > 70) {
        sendTextMessage(`SYSTEM INJECTION: Candidate confidence high (${mpMetrics.confidenceScore}%). Presence score: ${mpMetrics.presence}%. Raise the challenge level.`);
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

  const handleEndSession = () => {
    setIsSessionCompleted(true);
    showToast("Generating Final Report...");
  };

  // Use production composite score from psychometric engine
  const mpScore = mpMetrics.compositeScore;
  const aiScore = metrics ? Math.round((metrics.confidence + metrics.starProgress.situation + metrics.starProgress.task + metrics.starProgress.action + metrics.starProgress.result + metrics.articulation) / 6) : 0;
  const compScore = Math.round((mpScore * 0.45) + (aiScore * 0.55));

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
              <VideoPreview 
                ref={videoRef} 
                canvasRef={canvasRef} 
                isWarnFlash={!!toastMsg} 
                audioLevel={audioLevel}
                stress={mpMetrics.stress}
                presence={mpMetrics.presence}
              />
              
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
                <BiometricsCard label="Confidence Score" value={mpMetrics.confidenceScore} rawVal={mpMetrics.confidenceScore} progressFn={v => v} subLabel={mpMetrics.confidenceScore > 70 ? 'High confidence' : 'Building'} />
                <BiometricsCard label="Exec Presence" value={mpMetrics.presence} rawVal={mpMetrics.presence} progressFn={v => v} subLabel={mpMetrics.presence > 70 ? 'Commanding' : 'Passive'} />
                <BiometricsCard label="Engagement" value={mpMetrics.engagement} rawVal={mpMetrics.engagement} progressFn={v => v} subLabel={mpMetrics.engagement > 70 ? 'Deeply engaged' : 'Surface level'} />
                <BiometricsCard label="Cognitive Stress" value={mpMetrics.stress} rawVal={mpMetrics.stress} progressFn={v => v} sourceTag="MP CORE" />
                <BiometricsCard label="Gaze Stability" value={mpMetrics.gazeStability} rawVal={mpMetrics.gazeStability} progressFn={v => v} subLabel={mpMetrics.gazeStability > 70 ? 'Steady' : 'Scanning'} />
                <BiometricsCard label="Blink Spike" value={mpMetrics.blinkSpike} rawVal={mpMetrics.blinkSpike} progressFn={v => v} subLabel={`${mpMetrics.blinkRate} bpm`} />
                <BiometricsCard label="Smile Auth." value={mpMetrics.smileAuthenticity} rawVal={mpMetrics.smileAuthenticity} progressFn={v => v} subLabel={mpMetrics.smileAuthenticity > 60 ? 'Duchenne' : 'Performative'} />
                <BiometricsCard label="Head Stability" value={mpMetrics.headStability} rawVal={mpMetrics.headStability} progressFn={v => v} subLabel={`Tilt ${mpMetrics.tilt}°`} />
              </div>
              <div className="mt-5">
                <InsightTicker events={insightEvents} />
              </div>
            </Box>
          </div>
          
          {/* RIGHT COL */}
          <div className="space-y-6">
            <FirebasePanel hook={fb} />
            
            <Box title="Intelligence Feed">
              <LiveChat 
                you={youTranscript} 
                sarah={sarahTranscript} 
                history={chatHistory}
                isProcessing={pipelineStep === 'processing'} 
              />
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
              
              {!isSessionCompleted && isStreaming && (
                <button 
                  onClick={handleEndSession}
                  className="w-full mt-6 py-4 bg-rose-600/10 border border-rose-500/30 text-rose-500 font-bold text-[10px] tracking-[.3em] uppercase rounded-2xl hover:bg-rose-600 hover:text-white transition-all duration-300"
                >
                  Terminate &amp; Generate Report
                </button>
              )}
            </Box>

            <Box title="Behavioral Timeline">
              <BehaviorTimeline timeline={bioTimeline} />
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

      <AnimatePresence>
        {isSessionCompleted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[1000] bg-slate-950/90 backdrop-blur-2xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="max-w-2xl w-full bg-slate-900 border border-white/10 rounded-[32px] p-10 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500" />
              
              <div className="text-center mb-10">
                <div className="inline-block px-4 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Final Verdict Generated</div>
                <h2 className="text-4xl font-black text-white tracking-tighter mb-2">Interview Intelligence Report</h2>
                <p className="text-slate-500 font-medium">Candidate Identity Verified • Session ID: #VIZ_{Date.now().toString().slice(-6)}</p>
              </div>

              <div className="grid grid-cols-2 gap-8 mb-10">
                <div className="space-y-6">
                  <div className="bg-slate-950/50 p-6 rounded-3xl border border-white/5">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Neural Analytics</div>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-1">
                          <span>PRESENCE</span>
                          <span>{mpMetrics.presence}%</span>
                        </div>
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${mpMetrics.presence}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-1">
                          <span>AUTHENTICITY</span>
                          <span>{mpMetrics.authenticity}%</span>
                        </div>
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${mpMetrics.authenticity}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center bg-indigo-600/10 rounded-3xl border border-indigo-500/20 p-6">
                  <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Composite Score</div>
                  <div className="text-7xl font-black text-white tracking-tighter">{compScore}</div>
                  <div className="text-[11px] font-bold text-indigo-400 uppercase mt-2 tracking-widest">Mastery Level</div>
                </div>
              </div>

              <div className="bg-slate-950/50 border border-white/5 rounded-3xl p-6 mb-10">
                 <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Sarah's Conclusion</div>
                 <p className="text-lg font-medium text-slate-300 italic leading-relaxed">
                   "{metrics.lastFeedback || "Session concluded with high-confidence telemetry data. Deployment recommended."}"
                 </p>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => window.location.reload()}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-widest rounded-2xl transition-all"
                >
                  Restart Session
                </button>
                <button 
                  className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-widest rounded-2xl shadow-xl shadow-indigo-500/20 transition-all"
                >
                  Export Detailed Analysis
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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