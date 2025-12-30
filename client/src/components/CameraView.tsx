/**
 * CameraView Component
 * 
 * Renders webcam feed with hand tracking overlay.
 * Uses single-canvas approach for accurate landmark mapping.
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import type { HandState, Landmark } from '../lib/types'
import { HandTracker, type HandResults } from '../lib/mediapipeHands'
import { extractFeatures } from '../lib/featureExtract'
import { getASLClassifier, disposeASLClassifier, type ClassificationResult } from '../lib/aslClassifier'
import './CameraView.css'

// Hand landmark connections
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
    return () => { disposeASLClassifier() }
  }, [])

  const drawLandmarks = (
    ctx: CanvasRenderingContext2D,
    landmarks: Landmark[],
    width: number,
    height: number
  ) => {
    if (!landmarks || landmarks.length !== 21) return

    // Draw connections - cleaner dark style
    ctx.strokeStyle = '#18181b'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'

    for (const [start, end] of HAND_CONNECTIONS) {
      const startLm = landmarks[start]
      const endLm = landmarks[end]
      
      ctx.beginPath()
      ctx.moveTo(startLm.x * width, startLm.y * height)
      ctx.lineTo(endLm.x * width, endLm.y * height)
      ctx.stroke()
    }

    // Draw landmarks
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i]
      const x = lm.x * width
      const y = lm.y * height
      const isFingertip = FINGERTIPS.includes(i)

      ctx.beginPath()
      ctx.arc(x, y, isFingertip ? 7 : 4, 0, 2 * Math.PI)
      ctx.fillStyle = isFingertip ? '#18181b' : '#52525b'
      ctx.fill()

      if (isFingertip) {
        ctx.beginPath()
        ctx.arc(x, y, 10, 0, 2 * Math.PI)
        ctx.strokeStyle = 'rgba(24, 24, 27, 0.3)'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  }

  const renderLoop = useCallback(() => {
    if (!isRunningRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')

    if (ctx && canvas && video && video.readyState >= 2) {
      const width = canvas.width
      const height = canvas.height

      ctx.clearRect(0, 0, width, height)

      // Draw video frame (flipped for mirror)
      ctx.save()
      ctx.scale(-1, 1)
      ctx.drawImage(video, -width, 0, width, height)
      ctx.restore()

      const results = lastResultsRef.current
      if (results?.handState?.landmarks) {
        drawLandmarks(ctx, results.handState.landmarks, width, height)
      }
    }

    animationRef.current = requestAnimationFrame(renderLoop)
  }, [])

  const handleTrackingResults = useCallback(async (results: HandResults) => {
    lastResultsRef.current = results

    if (results.handState) {
      setHandDetected(true)

      let mlPrediction: string | undefined
      let mlConfidence: number | undefined
      
      const classifier = getASLClassifier()
      if (classifier.getIsReady()) {
        const result = await classifier.classify(results.handState.landmarks)
        setClassification(result)
        mlPrediction = result.prediction || undefined
        mlConfidence = result.confidence
      }

      const features = extractFeatures(results.handState.landmarks)
      
      const enrichedState: HandState = {
        ...results.handState,
        mlPrediction,
        mlConfidence,
        features: features ? {
          fingerCurls: features.fingerCurls,
          fingertipDistances: features.fingertipDistances,
          fingerSpread: features.fingerSpread,
          palmFacing: features.palmFacing,
          thumbPosition: features.thumbPosition,
          fingersSpread: features.fingersSpread
        } : undefined
      }
      onHandStateRef.current(enrichedState)
    } else {
      setHandDetected(false)
      setClassification(null)
    }
  }, [])

  useEffect(() => {
    const cleanup = () => {
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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        })

        if (!mounted) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) throw new Error('Video element not available')

        video.srcObject = stream

        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); resolve() }
          const onError = () => { reject(new Error('Video failed to load')) }
          video.addEventListener('loadedmetadata', onLoaded)
          video.addEventListener('error', onError)
        })

        if (!mounted) return
        await video.play()
        if (!mounted) return

        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }

        const tracker = new HandTracker({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.5
        })
        trackerRef.current = tracker

        await tracker.start(video, handleTrackingResults)
        if (!mounted) return

        isRunningRef.current = true
        cameraReadyRef.current = true
        setCameraReady(true)
        setIsLoading(false)
        renderLoop()

      } catch (err) {
        if (!mounted) return
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
  }, [isActive])

  return (
    <div className="camera-view">
      <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
      
      <canvas
        ref={canvasRef}
        className="camera-canvas"
        style={{ display: isActive && cameraReady ? 'block' : 'none' }}
      />

      {/* Corner Guides */}
      {isActive && cameraReady && <div className="camera-guides" />}

      {/* Inactive State */}
      {!isActive && (
        <div className="camera-inactive">
          <div className="camera-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <h3>Camera Ready</h3>
          <p>Start a session to activate your camera and begin learning ASL with your AI coach.</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="camera-loading">
          <div className="loading-spinner" />
          <p>Initializing camera...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="camera-inactive">
          <div className="camera-icon" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M15 9l-6 6M9 9l6 6"/>
            </svg>
          </div>
          <h3>Camera Error</h3>
          <p>{error}</p>
        </div>
      )}

      {/* Tracking Badge */}
      {isActive && cameraReady && (
        <div className={`tracking-badge ${handDetected ? 'detected' : ''}`}>
          <span className="tracking-dot" />
          {handDetected ? 'Hand Detected' : 'Waiting for hand'}
        </div>
      )}

      {/* Prediction Display */}
      {isActive && cameraReady && classification?.prediction && classification.confidence > 0.5 && (
        <div className={`prediction-badge ${classification.confidence > 0.8 ? 'high' : 'medium'}`}>
          <span className="prediction-letter">{classification.prediction}</span>
          <span className="prediction-confidence">{Math.round(classification.confidence * 100)}% match</span>
        </div>
      )}
    </div>
  )
}
