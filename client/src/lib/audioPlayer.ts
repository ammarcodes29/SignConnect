/**
 * Audio Player Module
 * Plays TTS audio chunks streamed from the server.
 * Uses Web Audio API for low-latency playback.
 */

export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private audioQueue: ArrayBuffer[] = []
  private isPlaying = false
  private currentSource: AudioBufferSourceNode | null = null
  
  constructor() {
    // Initialize on first use to avoid autoplay restrictions
  }
  
  private async initContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }
    
    // Resume if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }
  
  /**
   * Add an audio chunk to the queue and start playing.
   * @param base64Data Base64-encoded MP3 audio data
   */
  async addChunk(base64Data: string) {
    try {
      await this.initContext()
      
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      
      this.audioQueue.push(bytes.buffer)
      
      // Start playing if not already
      if (!this.isPlaying) {
        await this.playNext()
      }
    } catch (error) {
      console.error('[AudioPlayer] Error adding chunk:', error)
    }
  }
  
  private async playNext() {
    if (!this.audioContext || this.audioQueue.length === 0) {
      this.isPlaying = false
      return
    }
    
    this.isPlaying = true
    
    // Combine all queued chunks into one buffer for smoother playback
    const combinedBuffer = this.combineBuffers(this.audioQueue)
    this.audioQueue = []
    
    try {
      // Decode the audio data
      const audioBuffer = await this.audioContext.decodeAudioData(combinedBuffer)
      
      // Create and play source
      const source = this.audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.audioContext.destination)
      
      source.onended = () => {
        this.currentSource = null
        // Check for more chunks
        if (this.audioQueue.length > 0) {
          this.playNext()
        } else {
          this.isPlaying = false
        }
      }
      
      this.currentSource = source
      source.start()
      
    } catch (error) {
      console.error('[AudioPlayer] Error decoding/playing audio:', error)
      this.isPlaying = false
      // Try next chunk if available
      if (this.audioQueue.length > 0) {
        await this.playNext()
      }
    }
  }
  
  private combineBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0)
    const combined = new Uint8Array(totalLength)
    
    let offset = 0
    for (const buffer of buffers) {
      combined.set(new Uint8Array(buffer), offset)
      offset += buffer.byteLength
    }
    
    return combined.buffer
  }
  
  /**
   * Stop current playback and clear queue.
   */
  stop() {
    if (this.currentSource) {
      this.currentSource.stop()
      this.currentSource = null
    }
    this.audioQueue = []
    this.isPlaying = false
  }
  
  /**
   * Close the audio context.
   */
  async close() {
    this.stop()
    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }
  }
}

// Singleton instance
let playerInstance: AudioPlayer | null = null

export function getAudioPlayer(): AudioPlayer {
  if (!playerInstance) {
    playerInstance = new AudioPlayer()
  }
  return playerInstance
}

export function disposeAudioPlayer() {
  if (playerInstance) {
    playerInstance.close()
    playerInstance = null
  }
}

