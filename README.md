# SignConnect

A real-time, conversational ASL tutor that teaches the ASL alphabet using your webcam and voice.

![ASL Alphabet Reference](asl-abc-poster.jpg)

## Powered By

| | |
|---|---|
| **Google Gemini 2.0 Flash** | Natural language understanding, intent parsing, and empathetic coaching responses |
| **Google MediaPipe** | Real-time hand landmark detection (21 3D points per hand) running client-side |
| **ElevenLabs** | Ultra-realistic streaming text-to-speech with a warm, supportive coaching voice |
| **Deepgram** | Real-time speech recognition for hands-free voice commands |

## Features

- **Real-time hand tracking** via MediaPipe Hands in the browser
- **Custom ML model** trained on hand landmark data for accurate sign recognition (94% accuracy)
- **Conversational voice interface** — say "teach me B" or "quiz me"
- **Live captions** for accessibility (agent + user transcripts)
- **Streaming TTS** via ElevenLabs with a warm, supportive coaching voice
- **AI coaching** via Gemini for natural, empathetic feedback
- **Teaching mode** with progress tracking (3/3 mastery system)
- **Quiz mode** with countdown, 3 tries per letter, and detailed results
- **Dark/Light mode** with smooth transitions and localStorage persistence
- **Speech interruption** — agent pauses naturally when you start talking

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Vercel)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │   Camera    │  │   MediaPipe  │  │   TensorFlow.js   │   │
│  │   View      │──│    Hands     │──│   ASL Classifier  │   │
│  └─────────────┘  └──────────────┘  └─────────┬─────────┘   │
│                                               │             │
│  ┌─────────────┐  ┌──────────────┐            │             │
│  │   Audio     │  │   WebSocket  │────────────┘             │
│  │   Capture   │──│    Client    │                          │
│  └─────────────┘  └──────────────┘                          │
└───────────────────────────────────────────────│─────────────┘
                                                │ WS
┌───────────────────────────────────────────────▼─────────────┐
│                      SERVER (Railway)                       │
│  ┌──────────────┐  ┌────────────┐  ┌────────────────────┐   │
│  │   Deepgram   │  │   Gemini   │  │    ElevenLabs      │   │
│  │   (ASR)      │  │  (Coach)   │  │   (TTS Stream)     │   │
│  └──────────────┘  └────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## ML Model

The sign classifier was trained on **my own ASL hand signs**:

1. **Data Collection** — Used the built-in data collector to capture MediaPipe hand landmarks (21 3D points × 26 letters)
2. **Training** — Fed landmark positions as JSON through a TensorFlow neural network
3. **Export** — Converted to TensorFlow.js format for browser inference
4. **Result** — 94% accuracy on the full A-Z alphabet

The model runs entirely client-side for low latency and privacy.

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- A webcam and microphone

### Environment Variables

Create a `.env` file in the project root:

```env
DEEPGRAM_API_KEY=your-deepgram-api-key
ELEVENLABS_API_KEY=your-elevenlabs-api-key
GEMINI_API_KEY=your-gemini-api-key
```

### 1. Clone the repo

```bash
git clone https://github.com/ammarcodes29/SignConnect.git
cd SignConnect
```

### 2. Start the backend

```bash
cd server
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 3. Start the frontend

```bash
cd client
npm install
npm run dev
```

### 4. Open the app

Navigate to http://localhost:5173/

Click **Start Session**, grant camera/mic access, and say "teach me A"!

## Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | **Vercel** | Auto-deploys from `main` branch |
| Backend | **Railway** | WebSocket + FastAPI server |

### Frontend (Vercel)

```bash
cd client
npm run build
# Deploy via Vercel CLI or GitHub integration
```

### Backend (Railway)

1. Connect your GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Railway auto-detects Python and runs `uvicorn`

## Project Structure

```
SignConnect/
├── client/                   # Vite + React + TypeScript frontend
│   ├── src/
│   │   ├── app/             # Main app component + CSS
│   │   ├── components/      # CameraView, CaptionsPanel, SessionControls
│   │   ├── lib/             # wsClient, audioCapture, audioPlayer, aslClassifier
│   │   └── styles/          # Global CSS with dark/light theme variables
│   └── public/
│       └── models/          # TensorFlow.js ASL classifier model
├── server/                   # FastAPI backend
│   ├── app/
│   │   ├── ws/              # WebSocket session handler + events
│   │   ├── llm/             # Gemini coaching integration
│   │   ├── tts/             # ElevenLabs streaming TTS
│   │   └── asr/             # Deepgram real-time ASR
│   └── training/            # ML model training scripts
├── docs/                     # Documentation
│   └── websocket-events.md  # Complete WS message schema
├── asl-abc-poster.jpg       # ASL alphabet reference
└── README.md
```

## How It Works

1. **Hand Tracking** — Google MediaPipe detects 21 hand landmarks in real-time
2. **ML Classification** — Custom TensorFlow.js model predicts the letter (client-side)
3. **Voice Commands** — Deepgram transcribes your speech in real-time
4. **Intent Parsing** — Google Gemini understands natural language like "teach me B" or "am I doing it right?"
5. **AI Coaching** — Gemini generates supportive, context-aware feedback tailored to your progress
6. **Voice Response** — ElevenLabs streams lifelike audio for a natural conversational experience

## Teaching Mode

- Say "teach me [letter]" to start
- Get the sign correct 3 times to master it
- Progress bar shows your 0/3 → 3/3 progress
- Agent celebrates your success and suggests next steps

## Quiz Mode

- Say "quiz me" to start an 8-letter quiz
- 3-2-1 countdown before each grading
- 3 tries per letter to get it right
- Final results popup with score, missed letters, and breakdown

## Known Limitations

- Best performance in good lighting conditions
- Single-hand detection only
- Supports static alphabet signs (no motion-based letters like J, Z)
- ASR works best with clear speech and minimal background noise

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React, TypeScript, Vite, TensorFlow.js |
| **Hand Tracking** | Google MediaPipe Hands |
| **AI Coach** | Google Gemini 2.0 Flash |
| **Voice** | ElevenLabs (TTS) + Deepgram (ASR) |
| **Backend** | Python, FastAPI, WebSockets |
| **Deployment** | Vercel (frontend), Railway (backend) |

## License

MIT

---

Built with ❤️ for accessible ASL education.

Powered by **Google Gemini**, **Google MediaPipe**, and **ElevenLabs**.