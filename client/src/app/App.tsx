import { useState, useCallback, useEffect } from 'react'
import CameraView from '../components/CameraView'
import CaptionsPanel from '../components/CaptionsPanel'
import SessionControls from '../components/SessionControls'
import { useWebSocket } from '../lib/wsClient'
import { useAudioCapture } from '../lib/audioCapture'
import type { HandState, QuizResults } from '../lib/types'
import './App.css'

type Theme = 'light' | 'dark'

function App() {
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [showQuizResults, setShowQuizResults] = useState(false)
  const [quizResults, setQuizResults] = useState<QuizResults | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('signconnect-theme') as Theme
    return saved || 'light'
  })
  
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

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('signconnect-theme', theme)
  }, [theme])

  useEffect(() => {
    if (uiState?.quizResults) {
      setQuizResults(uiState.quizResults)
      setShowQuizResults(true)
    }
  }, [uiState?.quizResults])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }, [])

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
        <div className="app-brand">
          <img 
            src="/SignConnectLogo.png" 
            alt="SignConnect" 
            className="brand-logo"
          />
          <span className="brand-name">SignConnect</span>
        </div>
        <div className="header-right">
          <button 
            className="theme-toggle" 
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            )}
          </button>
          <div className={`status-pill status-${status}`}>
            <span className="status-indicator" />
            <span className="status-label">{status}</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="camera-section">
          <CameraView 
            isActive={isSessionActive} 
            onHandState={handleHandState}
          />
          
          {uiState?.mode && uiState.mode !== 'IDLE' && (
            <div className="mode-chip">
              <span className="mode-dot" />
              {uiState.mode}
            </div>
          )}
          
          {uiState?.mode === 'QUIZ' && typeof uiState.quizCountdown === 'number' && (
            <div className="countdown-overlay">
              <div className="countdown-ring">
                <span className="countdown-num">{uiState.quizCountdown}</span>
              </div>
              <p className="countdown-hint">Hold your sign steady</p>
            </div>
          )}
          
          {uiState?.targetSign && (
            <div className="sign-info">
              <div className="sign-target">
                <span className="sign-label">Sign</span>
                <span className="sign-letter">{uiState.targetSign}</span>
              </div>
              
              {uiState.mode === 'TEACH' && typeof uiState.teachingProgress === 'number' && (
                <div className="progress-track">
                  <div className="progress-steps">
                    {[0, 1, 2].map(i => (
                      <div 
                        key={i} 
                        className={`progress-step ${i < uiState.teachingProgress! ? 'done' : ''} ${i === uiState.teachingProgress ? 'active' : ''}`}
                      >
                        {i < uiState.teachingProgress! ? '✓' : i + 1}
                      </div>
                    ))}
                  </div>
                  <span className="progress-text">{uiState.teachingProgress}/3 complete</span>
                </div>
              )}
              
              {uiState.mode === 'QUIZ' && typeof uiState.quizTry === 'number' && (
                <div className="tries-track">
                  <span className="tries-label">Attempt {uiState.quizTry + 1} of 3</span>
                  <div className="tries-dots">
                    {[0, 1, 2].map(i => (
                      <span 
                        key={i} 
                        className={`try-pip ${i === uiState.quizTry ? 'current' : ''} ${i < uiState.quizTry! ? 'used' : ''}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="sidebar">
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
        </aside>
      </main>

      {showQuizResults && quizResults && (
        <div className="results-backdrop" onClick={closeQuizResults}>
          <div className="results-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeQuizResults}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            
            <div className="results-header">
              <h2>Quiz Complete</h2>
              <p className="results-subtitle">Here's how you did</p>
            </div>
            
            <div className="score-display">
              <div className="score-ring">
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border-color)" strokeWidth="8"/>
                  <circle 
                    cx="50" cy="50" r="45" fill="none" 
                    stroke={quizResults.score >= 70 ? 'var(--accent-success)' : 'var(--accent-warning)'} 
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${quizResults.score * 2.83} 283`}
                    transform="rotate(-90 50 50)"
                    className="score-progress"
                  />
                </svg>
                <div className="score-center">
                  <span className="score-num">{quizResults.score}</span>
                  <span className="score-unit">%</span>
                </div>
              </div>
              <p className="score-summary">{quizResults.passed} of {quizResults.total} correct</p>
            </div>
            
            {quizResults.score === 100 ? (
              <div className="results-badge perfect">
                <span>🎉</span> Perfect Score!
              </div>
            ) : quizResults.score >= 70 ? (
              <div className="results-badge good">Great work!</div>
            ) : (
              <div className="results-badge practice">Keep practicing!</div>
            )}
            
            {quizResults.missed.length > 0 && (
              <div className="missed-block">
                <h3>Practice these letters</h3>
                <div className="missed-grid">
                  {quizResults.missed.map(letter => (
                    <span key={letter} className="missed-item">{letter}</span>
                  ))}
                </div>
              </div>
            )}
            
            <div className="breakdown-block">
              <h3>Breakdown</h3>
              <div className="breakdown-grid">
                {Object.entries(quizResults.details).map(([letter, tries]) => (
                  <div key={letter} className={`breakdown-item ${tries.some(t => t) ? 'pass' : 'fail'}`}>
                    <span className="breakdown-letter">{letter}</span>
                    <span className="breakdown-icon">{tries.some(t => t) ? '✓' : '✗'}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <button className="results-cta" onClick={closeQuizResults}>
              Continue Learning
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
