"""
Gemini Coach Module
Uses Gemini for intent parsing, lesson planning, and coaching responses.
"""
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class GeminiCoach:
    """
    Gemini-powered coaching brain for ASL tutoring.
    
    Responsibilities:
    - Parse user intent from speech transcripts
    - Plan lessons based on user progress
    - Generate empathetic, concise coaching responses
    
    NOT used for:
    - Vision or image recognition
    - Sign classification
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self._initialized = False
        # TODO: Initialize Vertex AI client
        
    async def parse_intent(self, transcript: str) -> dict:
        """
        Parse user intent from speech transcript.
        
        Args:
            transcript: User's spoken text
            
        Returns:
            dict with intent type and parameters
            
        Example intents:
        - {"intent": "teach", "target": "B"}
        - {"intent": "quiz", "focus": null}
        - {"intent": "repeat", "target": null}
        - {"intent": "help", "topic": "M vs N"}
        """
        # STUB: Simple keyword matching for MVP
        transcript_lower = transcript.lower()
        
        if "teach" in transcript_lower:
            # Extract letter if mentioned
            for char in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                if char.lower() in transcript_lower.split():
                    return {"intent": "teach", "target": char}
            return {"intent": "teach", "target": "A"}  # Default
            
        elif "quiz" in transcript_lower:
            return {"intent": "quiz", "focus": None}
            
        elif "repeat" in transcript_lower:
            return {"intent": "repeat", "target": None}
            
        elif "help" in transcript_lower:
            return {"intent": "help", "topic": None}
            
        else:
            return {"intent": "unknown", "raw": transcript}
    
    async def generate_coaching(
        self,
        recognition_result: dict,
        target_sign: str,
        user_context: Optional[dict] = None
    ) -> str:
        """
        Generate coaching response based on recognition results.
        
        Args:
            recognition_result: Output from classifier
            target_sign: The sign user was attempting
            user_context: Optional context about user progress
            
        Returns:
            Coaching text response
        """
        # STUB: Template-based responses for MVP
        prediction = recognition_result.get("prediction")
        confidence = recognition_result.get("confidence", 0)
        issues = recognition_result.get("issues", [])
        
        if prediction == target_sign and confidence > 0.8:
            return f"Great job! That's a perfect {target_sign}! Ready for the next one?"
        elif prediction == target_sign:
            return f"Good! That looks like {target_sign}. Try to hold it a bit more steadily."
        elif issues:
            issue_text = ", ".join(issues[:2])  # Limit to 2 corrections
            return f"Almost! I see {prediction} but you're going for {target_sign}. Try adjusting: {issue_text}"
        else:
            return f"I see {prediction}. For {target_sign}, make sure your fingers are positioned correctly."
    
    async def plan_next_prompt(self, session_state: dict) -> dict:
        """
        Plan the next lesson prompt based on session state.
        
        Args:
            session_state: Current session state including history, weak signs
            
        Returns:
            dict with next_sign, mode, and optional hints
        """
        # STUB: Simple progression for MVP
        weak_signs = session_state.get("weak_signs", [])
        current_streak = session_state.get("current_streak", 0)
        
        # If struggling, focus on weak signs
        if weak_signs:
            return {
                "next_sign": weak_signs[0],
                "mode": "TEACH",
                "hint": f"Let's practice {weak_signs[0]} again"
            }
        
        # Otherwise, progress through alphabet
        alphabet = "ABCEILOVY W"  # MVP set
        history = session_state.get("history", [])
        completed = set(h.get("sign") for h in history if h.get("passed"))
        
        for letter in alphabet:
            if letter not in completed:
                return {
                    "next_sign": letter,
                    "mode": "TEACH",
                    "hint": None
                }
        
        # All done - quiz mode
        return {
            "next_sign": alphabet[0],
            "mode": "QUIZ",
            "hint": "Great progress! Let's test your knowledge."
        }

