import { useState, useCallback, useEffect } from 'react'
import CameraView from '../components/CameraView'
import CaptionsPanel from '../components/CaptionsPanel'
import SessionControls from '../components/SessionControls'
import DataCollector from '../components/DataCollector'
import { useWebSocket } from '../lib/wsClient'
import { useAudioCapture } from '../lib/audioCapture'
import type { HandState, Landmark } from '../lib/types'
import './App.css'

type AppMode = 'normal' | 'collect'

function App() {
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [appMode, setAppMode] = useState<AppMode>('normal')
  const [currentLandmarks, setCurrentLandmarks] = useState<Landmark[] | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  
  const { 
    status, 
    agentText, 
    userTranscript, 
    uiState,
    connect, 
    disconnect, 
    sendHandState,
    sendAudioChunk
  } = useWebSocket()

  // Audio capture for voice input
  const { isCapturing, start: startAudio, stop: stopAudio } = useAudioCapture(
    useCallback((chunk: string) => {
      if (status === 'connected') {
        sendAudioChunk(chunk)
      }
    }, [status, sendAudioChunk])
  )

  const handleStartSession = useCallback(async () => {
    if (appMode === 'normal') {
      connect()
      // Start audio capture after a short delay to ensure WebSocket is ready
      setTimeout(async () => {
        await startAudio()
      }, 500)
    }
    setIsSessionActive(true)
  }, [connect, appMode, startAudio])

  const handleEndSession = useCallback(() => {
    stopAudio()
    disconnect()
    setIsSessionActive(false)
    setCurrentLandmarks(null)
    setIsTracking(false)
  }, [disconnect, stopAudio])

  const handleHandState = useCallback((handState: HandState) => {
    // Always track landmarks for data collection
    setCurrentLandmarks(handState.landmarks)
    setIsTracking(true)
    
    // Only send to server in normal mode
    if (appMode === 'normal' && isSessionActive && status === 'connected') {
      sendHandState(handState)
    }
  }, [appMode, isSessionActive, status, sendHandState])

  // Reset tracking when hand is lost (handled in CameraView, but we detect via no updates)
  const handleNoHand = useCallback(() => {
    setIsTracking(false)
  }, [])

  const toggleMode = useCallback(() => {
    if (isSessionActive) {
      handleEndSession()
    }
    setAppMode(prev => prev === 'normal' ? 'collect' : 'normal')
  }, [isSessionActive, handleEndSession])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="title-icon">🤟</span>
          SignConnect
        </h1>
        <div className="header-controls">
          <button 
            className={`mode-toggle ${appMode === 'collect' ? 'collect-mode' : ''}`}
            onClick={toggleMode}
          >
            {appMode === 'normal' ? '📊 Data Collection' : '🎓 Normal Mode'}
          </button>
          <div className="connection-status">
            <span className={`status-dot status-${status}`}></span>
            <span className="status-text">{status}</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="camera-section">
          <CameraView 
            isActive={isSessionActive} 
            onHandState={handleHandState}
          />
          {appMode === 'normal' && uiState && (
            <>
              {uiState.mode && (
                <div className="mode-badge">{uiState.mode}</div>
              )}
              {uiState.targetSign && (
                <div className="ui-state-overlay">
                  <div className="target-sign">Sign: {uiState.targetSign}</div>
                  {uiState.suggestion && (
                    <div className="suggestion">{uiState.suggestion}</div>
                  )}
                </div>
              )}
            </>
          )}
          {appMode === 'collect' && isSessionActive && (
            <div className="mode-badge collect">DATA COLLECTION</div>
          )}
        </div>

        <div className="info-section">
          {appMode === 'normal' ? (
            <>
              <CaptionsPanel 
                agentText={agentText} 
                userTranscript={userTranscript}
                isMicActive={isCapturing}
              />
              <SessionControls
                isActive={isSessionActive}
                status={status}
                onStart={handleStartSession}
                onEnd={handleEndSession}
              />
            </>
          ) : (
            <>
              <DataCollector
                currentLandmarks={currentLandmarks}
                isTracking={isTracking}
              />
              <div className="collect-controls">
                {!isSessionActive ? (
                  <button 
                    className="start-collect-btn"
                    onClick={handleStartSession}
                  >
                    📹 Start Camera
                  </button>
                ) : (
                  <button 
                    className="stop-collect-btn"
                    onClick={handleEndSession}
                  >
                    ⏹️ Stop Camera
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
