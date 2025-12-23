import type { ConnectionStatus } from '../lib/wsClient'
import './SessionControls.css'

interface SessionControlsProps {
  isActive: boolean
  status: ConnectionStatus
  onStart: () => void
  onEnd: () => void
}

export default function SessionControls({ 
  isActive, 
  status, 
  onStart, 
  onEnd 
}: SessionControlsProps) {
  const isConnecting = status === 'connecting'

  return (
    <div className="session-controls">
      {!isActive ? (
        <button 
          className="control-btn start-btn"
          onClick={onStart}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <>
              <span className="spinner"></span>
              Connecting...
            </>
          ) : (
            <>
              <span className="btn-icon">▶️</span>
              Start Session
            </>
          )}
        </button>
      ) : (
        <button 
          className="control-btn end-btn"
          onClick={onEnd}
        >
          <span className="btn-icon">⏹️</span>
          End Session
        </button>
      )}
      
      <div className="controls-hint">
        {!isActive 
          ? "Start a session to begin learning ASL"
          : "Say 'teach me A' or 'quiz me' to begin"
        }
      </div>
    </div>
  )
}

