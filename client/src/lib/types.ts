// ============================================
// Hand Tracking Types
// ============================================

export interface Landmark {
  x: number
  y: number
  z: number
}

export interface HandState {
  landmarks: Landmark[]
  handedness: 'Left' | 'Right'
  confidence: number
  timestamp: number
}

// ============================================
// WebSocket Message Types (Client -> Server)
// ============================================

export interface AudioChunkMessage {
  type: 'audio_chunk'
  data: string // base64 encoded audio
  timestamp: number
}

export interface HandStateMessage {
  type: 'hand_state'
  data: HandState
}

export interface ClientControlMessage {
  type: 'client_control'
  action: 'start' | 'stop' | 'toggle_captions'
}

export type ClientMessage = AudioChunkMessage | HandStateMessage | ClientControlMessage

// ============================================
// WebSocket Message Types (Server -> Client)
// ============================================

export interface AsrPartialMessage {
  type: 'asr_partial'
  text: string
  timestamp: number
}

export interface AsrFinalMessage {
  type: 'asr_final'
  text: string
  timestamp: number
}

export interface AgentTextPartialMessage {
  type: 'agent_text_partial'
  text: string
  timestamp: number
}

export interface AgentTextFinalMessage {
  type: 'agent_text_final'
  text: string
  timestamp: number
}

export interface TtsAudioChunkMessage {
  type: 'tts_audio_chunk'
  data: string // base64 encoded audio
  timestamp: number
}

export interface UiStateMessage {
  type: 'ui_state'
  mode: 'IDLE' | 'TEACH' | 'QUIZ'
  targetSign?: string
  prediction?: string
  confidence?: number
  suggestion?: string
  streak?: number
  timestamp: number
}

export interface ErrorMessage {
  type: 'error'
  message: string
  code?: string
  timestamp: number
}

export type ServerMessage = 
  | AsrPartialMessage 
  | AsrFinalMessage 
  | AgentTextPartialMessage 
  | AgentTextFinalMessage
  | TtsAudioChunkMessage
  | UiStateMessage
  | ErrorMessage

