/**
 * CameraView Component
 * 
 * Renders webcam feed with hand tracking overlay.
 * Uses single-canvas approach (like Python cv2 + MediaPipe) for accurate landmark mapping.
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import type { HandState, Landmark } from '../lib/types'
import { HandTracker, type HandResults } from '../lib/mediapipeHands'
import { extractFeatures } from '../lib/featureExtract'
import { getASLClassifier, disposeASLClassifier, type ClassificationResult } from '../lib/aslClassifier'
import './CameraView.css'

// Hand landmark connections (same as Python HAND_CONNECTIONS)
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16], // ring
  [0, 17], [17, 18], [18, 19], [19, 20], // pinky
  [5, 9], [9, 13], [13, 17]             // palm
]

const FINGERTIPS = [4, 8, 12, 16, 20]

interface CameraViewProps {
  isActive: boolean
  onHandState: (handState: HandState) => void
}

export default function CameraView({ isActive, onHandState }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  const trackerRef = useRef<HandTracker | null>(null)
  const lastResultsRef = useRef<HandResults | null>(null)
  const isRunningRef = useRef(false)
  const cameraReadyRef = useRef(false)
  
  // Stable callback ref for onHandState
  const onHandStateRef = useRef(onHandState)
  onHandStateRef.current = onHandState
  
  const [cameraReady, setCameraReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [handDetected, setHandDetected] = useState(false)
  const [classification, setClassification] = useState<ClassificationResult | null>(null)
  
  // Load ASL classifier on mount
  useEffect(() => {
    const classifier = getASLClassifier()
    classifier.loadModel('/models/asl_classifier/model.json')
      .then(() => {
        console.log('[CameraView] ASL classifier loaded')
      })
      .catch(err => {
        console.error('[CameraView] Failed to load ASL classifier:', err)
      })
    
    return () => {
      disposeASLClassifier()
    }
  }, [])

  /**
   * Draw hand landmarks on canvas (like Python get_debug_frame)
   */
  const drawLandmarks = (
    ctx: CanvasRenderingContext2D,
    landmarks: Landmark[],
    width: number,
    height: number
  ) => {
    if (!landmarks || landmarks.length !== 21) return

    // Draw connections first
    ctx.strokeStyle = '#6366f1'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'

    for (const [start, end] of HAND_CONNECTIONS) {
      const startLm = landmarks[start]
      const endLm = landmarks[end]
      
      const x1 = startLm.x * width
      const y1 = startLm.y * height
      const x2 = endLm.x * width
      const y2 = endLm.y * height

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }

    // Draw landmarks
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i]
      const x = lm.x * width
      const y = lm.y * height
      const isFingertip = FINGERTIPS.includes(i)

      // Draw filled circle
      ctx.beginPath()
      ctx.arc(x, y, isFingertip ? 8 : 5, 0, 2 * Math.PI)
      ctx.fillStyle = isFingertip ? '#f59e0b' : '#10b981'
      ctx.fill()

      // Add glow for fingertips
      if (isFingertip) {
        ctx.beginPath()
        ctx.arc(x, y, 12, 0, 2 * Math.PI)
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)'
        ctx.lineWidth = 3
        ctx.stroke()
      }
    }
  }

  /**
   * Draw "no hand detected" indicator
   */
  const drawNoHandIndicator = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => {
    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.fillRect(0, 0, width, height)
    
    // Hand icon
    ctx.font = '64px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.fillText('✋', width / 2, height / 2 - 40)
    
    // Text
    ctx.font = '18px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillText('Show your hand to the camera', width / 2, height / 2 + 40)
  }

  /**
   * Draw confidence bar
   */
  const drawConfidenceBar = (
    ctx: CanvasRenderingContext2D,
    conf: number,
    width: number,
    height: number
  ) => {
    const barWidth = 120
    const barHeight = 8
    const padding = 16
    const x = width - barWidth - padding
    const y = height - barHeight - padding - 20

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.beginPath()
    ctx.roundRect(x - 8, y - 24, barWidth + 16, barHeight + 36, 8)
    ctx.fill()

    // Label
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillText(`Confidence: ${Math.round(conf * 100)}%`, x, y - 8)

    // Track
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.beginPath()
    ctx.roundRect(x, y, barWidth, barHeight, 4)
    ctx.fill()

    // Fill
    const fillColor = conf > 0.8 ? '#10b981' : conf > 0.5 ? '#f59e0b' : '#ef4444'
    ctx.fillStyle = fillColor
    ctx.beginPath()
    ctx.roundRect(x, y, barWidth * conf, barHeight, 4)
    ctx.fill()
  }

  /**
   * Main render loop - draws video frame and landmarks
   * Uses refs to avoid dependency issues
   */
  const renderLoop = useCallback(() => {
    if (!isRunningRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')

    if (ctx && canvas && video && video.readyState >= 2) {
      const width = canvas.width
      const height = canvas.height

      // Clear canvas
      ctx.clearRect(0, 0, width, height)

      // Draw video frame (flipped horizontally for mirror effect)
      ctx.save()
      ctx.scale(-1, 1)
      ctx.drawImage(video, -width, 0, width, height)
      ctx.restore()

      // Draw landmarks if we have results
      const results = lastResultsRef.current
      if (results?.handState?.landmarks) {
        drawLandmarks(ctx, results.handState.landmarks, width, height)
        drawConfidenceBar(ctx, results.handState.confidence, width, height)
      } else if (cameraReadyRef.current) {
        drawNoHandIndicator(ctx, width, height)
      }
    }

    animationRef.current = requestAnimationFrame(renderLoop)
  }, [])

  /**
   * Handle hand tracking results - uses ref to avoid triggering effects
   */
  const handleTrackingResults = useCallback(async (results: HandResults) => {
    lastResultsRef.current = results

    if (results.handState) {
      setHandDetected(true)

      // Run ML classification
      const classifier = getASLClassifier()
      if (classifier.getIsReady()) {
        const result = await classifier.classify(results.handState.landmarks)
        setClassification(result)
      }

      // Extract features for classification
      const features = extractFeatures(results.handState.landmarks)
      if (features) {
        // Enrich hand state with features
        const enrichedState: HandState = {
          ...results.handState,
          features: {
            fingerCurls: features.fingerCurls,
            fingertipDistances: features.fingertipDistances,
            fingerSpread: features.fingerSpread,
            palmFacing: features.palmFacing,
            thumbPosition: features.thumbPosition,
            fingersSpread: features.fingersSpread
          }
        }
        onHandStateRef.current(enrichedState)
      } else {
        onHandStateRef.current(results.handState)
      }
    } else {
      setHandDetected(false)
      setClassification(null)
    }
  }, [])

  /**
   * Initialize camera and tracking - only depends on isActive
   */
  useEffect(() => {
    // Cleanup function
    const cleanup = () => {
      console.log('[CameraView] Cleaning up...')
      isRunningRef.current = false
      cameraReadyRef.current = false

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }

      if (trackerRef.current) {
        trackerRef.current.stop()
        trackerRef.current = null
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }

      lastResultsRef.current = null
      setCameraReady(false)
      setHandDetected(false)
      setError(null)
    }

    if (!isActive) {
      cleanup()
      return
    }

    let mounted = true

    async function startTracking() {
      setIsLoading(true)
      setError(null)

      try {
        // Get camera stream
        console.log('[CameraView] Requesting camera access...')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          }
        })

        if (!mounted) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream

        const video = videoRef.current
        if (!video) throw new Error('Video element not available')

        video.srcObject = stream

        // Wait for video metadata to load
        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => {
            video.removeEventListener('loadedmetadata', onLoaded)
            video.removeEventListener('error', onError)
            resolve()
          }
          const onError = () => {
            video.removeEventListener('loadedmetadata', onLoaded)
            video.removeEventListener('error', onError)
            reject(new Error('Video failed to load'))
          }
          video.addEventListener('loadedmetadata', onLoaded)
          video.addEventListener('error', onError)
        })

        if (!mounted) return

        // Start video playback
        await video.play()
        console.log('[CameraView] Video playing')

        if (!mounted) return

        // Set canvas dimensions to match video
        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          console.log(`[CameraView] Canvas size: ${canvas.width}x${canvas.height}`)
        }

        // Initialize hand tracker (create fresh instance)
        console.log('[CameraView] Initializing hand tracker...')
        const tracker = new HandTracker({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.5
        })
        trackerRef.current = tracker

        await tracker.start(video, handleTrackingResults)

        if (!mounted) return

        // Mark as ready
        isRunningRef.current = true
        cameraReadyRef.current = true
        setCameraReady(true)
        setIsLoading(false)

        // Start render loop
        renderLoop()

        console.log('[CameraView] Ready!')

      } catch (err) {
        if (!mounted) return
        console.error('[CameraView] Error:', err)
        setError(err instanceof Error ? err.message : 'Failed to start camera')
        setIsLoading(false)
      }
    }

    startTracking()

    return () => {
      mounted = false
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]) // Only re-run when isActive changes - callbacks use refs and are stable

  return (
    <div className="camera-view">
      {/* Hidden video element for capture */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ display: 'none' }}
      />

      {/* Main display canvas */}
      <canvas
        ref={canvasRef}
        className="camera-canvas"
        style={{ display: isActive && cameraReady ? 'block' : 'none' }}
      />

      {/* Placeholder when inactive */}
      {!isActive && (
        <div className="camera-placeholder">
          <div className="placeholder-content">
            <span className="placeholder-icon">📹</span>
            <p>Click "Start Session" to begin</p>
            <p className="placeholder-hint">Camera will activate automatically</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="camera-loading">
          <div className="loading-spinner"></div>
          <p>Loading hand tracking model...</p>
          <p className="loading-hint">This may take a few seconds</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="camera-error">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {/* Status badges */}
      {isActive && cameraReady && (
        <>
          <div className={`camera-badge ${handDetected ? 'tracking' : ''}`}>
            <span className="live-dot"></span>
            {handDetected ? 'TRACKING' : 'LIVE'}
          </div>

          {/* Classification result - prominent display */}
          {classification && classification.prediction && classification.confidence > 0.5 && (
            <div className="classification-display">
              <div className="predicted-letter">{classification.prediction}</div>
              <div className="prediction-confidence">
                {Math.round(classification.confidence * 100)}%
              </div>
              <div className="prediction-alternatives">
                {classification.topK.slice(1, 4).map((item, idx) => (
                  <span key={idx} className="alt-prediction">
                    {item.label}: {Math.round(item.confidence * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}

        </>
      )}
    </div>
  )
}
