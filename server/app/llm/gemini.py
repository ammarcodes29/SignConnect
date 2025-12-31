"""
Gemini Coach Module
Uses Gemini for intent parsing, lesson planning, and coaching responses.
"""
import os
import re
import logging
from pathlib import Path
from typing import Optional
import httpx
from dotenv import load_dotenv

# Load environment variables from project root
project_root = Path(__file__).parent.parent.parent.parent
env_path = project_root / ".env"
load_dotenv(env_path)

logger = logging.getLogger(__name__)

# Coaching personality - calm, gentle, reassuring (like ChatGPT voice mode)
COACH_PERSONA = """You are Sam, a calm and gentle ASL tutor. You speak slowly and reassuringly.

Your voice/style:
- Calm, unhurried, soothing - like a meditation guide or therapist
- Warm but not bubbly - measured, thoughtful
- Very brief - usually just ONE sentence
- Pause-friendly - your words should feel spacious, not rushed
- Reassuring without being patronizing

Examples of your tone:
- "Beautiful. That's perfect."
- "Take your time. No rush."
- "There you go. Nice and steady."
- "Mm-hmm. Just like that."
- "Good. Let's try one more."

What you AVOID:
- Exclamation marks (!) - keep energy calm
- Long explanations - say less
- Rapid-fire instructions - space it out
- Over-enthusiasm - stay grounded
- Repetitive phrases - vary naturally

You speak like someone who has all the time in the world."""


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
    
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
    MODEL = "gemini-2.0-flash"  # Fast model for low latency
    
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self._client: Optional[httpx.AsyncClient] = None
        
        if not self.api_key:
            logger.warning("GEMINI_API_KEY not found - using rule-based fallback")
        else:
            logger.info("Gemini Coach initialized")
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client
    
    async def _call_gemini(self, prompt: str, include_persona: bool = True) -> str:
        """Call Gemini API with a prompt."""
        if not self.api_key:
            return ""
        
        try:
            client = await self._get_client()
            url = f"{self.BASE_URL}/models/{self.MODEL}:generateContent"
            
            # Include coaching persona for better tone
            full_prompt = f"{COACH_PERSONA}\n\n{prompt}" if include_persona else prompt
            
            response = await client.post(
                url,
                params={"key": self.api_key},
                json={
                    "contents": [{"parts": [{"text": full_prompt}]}],
                    "generationConfig": {
                        "temperature": 0.6,  # More consistent, calm responses
                        "maxOutputTokens": 60,  # Very short responses
                    }
                }
            )
            response.raise_for_status()
            data = response.json()
            
            # Extract text from response
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "").strip()
            return ""
            
        except Exception as e:
            logger.error(f"Gemini API call failed: {e}")
            return ""
    
    def parse_intent_rules(self, transcript: str) -> dict:
        """
        Parse user intent using rule-based matching (fast fallback).
        """
        text = transcript.lower().strip()
        
        # Check/feedback requests: "am I doing it right?", "how's this?", "is this correct?"
        check_patterns = [
            r"am i (doing|signing)",
            r"is (this|that) (right|correct|good)",
            r"how('s| is| am i doing)",
            r"(look|looking) (right|correct|good|ok)",
            r"what do you (think|see)",
            r"can you (see|check)",
            r"doing (it )?(right|correctly|good)",
        ]
        for pattern in check_patterns:
            if re.search(pattern, text):
                return {"intent": "check"}
        
        # Teach commands - many variations
        teach_patterns = [
            r"teach\s+(?:me\s+)?(?:the\s+)?(?:letter\s+)?([a-z])\b",
            r"show\s+(?:me\s+)?(?:the\s+)?(?:letter\s+)?([a-z])\b",
            r"how\s+(?:do\s+)?(?:i\s+)?sign\s+(?:the\s+)?(?:letter\s+)?([a-z])\b",
            r"practice\s+(?:the\s+)?(?:letter\s+)?([a-z])\b",
            r"learn\s+(?:the\s+)?(?:letter\s+)?([a-z])\b",
            r"(?:the\s+)?letter\s+([a-z])\b",  # "the letter A", "letter A"
            r"\bdo\s+([a-z])\b",  # "do A", "let's do A"
            r"\btry\s+([a-z])\b",  # "try A"
            r"work\s+on\s+(?:the\s+)?(?:letter\s+)?([a-z])\b",  # "work on A"
            r"start\s+with\s+(?:the\s+)?(?:letter\s+)?([a-z])\b",  # "start with A"
        ]
        
        for pattern in teach_patterns:
            match = re.search(pattern, text)
            if match:
                return {"intent": "teach", "target": match.group(1).upper()}
        
        # Just "teach me" without a letter
        if re.search(r"\b(teach|learn|show|practice)\b", text):
            return {"intent": "teach", "target": None}
        
        # Quiz commands: "quiz me", "test me"
        if re.search(r"\b(quiz|test)\s*(?:me)?\b", text):
            return {"intent": "quiz", "focus": None}
        
        # Stop/end commands
        if re.search(r"\b(stop|end|quit|exit|done)\b", text):
            return {"intent": "stop"}
        
        # Repeat commands
        if re.search(r"\b(repeat|again|one\s+more|try again)\b", text):
            return {"intent": "repeat"}
        
        # Help commands
        if re.search(r"\b(help|hint|confused|stuck)\b", text):
            return {"intent": "help"}
        
        # Next/skip commands
        if re.search(r"\b(next|skip|move\s+on|another)\b", text):
            return {"intent": "next"}
        
        # Yes/affirmative
        if re.search(r"^(yes|yeah|yep|sure|ok|okay|absolutely|definitely|let's do it|go ahead)\.?$", text):
            return {"intent": "yes"}
        
        # No/negative
        if re.search(r"^(no|nope|nah|not really|maybe later)\.?$", text):
            return {"intent": "no"}
        
        # Greeting (but not just "yes/ok")
        if re.search(r"\b(hello|hi|hey|thanks|thank you)\b", text):
            return {"intent": "greeting"}
        
        return {"intent": "unknown", "raw": transcript}
    
    async def parse_intent(self, transcript: str) -> dict:
        """
        Parse user intent from speech transcript.
        Uses rules first (fast), falls back to Gemini for complex cases.
        """
        # Try rule-based first (fast)
        result = self.parse_intent_rules(transcript)
        
        # If unknown and Gemini is available, use it for complex parsing
        if result["intent"] == "unknown" and self.api_key:
            prompt = f"""Parse the user's intent. User said: "{transcript}"

Reply with ONLY one word or format:
- teach:X (where X is a letter A-Z)
- teach (wants to learn, no specific letter)
- quiz (wants to be tested)
- check (asking for feedback: "am I doing it right?", "how's this?")
- stop (wants to end)
- repeat (wants to try again)
- help (needs assistance)
- next (wants next letter)
- yes (affirmative response)
- no (negative response)
- greeting (hello, thanks)
- unknown"""
            
            response = await self._call_gemini(prompt, include_persona=False)
            response = response.strip().lower()
            
            if response.startswith("teach:"):
                letter = response.split(":")[1].strip().upper()
                if len(letter) == 1 and letter.isalpha():
                    return {"intent": "teach", "target": letter}
            elif response in ["teach", "quiz", "stop", "repeat", "help", "next", "greeting", "check", "yes", "no"]:
                return {"intent": response, "target": None}
        
        return result
    
    async def generate_coaching(
        self,
        recognition_result: dict,
        target_sign: str,
        mode: str = "TEACH",
        user_context: Optional[dict] = None
    ) -> str:
        """Generate warm, supportive coaching response."""
        prediction = recognition_result.get("prediction")
        confidence = recognition_result.get("confidence", 0)
        
        # Use Gemini for calm, gentle responses
        if self.api_key:
            if prediction == target_sign and confidence > 0.8:
                prompt = f"The student signed '{target_sign}' well. Give calm, brief praise. One short sentence, no exclamation marks. Like: 'Beautiful. That's it.'"
            elif prediction == target_sign and confidence > 0.5:
                prompt = f"The student signed '{target_sign}' but at {int(confidence*100)}%. Give calm encouragement to hold steadier. One sentence, gentle tone."
            elif prediction and prediction != target_sign:
                prompt = f"The student showed '{prediction}' but we want '{target_sign}'. Give gentle redirection in one calm sentence. No 'wrong' or 'incorrect'."
            else:
                prompt = f"The student's sign for '{target_sign}' isn't clear. One calm sentence encouraging them to try again."
            
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        # Calm fallback responses
        if prediction == target_sign and confidence > 0.8:
            return f"Beautiful. That's a perfect {target_sign}."
        elif prediction == target_sign:
            return f"Good. That's {target_sign}. Just hold it a little steadier."
        elif prediction and prediction != target_sign:
            return f"I see {prediction}. For {target_sign}, try adjusting your fingers slightly."
        else:
            return f"Take your time with {target_sign}. No rush."
    
    async def generate_lesson_intro(self, letter: str) -> str:
        """Generate a calm, brief instruction for a letter."""
        if self.api_key:
            prompt = f"""Give a calm, brief instruction for signing ASL letter '{letter}'.
Just the hand position. No greetings. One sentence.
Example: "For {letter}, [position]. Show me when you're ready."
Keep it short and unhurried."""
            
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        # Calm fallback templates
        tips = {
            "A": "Make a gentle fist with your thumb on the side.",
            "B": "Hold your hand flat, fingers together, thumb tucked in.",
            "C": "Curve your hand like you're holding a small cup.",
            "D": "Touch middle, ring, and pinky to thumb. Index points up.",
            "E": "Curl all fingers in, thumb tucked across.",
            "F": "Touch index and thumb together, other fingers spread.",
            "G": "Point index finger and thumb sideways together.",
            "H": "Extend index and middle fingers sideways.",
            "I": "Make a fist, extend just your pinky.",
            "J": "Start with I and trace a J in the air.",
            "K": "Index and middle up with thumb between them.",
            "L": "Thumb and index make an L shape.",
            "M": "Tuck thumb under your first three fingers.",
            "N": "Tuck thumb under your first two fingers.",
            "O": "Fingertips meet thumb in a circle.",
            "P": "Like K, but pointed downward.",
            "Q": "Like G, but pointed downward.",
            "R": "Cross your index and middle fingers.",
            "S": "Make a fist with thumb across fingers.",
            "T": "Tuck thumb between index and middle finger.",
            "U": "Index and middle fingers together, pointing up.",
            "V": "Index and middle fingers spread apart.",
            "W": "Three fingers up. Index, middle, and ring.",
            "X": "Hook your index finger like a claw.",
            "Y": "Thumb and pinky extended out.",
            "Z": "Draw a Z in the air with your index finger.",
        }
        
        tip = tips.get(letter, "Position your fingers clearly.")
        return f"For {letter}, {tip.lower()} Show me when ready."
    
    async def generate_quiz_prompt(self, letter: str) -> str:
        """Generate a calm quiz prompt."""
        if self.api_key:
            prompt = f"Calmly ask the student to show ASL letter '{letter}'. One short sentence, no exclamation marks."
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        prompts = [
            f"Show me {letter} when you're ready.",
            f"Let's see {letter}. Take your time.",
            f"Whenever you're ready, show me {letter}.",
            f"Go ahead and show me {letter}.",
        ]
        import random
        return random.choice(prompts)
    
    async def generate_greeting_response(self) -> str:
        """Generate a calm response to greetings."""
        if self.api_key:
            prompt = "The student greeted you. Respond calmly in one sentence. Offer to help them learn. No exclamation marks."
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        return "Hi. Good to see you. What would you like to work on?"
    
    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    @property
    def is_available(self) -> bool:
        """Check if Gemini is available."""
        return bool(self.api_key)
