import { useState, useCallback, useRef, useEffect } from 'react'
import type { HandState, ServerMessage, UiStateMessage } from './types'
import { getAudioPlayer, disposeAudioPlayer } from './audioPlayer'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface UseWebSocketReturn {
  status: ConnectionStatus
  agentText: string
  userTranscript: string
  uiState: UiStateMessage | null
  connect: () => void
  disconnect: () => void
  sendHandState: (handState: HandState) => void
  sendAudioChunk: (audioData: string) => void
}

export function useWebSocket(): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [agentText, setAgentText] = useState('')
  const [userTranscript, setUserTranscript] = useState('')
  const [uiState, setUiState] = useState<UiStateMessage | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: ServerMessage = JSON.parse(event.data)
      
      switch (message.type) {
        case 'asr_partial':
          setUserTranscript(message.text)
          break
        case 'asr_final':
          setUserTranscript(message.text)
          break
        case 'agent_text_partial':
          setAgentText(prev => prev + message.text)
          break
        case 'agent_text_final':
          setAgentText(message.text)
          break
        case 'tts_audio_chunk':
          // Play TTS audio from agent
          getAudioPlayer().addChunk(message.data)
          break
        case 'tts_stop':
          // Stop audio playback immediately (user interrupted)
          getAudioPlayer().stop()
          break
        case 'ui_state':
          setUiState(message)
          break
        case 'error':
          console.error('Server error:', message.message)
          break
        default:
          console.log('Unknown message type:', message)
      }
    } catch (err) {
      console.error('Failed to parse message:', err)
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setStatus('connecting')
    
    // Use relative WebSocket URL for Vite proxy
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/session`
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
      setStatus('connected')
      setAgentText('')
      setUserTranscript('')
    }

    ws.onmessage = handleMessage

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setStatus('error')
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setStatus('disconnected')
      wsRef.current = null
    }
  }, [handleMessage])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    
    // Stop and cleanup audio player
    disposeAudioPlayer()
    
    setStatus('disconnected')
    setAgentText('')
    setUserTranscript('')
    setUiState(null)
  }, [])

  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const sendHandState = useCallback((handState: HandState) => {
    sendMessage({
      type: 'hand_state',
      data: handState
    })
  }, [sendMessage])

  const sendAudioChunk = useCallback((audioData: string) => {
    sendMessage({
      type: 'audio_chunk',
      data: audioData,
      timestamp: Date.now()
    })
  }, [sendMessage])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    agentText,
    userTranscript,
    uiState,
    connect,
    disconnect,
    sendHandState,
    sendAudioChunk
  }
}

export { ConnectionStatus }

