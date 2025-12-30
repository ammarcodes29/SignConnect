"""
WebSocket Session Handler
Manages real-time conversational ASL tutoring sessions.
Prioritizes natural conversation over rigid modes.
"""
import json
import logging
import time
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws.events import (
    SessionMode,
    HandStateMessage,
    AudioChunkMessage,
    ClientControlMessage,
    AgentTextFinalMessage,
    AsrPartialMessage,
    AsrFinalMessage,
    TtsAudioChunkMessage,
    UiStateMessage,
    ErrorMessage,
)
from app.recognition.classifier import SignClassifier
from app.llm.gemini import GeminiCoach
from app.tts.elevenlabs import TTSService
from app.asr.provider import DeepgramASR

logger = logging.getLogger(__name__)
router = APIRouter()


class SessionState:
    """Manages state for a single tutoring session."""
    
    def __init__(self):
        self.mode: SessionMode = SessionMode.IDLE
        self.target_sign: Optional[str] = None
        self.current_streak: int = 0
        
        # Recognition tracking
        self.last_prediction: Optional[str] = None
        self.last_confidence: float = 0.0
        self.last_feedback_time: float = 0.0
        self.best_confidence_for_target: float = 0.0
        self.has_celebrated_success: bool = False
        
        # Conversation memory (last 5 exchanges)
        self.conversation_history: list[dict] = []
        
    def add_to_history(self, role: str, text: str):
        """Add exchange to conversation history."""
        self.conversation_history.append({"role": role, "text": text})
        # Keep only last 5 exchanges
        if len(self.conversation_history) > 10:
            self.conversation_history = self.conversation_history[-10:]
    
    def get_context_string(self) -> str:
        """Get conversation context for Gemini."""
        context = f"Mode: {self.mode.value}"
        if self.target_sign:
            context += f", Currently teaching: {self.target_sign}"
        if self.last_prediction:
            context += f", User showing: {self.last_prediction} ({int(self.last_confidence*100)}%)"
        if self.conversation_history:
            recent = self.conversation_history[-4:]  # Last 2 exchanges
            history = " | ".join([f"{h['role']}: {h['text'][:50]}" for h in recent])
            context += f"\nRecent: {history}"
        return context
        
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
    Handles conversational ASL tutoring.
    Prioritizes listening to user over giving hand feedback.
    """
    
    # Feedback timing - much more relaxed
    FEEDBACK_COOLDOWN = 12.0  # Minimum 12 seconds between proactive feedback
    SUCCESS_THRESHOLD = 0.80  # Higher bar for success
    SIGNIFICANT_CHANGE = 0.25  # Only comment on big changes
    
    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.state = SessionState()
        self.classifier = SignClassifier()
        self.coach = GeminiCoach()
        self.tts = TTSService()
        self.asr = DeepgramASR()
        self._running = False
        self._asr_connected = False
        self._speaking = False
        self._user_speaking = False  # Pause feedback when user talks
        self._last_speech_time = 0.0
        
    async def send(self, message):
        """Send a message to the client."""
        if hasattr(message, 'model_dump'):
            data = message.model_dump(by_alias=True)
        else:
            data = message
        await self.ws.send_json(data)
        
    async def handle_hand_state(self, msg: dict):
        """Process hand state - update UI but be conservative with verbal feedback."""
        try:
            hand_state = HandStateMessage(**msg)
            
            landmarks = [
                {"x": lm.x, "y": lm.y, "z": lm.z} 
                for lm in hand_state.data.landmarks
            ]
            
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
            
            result = self.classifier.classify(landmarks, features)
            prediction = result.get("prediction")
            confidence = result.get("confidence", 0)
            
            # Track state
            old_prediction = self.state.last_prediction
            old_confidence = self.state.last_confidence
            self.state.last_prediction = prediction
            self.state.last_confidence = confidence
            
            # Update best confidence for current target
            if self.state.target_sign and prediction == self.state.target_sign:
                if confidence > self.state.best_confidence_for_target:
                    self.state.best_confidence_for_target = confidence
            
            # Send UI update (always)
            ui_state = self.state.to_ui_state(
                prediction=prediction,
                confidence=confidence,
                suggestion=result.get("issues", [""])[0] if result.get("issues") else None
            )
            await self.send(ui_state)
            
            # Only give verbal feedback if appropriate
            if self.state.mode in [SessionMode.TEACH, SessionMode.QUIZ]:
                await self._maybe_give_feedback(prediction, confidence, old_prediction, old_confidence)
            
        except Exception as e:
            logger.error(f"Error processing hand state: {e}")
    
    async def _maybe_give_feedback(self, prediction: str, confidence: float, 
                                    old_prediction: str, old_confidence: float):
        """Give feedback only when truly appropriate - not constantly."""
        
        # Never interrupt if speaking or user is speaking
        if self._speaking or self._user_speaking:
            return
        
        # Don't give feedback if user spoke recently (let them lead)
        if time.time() - self._last_speech_time < 3.0:
            return
            
        target = self.state.target_sign
        if not target:
            return
            
        current_time = time.time()
        time_since_feedback = current_time - self.state.last_feedback_time
        
        # SUCCESS: User nailed it!
        if prediction == target and confidence >= self.SUCCESS_THRESHOLD:
            if not self.state.has_celebrated_success:
                self.state.has_celebrated_success = True
                self.state.current_streak += 1
                self.state.last_feedback_time = current_time
                await self._celebrate_success()
                return
        
        # Only give corrective feedback after long cooldown AND significant change
        if time_since_feedback < self.FEEDBACK_COOLDOWN:
            return
            
        # Check for significant improvement or regression
        if prediction == target:
            improvement = confidence - old_confidence
            if improvement > self.SIGNIFICANT_CHANGE:
                # Getting better - encourage!
                self.state.last_feedback_time = current_time
                await self.speak("That's it! You're getting closer!")
        elif old_prediction == target and prediction != target:
            # Lost the sign - gentle reminder
            self.state.last_feedback_time = current_time
            await self.speak(f"Hmm, try to get back to {target}.")
    
    async def _celebrate_success(self):
        """Celebrate and offer next steps conversationally."""
        target = self.state.target_sign
        
        if self.coach.is_available:
            prompt = f"""The student just successfully signed '{target}'! 
Celebrate briefly and naturally ask what they'd like to do next.
Keep it to 1-2 sentences. Be warm but not over the top."""
            response = await self.coach._call_gemini(prompt)
            if response:
                self.state.add_to_history("agent", response)
                await self.speak(response)
                return
        
        await self.speak(f"Perfect {target}! What would you like to do next?")
            
    async def handle_audio_chunk(self, msg: dict):
        """Process audio chunks."""
        if not self._asr_connected:
            return
        try:
            audio_chunk = AudioChunkMessage(**msg)
            await self.asr.send_audio_base64(audio_chunk.data)
        except Exception as e:
            logger.error(f"Error processing audio chunk: {e}")
    
    async def handle_control(self, msg: dict):
        """Handle client control messages."""
        try:
            control = ClientControlMessage(**msg)
            
            if control.action == "start":
                self.state.mode = SessionMode.IDLE
                await self.send_welcome()
                await self.start_asr()
            elif control.action == "stop":
                self.state.mode = SessionMode.IDLE
                self.state.target_sign = None
                await self.stop_asr()
                
        except Exception as e:
            logger.error(f"Error handling control: {e}")
    
    async def on_transcript(self, text: str, is_final: bool):
        """Handle speech transcripts - prioritize user voice."""
        self._user_speaking = True
        self._last_speech_time = time.time()
        
        if is_final:
            self._user_speaking = False
            msg = AsrFinalMessage(text=text)
            logger.info(f"User: {text}")
            await self.send(msg)
            
            # Add to history and process
            self.state.add_to_history("user", text)
            await self.process_conversation(text)
        else:
            msg = AsrPartialMessage(text=text)
            await self.send(msg)
    
    async def process_conversation(self, transcript: str):
        """Process all user speech conversationally through Gemini."""
        if not transcript.strip():
            return
        
        # First try rule-based for clear commands (faster)
        intent = self.coach.parse_intent_rules(transcript)
        intent_type = intent.get("intent")
        logger.info(f"Intent: {intent}")
        
        # Handle clear commands directly
        if intent_type == "teach":
            target = intent.get("target")
            if target:
                await self.start_teaching(target)
            else:
                await self.respond_naturally("The user wants to learn a letter but didn't specify which one. Ask them warmly which letter they'd like to learn.")
                
        elif intent_type == "quiz":
            await self.start_quiz()
            
        elif intent_type == "stop":
            await self.end_activity()
            
        elif intent_type == "next":
            await self.progress_to_next()
            
        elif intent_type == "check":
            await self.give_feedback_on_request()
            
        elif intent_type == "yes" and self.state.has_celebrated_success:
            await self.progress_to_next()
            
        else:
            # EVERYTHING ELSE goes to Gemini for natural conversation
            await self.respond_naturally(transcript)
    
    async def respond_naturally(self, user_input: str):
        """Let Gemini handle the conversation naturally."""
        if not self.coach.is_available:
            await self.speak("I'm here to help! Try saying 'teach me' and a letter.")
            return
        
        context = self.state.get_context_string()
        
        prompt = f"""You are Sam, a warm and patient ASL tutor having a real conversation.

Context: {context}

The student said: "{user_input}"

Respond naturally like a caring teacher would. You can:
- Answer questions about ASL or the current letter
- Give feedback if they're asking about their sign
- Chat briefly about related topics
- Gently guide back to practice if way off-topic
- Ask follow-up questions to understand them better

Keep responses to 1-3 sentences. Be conversational, not robotic.
If they're practicing a sign, you can see what they're showing in the context above."""

        response = await self.coach._call_gemini(prompt)
        if response:
            self.state.add_to_history("agent", response)
            await self.speak(response)
        else:
            await self.speak("I'm listening! What would you like to work on?")
    
    async def give_feedback_on_request(self):
        """Give immediate feedback when user asks."""
        prediction = self.state.last_prediction
        confidence = self.state.last_confidence
        target = self.state.target_sign
        
        if not prediction:
            await self.speak("I can't quite see your hand. Can you hold it up for me?")
            return
        
        if target:
            if prediction == target and confidence >= self.SUCCESS_THRESHOLD:
                await self.speak(f"Yes! That's a great {target}!")
            elif prediction == target:
                await self.speak(f"That's {target}! Try holding it a bit steadier.")
            else:
                context = self.state.get_context_string()
                prompt = f"""Context: {context}
The student asked for feedback. They're trying to sign '{target}' but showing '{prediction}' at {int(confidence*100)}%.
Give specific, helpful feedback in 1 sentence. What should they adjust?"""
                response = await self.coach._call_gemini(prompt)
                if response:
                    await self.speak(response)
                else:
                    await self.speak(f"You're showing {prediction}. For {target}, try adjusting your fingers.")
        else:
            await self.speak(f"I see {prediction}. Would you like to practice that letter?")
    
    async def start_teaching(self, letter: str):
        """Start teaching a letter."""
        letter = letter.upper()
        self.state.mode = SessionMode.TEACH
        self.state.target_sign = letter
        self.state.has_celebrated_success = False
        self.state.best_confidence_for_target = 0.0
        self.state.last_feedback_time = time.time()
        
        ui_state = self.state.to_ui_state()
        await self.send(ui_state)
        
        # Short, natural instruction
        if self.coach.is_available:
            prompt = f"""Give a brief instruction for signing '{letter}' in ASL.
Just the hand position - no greeting. Like: "For {letter}, [position]. Show me!"
One sentence max."""
            response = await self.coach._call_gemini(prompt)
            if response:
                self.state.add_to_history("agent", response)
                await self.speak(response)
                return
        
        await self.speak(f"For {letter}, let me see your hand. Show me when ready!")
        logger.info(f"Teaching: {letter}")
    
    async def start_quiz(self):
        """Start a quiz."""
        self.state.mode = SessionMode.QUIZ
        
        import random
        letters = "ABCILOVY"
        letter = random.choice(letters)
        self.state.target_sign = letter
        self.state.has_celebrated_success = False
        self.state.best_confidence_for_target = 0.0
        self.state.last_feedback_time = time.time()
        
        ui_state = self.state.to_ui_state()
        await self.send(ui_state)
        
        await self.speak(f"Alright, show me {letter}!")
        logger.info(f"Quiz: {letter}")
    
    async def progress_to_next(self):
        """Move to next letter."""
        letters = "ABCILOVY"
        current = self.state.target_sign
        
        if current and current in letters:
            idx = letters.index(current)
            next_letter = letters[(idx + 1) % len(letters)]
        else:
            next_letter = "A"
        
        await self.start_teaching(next_letter)
    
    async def end_activity(self):
        """End current activity."""
        self.state.mode = SessionMode.IDLE
        self.state.target_sign = None
        self.state.has_celebrated_success = False
        
        await self.send(self.state.to_ui_state())
        await self.speak("Sounds good! Let me know when you want to practice more.")
    
    async def start_asr(self):
        """Start ASR."""
        if self._asr_connected:
            return
        try:
            await self.asr.connect(self.on_transcript)
            self._asr_connected = self.asr.is_connected
            if self._asr_connected:
                logger.info("ASR started")
        except Exception as e:
            logger.error(f"ASR failed: {e}")
            self._asr_connected = False
    
    async def stop_asr(self):
        """Stop ASR."""
        if self._asr_connected:
            await self.asr.disconnect()
            self._asr_connected = False
    
    async def speak(self, text: str):
        """Speak via TTS."""
        self._speaking = True
        try:
            await self.send(AgentTextFinalMessage(text=text))
            
            if self.tts.is_available:
                import base64
                async for chunk in self.tts.stream(text):
                    await self.send(TtsAudioChunkMessage(data=base64.b64encode(chunk).decode()))
        finally:
            self._speaking = False
            
    async def send_welcome(self):
        """Send welcome."""
        await self.send(self.state.to_ui_state())
        self.state.add_to_history("agent", "Hi! What would you like to learn today?")
        await self.speak("Hi! What would you like to learn today?")
        
    async def run(self):
        """Main loop."""
        self._running = True
        await self.send_welcome()
        await self.start_asr()
        
        while self._running:
            try:
                data = await self.ws.receive_json()
                msg_type = data.get("type")
                
                if msg_type == "hand_state":
                    await self.handle_hand_state(data)
                elif msg_type == "audio_chunk":
                    await self.handle_audio_chunk(data)
                elif msg_type == "client_control":
                    await self.handle_control(data)
                    
            except WebSocketDisconnect:
                self._running = False
            except Exception as e:
                logger.error(f"Error: {e}")
                
    def stop(self):
        self._running = False


@router.websocket("/ws/session")
async def websocket_session(websocket: WebSocket):
    """WebSocket endpoint."""
    await websocket.accept()
    logger.info("Session started")
    
    session = SessionManager(websocket)
    
    try:
        await session.run()
    finally:
        await session.stop_asr()
        await session.tts.close()
        await session.coach.close()
        session.stop()
        logger.info("Session ended")
