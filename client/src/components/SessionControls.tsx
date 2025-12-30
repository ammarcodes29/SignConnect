import './SessionControls.css'

interface SessionControlsProps {
  isActive: boolean
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  onStart: () => void
  onEnd: () => void
}

function SessionControls({ isActive, status, onStart, onEnd }: SessionControlsProps) {
  const isConnecting = status === 'connecting'

  return (
    <div className="session-controls">
      {!isActive ? (
        <button 
          className="session-btn start-btn"
          onClick={onStart}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <>
              <span className="btn-spinner" />
              <span>Connecting...</span>
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <span>Start Session</span>
            </>
          )}
        </button>
      ) : (
        <button 
          className="session-btn end-btn"
          onClick={onEnd}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
          <span>End Session</span>
        </button>
      )}
      
      <div className="controls-hint">
        {!isActive ? (
          <p>Start a session to begin your ASL lesson with your AI coach.</p>
        ) : (
          <p>Say "teach me A" or "quiz me" to get started!</p>
        )}
      </div>
    </div>
  )
}

export default SessionControls
