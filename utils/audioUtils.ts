import { Blob } from '@google/genai';

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  // PCM data from Gemini is 16-bit little-endian
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Resamples audio data to 16kHz (required by Gemini Live API) and converts to 16-bit PCM.
 * This handles microphones running at 44.1kHz, 48kHz, etc.
 */
function downsampleTo16k(inputData: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const l = inputData.length;
    const result = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return result;
  }

  const ratio = inputSampleRate / 16000;
  const newLength = Math.ceil(inputData.length / ratio);
  const result = new Int16Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const index = i * ratio;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    const weight = index - low;
    
    // Boundary check
    const val1 = inputData[Math.min(low, inputData.length - 1)];
    const val2 = inputData[Math.min(high, inputData.length - 1)];
    
    // Linear interpolation
    const val = val1 * (1 - weight) + val2 * weight;
    
    // Clamp and convert
    const s = Math.max(-1, Math.min(1, val));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

export function createPcmBlob(data: Float32Array, sampleRate: number): Blob {
  const pcm16k = downsampleTo16k(data, sampleRate);
  
  return {
    data: arrayBufferToBase64(pcm16k.buffer),
    mimeType: 'audio/pcm;rate=16000',
  };
}