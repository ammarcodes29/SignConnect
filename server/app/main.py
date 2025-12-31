"""
SignConnect Server - FastAPI WebSocket Server
Handles real-time ASL tutoring sessions.
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ws.session import router as ws_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="SignConnect API",
    description="Real-time ASL Tutor Backend",
    version="0.1.0"
)

# CORS middleware - allow Vercel frontend and local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://sign-connect-omega.vercel.app",  # Production frontend
        "https://signconnect.vercel.app",  # Alternative production URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include WebSocket router
app.include_router(ws_router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "SignConnect API"}


@app.get("/health")
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "version": "0.1.0",
        "components": {
            "websocket": "ready",
            "recognition": "stub",
            "llm": "stub",
            "tts": "stub"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

