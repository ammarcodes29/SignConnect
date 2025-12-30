"""
ASR Provider Module - Deepgram Integration
Handles streaming speech-to-text for real-time user transcription.
Uses raw websockets for simplicity and async compatibility.
"""
import os
import asyncio
import logging
import json
import base64
import ssl
import certifi
from pathlib import Path
from typing import Callable, Optional
from dotenv import load_dotenv

# Load environment variables from project root
project_root = Path(__file__).parent.parent.parent.parent
env_path = project_root / ".env"
load_dotenv(env_path)

logger = logging.getLogger(__name__)


class DeepgramASR:
    """
    Real-time speech-to-text using Deepgram's streaming WebSocket API.
    Uses raw websockets for async compatibility with FastAPI.
    """
    
    DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"
    
    def __init__(self):
        self.api_key = os.getenv("DEEPGRAM_API_KEY")
        logger.info(f"DeepgramASR init - API key present: {bool(self.api_key)}")
        if not self.api_key:
            logger.warning("DEEPGRAM_API_KEY not found - ASR will be disabled")
        
        self._websocket = None
        self._on_transcript: Optional[Callable] = None
        self._is_connected = False
        self._receive_task: Optional[asyncio.Task] = None
        
    async def connect(self, on_transcript: Callable[[str, bool], None]):
        """
        Connect to Deepgram's streaming API.
        
        Args:
            on_transcript: Callback function(text, is_final) for transcripts
        """
        if not self.api_key:
            logger.warning("Cannot connect - no API key")
            return
            
        if self._is_connected:
            logger.info("Already connected to Deepgram")
            return
            
        self._on_transcript = on_transcript
        
        try:
            import websockets
            
            # Build URL with query params
            params = {
                "model": "nova-2",
                "language": "en-US",
                "smart_format": "true",
                "interim_results": "true",
                "punctuate": "true",
                "encoding": "linear16",
                "sample_rate": "16000",
                "channels": "1",
            }
            query_string = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{self.DEEPGRAM_WS_URL}?{query_string}"
            
            headers = {
                "Authorization": f"Token {self.api_key}"
            }
            
            # Create SSL context with proper certificates (fixes macOS issue)
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            
            logger.info("Connecting to Deepgram...")
            self._websocket = await websockets.connect(
                url,
                extra_headers=headers,
                ping_interval=5,
                ping_timeout=20,
                ssl=ssl_context,
            )
            self._is_connected = True
            logger.info("Connected to Deepgram successfully!")
            
            # Start receiving messages in background
            self._receive_task = asyncio.create_task(self._receive_loop())
            
        except Exception as e:
            logger.error(f"Failed to connect to Deepgram: {e}")
            self._is_connected = False
            raise
    
    async def _receive_loop(self):
        """Background task to receive transcripts from Deepgram."""
        try:
            async for message in self._websocket:
                try:
                    data = json.loads(message)
                    
                    msg_type = data.get("type")
                    
                    # Handle transcript response
                    if msg_type == "Results":
                        channel = data.get("channel", {})
                        alternatives = channel.get("alternatives", [])
                        is_final = data.get("is_final", False)
                        
                        if alternatives:
                            transcript = alternatives[0].get("transcript", "")
                            
                            if transcript and self._on_transcript:
                                logger.debug(f"Transcript: '{transcript}' (final={is_final})")
                                await self._on_transcript(transcript, is_final)
                                
                    elif msg_type == "Metadata":
                        logger.debug(f"Deepgram metadata received")
                        
                except json.JSONDecodeError:
                    logger.warning("Received non-JSON message from Deepgram")
                    
        except asyncio.CancelledError:
            logger.info("Receive loop cancelled")
        except Exception as e:
            logger.error(f"Error in receive loop: {e}")
        finally:
            self._is_connected = False
            
    async def send_audio(self, audio_bytes: bytes):
        """
        Send raw audio bytes to Deepgram.
        
        Args:
            audio_bytes: Raw PCM audio data (16-bit, 16kHz, mono)
        """
        if not self._is_connected or not self._websocket:
            return
            
        try:
            await self._websocket.send(audio_bytes)
        except Exception as e:
            logger.error(f"Error sending audio: {e}")
            self._is_connected = False
            
    async def send_audio_base64(self, audio_base64: str):
        """
        Send base64-encoded audio to Deepgram.
        
        Args:
            audio_base64: Base64-encoded PCM audio data
        """
        try:
            audio_bytes = base64.b64decode(audio_base64)
            await self.send_audio(audio_bytes)
        except Exception as e:
            logger.error(f"Error decoding/sending audio: {e}")
    
    async def disconnect(self):
        """Disconnect from Deepgram."""
        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
            self._receive_task = None
            
        if self._websocket:
            try:
                # Send close message
                await self._websocket.send(json.dumps({"type": "CloseStream"}))
                await self._websocket.close()
            except Exception as e:
                logger.debug(f"Error during disconnect: {e}")
            self._websocket = None
            
        self._is_connected = False
        logger.info("Disconnected from Deepgram")
    
    @property
    def is_connected(self) -> bool:
        """Check if connected to Deepgram."""
        return self._is_connected
