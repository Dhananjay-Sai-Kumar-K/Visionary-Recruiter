class AdvancedAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.ptr = 0;
    this.noiseGateThreshold = 0.015;

    this.port.onmessage = (event) => {
      if (event.data.type === 'SET_THRESHOLD') {
        this.noiseGateThreshold = event.data.value;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];
    
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.ptr] = channel[i];
      this.ptr++;

      if (this.ptr >= this.bufferSize) {
        this.processAndSend();
        this.ptr = 0;
      }
    }

    return true;
  }

  processAndSend() {
    // 1. Calculate RMS for VAD/UI
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) {
        sum += this.buffer[i] * this.buffer[i];
    }
    const rms = Math.sqrt(sum / this.buffer.length);

    // 2. Send RAW audio. Gating usually hurts the model's performance.
    // We send a copy to avoid modification during concurrent processing
    this.port.postMessage({
      audio: new Float32Array(this.buffer),
      rms: rms
    });
  }
}

registerProcessor('advanced-audio-processor', AdvancedAudioProcessor);
