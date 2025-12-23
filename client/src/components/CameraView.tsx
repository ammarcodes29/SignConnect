import { useRef, useEffect, useState } from 'react'
import type { HandState, Landmark } from '../lib/types'
import './CameraView.css'

interface CameraViewProps {
  isActive: boolean
  onHandState: (handState: HandState) => void
}

export default function CameraView({ isActive, onHandState }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isActive) {
      // Stop camera when session ends
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
        tracks.forEach(track => track.stop())
        videoRef.current.srcObject = null
      }
      setCameraReady(false)
      return
    }

    // Start camera when session begins
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          }
        })
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraReady(true)
          setError(null)
          
          // Send stub hand state periodically for demo
          // TODO: Replace with real MediaPipe integration
          const interval = setInterval(() => {
            const stubHandState: HandState = {
              landmarks: generateStubLandmarks(),
              handedness: 'Right',
              confidence: 0.95,
              timestamp: Date.now()
            }
            onHandState(stubHandState)
          }, 500)

          return () => clearInterval(interval)
        }
      } catch (err) {
        console.error('Camera access error:', err)
        setError('Unable to access camera. Please grant permission.')
      }
    }

    startCamera()
  }, [isActive, onHandState])

  // Draw overlay on canvas (placeholder for hand landmarks)
  useEffect(() => {
    if (!cameraReady || !canvasRef.current || !videoRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const video = videoRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Simple animation loop for future landmark drawing
    let animationId: number
    
    function draw() {
      if (!ctx || !video) return
      // Clear and prepare for landmark overlay
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // TODO: Draw hand landmarks here when MediaPipe is integrated
      animationId = requestAnimationFrame(draw)
    }
    
    draw()

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [cameraReady])

  return (
    <div className="camera-view">
      {!isActive && (
        <div className="camera-placeholder">
          <div className="placeholder-content">
            <span className="placeholder-icon">📹</span>
            <p>Click "Start Session" to begin</p>
            <p className="placeholder-hint">Camera will activate automatically</p>
          </div>
        </div>
      )}
      
      {error && (
        <div className="camera-error">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
        </div>
      )}
      
      <video 
        ref={videoRef} 
        className="camera-video"
        playsInline
        muted
        style={{ display: isActive && cameraReady ? 'block' : 'none' }}
      />
      
      <canvas 
        ref={canvasRef}
        className="camera-overlay"
        style={{ display: isActive && cameraReady ? 'block' : 'none' }}
      />
      
      {isActive && cameraReady && (
        <div className="camera-badge">
          <span className="live-dot"></span>
          LIVE
        </div>
      )}
    </div>
  )
}

// Generate stub landmarks for demo purposes
function generateStubLandmarks(): Landmark[] {
  return Array.from({ length: 21 }, (_, i) => ({
    x: 0.5 + Math.sin(Date.now() / 1000 + i) * 0.1,
    y: 0.5 + Math.cos(Date.now() / 1000 + i) * 0.1,
    z: 0
  }))
}

