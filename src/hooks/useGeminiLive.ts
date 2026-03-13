import { useRef, useState, useCallback } from "react";

/* ─────────────────────── Config Interface ─────────────────────── */

export interface GeminiLiveConfig {
    apiKey: string;
    model?: string;
    systemInstruction?: string;
    /** VAD RMS threshold — audio below this is treated as silence (default: 0.02) */
    vadThreshold?: number;
    /** Noise gate threshold — samples below this are zeroed (default: 0.015) */
    noiseGateThreshold?: number;
    /** Max automatic reconnect attempts before giving up (default: 3) */
    maxReconnectAttempts?: number;
    /** Strip common filler words from transcript during refinement (default: false) */
    enableFillerRemoval?: boolean;
}

/* ─────────────────────── Shared Types ─────────────────────── */

export interface InterviewMetrics {
    confidence: number;
    starProgress: {
        situation: number;
        task: number;
        action: number;
        result: number;
    };
    articulation: number;
    lastFeedback: string;
    transcript?: string;
}

/** Pipeline step mirrors test.html's visual chunk tracker */
export type PipelineStep =
    | "idle"
    | "connecting"
    | "active"
    | "processing"
    | "done";

/* ─────────────────────── FILLER WORDS ─────────────────────── */

const FILLER_PATTERN =
    /\b(um+|uh+|like|you know|basically|honestly|literally|right\?|i mean|sort of|kind of|you see|actually|so yeah|yeah so)\b/gi;

/* ─────────────────────── HOOK ─────────────────────── */

export function useGeminiLive({
    apiKey,
    systemInstruction,
    vadThreshold = 0.02,
    noiseGateThreshold = 0.015,
    maxReconnectAttempts = 3,
    enableFillerRemoval = false,
}: GeminiLiveConfig) {

    /* ── UI State ── */
    const [isConnected, setIsConnected] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isMicHeld, setIsMicHeld] = useState(false);
    const [youTranscript, setYouTranscript] = useState("");
    const [sarahTranscript, setSarahTranscript] = useState("");
    const [stream, setLocalStream] = useState<MediaStream | null>(null);
    const [pipelineStep, setPipelineStep] = useState<PipelineStep>("idle");

    const [metrics, setMetrics] = useState<InterviewMetrics>({
        confidence: 70,
        starProgress: { situation: 0, task: 0, action: 0, result: 0 },
        articulation: 50,
        lastFeedback: ""
    });

    // Audio analysis state (from test.html AudioLens pipeline)
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);

    // Transcript quality metrics
    const [rawWordCount, setRawWordCount] = useState(0);
    const [refinedWordCount, setRefinedWordCount] = useState(0);

    /* ── Refs ── */
    const wsRef = useRef<WebSocket | null>(null);

    // Audio: separate contexts for input (16 kHz) and output (24 kHz)
    const inputCtxRef = useRef<AudioContext | null>(null);
    const outputCtxRef = useRef<AudioContext | null>(null);
    const nextPlayTimeRef = useRef(0);
    const pendingChunksRef = useRef<string[]>([]);
    const isResumingRef = useRef(false);

    // Media
    const streamRef = useRef<MediaStream | null>(null);
    const videoTimerRef = useRef<number | null>(null);
    const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
    /** Analyser node exposed to UI for waveform canvas drawing */
    const analyserRef = useRef<AnalyserNode | null>(null);

    // PTT hold (needed inside audio processor closure)
    const isMicHeldRef = useRef(false);

    // Reconnect / retry
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const intentionalDisconnectRef = useRef(false);

    // Silence gating counter (mirrors test.html SILENCE_THRESHOLD logic)
    const silenceFramesRef = useRef(0);
    const SILENCE_THRESHOLD = 15; // frames of continuous silence before suppressing send

    // Snapshot of config values used inside closures (avoids stale captures)
    const vadThresholdRef = useRef(vadThreshold);
    vadThresholdRef.current = vadThreshold;
    const noiseGateThresholdRef = useRef(noiseGateThreshold);
    noiseGateThresholdRef.current = noiseGateThreshold;

    /* ─────────────────────── Helpers ─────────────────────── */

    /** Chunked base64 encode — avoids call-stack overflow on large PCM buffers */
    const encodeBase64 = (bytes: Uint8Array): string => {
        let binary = "";
        const C = 0x8000;
        for (let i = 0; i < bytes.length; i += C)
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + C) as unknown as number[]);
        return btoa(binary);
    };

    /** Promise-based sleep for retry backoff */
    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

    /** Convert Float32 audio samples to a valid RIFF/WAV Blob (for file export / fallback chunking) */
    const float32ToWav = (samples: Float32Array, sampleRate = 16000): Blob => {
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            pcm[i] = Math.round(s * 32767);
        }
        const wavBuffer = new ArrayBuffer(44 + pcm.byteLength);
        const view = new DataView(wavBuffer);

        const writeStr = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };
        const numChannels = 1;
        const byteRate = sampleRate * numChannels * 2;

        writeStr(0, "RIFF");
        view.setUint32(4, 36 + pcm.byteLength, true);
        writeStr(8, "WAVE");
        writeStr(12, "fmt ");
        view.setUint32(16, 16, true);            // PCM sub-chunk size
        view.setUint16(20, 1, true);             // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, numChannels * 2, true); // block align
        view.setUint16(34, 16, true);            // bits per sample
        writeStr(36, "data");
        view.setUint32(40, pcm.byteLength, true);

        const pcmBytes = new Uint8Array(pcm.buffer);
        const wavBytes = new Uint8Array(wavBuffer);
        wavBytes.set(pcmBytes, 44);

        return new Blob([wavBuffer], { type: "audio/wav" });
    };

    /** Blob → base64 data URL (async; useful for WAV chunk upload) */
    const blobToBase64 = (blob: Blob): Promise<string> =>
        new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res((reader.result as string).split(",")[1]);
            reader.onerror = rej;
            reader.readAsDataURL(blob);
        });

    /* ── Audio Signal Processing (ported from test.html AudioLens engine) ── */

    /** Root Mean Square — drives VAD and level meter */
    const getRMS = (samples: Float32Array): number => {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        return Math.sqrt(sum / samples.length);
    };

    /** Noise gate — zeros samples below threshold to suppress background hiss */
    const applyNoiseGate = (samples: Float32Array, threshold: number): Float32Array => {
        const result = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            result[i] = Math.abs(samples[i]) > threshold ? samples[i] : 0;
        }
        return result;
    };

    /** Linear interpolation resample — converts native browser SR → 16 kHz for Gemini */
    const resampleLinear = (samples: Float32Array, srcRate: number, targetRate: number): Float32Array => {
        if (Math.abs(srcRate - targetRate) < 10) return samples;
        const ratio = targetRate / srcRate;
        const outLen = Math.round(samples.length * ratio);
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
            const srcIdx = i / ratio;
            const lo = Math.floor(srcIdx);
            const hi = Math.min(lo + 1, samples.length - 1);
            const frac = srcIdx - lo;
            out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
        }
        return out;
    };

    /* ─────────────────────── Audio OUTPUT ─────────────────────── */

    const ensureOutputCtx = useCallback(async (): Promise<boolean> => {
        if (!outputCtxRef.current || outputCtxRef.current.state === "closed") {
            outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
            nextPlayTimeRef.current = 0;
        }
        if (outputCtxRef.current.state === "suspended") {
            if (!isResumingRef.current) {
                isResumingRef.current = true;
                await outputCtxRef.current.resume();
                isResumingRef.current = false;
                const queued = pendingChunksRef.current.splice(0);
                queued.forEach(b64 => scheduleChunk(b64));
            }
            return false;
        }
        return true;
    }, []);

    const scheduleChunk = useCallback((base64: string) => {
        try {
            const ctx = outputCtxRef.current!;
            const bin = atob(base64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            const i16 = new Int16Array(u8.buffer);
            const f32 = new Float32Array(i16.length);
            for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768.0;

            const buf = ctx.createBuffer(1, f32.length, 24000);
            buf.copyToChannel(f32, 0);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);

            const now = ctx.currentTime;
            if (nextPlayTimeRef.current < now + 0.01) nextPlayTimeRef.current = now + 0.05;
            src.start(nextPlayTimeRef.current);
            nextPlayTimeRef.current += buf.duration;
        } catch (e) {
            console.error("Playback error:", e);
        }
    }, []);

    const playAudio = useCallback(async (base64: string) => {
        const ready = await ensureOutputCtx();
        if (!ready) {
            pendingChunksRef.current.push(base64);
            return;
        }
        scheduleChunk(base64);
    }, [ensureOutputCtx, scheduleChunk]);

    /* ─────────────────────── Transcript Refinement ─────────────────────── */

    /**
     * Post-session refinement pass — strips filler words and returns a cleaned string.
     * If the Gemini WS is still open, no extra API call is made; it's purely client-side.
     * For a full server-side pass, this can be extended to call a REST endpoint.
     */
    const refineTranscript = useCallback(async (rawText: string): Promise<string> => {
        if (!rawText.trim()) return rawText;
        setPipelineStep("processing");

        let refined = rawText;

        // Client-side filler removal (if enabled)
        if (enableFillerRemoval) {
            refined = refined.replace(FILLER_PATTERN, "").replace(/\s{2,}/g, " ").trim();
        }

        // Capitalise first character and ensure ending punctuation
        if (refined.length > 0) {
            refined = refined.charAt(0).toUpperCase() + refined.slice(1);
            if (!/[.!?]$/.test(refined)) refined += ".";
        }

        const rawWc = rawText.trim().split(/\s+/).length;
        const refinedWc = refined.trim().split(/\s+/).length;
        setRawWordCount(rawWc);
        setRefinedWordCount(refinedWc);

        setPipelineStep("done");
        return refined;
    }, [enableFillerRemoval]);

    /* ─────────────────────── Export Utility ─────────────────────── */

    /**
     * Formats both speaker transcripts into a plain-text export string.
     * Call exportTranscript() at session end; create a download link from the result.
     */
    const exportTranscript = useCallback((): string => {
        const lines: string[] = [
            "=== Visionary Recruiter — Interview Transcript ===",
            `Exported: ${new Date().toLocaleString()}`,
            "",
            "--- YOU ---",
            youTranscript || "(no transcript recorded)",
            "",
            "--- SARAH (AI Interviewer) ---",
            sarahTranscript || "(no transcript recorded)",
            "",
            `Word count (you): ${rawWordCount || youTranscript.trim().split(/\s+/).length}`,
        ];
        if (refinedWordCount) {
            const quality = Math.round((refinedWordCount / rawWordCount) * 100);
            lines.push(`Quality score (post-refinement): ${quality}%`);
        }
        return lines.join("\n");
    }, [youTranscript, sarahTranscript, rawWordCount, refinedWordCount]);

    /* ─────────────────────── Message Handler ─────────────────────── */

    const handleMessage = useCallback(async (ev: MessageEvent) => {
        let text: string;
        if (ev.data instanceof Blob) {
            text = await ev.data.text();
        } else {
            text = ev.data as string;
        }

        let data: Record<string, unknown>;
        try { data = JSON.parse(text); }
        catch { console.warn("Bad JSON from WS:", text.substring(0, 120)); return; }

        if (data.setupComplete) {
            console.log("Gemini Setup ACK — ready!");
            setPipelineStep("active");
            return;
        }

        /* ── Tool calls (top-level "toolCall" in camelCase protocol) */
        const toolCall = data.toolCall as { functionCalls?: { id: string; name: string; args: Record<string, unknown> }[] } | undefined;
        if (toolCall?.functionCalls) {
            for (const call of toolCall.functionCalls) {
                if (call.name === "update_interview_metrics") {
                    const a = call.args as {
                        confidence: number; star_situation: number; star_task: number;
                        star_action: number; star_result: number; articulation: number; feedback: string;
                    };
                    setMetrics({
                        confidence: a.confidence,
                        starProgress: { situation: a.star_situation, task: a.star_task, action: a.star_action, result: a.star_result },
                        articulation: a.articulation,
                        lastFeedback: a.feedback
                    });
                    console.log(`Tool call: conf=${a.confidence} S=${a.star_situation} feedback="${a.feedback}"`);
                }
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{ id: call.id, name: call.name, response: { result: "ok" } }]
                        }
                    }));
                }
            }
        }

        /* ── Input transcription (YOU) — top-level field */
        const inputTx = data.inputTranscription as { text?: string } | undefined;
        if (inputTx?.text) {
            setYouTranscript(prev => (prev + " " + inputTx.text!).trim());
        }

        /* ── Output transcription (SARAH) — top-level field */
        const outputTx = data.outputTranscription as { text?: string } | undefined;
        if (outputTx?.text) {
            setSarahTranscript(prev => prev + outputTx.text!);
        }

        /* ── serverContent — audio chunks + fallback transcription */
        const sc = data.serverContent as {
            modelTurn?: { parts?: { inlineData?: { mimeType?: string; data: string }; functionCall?: { id: string; name: string; args: Record<string, unknown> } }[] };
            inputTranscription?: { text?: string };
            outputTranscription?: { text?: string };
            turnComplete?: boolean;
        } | undefined;

        if (!sc) return;

        // Fallback: some model versions nest transcription inside serverContent
        if (!inputTx && sc.inputTranscription?.text) {
            setYouTranscript(prev => (prev + " " + sc.inputTranscription!.text!).trim());
        }
        if (!outputTx && sc.outputTranscription?.text) {
            setSarahTranscript(prev => prev + sc.outputTranscription!.text!);
        }

        const parts = sc.modelTurn?.parts ?? [];
        for (const part of parts) {
            if (part.inlineData?.data) {
                const mime = part.inlineData.mimeType ?? "";
                if (mime.startsWith("audio") || mime === "") {
                    await playAudio(part.inlineData.data);
                }
            }
            if (part.functionCall) {
                const fc = part.functionCall;
                if (fc.name === "update_interview_metrics") {
                    const a = fc.args as {
                        confidence: number; star_situation: number; star_task: number;
                        star_action: number; star_result: number; articulation: number; feedback: string;
                    };
                    setMetrics({
                        confidence: a.confidence,
                        starProgress: { situation: a.star_situation, task: a.star_task, action: a.star_action, result: a.star_result },
                        articulation: a.articulation,
                        lastFeedback: a.feedback
                    });
                }
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{ id: fc.id, name: fc.name, response: { result: "ok" } }]
                        }
                    }));
                }
            }
        }

        if (sc.turnComplete) {
            console.log("Turn complete");
            setYouTranscript("");
            setSarahTranscript("");
            nextPlayTimeRef.current = 0;
            pendingChunksRef.current = [];
        }
    }, [playAudio]);

    /* ─────────────────────── Reconnect / Retry ─────────────────────── */

    /**
     * Schedules an exponential-backoff reconnect attempt.
     * Attempt 0 → 500 ms, 1 → 1 s, 2 → 2 s, 3 → 4 s, …
     * Stops after maxReconnectAttempts.
     */
    const scheduleReconnect = useCallback(() => {
        if (intentionalDisconnectRef.current) return;
        if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            console.warn(`[WS] Max reconnect attempts (${maxReconnectAttempts}) reached. Giving up.`);
            setPipelineStep("done");
            return;
        }

        const attempt = reconnectAttemptsRef.current;
        const delayMs = Math.pow(2, attempt) * 500;
        reconnectAttemptsRef.current += 1;
        console.log(`[WS] Reconnect attempt ${attempt + 1}/${maxReconnectAttempts} in ${delayMs}ms…`);

        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
        }, delayMs);
    }, [maxReconnectAttempts]); // connect added below via ref pattern to avoid circular dep

    /* ─────────────────────── CONNECT ─────────────────────── */

    const connect = useCallback((overrideKey?: string) => {
        if (
            wsRef.current &&
            (wsRef.current.readyState === WebSocket.OPEN ||
                wsRef.current.readyState === WebSocket.CONNECTING)
        ) return;

        const key = (overrideKey || apiKey).trim();
        if (!key) { console.error("Gemini API key missing"); return; }

        intentionalDisconnectRef.current = false;
        setPipelineStep("connecting");
        console.log("Connecting to Gemini Live (v1beta)…");

        const url =
            `wss://generativelanguage.googleapis.com/ws/` +
            `google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent` +
            `?key=${key}`;

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("Gemini WebSocket OPEN");
            reconnectAttemptsRef.current = 0; // reset backoff counter on success
            setIsConnected(true);

            ws.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                    generation_config: {
                        response_modalities: ["AUDIO"],
                        speech_config: {
                            voice_config: {
                                prebuilt_voice_config: {
                                    voice_name: "Puck"
                                }
                            }
                        }
                    },
                    input_audio_transcription: {},
                    output_audio_transcription: {},
                    system_instruction: {
                        parts: [{
                            text: (systemInstruction || "You are Sarah, a Lead Talent Partner from Visionary Recruiting. You are conducting a high-stakes professional mock interview for a technical leadership role. You must follow the STAR method (Situation, Task, Action, Result) rigorously. Introduce yourself with professional elegance, then probe for specific examples. Keep your focus on assessing core competencies. CRITICAL: After every candidate response, always call update_interview_metrics to quantify their performance. Your tone should be encouraging but elite—think of yourself as a top-tier executive coach.") + "\n\nCRITICAL LINGUISTIC LOCK: You are operating in a 100% English-only environment. You MUST transcribe all input audio as English (en-US). If you hear non-English speech or background noise, ignore it or interpret it as the closest phonetic English equivalent. Under NO circumstances should you output or transcribe in Thai, Hindi, or any other language. Your language processing is strictly locked to English."
                        }]
                    },
                    realtime_input_config: {
                        automatic_activity_detection: { disabled: true }
                    },
                    tools: [{
                        function_declarations: [{
                            name: "update_interview_metrics",
                            description: "Update STAR evaluation scores after each answer.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    confidence: { type: "NUMBER", description: "0-100" },
                                    star_situation: { type: "NUMBER", description: "0-100" },
                                    star_task: { type: "NUMBER", description: "0-100" },
                                    star_action: { type: "NUMBER", description: "0-100" },
                                    star_result: { type: "NUMBER", description: "0-100" },
                                    articulation: { type: "NUMBER", description: "0-100" },
                                    feedback: { type: "STRING", description: "Max 10 words of encouragement or correction." }
                                },
                                required: ["confidence", "star_situation", "star_task", "star_action", "star_result", "articulation", "feedback"]
                            }
                        }]
                    }]
                }
            }));
        };

        ws.onmessage = handleMessage;

        ws.onclose = (ev) => {
            wsRef.current = null;
            setIsConnected(false);
            setIsStreaming(false);
            console.log(`[WS Close] code=${ev.code} reason="${ev.reason}"`);

            if (ev.code === 1008) {
                console.error("Gemini rejected request — check model name / API key.");
                setPipelineStep("done");
                return; // Don't retry auth failures
            }

            if (!intentionalDisconnectRef.current) {
                scheduleReconnect();
            } else {
                setPipelineStep("done");
            }
        };

        ws.onerror = (err) => console.error("Gemini WebSocket error", err);

    }, [apiKey, systemInstruction, handleMessage, scheduleReconnect]);

    /* ─────────────────────── MIC HOLD (Push-to-Talk) ─────────────────────── */

    const micDown = useCallback(() => {
        if (!isStreaming) return;
        isMicHeldRef.current = true;
        silenceFramesRef.current = 0;
        setIsMicHeld(true);
        setYouTranscript("");
        console.log("Mic OPEN — sending activityStart");
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
        }
    }, [isStreaming]);

    const micUp = useCallback(() => {
        if (!isMicHeldRef.current) return;
        isMicHeldRef.current = false;
        silenceFramesRef.current = 0;
        setIsMicHeld(false);
        console.log("Mic CLOSED — sending activityEnd");
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
        }
    }, []);

    /* ─────────────────────── START CAMERA + MIC ─────────────────────── */

    const startStreaming = useCallback(async (videoElement?: HTMLVideoElement | null) => {
        if (isStreaming || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        try {
            console.log("Requesting camera + microphone…");

            const media = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10 } }
            });

            streamRef.current = media;
            setLocalStream(media);
            setIsStreaming(true);

            // Output AudioContext at 24kHz — created inside user-gesture chain for autoplay
            outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
            nextPlayTimeRef.current = 0;
            console.log("Output AudioContext 24kHz ready");

            // Input AudioContext at NATIVE browser rate — we resample to 16kHz ourselves
            inputCtxRef.current = new AudioContext();
            const nativeSR = inputCtxRef.current.sampleRate;
            console.log(`Input AudioContext native: ${nativeSR}Hz (will resample → 16kHz)`);

            const source = inputCtxRef.current.createMediaStreamSource(media);

            // AnalyserNode: feeds waveform canvas in the UI (pre-gating = true input amplitude)
            const analyser = inputCtxRef.current.createAnalyser();
            analyser.fftSize = 1024;
            analyserRef.current = analyser;
            source.connect(analyser);

            // ScriptProcessor — 2048 buffer for lower latency than 4096
            const proc = inputCtxRef.current.createScriptProcessor(2048, 1, 1);
            source.connect(proc);
            proc.connect(inputCtxRef.current.destination);

            proc.onaudioprocess = (e) => {
                const raw = e.inputBuffer.getChannelData(0);

                // 1. Noise gate — suppresses background hiss (threshold from config ref)
                const gated = applyNoiseGate(raw, noiseGateThresholdRef.current);

                // 2. VAD + level meter (always active, even when PTT not held)
                const rms = getRMS(gated);
                const speaking = rms > vadThresholdRef.current;
                setIsSpeaking(speaking);
                setAudioLevel(Math.min(rms * 300, 100));

                // 3. Only send to Gemini when mic is held (PTT)
                if (!isMicHeldRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

                // 4. VAD silence suppression: mirror test.html's silenceFrames counter.
                //    If the user is silent for SILENCE_THRESHOLD consecutive frames, skip
                //    sending — saves bandwidth and avoids flooding Gemini with empty noise.
                if (!speaking) {
                    silenceFramesRef.current++;
                    if (silenceFramesRef.current > SILENCE_THRESHOLD) {
                        return; // suppress this frame
                    }
                } else {
                    silenceFramesRef.current = 0; // voice detected — reset counter
                }

                // 5. Resample native SR → 16kHz via linear interpolation
                const resampled = resampleLinear(gated, nativeSR, 16000);

                // 6. Float32 → Int16 PCM
                const pcm16 = new Int16Array(resampled.length);
                for (let i = 0; i < resampled.length; i++) {
                    const s = Math.max(-1, Math.min(1, resampled[i]));
                    pcm16[i] = Math.round(s * 32767);
                }

                // 7. Base64 encode and send — camelCase required by BidiGenerateContent WS
                const b64 = encodeBase64(new Uint8Array(pcm16.buffer));
                wsRef.current!.send(JSON.stringify({
                    realtimeInput: {
                        mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: b64 }]
                    }
                }));
            };

            // Wire video preview if a ref was passed
            if (videoElement) {
                videoElement.srcObject = media;
            }

            // Video frame capture every 2.5 s
            const canvas = document.createElement("canvas");
            canvas.width = 320;
            canvas.height = 240;
            const ctx2d = canvas.getContext("2d")!;

            const hiddenVid = document.createElement("video");
            hiddenVid.srcObject = media;
            hiddenVid.muted = true;
            hiddenVid.playsInline = true;
            hiddenVid.play();
            hiddenVideoRef.current = hiddenVid;

            const sendFrame = () => {
                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                ctx2d.drawImage(hiddenVid, 0, 0, 320, 240);
                const jpeg = canvas.toDataURL("image/jpeg", 0.45).split(",")[1];
                wsRef.current.send(JSON.stringify({
                    realtimeInput: {
                        mediaChunks: [{ mimeType: "image/jpeg", data: jpeg }]
                    }
                }));
                videoTimerRef.current = window.setTimeout(sendFrame, 2500);
            };
            sendFrame();

            console.log("Media ACTIVE — hold mic to speak!");

        } catch (err) {
            console.error("Media error", err);
            setIsStreaming(false);
        }
    }, [isStreaming, encodeBase64]);

    /* ─────────────────────── DISCONNECT ─────────────────────── */

    const disconnect = useCallback(() => {
        intentionalDisconnectRef.current = true;

        // Cancel any pending reconnect timer
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;

        if (videoTimerRef.current) { clearTimeout(videoTimerRef.current); videoTimerRef.current = null; }

        hiddenVideoRef.current?.pause();
        hiddenVideoRef.current = null;

        wsRef.current?.close();
        wsRef.current = null;

        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;

        inputCtxRef.current?.close();
        inputCtxRef.current = null;

        outputCtxRef.current?.close();
        outputCtxRef.current = null;

        isMicHeldRef.current = false;
        silenceFramesRef.current = 0;
        analyserRef.current = null;
        setIsMicHeld(false);
        setIsSpeaking(false);
        setAudioLevel(0);
        setLocalStream(null);
        setIsStreaming(false);
        setIsConnected(false);
        setYouTranscript("");
        setSarahTranscript("");
        setPipelineStep("idle");
        nextPlayTimeRef.current = 0;
        pendingChunksRef.current = [];
    }, []);

    /* ─────────────────────── Send Text Message (Prompt Injection) ─────────────────────── */

    const sendTextMessage = useCallback((text: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.warn("Cannot send text message, websocket is not open.");
            return;
        }
        
        console.log("Sending text message via WebSocket:", text);
        wsRef.current.send(JSON.stringify({
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text }]
                }],
                turnComplete: true
            }
        }));
    }, []);

    /* ─────────────────────── Derived values ─────────────────────── */

    const wordCount = youTranscript.trim() ? youTranscript.trim().split(/\s+/).length : 0;
    const qualityScore =
        rawWordCount > 0 && refinedWordCount > 0
            ? Math.round((refinedWordCount / rawWordCount) * 100)
            : null;

    /* ─────────────────────── Public API ─────────────────────── */

    return {
        // Connection / session state
        isConnected,
        isStreaming,
        isMicHeld,
        pipelineStep,

        // Audio analysis
        isSpeaking,
        audioLevel,
        analyserRef,

        // Transcripts
        youTranscript,
        sarahTranscript,

        // Quality metrics
        wordCount,
        qualityScore,

        // Interview metrics (STAR + confidence)
        metrics,

        // Media stream (for <video> srcObject)
        stream,

        // Actions
        connect,
        startStreaming,
        micDown,
        micUp,
        disconnect,
        sendTextMessage,

        // Utilities
        refineTranscript,
        exportTranscript,
        float32ToWav,
        blobToBase64,
        sleep,
    };
}