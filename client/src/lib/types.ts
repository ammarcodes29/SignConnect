// ============================================
// Hand Tracking Types
// ============================================

export interface Landmark {
  x: number
  y: number
  z: number
}

export interface FingerCurls {
  thumb: number
  index: number
  middle: number
  ring: number
  pinky: number
}

export interface FingerSpread {
  thumbIndex: number
  indexMiddle: number
  middleRing: number
  ringPinky: number
}

export interface HandFeatures {
  fingerCurls: FingerCurls
  fingertipDistances: FingerCurls
  fingerSpread: FingerSpread
  palmFacing: 'camera' | 'away' | 'side'
  thumbPosition: 'extended' | 'across' | 'tucked'
  fingersSpread: boolean
}

export interface HandState {
  landmarks: Landmark[]
  handedness: 'Left' | 'Right'
  confidence: number
  timestamp: number
  features?: HandFeatures
  // ML model prediction (from client)
  mlPrediction?: string
  mlConfidence?: number
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

export interface TtsStopMessage {
  type: 'tts_stop'
}

export interface QuizResults {
  passed: number
  total: number
  score: number
  missed: string[]
  details: Record<string, boolean[]>
}

export interface UiStateMessage {
  type: 'ui_state'
  mode: 'IDLE' | 'TEACH' | 'QUIZ'
  targetSign?: string
  prediction?: string
  confidence?: number
  suggestion?: string
  streak?: number
  teachingProgress?: number  // 0-3 for teaching mode
  quizCountdown?: number  // 3-2-1 countdown
  quizTry?: number  // Current try (0-2)
  quizResults?: QuizResults  // Final quiz results
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
  | TtsStopMessage
  | UiStateMessage
  | ErrorMessage

