/**
 * Feature Extraction for Sign Classification
 * Extracts meaningful features from hand landmarks for recognition.
 */
import type { Landmark } from './types'

// Landmark indices
const WRIST = 0
const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12
const RING_MCP = 13, RING_PIP = 14, RING_DIP = 15, RING_TIP = 16
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20

// Finger groups
const FINGERS = {
  thumb: [THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP],
  index: [INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP],
  middle: [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP],
  ring: [RING_MCP, RING_PIP, RING_DIP, RING_TIP],
  pinky: [PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP]
}

// Reserved for future use
const _FINGERTIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]
const _FINGER_MCPS = [THUMB_MCP, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]
void _FINGERTIPS; void _FINGER_MCPS; // Suppress unused warnings

export interface HandFeatures {
  // Finger curl values (0 = extended, 1 = fully curled)
  fingerCurls: {
    thumb: number
    index: number
    middle: number
    ring: number
    pinky: number
  }
  
  // Fingertip distances from wrist (normalized)
  fingertipDistances: {
    thumb: number
    index: number
    middle: number
    ring: number
    pinky: number
  }
  
  // Fingertip-to-fingertip distances (normalized)
  fingerSpread: {
    thumbIndex: number
    indexMiddle: number
    middleRing: number
    ringPinky: number
  }
  
  // Palm orientation (simplified)
  palmFacing: 'camera' | 'away' | 'side'
  
  // Thumb position relative to palm
  thumbPosition: 'extended' | 'across' | 'tucked'
  
  // Whether fingers are together or spread
  fingersSpread: boolean
  
  // Raw normalized landmarks for ML if needed
  normalizedLandmarks: Landmark[]
}

/**
 * Calculate Euclidean distance between two landmarks
 */
function distance(a: Landmark, b: Landmark): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

/**
 * Calculate 2D distance (ignoring z)
 */
function distance2D(a: Landmark, b: Landmark): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2)
  )
}

/**
 * Calculate angle between three points (in radians)
 */
function angle(a: Landmark, b: Landmark, c: Landmark): number {
  const ab = { x: a.x - b.x, y: a.y - b.y }
  const cb = { x: c.x - b.x, y: c.y - b.y }
  
  const dot = ab.x * cb.x + ab.y * cb.y
  const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y)
  const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y)
  
  if (magAB === 0 || magCB === 0) return 0
  
  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB)))
  return Math.acos(cosAngle)
}

/**
 * Calculate finger curl (0 = extended, 1 = fully curled)
 */
function calculateFingerCurl(landmarks: Landmark[], fingerIndices: number[]): number {
  if (fingerIndices.length < 4) return 0
  
  const [mcp, pip, dip, tip] = fingerIndices.map(i => landmarks[i])
  
  // Calculate angles at PIP and DIP joints
  const pipAngle = angle(mcp, pip, dip)
  const dipAngle = angle(pip, dip, tip)
  
  // Average angle, normalized to 0-1
  // Straight finger ~ π radians, curled ~ 0.5π radians
  const avgAngle = (pipAngle + dipAngle) / 2
  const curl = 1 - (avgAngle / Math.PI)
  
  return Math.max(0, Math.min(1, curl))
}

/**
 * Normalize landmarks relative to wrist and hand size
 */
function normalizeLandmarks(landmarks: Landmark[]): Landmark[] {
  const wrist = landmarks[WRIST]
  const middleMcp = landmarks[MIDDLE_MCP]
  
  // Use wrist-to-middle-mcp distance as reference scale
  const refDistance = distance(wrist, middleMcp) || 1
  
  return landmarks.map(lm => ({
    x: (lm.x - wrist.x) / refDistance,
    y: (lm.y - wrist.y) / refDistance,
    z: lm.z / refDistance
  }))
}

/**
 * Determine palm orientation
 */
function getPalmOrientation(landmarks: Landmark[]): 'camera' | 'away' | 'side' {
  // Use z-coordinate differences to estimate orientation
  const wrist = landmarks[WRIST]
  const middleMcp = landmarks[MIDDLE_MCP]
  const indexMcp = landmarks[INDEX_MCP]
  
  // If palm landmarks are closer (smaller z), palm faces camera
  const avgPalmZ = (wrist.z + middleMcp.z + indexMcp.z) / 3
  
  if (avgPalmZ < -0.05) return 'camera'
  if (avgPalmZ > 0.05) return 'away'
  return 'side'
}

/**
 * Determine thumb position
 */
function getThumbPosition(landmarks: Landmark[]): 'extended' | 'across' | 'tucked' {
  const thumbTip = landmarks[THUMB_TIP]
  const indexMcp = landmarks[INDEX_MCP]
  const pinkyMcp = landmarks[PINKY_MCP]
  const wrist = landmarks[WRIST]
  
  // Distance from thumb tip to palm center
  const palmCenterX = (indexMcp.x + pinkyMcp.x) / 2
  const palmCenterY = (indexMcp.y + pinkyMcp.y) / 2
  
  const thumbToCenter = Math.sqrt(
    Math.pow(thumbTip.x - palmCenterX, 2) +
    Math.pow(thumbTip.y - palmCenterY, 2)
  )
  
  // Suppress unused variable warning (wrist used for context)
  void wrist;
  
  // Check if thumb crosses over palm
  const thumbX = thumbTip.x
  const handCenterX = (wrist.x + indexMcp.x) / 2
  
  if (thumbToCenter < 0.08) return 'tucked'
  if (Math.abs(thumbX - handCenterX) < 0.05) return 'across'
  return 'extended'
}

/**
 * Extract all features from hand landmarks
 */
export function extractFeatures(landmarks: Landmark[]): HandFeatures | null {
  if (!landmarks || landmarks.length !== 21) {
    return null
  }
  
  const wrist = landmarks[WRIST]
  const normalized = normalizeLandmarks(landmarks)
  
  // Calculate finger curls
  const fingerCurls = {
    thumb: calculateFingerCurl(landmarks, FINGERS.thumb),
    index: calculateFingerCurl(landmarks, FINGERS.index),
    middle: calculateFingerCurl(landmarks, FINGERS.middle),
    ring: calculateFingerCurl(landmarks, FINGERS.ring),
    pinky: calculateFingerCurl(landmarks, FINGERS.pinky)
  }
  
  // Calculate fingertip distances from wrist
  const maxDist = distance(wrist, landmarks[MIDDLE_TIP]) || 1
  const fingertipDistances = {
    thumb: distance(wrist, landmarks[THUMB_TIP]) / maxDist,
    index: distance(wrist, landmarks[INDEX_TIP]) / maxDist,
    middle: distance(wrist, landmarks[MIDDLE_TIP]) / maxDist,
    ring: distance(wrist, landmarks[RING_TIP]) / maxDist,
    pinky: distance(wrist, landmarks[PINKY_TIP]) / maxDist
  }
  
  // Calculate finger spread (tip-to-tip distances)
  const refDist = distance(landmarks[INDEX_MCP], landmarks[PINKY_MCP]) || 1
  const fingerSpread = {
    thumbIndex: distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / refDist,
    indexMiddle: distance(landmarks[INDEX_TIP], landmarks[MIDDLE_TIP]) / refDist,
    middleRing: distance(landmarks[MIDDLE_TIP], landmarks[RING_TIP]) / refDist,
    ringPinky: distance(landmarks[RING_TIP], landmarks[PINKY_TIP]) / refDist
  }
  
  // Check if fingers are spread
  const avgSpread = (fingerSpread.indexMiddle + fingerSpread.middleRing + fingerSpread.ringPinky) / 3
  const fingersSpread = avgSpread > 0.4
  
  return {
    fingerCurls,
    fingertipDistances,
    fingerSpread,
    palmFacing: getPalmOrientation(landmarks),
    thumbPosition: getThumbPosition(landmarks),
    fingersSpread,
    normalizedLandmarks: normalized
  }
}

/**
 * Describe detected features in human-readable form (for debugging)
 */
export function describeFeatures(features: HandFeatures): string {
  const curled = Object.entries(features.fingerCurls)
    .filter(([_, v]) => v > 0.6)
    .map(([k]) => k)
  
  const extended = Object.entries(features.fingerCurls)
    .filter(([_, v]) => v < 0.3)
    .map(([k]) => k)
  
  let description = ''
  if (extended.length > 0) description += `Extended: ${extended.join(', ')}. `
  if (curled.length > 0) description += `Curled: ${curled.join(', ')}. `
  description += `Palm: ${features.palmFacing}. Thumb: ${features.thumbPosition}.`
  
  return description
}

