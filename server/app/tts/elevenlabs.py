"""
ElevenLabs TTS Module
Handles text-to-speech streaming for agent responses.
Configured for warm, supportive coaching voice.
"""
import os
import base64
import logging
from pathlib import Path
from typing import AsyncGenerator, Callable, Optional
import httpx
from dotenv import load_dotenv

# Load environment variables from project root
project_root = Path(__file__).parent.parent.parent.parent
env_path = project_root / ".env"
load_dotenv(env_path)

logger = logging.getLogger(__name__)


class TTSService:
    """
    ElevenLabs streaming TTS service.
    
    Converts agent text to natural speech audio.
    Configured for a warm, soft-spoken coaching voice.
    """
    
    # ElevenLabs API endpoints
    BASE_URL = "https://api.elevenlabs.io/v1"
    
    # Voice options - soft, warm, supportive voices
    VOICES = {
        # Female voices - soft and warm
        "aria": "9BWtsMINqrJLrRacOk9x",      # Soft, expressive, young female
        "sarah": "EXAVITQu4vr4xnSDxMaL",     # Soft, young female - great for coaching
        "charlotte": "XB0fDUnXU5powFXDhCwa", # Warm, mature female
        "alice": "Xb7hH8MSUJpSbSDYk0k2",     # Middle-aged, soft female
        
        # Male voices - gentle and warm  
        "george": "JBFqnCBsd6RMkjVDRZzb",    # Warm British, gentle
        "charlie": "IKne3meq5aSn9XLyUdCD",   # Australian, friendly
        "daniel": "onwK4e9ZLuTAKqWW03F9",    # British, soft
        
        # Default for coaching - soft female
        "default": "EXAVITQu4vr4xnSDxMaL",   # Sarah - soft and supportive
    }
    
    # Voice settings for slow, gentle, reassuring delivery (like ChatGPT voice mode)
    COACHING_VOICE_SETTINGS = {
        "stability": 0.85,        # Very high = calm, steady, measured pace
        "similarity_boost": 0.50, # Lower = softer, less aggressive
        "style": 0.20,            # Minimal style = natural, not exaggerated
        "use_speaker_boost": False # Softer overall, no boost
    }
    
    def __init__(self, voice_id: Optional[str] = None):
        self.api_key = os.getenv("ELEVENLABS_API_KEY")
        self.voice_id = voice_id or self.VOICES["default"]
        self._client: Optional[httpx.AsyncClient] = None
        
        if not self.api_key:
            logger.warning("ELEVENLABS_API_KEY not found - TTS will be disabled")
        else:
            logger.info(f"ElevenLabs TTS initialized with voice: {self.voice_id}")
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                timeout=30.0,
            )
        return self._client
    
    async def synthesize(self, text: str) -> bytes:
        """
        Synthesize text to audio bytes (non-streaming).
        """
        if not self.api_key:
            return b""
        
        try:
            client = await self._get_client()
            url = f"{self.BASE_URL}/text-to-speech/{self.voice_id}"
            
            response = await client.post(
                url,
                json={
                    "text": text,
                    "model_id": "eleven_turbo_v2_5",  # Latest fast model
                    "voice_settings": self.COACHING_VOICE_SETTINGS
                },
            )
            response.raise_for_status()
            return response.content
            
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            return b""
    
    async def stream(self, text: str) -> AsyncGenerator[bytes, None]:
        """
        Stream synthesized audio chunks with warm coaching voice.
        """
        if not self.api_key:
            logger.warning("TTS disabled - no API key")
            return
        
        if not text.strip():
            return
        
        try:
            client = await self._get_client()
            url = f"{self.BASE_URL}/text-to-speech/{self.voice_id}/stream"
            
            async with client.stream(
                "POST",
                url,
                json={
                    "text": text,
                    "model_id": "eleven_turbo_v2_5",  # Latest fast model with emotion
                    "voice_settings": self.COACHING_VOICE_SETTINGS
                },
            ) as response:
                response.raise_for_status()
                
                async for chunk in response.aiter_bytes(chunk_size=1024):
                    if chunk:
                        yield chunk
                        
        except Exception as e:
            logger.error(f"TTS streaming failed: {e}")
    
    async def speak(
        self, 
        text: str, 
        on_chunk: Callable[[str], None]
    ) -> None:
        """
        Stream TTS and call callback with base64-encoded chunks.
        """
        async for chunk in self.stream(text):
            b64_chunk = base64.b64encode(chunk).decode('utf-8')
            await on_chunk(b64_chunk)
    
    def set_voice(self, voice_name: str) -> bool:
        """
        Change the voice by name.
        
        Args:
            voice_name: One of the voice names in VOICES dict
            
        Returns:
            True if voice was found and set
        """
        if voice_name.lower() in self.VOICES:
            self.voice_id = self.VOICES[voice_name.lower()]
            logger.info(f"Voice changed to: {voice_name}")
            return True
        return False
    
    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    def get_voice_settings(self) -> dict:
        """Get current voice settings."""
        return {
            "voice_id": self.voice_id,
            "model": "eleven_turbo_v2_5",
            **self.COACHING_VOICE_SETTINGS
        }
    
    @property
    def is_available(self) -> bool:
        """Check if TTS is available."""
        return bool(self.api_key)
