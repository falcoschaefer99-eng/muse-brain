# Voice bridge setup (Telegram voice notes → transcription → brain memory)

This optional bridge lets your bot:

1. Receive Telegram voice notes  
2. Transcribe them with Whisper/STT  
3. Save transcript to MUSE Brain (`mind_observe` in `whisper` mode)

The bridge expects an **OpenAI-compatible** transcription endpoint (`POST /v1/audio/transcriptions`).
That can be hosted anywhere (cloud VM, container service, local sidecar).

## Required env

In `runner/.env`:

```bash
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<optional-chat-filter>

BRAIN_URL=https://<your-worker-url>/mcp
BRAIN_API_KEY=<your-brain-api-key>

VOICE_STT_URL=https://<your-whisper-endpoint>/v1/audio/transcriptions
VOICE_STT_API_KEY=
VOICE_STT_MODEL=whisper-1

VOICE_BRIDGE_TENANT=rainer
VOICE_BRIDGE_POLL_SECONDS=12
VOICE_BRIDGE_TIMEOUT_MS=30000
VOICE_BRIDGE_SEND_ACK=true
VOICE_BRIDGE_STATE_PATH=./state/telegram-voice-bridge.json
```

## Run it

```bash
cd runner
npm run build
npm run voice-bridge
```

For development:

```bash
npm run dev:voice-bridge
```

## Faster-whisper sidecar (recommended first upgrade)

You can run an included faster-whisper API sidecar and point `VOICE_STT_URL` at it.

```bash
cd runner
python3 -m venv .venv
source .venv/bin/activate
pip install -r stt/requirements.txt

# optional hardening
export FW_API_KEY=<set-a-token>

# speed/quality tradeoff
export FW_DEFAULT_MODEL=small
export FW_DEVICE=auto
export FW_COMPUTE_TYPE=int8

python stt/faster_whisper_server.py
```

Then in `runner/.env`:

```bash
VOICE_STT_URL=http://127.0.0.1:8788/v1/audio/transcriptions
VOICE_STT_API_KEY=<same-token-as-FW_API_KEY>
VOICE_STT_MODEL=small
```

If you deploy this sidecar in the cloud, use your HTTPS URL instead of localhost.

## Notes

- Bridge stores last Telegram `update_id` in `VOICE_BRIDGE_STATE_PATH` to avoid reprocessing.
- If `TELEGRAM_CHAT_ID` is set, only voice notes from that chat are processed.
- On success, the bridge can optionally send an acknowledgment with transcript preview.
- This bridge is intentionally endpoint-agnostic; it works with any hosted Whisper-compatible API.
