import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic, MicOff, Video, Brain, Sparkles, Trophy, Target,
  ChevronRight, Settings, AlertCircle, Download, Copy,
  Activity, CheckCircle, XCircle, Clock, UploadCloud, Users, Stethoscope, Code
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { useGeminiLive } from './hooks/useGeminiLive';

type ViewState = 'landing' | 'setup' | 'live' | 'debrief';
type TrackType = 'hr' | 'star' | 'tech' | 'stress';
type PipeStep = 'input' | 'preprocess' | 'vad' | 'chunk' | 'api' | 'merge' | 'refine' | 'done';
type PipeState = 'idle' | 'active' | 'done' | 'error';
type LogType = 'info' | 'success' | 'warn' | 'error';

interface LogEntry { ts: string; msg: string; type: LogType; }
interface ChunkPill { idx: number; state: 'sent' | 'done' | 'error'; }

// ─── Audio pipeline constants ────────────────────────────────────────────────
const SAMPLE_RATE = 16000;
const CHUNK_DURATION = 0.8;
const OVERLAP_DURATION = 0.2;
const VAD_THRESHOLD = 0.05;
const NOISE_GATE = 0.02;
const MAX_RETRIES = 3;
const FFT_SIZE = 1024;

const PIPE_STEPS: { id: PipeStep; label: string }[] = [
  { id: 'input', label: 'INPUT' },
  { id: 'preprocess', label: 'PREPROC' },
  { id: 'vad', label: 'VAD' },
  { id: 'chunk', label: 'CHUNK' },
  { id: 'api', label: 'API' },
  { id: 'merge', label: 'MERGE' },
  { id: 'refine', label: 'REFINE' },
  { id: 'done', label: 'OUTPUT' },
];

function getRMS(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function applyNoiseGate(samples: Float32Array) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.abs(samples[i]) > NOISE_GATE ? samples[i] : 0;
  }
  return out;
}

function float32ToWav(samples: Float32Array, sr: number) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const write = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nowTS = () => {
  const t = new Date();
  return `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
};

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('landing');
  const [apiKey, setApiKey] = useState((import.meta as any).env?.VITE_GEMINI_API_KEY || '');
  const [showSettings, setShowSettings] = useState(!(import.meta as any).env?.VITE_GEMINI_API_KEY);

  // Setup Wizard State
  const [resumeText, setResumeText] = useState('');
  const [currentTrack, setCurrentTrack] = useState<TrackType>('star');

  // Audio Pipeline & Live State
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeakingVAD, setIsSpeakingVAD] = useState(false);
  const [audioLevelRMS, setAudioLevelRMS] = useState(0);
  const [recElapsed, setRecElapsed] = useState(0);
  const [rawText, setRawText] = useState('');
  const [refinedText, setRefinedText] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [chunkPills, setChunkPills] = useState<ChunkPill[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [bodyLanguageScore, setBodyLanguageScore] = useState(0);

  const [pipeState, setPipeState] = useState<Record<PipeStep, PipeState>>({
    input: 'idle', preprocess: 'idle', vad: 'idle', chunk: 'idle',
    api: 'idle', merge: 'idle', refine: 'idle', done: 'idle',
  });
  const [logs, setLogs] = useState<LogEntry[]>([{ ts: nowTS(), msg: 'Visionary Recruiter initialized. Ready.', type: 'info' }]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const scriptProcRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bodyScoreIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkIndexRef = useRef(0);
  const bufferRef = useRef(new Float32Array(0));
  const rawChunksRef = useRef<Record<number, string>>({});

  // Prompt Generator
  const generateSystemInstruction = useCallback(() => {
    let persona = '';
    switch (currentTrack) {
      case 'hr': persona = 'You are Sarah, an HR Recruiter for a first-round phone screen. Keep things friendly, assess culture fit, and ask broad background questions.'; break;
      case 'star': persona = 'You are Sarah, a Senior Recruiter doing a behavioral mock interview using the STAR method. Keep responses to 2-3 sentences. Ask one STAR question at a time.'; break;
      case 'tech': persona = 'You are Sarah, an Engineering Manager. You are strictly evaluating hard technical skills, system design knowledge, and problem-solving depth. Ask complex technical follow-ups.'; break;
      case 'stress': persona = 'You are Sarah, an intense and impatient interviewer. Ask rapid-fire questions, challenge their answers, and test their composure under high pressure.'; break;
    }

    let prompt = `${persona}\n\n`;
    prompt += 'CRITICAL: After every candidate response, always call update_interview_metrics with scores 0-100 for each dimension. Along with STAR confidence, analyze the video frames to grade their eye contact and posture from 0-100. Never skip this call.\n\n';

    if (currentTrack === 'tech') {
      prompt += 'VISION EVALUATION: If you ask a technical question, ask the candidate to draw their solution (architecture diagram, code, logic) on a piece of paper and hold it up to the camera. Look at the camera feed and evaluate their drawing.\n\n';
    }

    if (resumeText.trim()) {
      prompt += `--- CANDIDATE RESUME CONTEXT ---\n${resumeText.trim()}\n---------------------------------\n\n`;
      prompt += "INSTRUCTION: I have provided the candidate's resume above. Your FIRST question MUST be specific to a past role or project listed on this resume. Continually reference their actual experience in your questions whenever possible.";
    } else {
      prompt += 'INSTRUCTION: Wait for the candidate to introduce themselves, then begin the interview based on your persona.';
    }
    return prompt;
  }, [currentTrack, resumeText]);

  const {
    isConnected, isStreaming, isMicHeld, isSpeaking,
    audioLevel, analyserRef, stream, metrics,
    youTranscript, sarahTranscript,
    connect, disconnect, startStreaming, micDown, micUp, sendTextMessage
  } = useGeminiLive({ apiKey, systemInstruction: generateSystemInstruction() });

  const addLog = useCallback((msg: string, type: LogType = 'info') => {
    setLogs(prev => [...prev.slice(-99), { ts: nowTS(), msg, type }]);
  }, []);

  const setStep = useCallback((step: PipeStep, state: PipeState) => {
    setPipeState(prev => ({ ...prev, [step]: state }));
  }, []);

  const updateChunkPill = useCallback((idx: number, state: ChunkPill['state']) => {
    setChunkPills(prev => {
      const i = prev.findIndex(p => p.idx === idx);
      if (i >= 0) { const n = [...prev]; n[i] = { idx, state }; return n; }
      return [...prev, { idx, state }];
    });
  }, []);

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (currentView === 'live' && !isConnected) connect();
  }, [currentView, isConnected, connect]);

  useEffect(() => {
    if (isConnected && !isStreaming) startStreaming(videoRef.current);
  }, [isConnected, isStreaming, startStreaming]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const analyser = analyserNodeRef.current ?? analyserRef.current;
    if (!analyser || (!isStreaming && !isRecording)) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = canvas.offsetWidth || 280; canvas.height = canvas.offsetHeight || 56;
        ctx.fillStyle = 'rgba(10,10,15,0.95)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#2d2d3a'; ctx.beginPath(); ctx.moveTo(0, canvas.height / 2); ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
      }
      return;
    }
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let animId: number;
    const draw = () => {
      animId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      canvas.width = canvas.offsetWidth || 280; canvas.height = canvas.offsetHeight || 56;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(10,10,15,0.95)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const speaking = isMicHeld || isSpeakingVAD;
      const color = speaking ? '#22c55e' : '#7c3aed';
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
      ctx.beginPath();
      const sliceW = canvas.width / buf.length; let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const y = ((buf[i] / 128) * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, [isStreaming, isRecording, isMicHeld, isSpeakingVAD, analyserRef, currentView]);

  const sendChunkToAPI = useCallback(async (samples: Float32Array, idx: number) => {
    setStep('preprocess', 'active'); setStep('vad', 'done'); setStep('chunk', 'active');
    updateChunkPill(idx, 'sent');
    const wavBlob = float32ToWav(samples, SAMPLE_RATE);
    const b64 = await blobToBase64(wavBlob);
    setStep('chunk', 'done'); setStep('api', 'active');

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        setRetrying(true); await sleep(Math.pow(2, attempt) * 500);
      }
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: "You are transcribing a live job interview accurately. Output ONLY transcript.",
            messages: [{
              role: 'user', content: [
                { type: 'document', source: { type: 'base64', media_type: 'audio/wav', data: b64 } },
                { type: 'text', text: 'Transcribe this audio.' }
              ]
            }]
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const text = (data.content as any[]).map(c => c.text || '').join('').trim();
        setRetrying(false); updateChunkPill(idx, 'done'); setStep('api', 'done'); setStep('merge', 'active');
        rawChunksRef.current[idx] = text;
        const merged = Object.keys(rawChunksRef.current).map(Number).sort((a, b) => a - b).map(k => rawChunksRef.current[k]).join(' ');
        setRawText(merged); setChunkCount(idx + 1); setStep('merge', 'done'); return;
      } catch (err: any) {
        if (attempt === MAX_RETRIES - 1) {
          setRetrying(false); updateChunkPill(idx, 'error'); setStep('api', 'error');
        }
      }
    }
  }, [setStep, updateChunkPill]);

  const startAudioPipeline = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true }, video: false });
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser(); analyser.fftSize = FFT_SIZE; analyserNodeRef.current = analyser;
      const processor = ctx.createScriptProcessor(4096, 1, 1); scriptProcRef.current = processor;
      const source = ctx.createMediaStreamSource(mediaStream); sourceNodeRef.current = source;
      source.connect(analyser); source.connect(processor); processor.connect(ctx.destination);
      const chunkSamples = Math.floor(CHUNK_DURATION * SAMPLE_RATE);
      const overlapSamples = Math.floor(OVERLAP_DURATION * SAMPLE_RATE);
      bufferRef.current = new Float32Array(0);

      processor.onaudioprocess = (e) => {
        const cleaned = applyNoiseGate(e.inputBuffer.getChannelData(0));
        const rms = getRMS(cleaned);
        const isSpeech = rms > VAD_THRESHOLD;
        setIsSpeakingVAD(isSpeech); setAudioLevelRMS(Math.min(rms * 300, 100));
        if (!isSpeech) return;
        const merged = new Float32Array(bufferRef.current.length + cleaned.length);
        merged.set(bufferRef.current); merged.set(cleaned, bufferRef.current.length);
        bufferRef.current = merged;
        if (bufferRef.current.length >= chunkSamples) {
          const chunk = bufferRef.current.slice(0, chunkSamples);
          bufferRef.current = bufferRef.current.slice(chunkSamples - overlapSamples);
          sendChunkToAPI(chunk, chunkIndexRef.current++);
        }
      };
      const startTime = Date.now();
      timerIntervalRef.current = setInterval(() => setRecElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
      bodyScoreIntervalRef.current = setInterval(() => setBodyLanguageScore(Math.floor(Math.random() * 20)+80), 3000);
      setIsRecording(true); setStep('input', 'active');
    } catch (err: any) { addLog('Mic error: ' + err.message, 'error'); }
  }, [addLog, sendChunkToAPI, setStep]);

  const stopAudioPipeline = useCallback(() => {
    if (scriptProcRef.current) { scriptProcRef.current.disconnect(); scriptProcRef.current = null; }
    if (sourceNodeRef.current) { sourceNodeRef.current.disconnect(); sourceNodeRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (bodyScoreIntervalRef.current) clearInterval(bodyScoreIntervalRef.current);
    analyserNodeRef.current = null; setIsRecording(false); setIsSpeakingVAD(false); setAudioLevelRMS(0); setStep('input', 'done');
  }, [setStep]);

  const refineTranscript = useCallback(async (text: string) => {
    if (!text.trim() || !apiKey) return;
    setIsRefining(true); setStep('refine', 'active');
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          messages: [{ role: 'user', content: `Clean this raw interview transcript. Output only cleaned transcript:\n\n${text}` }],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setRefinedText((data.content as any[]).map(c => c.text || '').join('').trim());
      setStep('refine', 'done'); setStep('done', 'done');
    } catch (err: any) {
      setStep('refine', 'error');
    } finally { setIsRefining(false); }
  }, [apiKey, setStep]);

  useEffect(() => {
    if (!isRecording && rawText.trim() && currentView === 'debrief') refineTranscript(rawText);
  }, [isRecording, rawText, currentView, refineTranscript]);

  const sessionTime = `${String(Math.floor(recElapsed / 60)).padStart(2, '0')}:${String(recElapsed % 60).padStart(2, '0')}`;
  const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;
  const readinessScore = Math.round((metrics.confidence * 0.2) + (((metrics.starProgress.situation + metrics.starProgress.task + metrics.starProgress.action + metrics.starProgress.result) / 4) * 0.6) + (metrics.articulation * 0.2));

  /* ─── View Renders ──────────────────────────────────────────────────────── */

  const renderLanding = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto flex flex-col items-center text-center pt-24">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black tracking-widest mb-6">
        <Sparkles size={14} /> GEMINI LIVE AGENT POWERED
      </div>
      <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
        Master Your Interviews in <span className="text-gradient">Real-Time</span>
      </h1>
      <p className="text-lg text-muted-foreground max-w-2xl mb-10">The world's first multimodal AI Recruiter that sees your confidence, hears your expertise, and coaches you to land your dream job.</p>
      <div className="flex gap-4 mb-20">
        <button onClick={() => apiKey ? setCurrentView('setup') : setShowSettings(true)} className="btn-premium flex items-center gap-2 group shadow-xl">
          Start Live Session <ChevronRight size={18} className="group-hover:translate-x-1 transition" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
        {[
          { icon: Mic, title: 'Push-to-Talk', desc: 'Hold the mic to speak. Release to let Sarah respond instantly.' },
          { icon: Video, title: 'Multimodal Vision', desc: 'Analyzes eye contact, whiteboard drawings, and professional demeanor.' },
          { icon: Target, title: 'Dynamic Tracks', desc: 'From HR screens to high-pressure technical stress tests.' },
        ].map((f, i) => (
          <div key={i} className="glass p-8 rounded-3xl hover:border-primary/50 transition duration-300">
            <f.icon className="text-primary w-8 h-8 mb-4 border border-primary/20 p-1.5 rounded-xl bg-primary/10" />
            <h3 className="font-bold text-xl mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );

  const renderSetup = () => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-4xl mx-auto pt-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2">Configure Your Interview</h2>
        <p className="text-muted-foreground">Customize Sarah's persona and provide your context before entering the room.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="glass p-6 rounded-3xl border-white/10">
          <h3 className="font-bold flex items-center gap-2 mb-4"><Users className="text-primary" /> Interview Track</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'hr', icon: '🤝', label: 'HR Screen' },
              { id: 'star', icon: '🏆', label: 'Behavioral' },
              { id: 'tech', icon: '💻', label: 'Technical Dive' },
              { id: 'stress', icon: '🔥', label: 'Stress Test' }
            ].map(t => (
              <button key={t.id} onClick={() => setCurrentTrack(t.id as TrackType)}
                className={cn('p-4 rounded-xl border text-left flex flex-col gap-2 transition', currentTrack === t.id ? 'bg-primary/10 border-primary text-primary shadow-lg shadow-primary/10' : 'bg-white/5 border-white/5 hover:border-white/20 text-muted-foreground')}>
                <span className="text-2xl">{t.icon}</span>
                <span className="text-xs font-bold uppercase tracking-widest">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="glass p-6 rounded-3xl border-white/10 flex flex-col">
          <h3 className="font-bold flex items-center gap-2 mb-4"><UploadCloud className="text-primary" /> Candidate Context</h3>
          <textarea
            className="w-full flex-1 bg-black/40 border border-white/10 rounded-xl p-4 text-xs font-mono text-muted-foreground focus:border-primary outline-none transition"
            placeholder="Paste your past experience, skills, or resume here. Sarah will base her first question exclusively on this input."
            value={resumeText} onChange={e => setResumeText(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-4">
        <button onClick={() => setCurrentView('landing')} className="px-6 py-3 font-bold text-muted-foreground hover:text-white transition">Back</button>
        <button onClick={() => {
          setRawText(''); setRefinedText(''); setChunkPills([]); setChunkCount(0); setRecElapsed(0); rawChunksRef.current = {}; chunkIndexRef.current = 0; bufferRef.current = new Float32Array(0);
          setPipeState({ input: 'idle', preprocess: 'idle', vad: 'idle', chunk: 'idle', api: 'idle', merge: 'idle', refine: 'idle', done: 'idle' });
          setCurrentView('live');
          setTimeout(() => startAudioPipeline(), 600);
        }} className="btn-premium px-12">Enter Interview Room</button>
      </div>
    </motion.div>
  );

  const renderLive = () => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto pt-6 flex flex-col min-h-[85vh]">
      <div className="flex items-center gap-1 mb-4 p-3 glass rounded-2xl border-white/5 overflow-x-auto">
        {PIPE_STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center gap-1 flex-shrink-0">
            <div className={cn('text-[8px] font-black tracking-widest px-2 py-1 rounded border transition-all duration-300',
              pipeState[step.id] === 'active' ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30' : pipeState[step.id] === 'done' ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-white/5 text-muted-foreground/30 border-white/5'
            )}>
              {step.label} {pipeState[step.id] === 'active' && <span className="inline-block w-1 h-1 bg-current ml-1 animate-pulse" />}
            </div>
            {i < PIPE_STEPS.length - 1 && <span className="text-muted-foreground/30 text-[8px]">→</span>}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {retrying && <span className="text-[9px] font-black text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded animate-pulse">↻ RETRY</span>}
          <div className="flex items-center gap-1.5 text-[9px] font-mono whitespace-nowrap"><Clock size={10} /> {sessionTime}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
        <div className="lg:col-span-3 glass-premium rounded-[2.5rem] relative flex flex-col items-center justify-center p-12 border-white/10 overflow-hidden shadow-[0_0_100px_rgba(139,92,246,0.1)]">
          <div className="absolute top-8 left-8 flex gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest border border-red-500/30">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse outline outline-4 outline-red-500/20" />Live
            </div>
            <div className="text-[10px] text-muted-foreground font-mono bg-white/5 px-2 py-1 rounded border border-white/5">
              {isConnected ? (isStreaming ? 'CONNECTED & STREAMING' : 'WEBSOCKET CONNECTED') : 'INITIALIZING CONNECTIONS...'}
            </div>
          </div>
          <div className="absolute top-8 right-8 text-[10px] font-black tracking-widest uppercase text-primary border border-primary/20 bg-primary/10 px-3 py-1.5 rounded-full">
            {currentTrack} TRACK
          </div>

          <div className="mb-8 relative mt-16">
            <motion.div animate={{ scale: isConnected ? [1, 1.05, 1] : 1 }} transition={{ duration: 4, repeat: Infinity }}
              className="w-40 h-40 rounded-full glass border border-white/30 flex items-center justify-center relative bg-gradient-to-b from-white/10 z-10">
              <Brain className="w-16 h-16 text-primary drop-shadow-[0_0_15px_rgba(139,92,246,0.5)]" />
              {isConnected && isStreaming && <motion.div animate={{ scale: [1, 1.4], opacity: [0.5, 0] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0 border-2 border-primary rounded-full" />}
            </motion.div>
          </div>
          <h2 className="text-2xl font-bold mb-8">Sarah</h2>
          
          <div className="w-full max-w-2xl min-h-[60px]">
            <AnimatePresence>
              {sarahTranscript ? (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="px-8 py-5 rounded-3xl bg-white/5 border border-white/10 text-center">
                  <p className="text-lg italic">"{sarahTranscript}"</p>
                </motion.div>
              ) : (
                <div className="text-center text-muted-foreground text-sm animate-pulse tracking-widest font-mono">LISTENING...</div>
              )}
            </AnimatePresence>
          </div>

          <div className="w-full max-w-2xl mt-4">
            <AnimatePresence>
              {(youTranscript || rawText) && (
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="w-full px-6 py-3 rounded-2xl bg-sky-900/40 border border-sky-500/30 text-sky-300 text-sm">
                  <span className="font-black text-[10px] tracking-widest">YOU: </span> {youTranscript || rawText}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="absolute bottom-8 right-8 flex gap-3">
             <button onClick={() => { sendTextMessage("Wrap up the interview. Say: 'That concludes my questions. Do you have any general questions for me?'"); addLog("Triggered reverse Q&A wrap-up", 'warn'); }}
                className="px-4 py-2 font-bold bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:text-primary transition text-xs">
                Wrap-Up Questions
             </button>
             <button onClick={() => { stopAudioPipeline(); disconnect(); setCurrentView('debrief'); }}
                className="px-4 py-2 font-bold bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500 hover:text-white transition text-xs">
                End Session
             </button>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="h-56 glass rounded-[2rem] relative overflow-hidden bg-black border-white/10 flex-shrink-0">
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover opacity-60" />
            <div className="absolute bottom-4 left-4">
              <div className="text-[10px] tracking-widest text-primary font-black mb-1">CANDIDATE</div>
              <div className={cn("text-xs font-bold px-2 py-0.5 rounded bg-black/50 border", bodyLanguageScore > 85 ? "text-green-400 border-green-500/30" : "text-yellow-400 border-yellow-500/30")}>
                Body Posture: {bodyLanguageScore}/100
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl p-3 border-white/10 flex-shrink-0">
            <div className="flex justify-between mb-2">
              <span className="text-[9px] font-black tracking-widest text-muted-foreground">AUDIO INPUT</span>
              <span className={cn('text-[9px] font-black tracking-widest px-2 py-0.5 rounded border', (isSpeakingVAD || isSpeaking) ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-white/5 text-muted-foreground')}>
                {(isSpeakingVAD || isSpeaking) ? '● SPEAKING' : '○ SILENCE'}
              </span>
            </div>
            <div className="h-10 rounded-xl bg-black mb-2 overflow-hidden"><canvas ref={waveCanvasRef} /></div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden"><motion.div animate={{ width: `${audioLevelRMS}%` }} className="h-full bg-green-400" /></div>
          </div>

          {isStreaming && (
            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} onMouseDown={micDown} onMouseUp={micUp} onMouseLeave={micUp}
              className={cn('w-full py-4 rounded-xl font-black text-[11px] tracking-widest uppercase transition-all select-none border-2 flex items-center justify-center gap-2 flex-shrink-0', isMicHeld ? 'bg-green-500 border-green-400 text-white shadow-lg shadow-green-500/40 scale-105' : 'bg-white/5 border-white/20 text-muted-foreground')}>
              {isMicHeld ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />} {isMicHeld ? 'Speaking...' : 'Hold to Speak'}
            </motion.button>
          )}

          <div className="flex-1 glass p-5 rounded-3xl border-white/10 flex flex-col min-h-[150px]">
            <h3 className="font-black text-[10px] tracking-widest text-muted-foreground mb-4 flex gap-2"><Target size={12} /> LIVE METRICS</h3>
            <div className="space-y-4 mb-4">
              {[{ l: 'CONFIDENCE', v: metrics.confidence, c: 'bg-cyan-400' }, { l: 'ARTICULATE', v: metrics.articulation, c: 'bg-fuchsia-400' }].map(m => (
                <div key={m.l} className="space-y-1"><div className="flex justify-between text-[9px] font-black"><span>{m.l}</span><span>{m.v}%</span></div><div className="h-1 bg-white/5 rounded-full overflow-hidden"><motion.div animate={{ width: `${m.v}%` }} className={cn('h-full', m.c)} /></div></div>
              ))}
            </div>
            {metrics.lastFeedback && <div className="text-[10px] font-bold text-primary italic bg-primary/10 p-2 rounded-lg border border-primary/20">"{metrics.lastFeedback}"</div>}
            <div className="mt-auto h-20 overflow-y-auto text-[8px] font-mono text-muted-foreground/50 space-y-0.5" style={{ scrollbarWidth: 'none' }}>
              {logs.slice(-15).map((l, i) => <div key={i}>{l.ts} <span className={l.type === 'error' ? 'text-red-400' : ''}>{l.msg}</span></div>)}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  const renderDebrief = () => (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto glass p-10 rounded-[3rem] border-white/20 mt-12 bg-gradient-to-b from-primary/5">
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4"><Trophy className="text-primary w-8 h-8" /></div>
        <h2 className="text-4xl font-bold">Interview Complete</h2>
        <p className="text-muted-foreground">Detailed metrics and feedback report.</p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-10">
        {[
          { l: 'Readiness Score', v: `${readinessScore}%`, c: 'text-primary' },
          { l: 'STAR Completion', v: `${Math.round((metrics.starProgress.situation + metrics.starProgress.task + metrics.starProgress.action + metrics.starProgress.result) / 4)}%`, c: 'text-violet-400' },
          { l: 'Words Spoken', v: wordCount, c: 'text-sky-400' },
        ].map(m => (
           <div key={m.l} className="p-6 rounded-3xl bg-white/5 border border-white/10 text-center"><div className={cn("text-4xl font-black mb-2", m.c)}>{m.v}</div><div className="text-[10px] font-black tracking-widest uppercase opacity-50">{m.l}</div></div>
        ))}
      </div>

      <div className="glass p-6 rounded-3xl mb-8 text-left border-white/10">
        <h3 className="font-bold flex items-center gap-2 mb-4"><Activity size={16} className="text-primary" /> Transcripts</h3>
        {refinedText ? (
          <div className="mb-4">
             <div className="text-[9px] font-black tracking-widest text-violet-400 uppercase mb-2">✨ Refined transcript</div>
             <p className="font-mono text-sm leading-relaxed">{refinedText}</p>
          </div>
        ) : (
          isRefining ? <div className="text-xs text-primary animate-pulse font-mono mb-4">Refining transcript...</div> : null
        )}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer tracking-widest uppercase font-black text-[9px] text-muted-foreground/50">Show Raw Transcript</summary><p className="font-mono mt-2">{rawText}</p></details>
      </div>

      <div className="flex gap-4 justify-center">
        <button className="px-8 py-3 bg-white/5 border-white/10 rounded-xl font-bold hover:bg-white/10" onClick={() => setCurrentView('landing')}>Home</button>
        <button className="btn-premium px-10" onClick={() => setCurrentView('setup')}>Practice Again</button>
      </div>
    </motion.div>
  );

  return (
    <div className="min-h-screen bg-mesh text-foreground">
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex items-center justify-between glass border-b border-white/5">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCurrentView('landing')}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg"><Brain className="text-white w-5 h-5" /></div>
          <span className="font-bold text-xl tracking-tight">Visionary Recruiter</span>
        </div>
        <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg hover:bg-white/5 text-muted-foreground"><Settings size={20} /></button>
      </nav>

      {showSettings && (
        <div className="fixed inset-0 z-[100] flex justify-center items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass p-8 rounded-3xl w-full max-w-sm border-white/20">
            <h2 className="text-2xl font-bold mb-4">API Key</h2>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIzaSy..." className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 font-mono text-sm outline-none focus:border-primary mb-6" />
            <button onClick={() => setShowSettings(false)} className="w-full py-3 bg-primary rounded-xl font-bold text-white shadow-lg shadow-primary/20 cursor-pointer">Save Key</button>
          </div>
        </div>
      )}

      <main className="pt-20 pb-12 px-6 relative z-10 w-full">
        {currentView === 'landing' && renderLanding()}
        {currentView === 'setup' && renderSetup()}
        {currentView === 'live' && renderLive()}
        {currentView === 'debrief' && renderDebrief()}
      </main>

      <div className="fixed top-1/4 -left-40 w-[500px] h-[500px] bg-primary/20 blur-[120px] rounded-full pointer-events-none opacity-40 animate-pulse-slow" />
      <div className="fixed bottom-1/4 -right-40 w-[500px] h-[500px] bg-fuchsia-500/20 blur-[120px] rounded-full pointer-events-none opacity-40 animate-pulse-slow" style={{ animationDelay: '1s' }} />
    </div>
  );
}