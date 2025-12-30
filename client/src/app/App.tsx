import { useState, useCallback, useEffect } from 'react'
import CameraView from '../components/CameraView'
import CaptionsPanel from '../components/CaptionsPanel'
import SessionControls from '../components/SessionControls'
import { useWebSocket } from '../lib/wsClient'
import { useAudioCapture } from '../lib/audioCapture'
import type { HandState, QuizResults } from '../lib/types'
import './App.css'

function App() {
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [showQuizResults, setShowQuizResults] = useState(false)
  const [quizResults, setQuizResults] = useState<QuizResults | null>(null)
  
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

  // Track quiz results
  useEffect(() => {
    if (uiState?.quizResults) {
      setQuizResults(uiState.quizResults)
      setShowQuizResults(true)
    }
  }, [uiState?.quizResults])

  // Audio capture for voice input
  const { isCapturing, start: startAudio, stop: stopAudio } = useAudioCapture(
    useCallback((chunk: string) => {
      if (status === 'connected') {
        sendAudioChunk(chunk)
      }
    }, [status, sendAudioChunk])
  )

  const handleStartSession = useCallback(async () => {
    connect()
    setTimeout(async () => {
      await startAudio()
    }, 500)
    setIsSessionActive(true)
  }, [connect, startAudio])

  const handleEndSession = useCallback(() => {
    stopAudio()
    disconnect()
    setIsSessionActive(false)
  }, [disconnect, stopAudio])

  const handleHandState = useCallback((handState: HandState) => {
    if (isSessionActive && status === 'connected') {
      sendHandState(handState)
    }
  }, [isSessionActive, status, sendHandState])

  const closeQuizResults = useCallback(() => {
    setShowQuizResults(false)
    setQuizResults(null)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="title-icon">🤟</span>
          SignConnect
        </h1>
        <div className="header-controls">
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
          
          {/* Mode Badge */}
          {uiState?.mode && (
            <div className="mode-badge">{uiState.mode}</div>
          )}
          
          {/* Quiz Countdown Overlay */}
          {uiState?.mode === 'QUIZ' && typeof uiState.quizCountdown === 'number' && (
            <div className="quiz-countdown-overlay">
              <div className="countdown-number">{uiState.quizCountdown}</div>
              <div className="countdown-label">Get ready!</div>
            </div>
          )}
          
          {/* Teaching/Quiz Info Overlay */}
          {uiState?.targetSign && (
            <div className="ui-state-overlay">
              <div className="target-sign">Sign: {uiState.targetSign}</div>
              
              {/* Teaching Progress */}
              {uiState.mode === 'TEACH' && typeof uiState.teachingProgress === 'number' && (
                <div className="teaching-progress">
                  <div className="progress-label">Progress: {uiState.teachingProgress}/3</div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${(uiState.teachingProgress / 3) * 100}%` }}
                    />
                  </div>
                  <div className="progress-dots">
                    {[0, 1, 2].map(i => (
                      <span 
                        key={i} 
                        className={`progress-dot ${i < uiState.teachingProgress! ? 'filled' : ''}`}
                      >
                        {i < uiState.teachingProgress! ? '✓' : '○'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Quiz Try Indicator */}
              {uiState.mode === 'QUIZ' && typeof uiState.quizTry === 'number' && (
                <div className="quiz-tries">
                  <div className="tries-label">Try {uiState.quizTry + 1}/3</div>
                  <div className="tries-dots">
                    {[0, 1, 2].map(i => (
                      <span 
                        key={i} 
                        className={`try-dot ${i === uiState.quizTry ? 'current' : i < uiState.quizTry! ? 'used' : ''}`}
                      >
                        {i < uiState.quizTry! ? '•' : i === uiState.quizTry ? '◉' : '○'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {uiState.suggestion && (
                <div className="suggestion">{uiState.suggestion}</div>
              )}
            </div>
          )}
        </div>

        <div className="info-section">
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
        </div>
      </main>

      {/* Quiz Results Popup */}
      {showQuizResults && quizResults && (
        <div className="quiz-results-overlay" onClick={closeQuizResults}>
          <div className="quiz-results-popup" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={closeQuizResults}>×</button>
            
            <h2 className="results-title">Quiz Complete!</h2>
            
            <div className="score-circle">
              <div className="score-value">{quizResults.score}%</div>
              <div className="score-label">{quizResults.passed}/{quizResults.total}</div>
            </div>
            
            {quizResults.score === 100 ? (
              <div className="results-message perfect">🎉 Perfect Score!</div>
            ) : quizResults.score >= 70 ? (
              <div className="results-message good">Great job!</div>
            ) : (
              <div className="results-message needs-work">Keep practicing!</div>
            )}
            
            {quizResults.missed.length > 0 && (
              <div className="missed-section">
                <h3>Letters to practice:</h3>
                <div className="missed-letters">
                  {quizResults.missed.map(letter => (
                    <span key={letter} className="missed-letter">{letter}</span>
                  ))}
                </div>
              </div>
            )}
            
            <div className="details-section">
              <h3>Breakdown:</h3>
              <div className="results-grid">
                {Object.entries(quizResults.details).map(([letter, tries]) => (
                  <div key={letter} className={`result-item ${tries.some(t => t) ? 'passed' : 'failed'}`}>
                    <span className="result-letter">{letter}</span>
                    <span className="result-status">
                      {tries.some(t => t) ? '✓' : '✗'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            
            <button className="close-results-btn" onClick={closeQuizResults}>
              Continue Learning
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
