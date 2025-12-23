import './CaptionsPanel.css'

interface CaptionsPanelProps {
  agentText: string
  userTranscript: string
}

export default function CaptionsPanel({ agentText, userTranscript }: CaptionsPanelProps) {
  return (
    <div className="captions-panel">
      <h2 className="captions-title">
        <span className="title-icon">💬</span>
        Live Captions
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
          </div>
          <div className="caption-text user-text">
            {userTranscript || <span className="placeholder">Speak to interact...</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

