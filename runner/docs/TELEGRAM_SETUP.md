# Telegram setup (notifications + optional voice notes)

This runner can post wake/task updates to Telegram.

## 1) Create your bot

1. Open **@BotFather** in Telegram
2. Run `/newbot`
3. Copy the bot token

## 2) Get your chat ID

Send any message to your bot, then run:

```bash
curl -sS "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
```

Find `message.chat.id` in the JSON response.

## 3) Configure runner env

In `runner/.env`:

```bash
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>
```

That enables text notifications.

## 4) Optional: enable Telegram voice notes

If you run MUSE TTS (or another compatible TTS endpoint), add:

```bash
TELEGRAM_VOICE_ENABLED=true
VOICE_TTS_URL=https://<your-muse-tts-endpoint>/synthesize
VOICE_TTS_API_KEY=
VOICE_PERSONA_DEFAULT=lewis
VOICE_PERSONA_RAINER=lewis
VOICE_PERSONA_COMPANION=onyx
TELEGRAM_VOICE_REQUIRED=false
```

- `TELEGRAM_VOICE_REQUIRED=false` means text still sends even if TTS is down.
- Set it to `true` if you want voice delivery to be strict.

Voice mapping defaults:
- **Rainer → Lewis**
- **Companion → Onyx**

