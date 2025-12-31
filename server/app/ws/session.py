"""
WebSocket Session Handler
Real-time conversational ASL tutoring.
Uses CLIENT'S ML model predictions for grading, not server-side classifier.
"""
import json
import logging
import time
import asyncio
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
from app.llm.gemini import GeminiCoach
from app.tts.elevenlabs import TTSService
from app.asr.provider import DeepgramASR

logger = logging.getLogger(__name__)
router = APIRouter()


class QuizState:
    """Tracks state for a quiz session."""
    
    # All letters except J and Z (require motion)
    ALL_LETTERS = list("ABCDEFGHIKLMNOPQRSTUVWXY")  # 24 letters
    QUIZ_COUNT = 8  # Number of letters per quiz
    
    def __init__(self):
        import random
        # Randomly select 8 letters from the pool
        self.letters_to_quiz = random.sample(self.ALL_LETTERS, self.QUIZ_COUNT)
        random.shuffle(self.letters_to_quiz)  # Extra shuffle for randomness
        
        self.current_letter_index = 0
        self.current_try = 0
        self.countdown_active = False
        self.countdown_value = 0
        self.is_active = True  # Quiz in progress
        
        self.results: dict[str, bool] = {}
        self.letter_tries: dict[str, list[bool]] = {}
        
        for letter in self.letters_to_quiz:
            self.results[letter] = False
            self.letter_tries[letter] = []
    
    @property
    def current_letter(self) -> Optional[str]:
        if self.current_letter_index < len(self.letters_to_quiz):
            return self.letters_to_quiz[self.current_letter_index]
        return None
    
    @property
    def is_complete(self) -> bool:
        return self.current_letter_index >= len(self.letters_to_quiz)
    
    def record_attempt(self, success: bool):
        letter = self.current_letter
        if letter:
            self.letter_tries[letter].append(success)
            if success:
                self.results[letter] = True
            self.current_try += 1
    
    def advance_to_next_letter(self):
        self.current_letter_index += 1
        self.current_try = 0
    
    def needs_next_try(self) -> bool:
        letter = self.current_letter
        if not letter:
            return False
        if self.results[letter]:
            return False
        return self.current_try < 3
    
    def get_final_results(self) -> dict:
        passed = sum(1 for v in self.results.values() if v)
        total = len(self.letters_to_quiz)
        missed = [l for l, v in self.results.items() if not v]
        return {
            "passed": passed,
            "total": total,
            "score": round((passed / total) * 100) if total > 0 else 0,
            "missed": missed,
            "details": self.letter_tries
        }


class SessionState:
    """Manages state for a single tutoring session."""
    
    def __init__(self):
        self.mode: SessionMode = SessionMode.IDLE
        self.target_sign: Optional[str] = None
        self.current_streak: int = 0
        
        # ML model results from client
        self.last_ml_prediction: Optional[str] = None
        self.last_ml_confidence: float = 0.0
        
        # Teaching progress
        self.teaching_successes: int = 0
        self.has_announced_success: bool = False
        self.success_frame_count: int = 0
        self.mastery_completed: bool = False  # True when 3/3 reached, prevents further counting
        self.last_success_time: float = 0.0  # Cooldown between checkmarks
        self.in_cooldown: bool = False  # Block frame reads during cooldown
        
        # Auto-feedback timing
        self.last_feedback_time: float = 0.0  # Track when we last gave feedback
        self.wrong_since: float = 0.0  # Track how long user has been wrong
        
        # Quiz state
        self.quiz: Optional[QuizState] = None
        
        # Conversation memory
        self.conversation_history: list[dict] = []
        
        # Session history
        self.learned_letters: set[str] = set()
        self.quiz_scores: list[dict] = []
        
        self.interrupted_text: Optional[str] = None
        
    def add_to_history(self, role: str, text: str):
        self.conversation_history.append({"role": role, "text": text})
        if len(self.conversation_history) > 10:
            self.conversation_history = self.conversation_history[-10:]
    
    def get_context_string(self) -> str:
        context = f"Mode: {self.mode.value}"
        if self.target_sign:
            if self.mode == SessionMode.TEACH:
                context += f", Teaching: {self.target_sign} (progress: {self.teaching_successes}/3)"
            elif self.mode == SessionMode.QUIZ and self.quiz:
                context += f", Quiz: {self.target_sign} (try {self.quiz.current_try + 1}/3)"
        if self.last_ml_prediction:
            context += f", User showing: {self.last_ml_prediction} ({int(self.last_ml_confidence*100)}%)"
        if self.learned_letters:
            context += f"\nLearned: {', '.join(sorted(self.learned_letters))}"
        return context
        
    def to_ui_state(
        self, 
        prediction: Optional[str] = None, 
        confidence: Optional[float] = None,
        suggestion: Optional[str] = None,
        quiz_countdown: Optional[int] = None,
        quiz_try: Optional[int] = None,
        quiz_results: Optional[dict] = None
    ) -> UiStateMessage:
        return UiStateMessage(
            mode=self.mode,
            target_sign=self.target_sign,
            prediction=prediction,
            confidence=confidence,
            suggestion=suggestion,
            streak=self.current_streak,
            teaching_progress=self.teaching_successes,
            quiz_countdown=quiz_countdown,
            quiz_try=quiz_try,
            quiz_results=quiz_results,
        )


class SessionManager:
    """
    Handles ASL tutoring.
    Uses CLIENT ML predictions for grading.
    Quiz mode is protected from speech interruption.
    """
    
    SUCCESS_CONFIDENCE = 0.89  # 89% threshold
    SUCCESS_FRAMES_NEEDED = 3
    SILENCE_BUFFER = 1.0
    CHECKMARK_COOLDOWN = 2.5  # Seconds between checkmarks
    AUTO_FEEDBACK_INTERVAL = 4.0  # Seconds before auto-feedback when struggling
    
    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.state = SessionState()
        self.coach = GeminiCoach()
        self.tts = TTSService()
        self.asr = DeepgramASR()
        self._running = False
        self._asr_connected = False
        
        self._speaking = False
        self._should_stop_speaking = False
        self._current_speech_text = ""
        
        self._user_speaking = False
        self._last_user_speech_time = 0.0
        self._accumulated_transcript = ""
        self._waiting_for_silence = False
        self._silence_task: Optional[asyncio.Task] = None
        
    async def send(self, message):
        if hasattr(message, 'model_dump'):
            data = message.model_dump(by_alias=True)
        else:
            data = message
        await self.ws.send_json(data)
    
    async def _stop_client_audio(self):
        await self.ws.send_json({"type": "tts_stop"})
        
    async def _interrupt_speech(self):
        if self._speaking:
            logger.info("INTERRUPTING speech!")
            self._should_stop_speaking = True
            self.state.interrupted_text = self._current_speech_text
            await self._stop_client_audio()
        
    async def handle_hand_state(self, msg: dict):
        """Process hand state - use CLIENT ML prediction."""
        try:
            hand_state = HandStateMessage(**msg)
            
            # Get ML prediction from CLIENT (not server classifier!)
            prediction = hand_state.data.ml_prediction
            confidence = hand_state.data.ml_confidence or 0.0
            
            # Store for later use
            self.state.last_ml_prediction = prediction
            self.state.last_ml_confidence = confidence
            
            # Build UI state
            quiz_countdown = None
            quiz_try = None
            if self.state.quiz:
                if self.state.quiz.countdown_active:
                    quiz_countdown = self.state.quiz.countdown_value
                quiz_try = self.state.quiz.current_try
            
            ui_state = self.state.to_ui_state(
                prediction=prediction,
                confidence=confidence,
                quiz_countdown=quiz_countdown,
                quiz_try=quiz_try
            )
            await self.send(ui_state)
            
            # Teaching mode: monitor for success
            if self.state.mode == SessionMode.TEACH and self.state.target_sign:
                await self._monitor_teaching_success(prediction, confidence)
            
        except Exception as e:
            logger.error(f"Error processing hand state: {e}")
    
    async def _monitor_teaching_success(self, prediction: str, confidence: float):
        """Monitor for teaching success using ML prediction with cooldown and auto-feedback."""
        target = self.state.target_sign
        current_time = time.time()
        
        if not target:
            return
        
        # Don't count more after mastery is complete
        if self.state.mastery_completed:
            return
        
        # Skip frame reading during cooldown
        if self.state.in_cooldown:
            if current_time - self.state.last_success_time < self.CHECKMARK_COOLDOWN:
                return
            else:
                self.state.in_cooldown = False
                self.state.has_announced_success = False
                self.state.success_frame_count = 0
            
        is_correct = prediction == target and confidence >= self.SUCCESS_CONFIDENCE
        
        if is_correct:
            self.state.success_frame_count += 1
            self.state.wrong_since = 0.0  # Reset wrong timer
            
            if self.state.success_frame_count >= self.SUCCESS_FRAMES_NEEDED:
                if not self.state.has_announced_success:
                    self.state.has_announced_success = True
                    self.state.teaching_successes += 1
                    self.state.current_streak += 1
                    self.state.last_success_time = current_time
                    self.state.in_cooldown = True  # Enter cooldown
                    
                    logger.info(f"Teaching success! {prediction} at {confidence*100:.0f}% - Progress: {self.state.teaching_successes}/3")
                    
                    # Check if mastery is now complete
                    if self.state.teaching_successes >= 3:
                        self.state.mastery_completed = True
                    
                    await self.send(self.state.to_ui_state(
                        prediction=prediction,
                        confidence=confidence
                    ))
                    
                    if not self._user_speaking and not self._waiting_for_silence:
                        await self._announce_teaching_progress()
        else:
            self.state.success_frame_count = 0
            
            # Track how long user has been wrong for auto-feedback
            if not self.state.wrong_since:
                self.state.wrong_since = current_time
            
            # Auto-feedback: if user is struggling for 4+ seconds and agent isn't speaking
            time_struggling = current_time - self.state.wrong_since
            time_since_feedback = current_time - self.state.last_feedback_time
            
            if (time_struggling >= self.AUTO_FEEDBACK_INTERVAL 
                and time_since_feedback >= self.AUTO_FEEDBACK_INTERVAL
                and not self._speaking 
                and not self._user_speaking 
                and not self._waiting_for_silence
                and prediction):  # Only if we see something
                
                self.state.last_feedback_time = current_time
                self.state.wrong_since = current_time  # Reset so we don't spam
                
                # Give gentle guidance
                await self._give_auto_feedback(prediction, confidence, target)
    
    async def _announce_teaching_progress(self):
        """Announce teaching progress in a calm, measured way."""
        progress = self.state.teaching_successes
        target = self.state.target_sign
        
        if progress >= 3:
            self.state.learned_letters.add(target)
            await self.speak(f"You've mastered {target}. Want to try another letter, or a quiz?")
        else:
            remaining = 3 - progress
            import random
            phrases = [
                f"Good. {progress} of 3.",
                f"That's {progress}. {remaining} more.",
                f"Nice. {remaining} to go.",
            ]
            await self.speak(random.choice(phrases))
    
    async def _give_auto_feedback(self, prediction: str, confidence: float, target: str):
        """Give automatic feedback when user is struggling."""
        pct = int(confidence * 100)
        
        if prediction == target:
            # Close but not quite there
            await self.speak(f"Getting there. You're at {pct}%. Hold it steadier.")
        elif prediction:
            # Wrong sign
            await self.speak(f"I see {prediction}. Try adjusting for {target}.")
        else:
            # Can't see clearly
            await self.speak(f"I can't quite see. Hold your hand up clearly.")
    
    async def handle_audio_chunk(self, msg: dict):
        if not self._asr_connected:
            return
        try:
            audio_chunk = AudioChunkMessage(**msg)
            await self.asr.send_audio_base64(audio_chunk.data)
        except Exception as e:
            logger.error(f"Error processing audio chunk: {e}")
    
    async def handle_control(self, msg: dict):
        try:
            control = ClientControlMessage(**msg)
            
            if control.action == "start":
                self.state.mode = SessionMode.IDLE
                await self.send_welcome()
                await self.start_asr()
            elif control.action == "stop":
                self.state.mode = SessionMode.IDLE
                self.state.target_sign = None
                self.state.quiz = None
                await self.stop_asr()
                
        except Exception as e:
            logger.error(f"Error handling control: {e}")
    
    async def on_transcript(self, text: str, is_final: bool):
        """Handle speech - but PROTECT quiz mode from distraction."""
        current_time = time.time()
        self._last_user_speech_time = current_time
        
        # In quiz mode, only stop speech but don't process conversation
        # unless user explicitly wants to stop
        if self.state.quiz and self.state.quiz.is_active:
            if self._speaking:
                await self._interrupt_speech()
            
            if is_final and text.strip():
                # Only check for explicit stop commands in quiz
                lower = text.lower().strip()
                if any(word in lower for word in ["stop", "quit", "end", "cancel", "exit"]):
                    logger.info("User requested to end quiz")
                    await self._end_quiz_early()
                # Otherwise ignore speech during quiz - let quiz continue
                await self.send(AsrFinalMessage(text=text))
            else:
                await self.send(AsrPartialMessage(text=text))
            return
        
        # Normal mode - process speech
        if self._speaking:
            await self._interrupt_speech()
        
        if is_final and text.strip():
            self._user_speaking = False
            
            if self._accumulated_transcript:
                self._accumulated_transcript += " " + text
            else:
                self._accumulated_transcript = text
            
            await self.send(AsrFinalMessage(text=text))
            
            if self._silence_task and not self._silence_task.done():
                self._silence_task.cancel()
            
            self._waiting_for_silence = True
            self._silence_task = asyncio.create_task(self._wait_for_silence())
            
        else:
            self._user_speaking = True
            await self.send(AsrPartialMessage(text=text))
    
    async def _wait_for_silence(self):
        try:
            await asyncio.sleep(self.SILENCE_BUFFER)
            
            if time.time() - self._last_user_speech_time < self.SILENCE_BUFFER:
                return
            
            if self._accumulated_transcript:
                transcript = self._accumulated_transcript
                self._accumulated_transcript = ""
                self._waiting_for_silence = False
                
                logger.info(f"User: {transcript}")
                self.state.add_to_history("user", transcript)
                
                was_interrupted = self.state.interrupted_text is not None
                await self.process_conversation(transcript, was_interrupted)
                self.state.interrupted_text = None
                
        except asyncio.CancelledError:
            pass
        finally:
            self._waiting_for_silence = False
    
    async def process_conversation(self, transcript: str, was_interrupted: bool = False):
        if not transcript.strip():
            return
        
        intent = self.coach.parse_intent_rules(transcript)
        intent_type = intent.get("intent")
        logger.info(f"Intent: {intent}")
        
        if intent_type == "teach":
            target = intent.get("target")
            if target:
                await self.start_teaching(target)
            else:
                await self._respond_naturally(transcript, was_interrupted)
                
        elif intent_type == "quiz":
            await self.start_quiz()
            
        elif intent_type == "stop":
            await self.end_activity()
            
        elif intent_type == "next":
            if self.state.mode == SessionMode.TEACH:
                await self.progress_to_next()
            
        elif intent_type == "check":
            await self.give_feedback()
            
        elif intent_type == "yes":
            if self.state.teaching_successes >= 3:
                await self.progress_to_next()
            else:
                await self._respond_naturally(transcript, was_interrupted)
            
        else:
            await self._respond_naturally(transcript, was_interrupted)
    
    async def _respond_naturally(self, user_input: str, was_interrupted: bool = False):
        if not self.coach.is_available:
            await self.speak("I'm here to help. Say 'teach me' and a letter.")
            return
        
        context = self.state.get_context_string()
        
        prompt = f"""You are Sam, a calm ASL tutor.
Context: {context}
The student said: "{user_input}"
Respond calmly in 1 sentence. No exclamation marks. Measured pace."""

        response = await self.coach._call_gemini(prompt)
        if response:
            self.state.add_to_history("agent", response)
            await self.speak(response)
        else:
            await self.speak("What would you like to work on?")
    
    async def give_feedback(self):
        prediction = self.state.last_ml_prediction
        confidence = self.state.last_ml_confidence
        target = self.state.target_sign
        
        if not prediction:
            await self.speak("I can't quite see your hand. Hold it up for me.")
            return
        
        pct = int(confidence * 100)
        if target:
            if prediction == target and confidence >= self.SUCCESS_CONFIDENCE:
                await self.speak(f"That's a nice {target}. {pct} percent.")
            elif prediction == target:
                await self.speak(f"You're at {pct} percent. Almost there.")
            else:
                await self.speak(f"That looks like {prediction}. Try adjusting for {target}.")
        else:
            await self.speak(f"I see {prediction} at {pct} percent. Want to practice that?")
    
    async def start_teaching(self, letter: str):
        letter = letter.upper()
        self.state.mode = SessionMode.TEACH
        self.state.target_sign = letter
        self.state.teaching_successes = 0
        self.state.has_announced_success = False
        self.state.success_frame_count = 0
        self.state.mastery_completed = False  # Reset mastery flag for new letter
        self.state.in_cooldown = False
        self.state.last_success_time = 0.0
        self.state.last_feedback_time = time.time()  # Reset auto-feedback timer
        self.state.wrong_since = 0.0
        self.state.quiz = None
        
        await self.send(self.state.to_ui_state())
        
        if self.coach.is_available:
            prompt = f"""Give a calm, brief instruction for signing '{letter}' in ASL.
Just the hand position. No greetings. Like: "For {letter}, [position]. Show me 3 times."
One sentence, no exclamation marks."""
            response = await self.coach._call_gemini(prompt)
            if response:
                self.state.add_to_history("agent", response)
                await self.speak(response)
                return
        
        await self.speak(f"Show me {letter}. Get it right 3 times to master it.")
        logger.info(f"Teaching: {letter}")
    
    async def start_quiz(self):
        self.state.mode = SessionMode.QUIZ
        self.state.quiz = QuizState()
        
        await self.speak("Alright. Quiz time. Eight random letters, three tries each. Take your time.")
        
        await asyncio.sleep(2)
        await self._quiz_next_letter()
    
    async def _quiz_next_letter(self):
        quiz = self.state.quiz
        if not quiz or quiz.is_complete:
            await self._finish_quiz()
            return
        
        letter = quiz.current_letter
        self.state.target_sign = letter
        
        await self.send(self.state.to_ui_state(quiz_try=quiz.current_try))
        
        await self.speak(f"Show me {letter}.")
        
        await asyncio.sleep(1)
        await self._start_quiz_countdown()
    
    async def _start_quiz_countdown(self):
        quiz = self.state.quiz
        if not quiz or not quiz.is_active:
            return
        
        quiz.countdown_active = True
        
        for i in range(3, 0, -1):
            if not quiz.is_active:  # Check if quiz was ended
                return
            quiz.countdown_value = i
            await self.send(self.state.to_ui_state(
                quiz_countdown=i,
                quiz_try=quiz.current_try
            ))
            await asyncio.sleep(1)
        
        quiz.countdown_active = False
        await self._grade_quiz_attempt()
    
    async def _grade_quiz_attempt(self):
        quiz = self.state.quiz
        if not quiz or not quiz.is_active:
            return
        
        target = quiz.current_letter
        # Use ML prediction from client!
        prediction = self.state.last_ml_prediction
        confidence = self.state.last_ml_confidence
        
        logger.info(f"Grading: target={target}, ML prediction={prediction}, confidence={confidence*100:.0f}%")
        
        success = prediction == target and confidence >= self.SUCCESS_CONFIDENCE
        quiz.record_attempt(success)
        
        if success:
            await self.speak(f"Good. {int(confidence*100)} percent.")
            await asyncio.sleep(1)
            quiz.advance_to_next_letter()
            await self._quiz_next_letter()
        else:
            if quiz.needs_next_try():
                tries_left = 3 - quiz.current_try
                if prediction:
                    await self.speak(f"That looked like {prediction}. {tries_left} {'tries' if tries_left > 1 else 'try'} left.")
                else:
                    await self.speak(f"I couldn't see that clearly. {tries_left} {'tries' if tries_left > 1 else 'try'} left.")
                await asyncio.sleep(1)
                await self._start_quiz_countdown()
            else:
                await self.speak(f"Okay. Moving on.")
                await asyncio.sleep(1)
                quiz.advance_to_next_letter()
                await self._quiz_next_letter()
    
    async def _end_quiz_early(self):
        """End quiz early when user requests."""
        if self.state.quiz:
            self.state.quiz.is_active = False
            await self._finish_quiz()
    
    async def _finish_quiz(self):
        quiz = self.state.quiz
        if not quiz:
            return
        
        results = quiz.get_final_results()
        self.state.quiz_scores.append(results)
        
        await self.send(self.state.to_ui_state(quiz_results=results))
        
        score = results["score"]
        missed = results["missed"]
        
        if score == 100:
            await self.speak("Perfect score. Well done.")
        elif score >= 70:
            await self.speak(f"Nice work. {score} percent.")
        else:
            await self.speak(f"You got {score} percent. Keep practicing.")
        
        self.state.mode = SessionMode.IDLE
        self.state.target_sign = None
        self.state.quiz = None
    
    async def progress_to_next(self):
        # All letters except J and Z (require motion)
        letters = "ABCDEFGHIKLMNOPQRSTUVWXY"
        current = self.state.target_sign
        
        if current and current in letters:
            idx = letters.index(current)
            next_letter = letters[(idx + 1) % len(letters)]
        else:
            next_letter = "A"
        
        await self.start_teaching(next_letter)
    
    async def end_activity(self):
        if self.state.quiz and self.state.quiz.is_active:
            await self._end_quiz_early()
            return
            
        self.state.mode = SessionMode.IDLE
        self.state.target_sign = None
        self.state.teaching_successes = 0
        self.state.quiz = None
        
        await self.send(self.state.to_ui_state())
        await self.speak("Okay. Let me know when you want to practice more.")
    
    async def start_asr(self):
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
        if self._asr_connected:
            await self.asr.disconnect()
            self._asr_connected = False
    
    async def speak(self, text: str):
        if self._user_speaking or self._waiting_for_silence:
            logger.info("Skipping speech - user is talking")
            return
            
        self._speaking = True
        self._should_stop_speaking = False
        self._current_speech_text = text
        
        try:
            await self.send(AgentTextFinalMessage(text=text))
            
            if self.tts.is_available:
                import base64
                chunk_count = 0
                async for chunk in self.tts.stream(text):
                    if self._should_stop_speaking:
                        logger.info(f"Speech stopped after {chunk_count} chunks")
                        break
                    
                    if self._user_speaking:
                        logger.info("User started talking - stopping speech")
                        await self._stop_client_audio()
                        break
                    
                    await self.send(TtsAudioChunkMessage(data=base64.b64encode(chunk).decode()))
                    chunk_count += 1
                    await asyncio.sleep(0.005)
                    
        finally:
            self._speaking = False
            self._current_speech_text = ""
            self._should_stop_speaking = False
            
    async def send_welcome(self):
        await self.send(self.state.to_ui_state())
        self.state.add_to_history("agent", "Hi. What would you like to learn today?")
        await self.speak("Hi. What would you like to learn today?")
        
    async def run(self):
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
