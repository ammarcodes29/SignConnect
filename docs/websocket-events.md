# WebSocket Events Schema

SignConnect uses a WebSocket-based protocol for real-time communication between the client and server.

## Connection

- **Endpoint:** `ws://localhost:8000/ws/session`
- **Protocol:** JSON messages over WebSocket

---

## Client → Server Messages

### `audio_chunk`

Streams microphone audio for ASR transcription.

```json
{
  "type": "audio_chunk",
  "data": "<base64-encoded-audio>",
  "timestamp": 1703123456789
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"audio_chunk"` | Message type identifier |
| `data` | `string` | Base64-encoded PCM/Opus audio data |
| `timestamp` | `number` | Unix timestamp in milliseconds |

---

### `hand_state`

Sends hand landmark data for sign classification.

```json
{
  "type": "hand_state",
  "data": {
    "landmarks": [
      { "x": 0.5, "y": 0.5, "z": 0.0 },
      ...
    ],
    "handedness": "Right",
    "confidence": 0.95,
    "timestamp": 1703123456789
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"hand_state"` | Message type identifier |
| `data.landmarks` | `Landmark[]` | Array of 21 hand landmarks (MediaPipe format) |
| `data.handedness` | `"Left" \| "Right"` | Which hand is detected |
| `data.confidence` | `number` | Detection confidence (0-1) |
| `data.timestamp` | `number` | Unix timestamp in milliseconds |

**Landmark structure:**
```json
{ "x": 0.5, "y": 0.5, "z": 0.0 }
```
- `x`, `y`: Normalized coordinates (0-1)
- `z`: Depth relative to wrist

---

### `client_control`

Client control commands.

```json
{
  "type": "client_control",
  "action": "start"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"client_control"` | Message type identifier |
| `action` | `"start" \| "stop" \| "toggle_captions"` | Control action |

---

## Server → Client Messages

### `asr_partial`

Partial ASR transcription (interim results).

```json
{
  "type": "asr_partial",
  "text": "teach me the letter",
  "timestamp": 1703123456789
}
```

### `asr_final`

Final ASR transcription.

```json
{
  "type": "asr_final",
  "text": "teach me the letter B",
  "timestamp": 1703123456789
}
```

---

### `agent_text_partial`

Streaming agent response text.

```json
{
  "type": "agent_text_partial",
  "text": "Great",
  "timestamp": 1703123456789
}
```

### `agent_text_final`

Complete agent response.

```json
{
  "type": "agent_text_final",
  "text": "Great job! That's a perfect B!",
  "timestamp": 1703123456789
}
```

---

### `tts_audio_chunk`

Streaming TTS audio for agent voice.

```json
{
  "type": "tts_audio_chunk",
  "data": "<base64-encoded-audio>",
  "timestamp": 1703123456789
}
```

---

### `ui_state`

UI state updates for lesson/quiz display.

```json
{
  "type": "ui_state",
  "mode": "TEACH",
  "targetSign": "B",
  "prediction": "B",
  "confidence": 0.92,
  "suggestion": "Try curling your thumb more",
  "streak": 5,
  "timestamp": 1703123456789
}
```

| Field | Type | Description |
|-------|------|-------------|
| `mode` | `"IDLE" \| "TEACH" \| "QUIZ"` | Current session mode |
| `targetSign` | `string?` | Sign the user should attempt |
| `prediction` | `string?` | Classified sign from hand state |
| `confidence` | `number?` | Classification confidence (0-1) |
| `suggestion` | `string?` | Correction suggestion |
| `streak` | `number?` | Current correct streak count |

---

### `error`

Error messages.

```json
{
  "type": "error",
  "message": "Invalid hand state format",
  "code": "INVALID_INPUT",
  "timestamp": 1703123456789
}
```

---

## Session State Machine

```
┌──────────┐
│   IDLE   │ ←── Initial state / "stop" command
└────┬─────┘
     │ "teach me X"
     ▼
┌──────────┐
│  TEACH   │ ←── Teaching mode: demonstrate + correct
└────┬─────┘
     │ "quiz me" / after mastery
     ▼
┌──────────┐
│   QUIZ   │ ←── Quiz mode: random prompts, scoring
└──────────┘
```

---

## Example Session Flow

1. **Client connects** → Server sends `agent_text_final` (welcome) + `ui_state`
2. **User speaks** "teach me A" → Client sends `audio_chunk`s
3. **Server processes ASR** → sends `asr_partial`, then `asr_final`
4. **Server parses intent** → sends `agent_text_final` with instructions + `ui_state` (mode=TEACH, targetSign=A)
5. **User signs** → Client sends `hand_state` periodically
6. **Server classifies** → sends `ui_state` with prediction + confidence
7. **Server coaches** → sends `agent_text_final` with feedback + `tts_audio_chunk`s
8. **Loop continues** until user says "stop" or disconnects

