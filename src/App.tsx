import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Video, Brain, Sparkles, Trophy, Target, ChevronRight, Settings, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { useGeminiLive } from './hooks/useGeminiLive';

function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
  const [showSettings, setShowSettings] = useState(!import.meta.env.VITE_GEMINI_API_KEY);

  const videoRef = useRef<HTMLVideoElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);

  const systemInstruction =
    "You are Sarah, a Senior Recruiter doing a mock interview using the STAR method. " +
    "Introduce yourself briefly, then ask one STAR question at a time. Keep responses to 2-3 sentences. " +
    "Notice non-verbal cues from the video feed and comment if the candidate looks nervous or unprofessional. " +
    "CRITICAL: After every candidate response, always call update_interview_metrics with scores 0-100 for each dimension. Never skip this call.";

  const {
    isConnected,
    isStreaming,
    isMicHeld,
    isSpeaking,
    audioLevel,
    analyserRef,
    youTranscript,
    sarahTranscript,
    metrics,
    stream,
    connect,
    disconnect,
    startStreaming,
    micDown,
    micUp,
  } = useGeminiLive({ apiKey, systemInstruction });

  /* ── Connect as soon as the session starts ── */
  useEffect(() => {
    if (isStarted && !isConnected) {
      connect();
    }
  }, [isStarted, isConnected, connect]);

  /* ── Start camera + mic as soon as the WS is connected ── */
  useEffect(() => {
    if (isConnected && !isStreaming) {
      startStreaming(videoRef.current);
    }
  }, [isConnected, isStreaming, startStreaming]);

  /* ── Keep video element in sync with media stream ── */
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  /* ── Waveform canvas animation (from test.html AudioLens engine) ── */
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;

    const analyser = analyserRef.current;

    // Draw a flat idle line when not streaming
    if (!analyser || !isStreaming) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = canvas.offsetWidth || 280;
        canvas.height = canvas.offsetHeight || 56;
        ctx.fillStyle = 'rgba(10,10,15,0.95)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#2d2d3a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }
      return;
    }

    const buf = new Uint8Array(analyser.frequencyBinCount);
    let animId: number;

    const draw = () => {
      animId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      canvas.width = canvas.offsetWidth || 280;
      canvas.height = canvas.offsetHeight || 56;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(10,10,15,0.95)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Green when speaking, violet when silent — same as test.html
      const color = isMicHeld ? '#22c55e' : '#7c3aed';
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const sliceW = canvas.width / buf.length;
      let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] / 128;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, [isStreaming, isMicHeld, analyserRef]);

  const handleEndSession = () => {
    disconnect();
    setIsStarted(false);
    setShowSummary(true);
  };

  const readinessScore = Math.round(
    (metrics.confidence * 0.2) +
    ((metrics.starProgress.situation + metrics.starProgress.task + metrics.starProgress.action + metrics.starProgress.result) / 4 * 0.6) +
    (metrics.articulation * 0.2)
  );

  return (
    <div className="min-h-screen bg-mesh text-foreground overflow-hidden">

      {/* ── Navigation ── */}
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex items-center justify-between glass border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Brain className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight">Visionary Recruiter</span>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors text-muted-foreground"
          >
            <Settings size={20} />
          </button>
          {!isStarted && (
            <button className="text-sm font-semibold bg-white/10 hover:bg-white/15 px-4 py-2 rounded-lg transition-all border border-white/10">
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* ── Settings Modal ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass p-8 rounded-3xl max-w-md w-full border-white/20 shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Settings className="text-primary" />
                API Configuration
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your <span className="text-primary font-medium">Gemini API Key</span> to enable the live interview experience.
                Your key is stored locally and never sent to our servers.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 block">
                    Gemini API Key
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all font-mono text-sm"
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => setShowSettings(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-bold bg-white/5 hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-bold bg-primary text-white hover:opacity-90 transition-all shadow-lg shadow-primary/20"
                >
                  Save Config
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pt-24 pb-12 px-6">
        <AnimatePresence mode="wait">

          {/* ══════════════════ SUMMARY ══════════════════ */}
          {showSummary ? (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto glass p-12 rounded-[3rem] border-white/20 shadow-2xl text-center bg-gradient-to-b from-primary/5 to-transparent"
            >
              <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-8">
                <Trophy className="text-primary w-10 h-10" />
              </div>

              <h2 className="text-4xl font-bold mb-4">Interview Summary</h2>
              <p className="text-muted-foreground mb-12">Here is how you performed under pressure.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
                <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                  <div className="text-4xl font-black text-primary mb-2">{readinessScore}%</div>
                  <div className="text-[10px] font-black tracking-widest uppercase opacity-50">Readiness Score</div>
                </div>
                <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                  <div className="text-4xl font-black text-violet-400 mb-2">
                    {Math.round((metrics.starProgress.situation + metrics.starProgress.task + metrics.starProgress.action + metrics.starProgress.result) / 4)}%
                  </div>
                  <div className="text-[10px] font-black tracking-widest uppercase opacity-50">STAR Compliance</div>
                </div>
                <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                  <div className="text-4xl font-black text-fuchsia-400 mb-2">{metrics.confidence}%</div>
                  <div className="text-[10px] font-black tracking-widest uppercase opacity-50">Confidence Level</div>
                </div>
              </div>

              <div className="text-left glass p-8 rounded-3xl border-white/10 mb-12">
                <h3 className="font-bold mb-4 flex items-center gap-2">
                  <Sparkles className="text-primary" size={18} />
                  Final AI Feedback
                </h3>
                <p className="text-foreground/80 leading-relaxed italic">
                  "{metrics.lastFeedback || 'Your technical knowledge is solid. Focus on quantifying results in the STAR method for your next session.'}"
                </p>
              </div>

              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => setShowSummary(false)}
                  className="px-8 py-4 rounded-xl font-black tracking-widest uppercase text-xs border border-white/10 hover:bg-white/5 transition-all"
                >
                  Close Report
                </button>
                <button
                  onClick={() => { setShowSummary(false); setIsStarted(true); }}
                  className="btn-premium px-12"
                >
                  Re-Try Mock Interview
                </button>
              </div>
            </motion.div>

          ) : !isStarted ? (

            /* ══════════════════ HERO ══════════════════ */
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-6xl mx-auto flex flex-col items-center text-center pt-12"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black tracking-widest mb-6"
              >
                <Sparkles size={14} />
                GEMINI LIVE AGENT POWERED
              </motion.div>

              <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 max-w-4xl leading-[1.1]">
                Master Your Interviews in <span className="text-gradient">Real-Time</span>
              </h1>

              <p className="text-lg text-muted-foreground max-w-2xl mb-10 leading-relaxed">
                The world's first multimodal AI Recruiter that sees your confidence,
                hears your expertise, and coaches you to land your dream job.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-20">
                <button
                  onClick={() => apiKey ? setIsStarted(true) : setShowSettings(true)}
                  className="btn-premium flex items-center gap-2 group shadow-xl shadow-primary/20"
                >
                  Start Live Session
                  <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
                <button className="px-6 py-3 rounded-xl font-medium border border-white/10 hover:bg-white/5 transition-all">
                  Watch Demo
                </button>
              </div>

              {/* Feature Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
                {[
                  { icon: Mic, title: "Push-to-Talk", desc: "Hold the mic button to speak. Release to let Sarah process and respond instantly." },
                  { icon: Video, title: "Multimodal Vision", desc: "Analyzes eye contact, hand gestures, and professional demeanor while you speak." },
                  { icon: Trophy, title: "STAR Analysis", desc: "Real-time grading of your Situation, Task, Action, and Result structure." }
                ].map((feature, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + (i * 0.1) }}
                    className="glass p-8 rounded-3xl group hover:border-primary/50 transition-all cursor-default"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary/10 transition-all duration-500">
                      <feature.icon className="text-primary w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-xl mb-3 tracking-tight">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>

          ) : (

            /* ══════════════════ LIVE INTERFACE ══════════════════ */
            <motion.div
              key="interface"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-6xl mx-auto"
            >
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-[75vh]">

                {/* ── AI Recruiter Panel ── */}
                <div className="lg:col-span-3 glass-premium rounded-[2.5rem] relative overflow-hidden flex flex-col items-center justify-center p-12 border-white/10 shadow-[0_0_100px_rgba(139,92,246,0.1)]">
                  <div className="absolute top-8 left-8 flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest border border-red-500/30">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse outline outline-4 outline-red-500/20" />
                      Live Feed
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono bg-white/5 px-2 py-1 rounded border border-white/5 tracking-tighter shadow-sm">
                      {isConnected ? (isStreaming ? 'STREAMS_ACTIVE' : 'CONNECTED') : 'INITIALIZING...'}
                    </div>
                  </div>

                  {/* AI "Head" Representation */}
                  <div className="relative mb-8">
                    <div className="w-64 h-64 rounded-full bg-gradient-to-br from-primary/30 to-fuchsia-500/30 blur-[60px] animate-pulse-slow absolute -inset-8 opacity-50" />
                    <motion.div
                      animate={{
                        scale: isConnected ? [1, 1.02, 1] : 1,
                        rotate: isConnected ? [0, 1, -1, 0] : 0
                      }}
                      transition={{ duration: 4, repeat: Infinity }}
                      className="w-48 h-48 rounded-full glass border border-white/30 flex items-center justify-center relative bg-gradient-to-b from-white/10 to-transparent shadow-2xl z-10"
                    >
                      <Brain className="w-20 h-20 text-primary opacity-90 drop-shadow-[0_0_15px_rgba(139,92,246,0.5)]" />
                      {isConnected && (
                        <>
                          <motion.div
                            animate={{ scale: [1, 1.4], opacity: [0.5, 0] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute inset-0 border-2 border-primary rounded-full"
                          />
                          <motion.div
                            animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                            transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                            className="absolute inset-0 border-2 border-primary/50 rounded-full"
                          />
                        </>
                      )}
                    </motion.div>
                  </div>

                  <div className="text-center z-10 mb-6">
                    <h2 className="text-3xl font-bold mb-2 tracking-tight">Sarah</h2>
                    <p className="text-primary font-black text-[10px] tracking-[0.3em] uppercase opacity-80">Senior Recruiter @ Google</p>
                  </div>

                  {/* ── SARAH Speech Bubble ── */}
                  <div className="w-full max-w-2xl mb-4">
                    <AnimatePresence>
                      {sarahTranscript ? (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="px-8 py-5 rounded-3xl bg-white/5 border border-white/10 text-center relative"
                        >
                          <p className="text-lg leading-relaxed text-foreground font-medium italic">
                            "{sarahTranscript}"
                          </p>
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background px-3 py-1 rounded-full border border-white/10">
                            <div className="flex gap-1">
                              {[1, 2, 3].map(i => (
                                <div key={i} className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 100}ms` }} />
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="text-center text-muted-foreground text-sm animate-pulse tracking-widest font-mono py-4">
                          {isConnected ? 'WAITING FOR RESPONSE...' : 'INITIALIZING SARAH...'}
                        </div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* ── YOU Speech Bubble ── */}
                  <AnimatePresence>
                    {youTranscript && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="w-full max-w-2xl px-6 py-3 rounded-2xl bg-sky-900/40 border border-sky-500/30 text-sky-300 text-sm"
                      >
                        <span className="font-black text-sky-400 text-[10px] tracking-widest uppercase mr-2">YOU:</span>
                        {youTranscript}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── Sidebar ── */}
                <div className="flex flex-col gap-6">

                  {/* User Video Viewport */}
                  <div className="h-56 glass rounded-[2rem] relative overflow-hidden group shadow-xl border-white/10 bg-neutral-900">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover opacity-50 transition-opacity group-hover:opacity-70"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {!isStreaming && <Video className="text-white/20 w-10 h-10" />}
                    </div>
                    <div className="absolute bottom-5 left-5 right-5 flex justify-between items-end z-10">
                      <div>
                        <div className="text-[10px] font-black tracking-widest text-primary mb-1">CANDIDATE</div>
                        <div className="text-xs font-bold text-white uppercase">You</div>
                      </div>
                      <div className="flex gap-1.5 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        <motion.div
                          animate={{ scale: [1, 1.5], opacity: [1, 0] }}
                          transition={{ duration: 1, repeat: Infinity }}
                          className="w-1.5 h-1.5 rounded-full bg-primary absolute"
                        />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                      </div>
                    </div>
                  </div>

                  {/* ── Waveform + VAD Panel (from test.html AudioLens pipeline) ── */}
                  <AnimatePresence>
                    {isStreaming && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="glass rounded-2xl p-3 border-white/10 overflow-hidden"
                      >
                        {/* Header row: AUDIO INPUT label + VAD badge */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-black tracking-[0.2em] uppercase text-muted-foreground">AUDIO INPUT</span>
                          <span className={cn(
                            "text-[9px] font-black tracking-widest px-2 py-0.5 rounded border transition-all duration-200",
                            isSpeaking
                              ? "bg-green-500/20 text-green-400 border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.3)]"
                              : "bg-white/5 text-muted-foreground border-white/10"
                          )}>
                            {isSpeaking ? '● SPEAKING' : '○ SILENCE'}
                          </span>
                        </div>
                        {/* Waveform canvas */}
                        <div className="h-14 rounded-xl overflow-hidden border border-white/5 bg-black/60 mb-2">
                          <canvas ref={waveCanvasRef} className="w-full h-full" />
                        </div>
                        {/* Noise level bar */}
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <motion.div
                            animate={{ width: `${audioLevel}%` }}
                            transition={{ duration: 0.08, ease: 'linear' }}
                            className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ── Push-to-Talk Button ── */}
                  {isStreaming && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onMouseDown={micDown}
                      onMouseUp={micUp}
                      onMouseLeave={micUp}
                      onTouchStart={(e) => { e.preventDefault(); micDown(); }}
                      onTouchEnd={(e) => { e.preventDefault(); micUp(); }}
                      className={cn(
                        "w-full py-5 rounded-2xl font-black text-sm tracking-widest uppercase transition-all duration-150 select-none touch-manipulation border-2 flex items-center justify-center gap-3",
                        isMicHeld
                          ? "bg-green-500 border-green-400 text-white shadow-[0_0_30px_rgba(34,197,94,0.5)] scale-105"
                          : "bg-white/5 border-white/20 text-muted-foreground hover:border-primary/50 hover:text-primary"
                      )}
                    >
                      {isMicHeld ? (
                        <>
                          <Mic className="w-5 h-5 animate-pulse" />
                          Speaking…
                        </>
                      ) : (
                        <>
                          <MicOff className="w-5 h-5" />
                          Hold to Speak
                        </>
                      )}
                    </motion.button>
                  )}

                  {/* Real-time Analytics */}
                  <div className="flex-1 glass p-8 rounded-[2rem] flex flex-col gap-6 border-white/10 shadow-xl">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-black text-[10px] tracking-[0.2em] uppercase text-muted-foreground flex items-center gap-2">
                        <Target size={14} className="text-primary" />
                        LIVE ANALYTICS
                      </h3>
                      <AlertCircle size={14} className="text-muted-foreground/50" />
                    </div>

                    <div className="space-y-6">
                      {[
                        { label: "CONFIDENCE", val: metrics.confidence, color: "bg-cyan-400" },
                        { label: "ARTICULATION", val: metrics.articulation, color: "bg-fuchsia-400" }
                      ].map((metric) => (
                        <div key={metric.label}>
                          <div className="flex justify-between text-[10px] font-black tracking-tighter mb-2">
                            <span>{metric.label}</span>
                            <span className="text-foreground">{metric.val}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                            <motion.div
                              animate={{ width: `${metric.val}%` }}
                              transition={{ duration: 1, ease: "easeOut" }}
                              className={cn("h-full rounded-full shadow-[0_0_12px_rgba(0,0,0,0.5)]", metric.color)}
                            />
                          </div>
                        </div>
                      ))}

                      {/* STAR Breakdown */}
                      <div className="space-y-3">
                        <div className="text-[10px] font-black tracking-widest text-muted-foreground mb-4">STAR BREAKDOWN</div>
                        {[
                          { label: "SITU", val: metrics.starProgress.situation, color: "bg-violet-400" },
                          { label: "TASK", val: metrics.starProgress.task, color: "bg-violet-400" },
                          { label: "ACTN", val: metrics.starProgress.action, color: "bg-violet-400" },
                          { label: "RSLT", val: metrics.starProgress.result, color: "bg-violet-400" }
                        ].map((m) => (
                          <div key={m.label} className="flex items-center gap-3">
                            <span className="text-[8px] font-black w-8 text-muted-foreground">{m.label}</span>
                            <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                              <motion.div
                                animate={{ width: `${m.val}%` }}
                                className={cn("h-full rounded-full", m.color)}
                              />
                            </div>
                            <span className="text-[8px] font-mono text-foreground/50">{m.val}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Live Feedback */}
                    {metrics.lastFeedback && (
                      <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold italic"
                      >
                        Coach: "{metrics.lastFeedback}"
                      </motion.div>
                    )}

                    {/* Status + End Session */}
                    <div className="mt-auto pt-8 border-t border-white/5 space-y-4">
                      {/* Pipeline status — mirrors test.html pipeline bar */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[
                          { label: 'WS', active: isConnected },
                          { label: 'CAM', active: isStreaming },
                          { label: 'MIC', active: isStreaming },
                          { label: 'VAD', active: isSpeaking },
                          { label: 'GEMINI', active: isConnected && isStreaming },
                        ].map((step, i) => (
                          <div key={step.label} className="flex items-center gap-1">
                            <div className={cn(
                              "text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded border transition-all",
                              step.active
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : "bg-white/5 text-muted-foreground/40 border-white/5"
                            )}>
                              {step.label}
                            </div>
                            {i < 4 && <span className="text-muted-foreground/30 text-[8px]">→</span>}
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          isConnected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-yellow-500 animate-pulse"
                        )} />
                        <span className="text-[10px] font-bold tracking-tight text-foreground/80 lowercase">
                          {isConnected ? (isStreaming ? 'streams active' : 'connected') : 'establishing websocket...'}
                        </span>
                      </div>
                      <button
                        onClick={handleEndSession}
                        className="w-full py-4 rounded-xl bg-red-500/10 text-red-500 text-xs font-black tracking-widest uppercase border border-red-500/20 hover:bg-red-500 hover:text-white transition-all duration-300 active:scale-[0.98] shadow-lg shadow-red-500/5"
                      >
                        Terminate Session
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Decorative Gradients */}
      <div className="fixed top-1/4 -left-40 w-[500px] h-[500px] bg-primary/20 blur-[120px] rounded-full pointer-events-none opacity-40 animate-pulse-slow" />
      <div className="fixed bottom-1/4 -right-40 w-[500px] h-[500px] bg-fuchsia-500/20 blur-[120px] rounded-full pointer-events-none opacity-40 animate-pulse-slow" style={{ animationDelay: '1s' }} />
    </div>
  );
}

export default App;
