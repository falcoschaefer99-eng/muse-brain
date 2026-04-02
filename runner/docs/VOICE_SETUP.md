# Voice bridge setup (Telegram voice notes → transcription → brain memory)

This optional bridge lets your bot:

1. Receive Telegram voice notes  
2. Transcribe them with Whisper/STT  
3. Save transcript to MUSE Brain (`mind_observe` in `whisper` mode)

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

## Notes

- Bridge stores last Telegram `update_id` in `VOICE_BRIDGE_STATE_PATH` to avoid reprocessing.
- If `TELEGRAM_CHAT_ID` is set, only voice notes from that chat are processed.
- On success, the bridge can optionally send an acknowledgment with transcript preview.
- This bridge is intentionally endpoint-agnostic; it works with your hosted Whisper-compatible API.

