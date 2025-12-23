"""
WebSocket Event Schemas
Defines all message types for client<->server communication.
"""
from enum import Enum
from typing import Optional, Literal, Union
from pydantic import BaseModel, Field
import time


# ============================================
# Enums
# ============================================

class SessionMode(str, Enum):
    IDLE = "IDLE"
    TEACH = "TEACH"
    QUIZ = "QUIZ"


# ============================================
# Client -> Server Messages
# ============================================

class AudioChunkMessage(BaseModel):
    type: Literal["audio_chunk"] = "audio_chunk"
    data: str  # base64 encoded audio
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class HandLandmark(BaseModel):
    x: float
    y: float
    z: float


class FingerCurls(BaseModel):
    thumb: float
    index: float
    middle: float
    ring: float
    pinky: float


class FingerSpread(BaseModel):
    thumbIndex: float
    indexMiddle: float
    middleRing: float
    ringPinky: float


class HandFeatures(BaseModel):
    fingerCurls: FingerCurls
    fingertipDistances: FingerCurls
    fingerSpread: FingerSpread
    palmFacing: Literal["camera", "away", "side"]
    thumbPosition: Literal["extended", "across", "tucked"]
    fingersSpread: bool


class HandState(BaseModel):
    landmarks: list[HandLandmark]
    handedness: Literal["Left", "Right"]
    confidence: float
    timestamp: int
    features: Optional[HandFeatures] = None


class HandStateMessage(BaseModel):
    type: Literal["hand_state"] = "hand_state"
    data: HandState


class ClientControlMessage(BaseModel):
    type: Literal["client_control"] = "client_control"
    action: Literal["start", "stop", "toggle_captions"]


# Union of all client message types
ClientMessage = Union[AudioChunkMessage, HandStateMessage, ClientControlMessage]


# ============================================
# Server -> Client Messages
# ============================================

class AsrPartialMessage(BaseModel):
    type: Literal["asr_partial"] = "asr_partial"
    text: str
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class AsrFinalMessage(BaseModel):
    type: Literal["asr_final"] = "asr_final"
    text: str
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class AgentTextPartialMessage(BaseModel):
    type: Literal["agent_text_partial"] = "agent_text_partial"
    text: str
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class AgentTextFinalMessage(BaseModel):
    type: Literal["agent_text_final"] = "agent_text_final"
    text: str
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class TtsAudioChunkMessage(BaseModel):
    type: Literal["tts_audio_chunk"] = "tts_audio_chunk"
    data: str  # base64 encoded audio
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class UiStateMessage(BaseModel):
    type: Literal["ui_state"] = "ui_state"
    mode: SessionMode = SessionMode.IDLE
    target_sign: Optional[str] = Field(None, alias="targetSign")
    prediction: Optional[str] = None
    confidence: Optional[float] = None
    suggestion: Optional[str] = None
    streak: Optional[int] = None
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))

    class Config:
        populate_by_name = True


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str
    code: Optional[str] = None
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


# Union of all server message types
ServerMessage = Union[
    AsrPartialMessage,
    AsrFinalMessage,
    AgentTextPartialMessage,
    AgentTextFinalMessage,
    TtsAudioChunkMessage,
    UiStateMessage,
    ErrorMessage
]

