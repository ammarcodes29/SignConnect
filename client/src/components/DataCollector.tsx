/**
 * Data Collection Tool for ASL Classifier Training
 * 
 * Captures hand landmarks for each ASL letter to build a training dataset.
 * Press spacebar or click to capture samples for the current letter.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import type { Landmark } from '../lib/types'
import './DataCollector.css'

const ASL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const SAMPLES_PER_LETTER = 50 // Recommended samples per letter

interface CollectedSample {
  letter: string
  landmarks: number[] // Flattened 63 features
  timestamp: number
}

interface DataCollectorProps {
  currentLandmarks: Landmark[] | null
  isTracking: boolean
}

export default function DataCollector({ currentLandmarks, isTracking }: DataCollectorProps) {
  const [currentLetterIndex, setCurrentLetterIndex] = useState(0)
  const [samples, setSamples] = useState<CollectedSample[]>([])
  const [sampleCounts, setSampleCounts] = useState<Record<string, number>>({})
  const [isCapturing, setIsCapturing] = useState(false)
  const [lastCapture, setLastCapture] = useState<string>('')
  const downloadLinkRef = useRef<HTMLAnchorElement>(null)

  const currentLetter = ASL_LETTERS[currentLetterIndex]

  // Flatten and normalize landmarks for storage
  const processLandmarks = useCallback((landmarks: Landmark[]): number[] | null => {
    if (!landmarks || landmarks.length !== 21) return null

    const wrist = landmarks[0]
    const middleMcp = landmarks[9]
    const scale = Math.sqrt(
      Math.pow(middleMcp.x - wrist.x, 2) +
      Math.pow(middleMcp.y - wrist.y, 2) +
      Math.pow(middleMcp.z - wrist.z, 2)
    ) || 1

    const features: number[] = []
    for (let i = 0; i < 21; i++) {
      const lm = landmarks[i]
      features.push((lm.x - wrist.x) / scale)
      features.push((lm.y - wrist.y) / scale)
      features.push(lm.z / scale)
    }

    return features
  }, [])

  // Capture current sample
  const captureSample = useCallback(() => {
    if (!currentLandmarks || !isTracking) {
      setLastCapture('❌ No hand detected!')
      return
    }

    const features = processLandmarks(currentLandmarks)
    if (!features) {
      setLastCapture('❌ Invalid landmarks!')
      return
    }

    const sample: CollectedSample = {
      letter: currentLetter,
      landmarks: features,
      timestamp: Date.now()
    }

    setSamples(prev => [...prev, sample])
    setSampleCounts(prev => ({
      ...prev,
      [currentLetter]: (prev[currentLetter] || 0) + 1
    }))
    setLastCapture(`✅ Captured ${currentLetter}!`)
    setIsCapturing(true)
    setTimeout(() => setIsCapturing(false), 200)
  }, [currentLandmarks, isTracking, currentLetter, processLandmarks])

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        captureSample()
      } else if (e.code === 'ArrowRight') {
        setCurrentLetterIndex(prev => Math.min(prev + 1, ASL_LETTERS.length - 1))
      } else if (e.code === 'ArrowLeft') {
        setCurrentLetterIndex(prev => Math.max(prev - 1, 0))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [captureSample])

  // Download collected data as JSON
  const downloadData = useCallback(() => {
    const dataStr = JSON.stringify({
      version: '1.0',
      collected_at: new Date().toISOString(),
      total_samples: samples.length,
      samples_per_letter: sampleCounts,
      data: samples
    }, null, 2)

    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    
    if (downloadLinkRef.current) {
      downloadLinkRef.current.href = url
      downloadLinkRef.current.download = `asl_training_data_${Date.now()}.json`
      downloadLinkRef.current.click()
    }

    URL.revokeObjectURL(url)
  }, [samples, sampleCounts])

  // Clear all data
  const clearData = useCallback(() => {
    if (confirm('Are you sure you want to clear all collected data?')) {
      setSamples([])
      setSampleCounts({})
      setLastCapture('')
    }
  }, [])

  const currentCount = sampleCounts[currentLetter] || 0
  const totalSamples = samples.length

  return (
    <div className="data-collector">
      <div className="collector-header">
        <h2>📊 Data Collection Mode</h2>
        <p>Collect training samples for the ASL classifier</p>
      </div>

      <div className="current-letter-section">
        <div className="letter-nav">
          <button 
            onClick={() => setCurrentLetterIndex(prev => Math.max(prev - 1, 0))}
            disabled={currentLetterIndex === 0}
          >
            ←
          </button>
          <div className={`current-letter ${isCapturing ? 'capturing' : ''}`}>
            {currentLetter}
          </div>
          <button 
            onClick={() => setCurrentLetterIndex(prev => Math.min(prev + 1, ASL_LETTERS.length - 1))}
            disabled={currentLetterIndex === ASL_LETTERS.length - 1}
          >
            →
          </button>
        </div>
        <div className="letter-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${Math.min(100, (currentCount / SAMPLES_PER_LETTER) * 100)}%` }}
            />
          </div>
          <span>{currentCount} / {SAMPLES_PER_LETTER} samples</span>
        </div>
      </div>

      <div className="capture-section">
        <button 
          className={`capture-btn ${isCapturing ? 'active' : ''}`}
          onClick={captureSample}
          disabled={!isTracking}
        >
          {isTracking ? '📸 Capture (Space)' : '⏳ Show hand first...'}
        </button>
        {lastCapture && <p className="last-capture">{lastCapture}</p>}
      </div>

      <div className="stats-section">
        <div className="stat">
          <span className="stat-value">{totalSamples}</span>
          <span className="stat-label">Total Samples</span>
        </div>
        <div className="stat">
          <span className="stat-value">{Object.keys(sampleCounts).length}</span>
          <span className="stat-label">Letters Covered</span>
        </div>
      </div>

      <div className="letter-grid">
        {ASL_LETTERS.map((letter, idx) => {
          const count = sampleCounts[letter] || 0
          const isComplete = count >= SAMPLES_PER_LETTER
          const isCurrent = idx === currentLetterIndex
          return (
            <button
              key={letter}
              className={`letter-cell ${isCurrent ? 'current' : ''} ${isComplete ? 'complete' : ''}`}
              onClick={() => setCurrentLetterIndex(idx)}
            >
              <span className="cell-letter">{letter}</span>
              <span className="cell-count">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="actions-section">
        <button className="action-btn download" onClick={downloadData} disabled={totalSamples === 0}>
          💾 Download Data ({totalSamples} samples)
        </button>
        <button className="action-btn clear" onClick={clearData} disabled={totalSamples === 0}>
          🗑️ Clear All
        </button>
      </div>

      <div className="instructions">
        <h4>Instructions:</h4>
        <ul>
          <li><kbd>Space</kbd> - Capture sample</li>
          <li><kbd>←</kbd> / <kbd>→</kbd> - Change letter</li>
          <li>Collect ~{SAMPLES_PER_LETTER} samples per letter</li>
          <li>Vary hand position and angle for each sample</li>
        </ul>
      </div>

      <a ref={downloadLinkRef} style={{ display: 'none' }} />
    </div>
  )
}

