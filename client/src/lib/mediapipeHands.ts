/**
 * MediaPipe Hands Integration
 * Runs hand tracking in the browser using MediaPipe's pre-trained model.
 * 
 * Uses dynamic CDN loading to avoid bundling issues in production.
 */
import type { Landmark, HandState } from './types'

// MediaPipe types (loaded dynamically)
interface MediaPipeResults {
  multiHandLandmarks?: Array<Array<{ x: number; y: number; z: number }>>
  multiHandedness?: Array<{ label: string; score: number }>
}

interface MediaPipeHands {
  setOptions(options: Record<string, unknown>): void
  onResults(callback: (results: MediaPipeResults) => void): void
  initialize(): Promise<void>
  send(input: { image: HTMLCanvasElement }): Promise<void>
  close(): Promise<void>
}

interface MediaPipeHandsConstructor {
  new (config: { locateFile: (file: string) => string }): MediaPipeHands
}

export interface MediaPipeHandsConfig {
  maxNumHands?: number
  modelComplexity?: 0 | 1
  minDetectionConfidence?: number
  minTrackingConfidence?: number
}

export interface HandResults {
  handState: HandState | null
  rawResults: MediaPipeResults | null
}

export type HandResultsCallback = (results: HandResults) => void

// Global flag to track if MediaPipe is loaded
let mediapipeLoaded = false
let HandsClass: MediaPipeHandsConstructor | null = null

/**
 * Dynamically load MediaPipe Hands from CDN
 */
async function loadMediaPipe(): Promise<MediaPipeHandsConstructor> {
  if (HandsClass) return HandsClass
  
  if (mediapipeLoaded) {
    // Wait a bit for it to be available on window
    await new Promise(resolve => setTimeout(resolve, 100))
    if ((window as any).Hands) {
      HandsClass = (window as any).Hands
      return HandsClass!
    }
  }
  
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if ((window as any).Hands) {
      HandsClass = (window as any).Hands
      mediapipeLoaded = true
      resolve(HandsClass!)
      return
    }
    
    // Load the script
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js'
    script.crossOrigin = 'anonymous'
    
    script.onload = () => {
      mediapipeLoaded = true
      // MediaPipe exposes Hands on window
      if ((window as any).Hands) {
        HandsClass = (window as any).Hands
        console.log('[MediaPipe] Loaded from CDN')
        resolve(HandsClass!)
      } else {
        reject(new Error('MediaPipe Hands not found on window after loading'))
      }
    }
    
    script.onerror = () => {
      reject(new Error('Failed to load MediaPipe Hands from CDN'))
    }
    
    document.head.appendChild(script)
  })
}

/**
 * Hand Tracker using manual frame processing (like Python cv2 approach)
 */
export class HandTracker {
  private hands: MediaPipeHands | null = null
  private videoElement: HTMLVideoElement | null = null
  private processingCanvas: HTMLCanvasElement | null = null
  private processingCtx: CanvasRenderingContext2D | null = null
  private callback: HandResultsCallback | null = null
  private animationFrameId: number | null = null
  private isRunning = false
  private lastResults: MediaPipeResults | null = null
  
  private frameWidth = 640
  private frameHeight = 480

  constructor(private config: MediaPipeHandsConfig = {}) {
    this.config = {
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
      ...config
    }
  }

  /**
   * Initialize MediaPipe Hands model
   */
  async initialize(): Promise<void> {
    // Dynamically load MediaPipe from CDN
    const Hands = await loadMediaPipe()
    
    this.hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      }
    })

    this.hands.setOptions({
      maxNumHands: this.config.maxNumHands,
      modelComplexity: this.config.modelComplexity,
      minDetectionConfidence: this.config.minDetectionConfidence,
      minTrackingConfidence: this.config.minTrackingConfidence,
    })

    this.hands.onResults(this.handleResults.bind(this))

    // Create offscreen canvas for frame processing
    this.processingCanvas = document.createElement('canvas')
    this.processingCtx = this.processingCanvas.getContext('2d', {
      willReadFrequently: true
    })

    // Wait for model to load
    await this.hands.initialize()
    console.log('[HandTracker] MediaPipe Hands initialized')
  }

  /**
   * Start tracking hands from video element
   */
  async start(
    videoElement: HTMLVideoElement, 
    callback: HandResultsCallback
  ): Promise<void> {
    if (!this.hands) {
      await this.initialize()
    }

    this.videoElement = videoElement
    this.callback = callback
    this.isRunning = true

    this.frameWidth = videoElement.videoWidth || 640
    this.frameHeight = videoElement.videoHeight || 480
    
    if (this.processingCanvas) {
      this.processingCanvas.width = this.frameWidth
      this.processingCanvas.height = this.frameHeight
    }

    console.log(`[HandTracker] Starting with frame size: ${this.frameWidth}x${this.frameHeight}`)
    this.processFrame()
  }

  /**
   * Main frame processing loop
   */
  private async processFrame(): Promise<void> {
    if (!this.isRunning || !this.videoElement || !this.hands) {
      return
    }

    const video = this.videoElement
    const ctx = this.processingCtx
    const canvas = this.processingCanvas

    if (ctx && canvas && video.readyState >= 2) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        this.frameWidth = video.videoWidth
        this.frameHeight = video.videoHeight
      }

      // Flip horizontally like cv2.flip(frame, 1)
      ctx.save()
      ctx.scale(-1, 1)
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
      ctx.restore()

      try {
        await this.hands.send({ image: canvas })
      } catch (err) {
        console.error('[HandTracker] Error processing frame:', err)
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.processFrame())
  }

  /**
   * Handle MediaPipe detection results
   */
  private handleResults(results: MediaPipeResults): void {
    this.lastResults = results

    if (!this.callback) return

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.callback({ handState: null, rawResults: results })
      return
    }

    const landmarks = results.multiHandLandmarks[0]
    const rawHandedness = results.multiHandedness?.[0]?.label
    const handedness = rawHandedness === 'Left' ? 'Right' : 'Left' as 'Left' | 'Right'
    const confidence = results.multiHandedness?.[0]?.score || 0

    const convertedLandmarks: Landmark[] = landmarks.map(lm => ({
      x: lm.x,
      y: lm.y,
      z: lm.z
    }))

    const handState: HandState = {
      landmarks: convertedLandmarks,
      handedness,
      confidence,
      timestamp: Date.now()
    }

    this.callback({ handState, rawResults: results })
  }

  getFrameDimensions(): { width: number; height: number } {
    return { width: this.frameWidth, height: this.frameHeight }
  }

  getLastResults(): MediaPipeResults | null {
    return this.lastResults
  }

  getIsRunning(): boolean {
    return this.isRunning
  }

  stop(): void {
    this.isRunning = false
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }

    this.callback = null
    this.lastResults = null
    this.videoElement = null
    console.log('[HandTracker] Stopped')
  }

  async dispose(): Promise<void> {
    this.stop()
    
    if (this.hands) {
      await this.hands.close()
      this.hands = null
    }

    this.processingCanvas = null
    this.processingCtx = null
    
    console.log('[HandTracker] Disposed')
  }
}

// Singleton instance
let trackerInstance: HandTracker | null = null

export function getHandTracker(config?: MediaPipeHandsConfig): HandTracker {
  if (!trackerInstance) {
    trackerInstance = new HandTracker(config)
  }
  return trackerInstance
}

export function disposeHandTracker(): void {
  if (trackerInstance) {
    trackerInstance.dispose()
    trackerInstance = null
  }
}
