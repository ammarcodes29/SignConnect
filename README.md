# SignConnect 🤟

A real-time, conversational ASL tutor that teaches the ASL alphabet (A–Z) and 10 common signs using your laptop webcam.

## Features

- **Real-time hand tracking** via MediaPipe Hands in the browser
- **Deterministic sign recognition** for reliability and low latency
- **Conversational voice interface** — say "teach me B" or "quiz me"
- **Live captions** for accessibility (agent + user)
- **Streaming TTS** for natural teacher voice (ElevenLabs)
- **AI coaching** via Gemini for empathetic, personalized feedback

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT                               │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Camera    │  │   MediaPipe  │  │  WebSocket Client │  │
│  │   View      │──│    Hands     │──│  (landmarks/audio)│  │
│  └─────────────┘  └──────────────┘  └─────────┬─────────┘  │
└───────────────────────────────────────────────│─────────────┘
                                                │ WS
┌───────────────────────────────────────────────▼─────────────┐
│                        SERVER                               │
│  ┌──────────────┐  ┌────────────┐  ┌────────────────────┐  │
│  │  Classifier  │  │   Gemini   │  │    ElevenLabs      │  │
│  │  (rules)     │  │  (coach)   │  │    (TTS stream)    │  │
│  └──────────────┘  └────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- A webcam

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/SignConnect.git
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

Navigate to [http://localhost:5173](http://localhost:5173)

Click **Start Session**, grant camera access, and say "teach me A"!

## Project Structure

```
SignConnect/
├── client/                 # Vite + React frontend
│   ├── src/
│   │   ├── app/           # Main app component
│   │   ├── components/    # UI components
│   │   ├── lib/           # Utilities (WS client, types)
│   │   └── styles/        # Global styles
│   └── package.json
├── server/                 # FastAPI backend
│   ├── app/
│   │   ├── ws/            # WebSocket session handling
│   │   ├── recognition/   # Sign classifier
│   │   ├── llm/           # Gemini coaching
│   │   ├── tts/           # ElevenLabs TTS
│   │   └── asr/           # Speech recognition
│   └── requirements.txt
├── docs/                   # Documentation
│   └── websocket-events.md
└── README.md
```

## MVP Sign Set

**Alphabet (10 letters):** A, B, C, E, I, L, O, V, W, Y

**Common Signs (10):** HELLO, THANK YOU, PLEASE, YES, NO, HELP, MORE, STOP, WATER, NAME

## Environment Variables (Optional)

Create `.env` files for API integrations:

**server/.env:**
```
GOOGLE_CLOUD_PROJECT=your-project-id
ELEVENLABS_API_KEY=your-api-key
```

## Development

### Running Tests

```bash
# Backend
cd server
pytest

# Frontend
cd client
npm test
```

### WebSocket Events

See [docs/websocket-events.md](docs/websocket-events.md) for the complete message schema.

## Known Limitations

- Recognition is currently stub-based (returns random predictions)
- TTS and ASR are not yet connected to real APIs
- Limited to single-hand detection
- Best performance in good lighting conditions

## Roadmap

- [ ] Implement MediaPipe hand tracking in client
- [ ] Build deterministic classifier for MVP signs
- [ ] Integrate Gemini for intent parsing + coaching
- [ ] Add ElevenLabs streaming TTS
- [ ] Add streaming ASR (Google/Deepgram)
- [ ] Polish UI with sign reference images

## License

MIT

---

Built for hackathon demo — ship fast, learn faster! 🚀

