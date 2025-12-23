/**
 * Hand Landmark Drawing Utilities
 * Draws hand landmarks and connections on a canvas.
 */
import type { Landmark } from './types'

// MediaPipe hand landmark connections
// Each pair represents indices of landmarks that should be connected
export const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index finger
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle finger
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring finger
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm
  [5, 9], [9, 13], [13, 17]
]

// Landmark names for reference
export const LANDMARK_NAMES = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP'
]

// Fingertip indices
export const FINGERTIPS = [4, 8, 12, 16, 20]

export interface DrawOptions {
  connectionColor?: string
  connectionWidth?: number
  landmarkColor?: string
  landmarkRadius?: number
  fingertipColor?: string
  fingertipRadius?: number
  mirrored?: boolean  // Whether to flip X coordinates (for CSS-mirrored video)
}

const DEFAULT_OPTIONS: DrawOptions = {
  connectionColor: '#6366f1',
  connectionWidth: 3,
  landmarkColor: '#10b981',
  landmarkRadius: 5,
  fingertipColor: '#f59e0b',
  fingertipRadius: 8,
  mirrored: false
}

/**
 * Get pixel coordinates from normalized landmark
 */
function getCoords(
  lm: Landmark, 
  width: number, 
  height: number, 
  mirrored: boolean
): { x: number; y: number } {
  // If mirrored, flip X coordinate to match CSS transform: scaleX(-1)
  const x = mirrored ? (1 - lm.x) * width : lm.x * width
  const y = lm.y * height
  return { x, y }
}

/**
 * Draw hand landmarks on a canvas
 */
export function drawHandLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  options: DrawOptions = {}
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (!landmarks || landmarks.length !== 21) {
    return
  }

  const mirrored = opts.mirrored ?? false

  // Draw connections first (so landmarks appear on top)
  ctx.strokeStyle = opts.connectionColor!
  ctx.lineWidth = opts.connectionWidth!
  ctx.lineCap = 'round'

  for (const [start, end] of HAND_CONNECTIONS) {
    const startCoords = getCoords(landmarks[start], width, height, mirrored)
    const endCoords = getCoords(landmarks[end], width, height, mirrored)
    
    ctx.beginPath()
    ctx.moveTo(startCoords.x, startCoords.y)
    ctx.lineTo(endCoords.x, endCoords.y)
    ctx.stroke()
  }

  // Draw landmarks
  for (let i = 0; i < landmarks.length; i++) {
    const coords = getCoords(landmarks[i], width, height, mirrored)
    
    // Use different style for fingertips
    const isFingertip = FINGERTIPS.includes(i)
    
    ctx.beginPath()
    ctx.arc(
      coords.x, 
      coords.y, 
      isFingertip ? opts.fingertipRadius! : opts.landmarkRadius!,
      0, 
      2 * Math.PI
    )
    ctx.fillStyle = isFingertip ? opts.fingertipColor! : opts.landmarkColor!
    ctx.fill()
    
    // Add glow effect for fingertips
    if (isFingertip) {
      ctx.beginPath()
      ctx.arc(coords.x, coords.y, opts.fingertipRadius! + 4, 0, 2 * Math.PI)
      ctx.strokeStyle = opts.fingertipColor! + '40' // 25% opacity
      ctx.lineWidth = 3
      ctx.stroke()
    }
  }
}

/**
 * Draw a "no hand detected" indicator
 */
export function drawNoHandIndicator(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  // Semi-transparent overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fillRect(0, 0, width, height)
  
  // Icon placeholder
  ctx.font = '48px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fillText('✋', width / 2, height / 2 - 30)
  
  ctx.font = '16px sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fillText('Show your hand to the camera', width / 2, height / 2 + 30)
}

/**
 * Draw detection confidence indicator
 */
export function drawConfidenceIndicator(
  ctx: CanvasRenderingContext2D,
  confidence: number,
  width: number,
  height: number
): void {
  const barWidth = 100
  const barHeight = 8
  const x = width - barWidth - 16
  const y = height - barHeight - 16
  
  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.roundRect(x - 4, y - 20, barWidth + 8, barHeight + 28, 6)
  ctx.fill()
  
  // Label
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fillText(`Confidence: ${Math.round(confidence * 100)}%`, x, y - 6)
  
  // Track
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.fillRect(x, y, barWidth, barHeight)
  
  // Fill based on confidence
  const fillColor = confidence > 0.8 ? '#10b981' : confidence > 0.5 ? '#f59e0b' : '#ef4444'
  ctx.fillStyle = fillColor
  ctx.fillRect(x, y, barWidth * confidence, barHeight)
}
