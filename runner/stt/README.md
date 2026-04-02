# faster-whisper STT sidecar

Optional OpenAI-compatible transcription service for the Telegram voice bridge.

## Install

```bash
cd runner
python3 -m venv .venv
source .venv/bin/activate
pip install -r stt/requirements.txt
```

## Run

```bash
# optional hardening
export FW_API_KEY=replace-me

# runtime tuning
export FW_DEFAULT_MODEL=small      # tiny, base, small, medium, large-v3, ...
export FW_DEVICE=auto              # auto|cpu|cuda
export FW_COMPUTE_TYPE=int8        # int8|int8_float16|float16|float32
export FW_PORT=8788

python stt/faster_whisper_server.py
```

Endpoint:
- `POST /v1/audio/transcriptions`

Health check:
- `GET /healthz`

If `FW_API_KEY` is set, clients must send:

```http
Authorization: Bearer <FW_API_KEY>
```
