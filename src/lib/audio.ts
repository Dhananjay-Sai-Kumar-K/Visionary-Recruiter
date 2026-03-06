/**
 * Audio processing utilities for Gemini Live API
 */

export function pcmToFloat32(pcmData: Int16Array): Float32Array {
    const float32 = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
        float32[i] = pcmData[i] / 32768.0;
    }
    return float32;
}

export function float32ToPcm(float32Data: Float32Array): Int16Array {
    const pcm = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Data[i]));
        pcm[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return pcm;
}

export async function getAudioContext(): Promise<AudioContext> {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    return new AudioContextClass({ sampleRate: 16000 });
}
