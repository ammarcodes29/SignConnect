/**
 * MediaPipe Hands Integration
 * Runs hand tracking in the browser using MediaPipe's pre-trained model.
 * 
 * This implementation mirrors the Python OpenCV + MediaPipe approach:
 * - Manually capture and flip frames
 * - Process flipped frames for correct landmark mapping
 * - No CSS transforms needed
 */
import { Hands, Results } from '@mediapipe/hands'
import type { Landmark, HandState } from './types'

export interface MediaPipeHandsConfig {
  maxNumHands?: number
  modelComplexity?: 0 | 1
  minDetectionConfidence?: number
  minTrackingConfidence?: number
}

export interface HandResults {
  handState: HandState | null
  rawResults: Results | null
}

export type HandResultsCallback = (results: HandResults) => void

/**
 * Hand Tracker using manual frame processing (like Python cv2 approach)
 * This gives us full control over coordinate systems
 */
export class HandTracker {
  private hands: Hands | null = null
  private videoElement: HTMLVideoElement | null = null
  private processingCanvas: HTMLCanvasElement | null = null
  private processingCtx: CanvasRenderingContext2D | null = null
  private callback: HandResultsCallback | null = null
  private animationFrameId: number | null = null
  private isRunning = false
  private lastResults: Results | null = null
  
  // Frame dimensions
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

    // Set processing canvas size to match video
    this.frameWidth = videoElement.videoWidth || 640
    this.frameHeight = videoElement.videoHeight || 480
    
    if (this.processingCanvas) {
      this.processingCanvas.width = this.frameWidth
      this.processingCanvas.height = this.frameHeight
    }

    console.log(`[HandTracker] Starting with frame size: ${this.frameWidth}x${this.frameHeight}`)
    
    // Start the processing loop
    this.processFrame()
  }

  /**
   * Main frame processing loop
   * Similar to Python: capture -> flip -> detect
   */
  private async processFrame(): Promise<void> {
    if (!this.isRunning || !this.videoElement || !this.hands) {
      return
    }

    const video = this.videoElement
    const ctx = this.processingCtx
    const canvas = this.processingCanvas

    if (ctx && canvas && video.readyState >= 2) {
      // Update canvas size if video size changed
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        this.frameWidth = video.videoWidth
        this.frameHeight = video.videoHeight
      }

      // CRITICAL: Flip horizontally like cv2.flip(frame, 1)
      // This ensures landmarks are in the mirrored coordinate space
      ctx.save()
      ctx.scale(-1, 1)
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
      ctx.restore()

      // Send flipped frame to MediaPipe
      try {
        await this.hands.send({ image: canvas })
      } catch (err) {
        console.error('[HandTracker] Error processing frame:', err)
      }
    }

    // Continue the loop
    this.animationFrameId = requestAnimationFrame(() => this.processFrame())
  }

  /**
   * Handle MediaPipe detection results
   */
  private handleResults(results: Results): void {
    this.lastResults = results

    if (!this.callback) return

    // Check if hand detected
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.callback({ handState: null, rawResults: results })
      return
    }

    // Get the first hand
    const landmarks = results.multiHandLandmarks[0]
    // Note: handedness is flipped because we flipped the frame
    const rawHandedness = results.multiHandedness?.[0]?.label
    const handedness = rawHandedness === 'Left' ? 'Right' : 'Left' as 'Left' | 'Right'
    const confidence = results.multiHandedness?.[0]?.score || 0

    // Convert to our Landmark format
    // Coordinates are already in the flipped space (0-1 normalized)
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

  /**
   * Get frame dimensions
   */
  getFrameDimensions(): { width: number; height: number } {
    return { width: this.frameWidth, height: this.frameHeight }
  }

  /**
   * Get the last detection results
   */
  getLastResults(): Results | null {
    return this.lastResults
  }

  /**
   * Check if tracker is running
   */
  getIsRunning(): boolean {
    return this.isRunning
  }

  /**
   * Stop tracking
   */
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

  /**
   * Cleanup resources
   */
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

// Singleton instance for app-wide use
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
