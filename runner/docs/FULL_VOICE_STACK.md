# Full voice stack (Telegram + MUSE TTS + local Whisper)

If you want the same end-to-end experience used in production demos, use this stack:

- Telegram bot notifications
- Telegram voice-note synthesis (TTS)
- Telegram voice-note transcription (STT/Whisper)
- Transcript persistence into MUSE Brain

## 1) Bootstrap the stack

```bash
cd runner
./scripts/setup-voice-stack.sh
```

This clones `muse-tts` into `runner/voice-stack/muse-tts`.

## 2) Run MUSE TTS (voice synthesis)

Follow upstream steps in:

- `runner/voice-stack/muse-tts/README.md`

Expose an HTTP endpoint that your runner can call with:
- `POST <VOICE_TTS_URL>`
- body: `{ text, voice, format, tenant }`

## 3) Run local Whisper-compatible STT (included in this repo)

```bash
cd runner
python3 -m venv .venv
source .venv/bin/activate
pip install -r stt/requirements.txt
python stt/faster_whisper_server.py
```

Default endpoint:
- `http://127.0.0.1:8788/v1/audio/transcriptions`

## 4) Configure runner `.env`

```bash
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>

BRAIN_URL=https://<your-worker-url>/mcp
BRAIN_API_KEY=<your-brain-key>

TELEGRAM_VOICE_ENABLED=true
VOICE_TTS_URL=http://127.0.0.1:8001/synthesize
VOICE_PERSONA_DEFAULT=lewis
VOICE_PERSONA_RAINER=lewis
VOICE_PERSONA_COMPANION=onyx

VOICE_STT_URL=http://127.0.0.1:8788/v1/audio/transcriptions
VOICE_BRIDGE_TENANT=rainer
VOICE_BRIDGE_SEND_ACK=true
```

## 5) Start runner + bridge

```bash
cd runner
npm run build
./run-orchestrator.sh
npm run voice-bridge
```

Now:
- text + voice notifications go out via Telegram
- inbound Telegram voice notes are transcribed and stored to brain memory
