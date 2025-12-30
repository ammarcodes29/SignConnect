import './CaptionsPanel.css'

interface CaptionsPanelProps {
  agentText: string
  userTranscript: string
  isMicActive?: boolean
}

export default function CaptionsPanel({ agentText, userTranscript, isMicActive }: CaptionsPanelProps) {
  return (
    <div className="captions-panel">
      <h2 className="captions-title">
        <span className="title-icon">💬</span>
        Live Captions
        {isMicActive && (
          <span className="mic-indicator" title="Microphone active">
            🎤
          </span>
        )}
      </h2>
      
      <div className="captions-container">
        <div className="caption-group">
          <div className="caption-label">
            <span className="label-dot agent-dot"></span>
            Agent
          </div>
          <div className="caption-text agent-text">
            {agentText || <span className="placeholder">Waiting for session...</span>}
          </div>
        </div>
        
        <div className="caption-group">
          <div className="caption-label">
            <span className="label-dot user-dot"></span>
            You
            {isMicActive && <span className="mic-active-dot"></span>}
          </div>
          <div className="caption-text user-text">
            {userTranscript || (
              <span className="placeholder">
                {isMicActive ? 'Listening...' : 'Speak to interact...'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

