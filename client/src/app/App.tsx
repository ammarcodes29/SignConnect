import { useState, useCallback } from 'react'
import CameraView from '../components/CameraView'
import CaptionsPanel from '../components/CaptionsPanel'
import SessionControls from '../components/SessionControls'
import { useWebSocket, ConnectionStatus } from '../lib/wsClient'
import type { HandState } from '../lib/types'
import './App.css'

function App() {
  const [isSessionActive, setIsSessionActive] = useState(false)
  
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

  const handleStartSession = useCallback(() => {
    connect()
    setIsSessionActive(true)
  }, [connect])

  const handleEndSession = useCallback(() => {
    disconnect()
    setIsSessionActive(false)
  }, [disconnect])

  const handleHandState = useCallback((handState: HandState) => {
    if (isSessionActive && status === 'connected') {
      sendHandState(handState)
    }
  }, [isSessionActive, status, sendHandState])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="title-icon">🤟</span>
          SignConnect
        </h1>
        <div className="connection-status">
          <span className={`status-dot status-${status}`}></span>
          <span className="status-text">{status}</span>
        </div>
      </header>

      <main className="app-main">
        <div className="camera-section">
          <CameraView 
            isActive={isSessionActive} 
            onHandState={handleHandState}
          />
          {uiState && (
            <>
              {uiState.mode && (
                <div className="mode-badge">{uiState.mode}</div>
              )}
              <div className="ui-state-overlay">
                {uiState.targetSign && (
                  <div className="target-sign">Sign: {uiState.targetSign}</div>
                )}
                {uiState.prediction && (
                  <div className="prediction">
                    Detected: {uiState.prediction} 
                    ({Math.round((uiState.confidence || 0) * 100)}%)
                  </div>
                )}
                {uiState.suggestion && (
                  <div className="suggestion">{uiState.suggestion}</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="info-section">
          <CaptionsPanel 
            agentText={agentText} 
            userTranscript={userTranscript} 
          />
          
          <SessionControls
            isActive={isSessionActive}
            status={status}
            onStart={handleStartSession}
            onEnd={handleEndSession}
          />
        </div>
      </main>
    </div>
  )
}

export default App

