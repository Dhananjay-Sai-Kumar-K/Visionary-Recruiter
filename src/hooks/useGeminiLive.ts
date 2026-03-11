import { useRef, useState, useCallback } from "react";

interface GeminiLiveConfig {
    apiKey: string;
    model?: string;
    systemInstruction?: string;
}

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

export function useGeminiLive({
    apiKey,
    systemInstruction
}: GeminiLiveConfig) {

    const [isConnected, setIsConnected] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isMicHeld, setIsMicHeld] = useState(false);
    const [youTranscript, setYouTranscript] = useState("");
    const [sarahTranscript, setSarahTranscript] = useState("");
    const [stream, setLocalStream] = useState<MediaStream | null>(null);

    const [metrics, setMetrics] = useState<InterviewMetrics>({
        confidence: 70,
        starProgress: { situation: 0, task: 0, action: 0, result: 0 },
        articulation: 50,
        lastFeedback: ""
    });

    // WebSocket
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

    // Mic hold ref (needed inside audio processor closure)
    const isMicHeldRef = useRef(false);

    /* ─────────────────────── helpers ─────────────────────── */

    /** Chunked base64 encode — avoids call-stack overflow on large PCM buffers */
    const encodeBase64 = (bytes: Uint8Array): string => {
        let binary = "";
        const C = 0x8000;
        for (let i = 0; i < bytes.length; i += C)
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + C) as unknown as number[]);
        return btoa(binary);
    };

    /* ─────────────────────── audio OUTPUT ─────────────────────── */

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
                // Flush queued chunks
                const queued = pendingChunksRef.current.splice(0);
                queued.forEach(b64 => scheduleChunk(b64));
            }
            return false; // still resuming
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

    /* ─────────────────────── message handler ─────────────────────── */

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

        if (data.setupComplete) { console.log("Gemini Setup ACK — ready!"); return; }

        /* ── Tool calls ── (top-level "toolCall" in camelCase protocol) */
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
                // Send tool response back — camelCase is required by the raw WS protocol
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{ id: call.id, name: call.name, response: { result: "ok" } }]
                        }
                    }));
                }
            }
        }

        /* ── Input transcription (YOU) — top-level field ── */
        const inputTx = data.inputTranscription as { text?: string } | undefined;
        if (inputTx?.text) {
            setYouTranscript(prev => (prev + " " + inputTx.text!).trim());
        }

        /* ── Output transcription (SARAH) — top-level field ── */
        const outputTx = data.outputTranscription as { text?: string } | undefined;
        if (outputTx?.text) {
            setSarahTranscript(prev => prev + outputTx.text!);
        }

        /* ── serverContent — audio chunks + fallback transcription ── */
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
            // Audio output
            if (part.inlineData?.data) {
                const mime = part.inlineData.mimeType ?? "";
                if (mime.startsWith("audio") || mime === "") {
                    await playAudio(part.inlineData.data);
                }
            }
            // Fallback: tool call inside parts (some versions send it here)
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

        // turnComplete — clear live transcript buffers
        if (sc.turnComplete) {
            console.log("Turn complete");
            setYouTranscript("");
            setSarahTranscript("");
            nextPlayTimeRef.current = 0;
            pendingChunksRef.current = [];
        }
    }, [playAudio]);

    /* ─────────────────────── CONNECT ─────────────────────── */

    const connect = useCallback(() => {
        if (
            wsRef.current &&
            (wsRef.current.readyState === WebSocket.OPEN ||
                wsRef.current.readyState === WebSocket.CONNECTING)
        ) return;

        const key = apiKey.trim();
        if (!key) { console.error("Gemini API key missing"); return; }

        console.log("Connecting to Gemini Live (v1beta)…");

        const url =
            `wss://generativelanguage.googleapis.com/ws/` +
            `google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent` +
            `?key=${key}`;

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("Gemini WebSocket OPEN");
            setIsConnected(true);

            // ✅ Model name that actually works; camelCase setup payload
            ws.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                    generation_config: {
                        response_modalities: ["AUDIO"]
                    },
                    // Enable transcriptions for both speaker & AI
                    input_audio_transcription: {},
                    output_audio_transcription: {},
                    // Disable auto-VAD so we control turns via activityStart / activityEnd
                    realtime_input_config: {
                        automatic_activity_detection: { disabled: true }
                    },
                    system_instruction: {
                        parts: [{
                            text: systemInstruction ||
                                "You are Sarah, a Senior Recruiter doing a mock interview using the STAR method. Introduce yourself briefly, then ask one STAR question at a time. Keep responses to 2-3 sentences. CRITICAL: After every candidate response, always call update_interview_metrics with scores 0-100 for each dimension. Never skip this call."
                        }]
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
            if (ev.code === 1008) console.error("Gemini rejected request — check model name / API key.");
        };

        ws.onerror = (err) => console.error("Gemini WebSocket error", err);

    }, [apiKey, systemInstruction, handleMessage]);

    /* ─────────────────────── MIC HOLD (Push-to-Talk) ─────────────────────── */

    const micDown = useCallback(() => {
        if (!isStreaming) return;
        isMicHeldRef.current = true;
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
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                },
                video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10 } }
            });

            streamRef.current = media;
            setLocalStream(media);
            setIsStreaming(true);

            // Create output AudioContext NOW (inside user-gesture chain) to satisfy autoplay policy
            outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
            nextPlayTimeRef.current = 0;
            console.log("Output AudioContext 24kHz ready");

            // Separate input context at 16 kHz — only for mic capture
            inputCtxRef.current = new AudioContext({ sampleRate: 16000 });
            const source = inputCtxRef.current.createMediaStreamSource(media);
            const proc = inputCtxRef.current.createScriptProcessor(4096, 1, 1);
            source.connect(proc);
            proc.connect(inputCtxRef.current.destination);

            proc.onaudioprocess = (e) => {
                // Only stream audio when mic is held (PTT)
                if (!isMicHeldRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

                const float = e.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(float.length);
                for (let i = 0; i < float.length; i++) {
                    const s = Math.max(-1, Math.min(1, float[i]));
                    pcm16[i] = s < 0 ? s * 32768 : s * 32767;
                }

                const b64 = encodeBase64(new Uint8Array(pcm16.buffer));

                // ✅ camelCase — required by the raw BidiGenerateContent WS protocol
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

            // ── Video frame capture every 2.5 s ──
            const canvas = document.createElement("canvas");
            canvas.width = 320;
            canvas.height = 240;
            const ctx2d = canvas.getContext("2d")!;

            // Use a hidden video element to draw frames from (avoids CORS issues with refs)
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
        setIsMicHeld(false);
        setLocalStream(null);
        setIsStreaming(false);
        setIsConnected(false);
        setYouTranscript("");
        setSarahTranscript("");
        nextPlayTimeRef.current = 0;
        pendingChunksRef.current = [];
    }, []);

    /* ─────────────────────── public API ─────────────────────── */

    return {
        isConnected,
        isStreaming,
        isMicHeld,
        youTranscript,
        sarahTranscript,
        metrics,
        stream,
        connect,
        startStreaming,
        micDown,
        micUp,
        disconnect
    };
}