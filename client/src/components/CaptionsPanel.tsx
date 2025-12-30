import { useEffect, useRef } from 'react'
import './CaptionsPanel.css'

interface CaptionsPanelProps {
  agentText: string
  userTranscript: string
  isMicActive: boolean
}

function CaptionsPanel({ agentText, userTranscript, isMicActive }: CaptionsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [agentText, userTranscript])

  return (
    <div className="captions-panel">
      <div className="captions-header">
        <h3>Conversation</h3>
        {isMicActive && (
          <div className="mic-badge">
            <span className="mic-pulse" />
            <span>Listening</span>
          </div>
        )}
      </div>
      
      <div className="captions-content" ref={scrollRef}>
        {agentText && (
          <div className="message message-agent">
            <div className="message-avatar">
              <img src="/SignConnectLogo.png" alt="" />
            </div>
            <div className="message-body">
              <span className="message-sender">Coach</span>
              <p className="message-text">{agentText}</p>
            </div>
          </div>
        )}
        
        {userTranscript && (
          <div className="message message-user">
            <div className="message-body">
              <span className="message-sender">You</span>
              <p className="message-text">{userTranscript}</p>
            </div>
            <div className="message-avatar user-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
          </div>
        )}
        
        {!agentText && !userTranscript && (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <p>Start a session to begin your ASL lesson</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default CaptionsPanel
