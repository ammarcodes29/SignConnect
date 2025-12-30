/**
 * Audio Capture Module
 * Captures microphone audio and converts to format suitable for Deepgram ASR.
 * 
 * Deepgram expects: PCM 16-bit, 16kHz, mono
 */

export interface AudioCaptureOptions {
  onAudioChunk: (chunk: string) => void  // Base64 encoded PCM data
  onError?: (error: Error) => void
  sampleRate?: number  // Default 16000
  chunkInterval?: number  // ms between chunks, default 100
}

export class AudioCapture {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private isCapturing = false
  
  private options: Required<AudioCaptureOptions>
  private audioBuffer: Float32Array[] = []
  private chunkTimer: number | null = null

  constructor(options: AudioCaptureOptions) {
    this.options = {
      onAudioChunk: options.onAudioChunk,
      onError: options.onError || console.error,
      sampleRate: options.sampleRate || 16000,
      chunkInterval: options.chunkInterval || 100,
    }
  }

  async start(): Promise<boolean> {
    if (this.isCapturing) return true

    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: this.options.sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: this.options.sampleRate,
      })

      // Create source from mic stream
      this.source = this.audioContext.createMediaStreamSource(this.stream)

      // Create processor for raw audio access
      // Note: ScriptProcessorNode is deprecated but still widely supported
      // AudioWorklet would be the modern approach but more complex
      const bufferSize = 4096
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

      this.processor.onaudioprocess = (event) => {
        if (!this.isCapturing) return
        
        const inputData = event.inputBuffer.getChannelData(0)
        // Clone the data since it gets reused
        this.audioBuffer.push(new Float32Array(inputData))
      }

      // Connect the audio graph
      this.source.connect(this.processor)
      this.processor.connect(this.audioContext.destination)

      // Start chunk timer
      this.chunkTimer = window.setInterval(() => {
        this.flushBuffer()
      }, this.options.chunkInterval)

      this.isCapturing = true
      console.log('[AudioCapture] Started')
      return true

    } catch (error) {
      console.error('[AudioCapture] Failed to start:', error)
      this.options.onError(error as Error)
      return false
    }
  }

  private flushBuffer() {
    if (this.audioBuffer.length === 0) return

    // Concatenate all buffered audio
    const totalLength = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0)
    const combined = new Float32Array(totalLength)
    
    let offset = 0
    for (const chunk of this.audioBuffer) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    
    this.audioBuffer = []

    // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
    const pcm16 = new Int16Array(combined.length)
    for (let i = 0; i < combined.length; i++) {
      const s = Math.max(-1, Math.min(1, combined[i]))
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }

    // Convert to base64
    const bytes = new Uint8Array(pcm16.buffer)
    const base64 = this.arrayBufferToBase64(bytes)
    
    this.options.onAudioChunk(base64)
  }

  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < buffer.byteLength; i++) {
      binary += String.fromCharCode(buffer[i])
    }
    return btoa(binary)
  }

  stop() {
    this.isCapturing = false

    if (this.chunkTimer) {
      clearInterval(this.chunkTimer)
      this.chunkTimer = null
    }

    // Flush any remaining audio
    this.flushBuffer()

    if (this.processor) {
      this.processor.disconnect()
      this.processor = null
    }

    if (this.source) {
      this.source.disconnect()
      this.source = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }

    this.audioBuffer = []
    console.log('[AudioCapture] Stopped')
  }

  get capturing(): boolean {
    return this.isCapturing
  }
}


/**
 * React hook for audio capture
 * Uses a ref for the callback to avoid stale closure issues
 */
import { useRef, useCallback, useState, useEffect } from 'react'

export function useAudioCapture(onAudioChunk: (chunk: string) => void) {
  const captureRef = useRef<AudioCapture | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  
  // Keep callback in a ref so AudioCapture always has the latest version
  const callbackRef = useRef(onAudioChunk)
  useEffect(() => {
    callbackRef.current = onAudioChunk
  }, [onAudioChunk])

  const start = useCallback(async () => {
    if (captureRef.current?.capturing) return true

    captureRef.current = new AudioCapture({
      // Use a wrapper that calls the current ref value
      onAudioChunk: (chunk) => callbackRef.current(chunk),
      onError: (err) => {
        console.error('[useAudioCapture] Error:', err)
        setIsCapturing(false)
      },
    })

    const success = await captureRef.current.start()
    setIsCapturing(success)
    return success
  }, [])  // No dependencies - callback is accessed via ref

  const stop = useCallback(() => {
    captureRef.current?.stop()
    captureRef.current = null
    setIsCapturing(false)
  }, [])

  return { isCapturing, start, stop }
}

