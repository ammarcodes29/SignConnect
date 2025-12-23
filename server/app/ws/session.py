"""
WebSocket Session Handler
Manages real-time communication for ASL tutoring sessions.
"""
import json
import logging
import asyncio
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws.events import (
    SessionMode,
    HandStateMessage,
    AudioChunkMessage,
    ClientControlMessage,
    AgentTextFinalMessage,
    UiStateMessage,
    ErrorMessage,
)
from app.recognition.classifier import SignClassifier
from app.llm.gemini import GeminiCoach
from app.tts.elevenlabs import TTSService

logger = logging.getLogger(__name__)
router = APIRouter()


class SessionState:
    """Manages state for a single tutoring session."""
    
    def __init__(self):
        self.mode: SessionMode = SessionMode.IDLE
        self.target_sign: Optional[str] = None
        self.current_streak: int = 0
        self.weak_signs: list[str] = []
        self.history: list[dict] = []
        
    def to_ui_state(
        self, 
        prediction: Optional[str] = None, 
        confidence: Optional[float] = None,
        suggestion: Optional[str] = None
    ) -> UiStateMessage:
        return UiStateMessage(
            mode=self.mode,
            target_sign=self.target_sign,
            prediction=prediction,
            confidence=confidence,
            suggestion=suggestion,
            streak=self.current_streak,
        )


class SessionManager:
    """
    Handles WebSocket session lifecycle and message routing.
    """
    
    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.state = SessionState()
        self.classifier = SignClassifier()
        self.coach = GeminiCoach()
        self.tts = TTSService()
        self._running = False
        
    async def send(self, message):
        """Send a message to the client."""
        if hasattr(message, 'model_dump'):
            data = message.model_dump(by_alias=True)
        else:
            data = message
        await self.ws.send_json(data)
        
    async def handle_hand_state(self, msg: dict):
        """Process hand state updates from client."""
        try:
            hand_state = HandStateMessage(**msg)
            
            # Convert landmarks to list of dicts for classifier
            landmarks = [
                {"x": lm.x, "y": lm.y, "z": lm.z} 
                for lm in hand_state.data.landmarks
            ]
            
            # Extract features if available
            features = None
            if hand_state.data.features:
                features = {
                    "fingerCurls": {
                        "thumb": hand_state.data.features.fingerCurls.thumb,
                        "index": hand_state.data.features.fingerCurls.index,
                        "middle": hand_state.data.features.fingerCurls.middle,
                        "ring": hand_state.data.features.fingerCurls.ring,
                        "pinky": hand_state.data.features.fingerCurls.pinky,
                    },
                    "thumbPosition": hand_state.data.features.thumbPosition,
                    "fingersSpread": hand_state.data.features.fingersSpread,
                }
            
            # Run classification with features
            result = self.classifier.classify(landmarks, features)
            
            # Send UI state update
            ui_state = self.state.to_ui_state(
                prediction=result.get("prediction"),
                confidence=result.get("confidence"),
                suggestion=result.get("issues", [""])[0] if result.get("issues") else None
            )
            await self.send(ui_state)
            
        except Exception as e:
            logger.error(f"Error processing hand state: {e}")
            
    async def handle_audio_chunk(self, msg: dict):
        """Process audio chunks from client (ASR stub)."""
        # TODO: Integrate with actual ASR service
        # For now, just acknowledge receipt
        pass
    
    async def handle_control(self, msg: dict):
        """Handle client control messages."""
        try:
            control = ClientControlMessage(**msg)
            
            if control.action == "start":
                self.state.mode = SessionMode.IDLE
                await self.send_welcome()
            elif control.action == "stop":
                self.state.mode = SessionMode.IDLE
                self.state.target_sign = None
                
        except Exception as e:
            logger.error(f"Error handling control: {e}")
            
    async def send_welcome(self):
        """Send initial welcome message."""
        welcome = AgentTextFinalMessage(
            text="Hello! I'm your ASL tutor. Say 'teach me A' to learn a letter, or 'quiz me' to test your skills!"
        )
        await self.send(welcome)
        
        # Also send initial UI state
        ui_state = self.state.to_ui_state()
        await self.send(ui_state)
        
    async def run(self):
        """Main session loop - receives and routes messages."""
        self._running = True
        
        # Send welcome on connect
        await self.send_welcome()
        
        while self._running:
            try:
                # Receive message
                data = await self.ws.receive_json()
                msg_type = data.get("type")
                
                # Route by message type
                if msg_type == "hand_state":
                    await self.handle_hand_state(data)
                elif msg_type == "audio_chunk":
                    await self.handle_audio_chunk(data)
                elif msg_type == "client_control":
                    await self.handle_control(data)
                else:
                    logger.warning(f"Unknown message type: {msg_type}")
                    
            except WebSocketDisconnect:
                logger.info("Client disconnected")
                self._running = False
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON: {e}")
                await self.send(ErrorMessage(message="Invalid JSON format"))
            except Exception as e:
                logger.error(f"Session error: {e}")
                await self.send(ErrorMessage(message=str(e)))
                
    def stop(self):
        """Stop the session loop."""
        self._running = False


@router.websocket("/ws/session")
async def websocket_session(websocket: WebSocket):
    """
    WebSocket endpoint for ASL tutoring sessions.
    """
    await websocket.accept()
    logger.info("New WebSocket connection established")
    
    session = SessionManager(websocket)
    
    try:
        await session.run()
    except Exception as e:
        logger.error(f"Session failed: {e}")
    finally:
        session.stop()
        logger.info("Session ended")

