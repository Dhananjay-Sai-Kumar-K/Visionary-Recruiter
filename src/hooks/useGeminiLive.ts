import { useRef, useState, useCallback } from 'react';

interface GeminiLiveConfig {
    apiKey: string;
    model?: string;
    systemInstruction?: string;
}

export interface InterviewMetrics {
    confidence: number;
    starStructure: number;
    articulation: number;
    lastFeedback: string;
}

export function useGeminiLive({ apiKey, model = "gemini-2.0-flash-exp", systemInstruction }: GeminiLiveConfig) {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState<string>("");
    const [metrics, setMetrics] = useState<InterviewMetrics>({
        confidence: 70,
        starStructure: 30,
        articulation: 50,
        lastFeedback: ""
    });

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const workerRef = useRef<number | null>(null);

    const connect = useCallback(() => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            console.log("Connection already exists or is connecting...");
            return;
        }

        const trimmedKey = apiKey.trim();
        if (!trimmedKey) {
            console.error("API Key is empty or only whitespace.");
            return;
        }

        console.log("Initiating WebSocket connection to Gemini Live (v1alpha)...");
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${trimmedKey}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("WebSocket Connection Opened Successfully.");
            setIsConnected(true);

            const setup = {
                setup: {
                    model: `models/${model}`,
                    generation_config: {
                        response_modalities: ["audio"]
                    },
                    tools: [{
                        function_declarations: [
                            {
                                name: "update_interview_metrics",
                                description: "Update the candidate's real-time performance metrics based on their latest response and non-verbal cues.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        confidence: { type: "NUMBER", description: "Score from 0-100 based on tone and posture." },
                                        star_structure: { type: "NUMBER", description: "Score from 0-100 on how well they are following the STAR method." },
                                        articulation: { type: "NUMBER", description: "Score from 0-100 on clarity and lack of filler words." },
                                        feedback: { type: "STRING", description: "A very short (max 10 words) encouraging or corrective feedback snippet." }
                                    },
                                    required: ["confidence", "star_structure", "articulation", "feedback"]
                                }
                            }
                        ]
                    }],
                    system_instruction: {
                        parts: [{ text: systemInstruction || "You are a professional recruiter." }]
                    }
                }
            };
            ws.send(JSON.stringify(setup));
        };

        ws.onmessage = async (event) => {
            const response = JSON.parse(event.data);

            if (response.serverContent?.modelTurn?.parts) {
                for (const part of response.serverContent.modelTurn.parts) {
                    if (part.call) {
                        const call = part.call;
                        if (call.name === "update_interview_metrics") {
                            const args = call.args;
                            setMetrics({
                                confidence: args.confidence,
                                starStructure: args.star_structure,
                                articulation: args.articulation,
                                lastFeedback: args.feedback
                            });

                            ws.send(JSON.stringify({
                                tool_response: {
                                    function_responses: [{
                                        name: "update_interview_metrics",
                                        response: { result: "ok" },
                                        id: call.id
                                    }]
                                }
                            }));
                        }
                    }
                    if (part.inlineData?.mimeType?.startsWith("audio/")) {
                        playAudio(part.inlineData.data);
                    }
                    if (part.text) {
                        // Append to transcript instead of replacing
                        setTranscript(prev => {
                            const lines = prev.split('\n');
                            if (lines.length > 5) lines.shift();
                            return [...lines, part.text].join('\n');
                        });
                    }
                }
            }
        };

        ws.onclose = (event) => {
            setIsConnected(false);
            console.log(`[WS Close] Code: ${event.code}, Reason: ${event.reason}`);
            if (event.code === 1006) {
                console.error("Connection failed (possibly network, API key, or region issues).");
            }
        };
        ws.onerror = (err) => {
            console.error("WS Error Details:", err);
        };
    }, [apiKey, model, systemInstruction]);

    const playAudio = async (base64Data: string) => {
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        }
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        // Assume PCM 16-bit 24kHz (default for Gemini)
        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

        const buffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        source.start();
    };

    const startStreaming = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                },
                video: { width: 480, height: 360, frameRate: 10 }
            });
            streamRef.current = stream;
            setIsRecording(true);

            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(2048, 1, 1);
            processorRef.current = processor;

            source.connect(processor);
            processor.connect(audioContext.destination);

            processor.onaudioprocess = (e) => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcm16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        const s = Math.max(-1, Math.min(1, inputData[i]));
                        pcm16[i] = s < 0 ? s * 32768 : s * 32767;
                    }

                    wsRef.current.send(JSON.stringify({
                        realtime_input: {
                            media_chunks: [{
                                mime_type: "audio/pcm;rate=16000",
                                data: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
                            }]
                        }
                    }));
                }
            };

            // Faster Video Frames Capture using Canvas
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            const ctx = canvas.getContext('2d');
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();

            const captureFrame = () => {
                if (wsRef.current?.readyState === WebSocket.OPEN && isRecording) {
                    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];

                    wsRef.current.send(JSON.stringify({
                        realtime_input: {
                            media_chunks: [{
                                mime_type: "image/jpeg",
                                data: base64
                            }]
                        }
                    }));
                }
                if (isRecording) {
                    workerRef.current = window.setTimeout(captureFrame, 2000); // 0.5 FPS
                }
            };
            captureFrame();

        } catch (err) {
            console.error("Media error:", err);
        }
    };

    const disconnect = useCallback(() => {
        if (workerRef.current) clearTimeout(workerRef.current);
        wsRef.current?.close();
        streamRef.current?.getTracks().forEach(t => t.stop());
        processorRef.current?.disconnect();
        if (audioContextRef.current) audioContextRef.current.close();
        setIsRecording(false);
        setIsConnected(false);
    }, []);

    return { isConnected, isRecording, transcript, metrics, connect, disconnect, startStreaming };
}
