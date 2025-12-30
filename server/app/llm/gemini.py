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

# Coaching personality - natural, human, conversational
COACH_PERSONA = """You are Sam, a friendly ASL tutor having a real conversation with your student.

How you talk:
- Natural and relaxed, like chatting with a friend who happens to be teaching you
- You ask questions, you listen, you respond to what THEY say
- Short responses (1-2 sentences usually) - don't lecture
- You can joke a little, be curious about them, share brief thoughts
- When teaching, give clear instructions without being preachy
- When they succeed, be genuinely happy but not over-the-top

What you DON'T do:
- Don't repeat the same phrases over and over
- Don't give feedback unless asked or unless it's a big moment
- Don't ignore what they said to push your agenda
- Don't be robotic or use scripted-sounding language
- Don't say "You're doing great!" constantly - vary your language

You're a real person having a conversation that happens to involve learning ASL."""


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
                        "temperature": 0.8,  # Slightly more creative for warmth
                        "maxOutputTokens": 100,  # Keep responses concise
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
        
        # Use Gemini for nuanced, warm responses
        if self.api_key:
            if prediction == target_sign and confidence > 0.8:
                prompt = f"The student just signed '{target_sign}' perfectly with {int(confidence*100)}% confidence! Give them excited, warm praise in 1 sentence."
            elif prediction == target_sign and confidence > 0.5:
                prompt = f"The student signed '{target_sign}' correctly but could be steadier ({int(confidence*100)}% confidence). Praise them warmly and gently suggest holding it more firmly. 1-2 sentences."
            elif prediction and prediction != target_sign:
                prompt = f"The student tried to sign '{target_sign}' but showed '{prediction}' instead. Give gentle, encouraging feedback without saying 'wrong'. Suggest what to adjust. 1-2 sentences."
            else:
                prompt = f"The student is trying to sign '{target_sign}' but the sign isn't clear. Encourage them warmly and offer to help. 1 sentence."
            
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        # Warm fallback responses
        if prediction == target_sign and confidence > 0.8:
            return f"Beautiful! That's a perfect {target_sign}! I'm so proud of you! 🌟"
        elif prediction == target_sign:
            return f"Yes! That's {target_sign}! You're getting it - try holding it just a bit steadier."
        elif prediction and prediction != target_sign:
            return f"You're so close! I see {prediction} - for {target_sign}, try adjusting your fingers a little. You've got this!"
        else:
            return f"Take your time with {target_sign}. I'm right here with you - let's try together!"
    
    async def generate_lesson_intro(self, letter: str) -> str:
        """Generate a short, focused instruction for a letter."""
        if self.api_key:
            prompt = f"""Give a SHORT instruction for signing the ASL letter '{letter}'.
Just tell them how to position their hand - no greetings or preamble.
Example format: "For {letter}, [hand position]. Show me when ready!"
Keep it to 1-2 sentences max."""
            
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        # Warm fallback templates
        tips = {
            "A": "Make a gentle fist with your thumb resting on the side - like you're giving a thumbs up sideways!",
            "B": "Hold your hand flat with fingers together and tuck your thumb in - nice and clean!",
            "C": "Curve your hand softly like you're holding a small cup - that's it!",
            "D": "Touch your middle, ring, and pinky to your thumb, index finger points up!",
            "E": "Curl all your fingers in and tuck your thumb across - like a cozy little fist!",
            "F": "Touch your index finger and thumb together, other fingers spread out!",
            "G": "Point your index finger and thumb sideways - like a little duck beak!",
            "H": "Extend your index and middle fingers sideways together!",
            "I": "Make a fist and extend just your pinky - simple and sweet!",
            "J": "Start with 'I' and trace a J shape in the air!",
            "K": "Index and middle fingers up with thumb between them!",
            "L": "Thumb and index finger make a perfect L shape - you've got this!",
            "M": "Tuck your thumb under your first three fingers!",
            "N": "Tuck your thumb under your first two fingers!",
            "O": "Fingertips meet your thumb in a beautiful circle!",
            "P": "Like 'K' but pointed downward!",
            "Q": "Like 'G' but pointed downward!",
            "R": "Cross your index and middle fingers - for good luck!",
            "S": "Make a fist with thumb across your fingers!",
            "T": "Tuck your thumb between index and middle finger!",
            "U": "Index and middle fingers together, pointing up!",
            "V": "Peace sign! Index and middle fingers spread apart!",
            "W": "Three fingers up - index, middle, and ring!",
            "X": "Hook your index finger like a little claw!",
            "Y": "Thumb and pinky out - hang loose style!",
            "Z": "Draw a Z in the air with your index finger!",
        }
        
        tip = tips.get(letter, "Position your fingers clearly and take your time!")
        return f"Wonderful! Let's learn the letter {letter} together! {tip}"
    
    async def generate_quiz_prompt(self, letter: str) -> str:
        """Generate an encouraging quiz prompt."""
        if self.api_key:
            prompt = f"Ask the student to show you the ASL sign for '{letter}' in a warm, encouraging way. 1 short sentence."
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        encouragements = [
            f"Alright, show me your best {letter}! I know you can do it!",
            f"Let's see that beautiful {letter}! Take your time!",
            f"Ready? Show me {letter} whenever you're comfortable!",
            f"I believe in you! Show me {letter}!",
        ]
        import random
        return random.choice(encouragements)
    
    async def generate_greeting_response(self) -> str:
        """Generate a warm response to greetings."""
        if self.api_key:
            prompt = "The student just greeted you or acknowledged something. Respond warmly in 1 sentence and offer to help them learn or practice."
            response = await self._call_gemini(prompt)
            if response:
                return response
        
        return "Hi there! I'm so glad you're here. What would you like to learn today?"
    
    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    @property
    def is_available(self) -> bool:
        """Check if Gemini is available."""
        return bool(self.api_key)
