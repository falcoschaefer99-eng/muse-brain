import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BrainClient } from "./brain.js";

interface TelegramVoice {
  file_id: string;
  duration?: number;
  mime_type?: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number | string };
  voice?: TelegramVoice;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface UpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}

interface FileResponse {
  ok: boolean;
  result?: { file_path?: string };
}

interface BridgeState {
  offset: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function loadState(path: string): BridgeState {
  if (!existsSync(path)) return { offset: 0 };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<BridgeState>;
    return { offset: Number.isFinite(parsed.offset) ? Number(parsed.offset) : 0 };
  } catch {
    return { offset: 0 };
  }
}

function saveState(path: string, state: BridgeState): void {
  ensureParentDir(path);
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

async function telegramPostJson<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram ${method} failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

async function downloadTelegramFile(botToken: string, filePath: string, timeoutMs: number): Promise<Uint8Array> {
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram file download failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function transcribeVoice(
  sttUrl: string,
  sttApiKey: string | undefined,
  audio: Uint8Array,
  timeoutMs: number,
  model: string
): Promise<string> {
  const audioBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.set("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice-note.ogg");
  form.set("model", model);

  const headers: Record<string, string> = {};
  if (sttApiKey) headers["Authorization"] = `Bearer ${sttApiKey}`;

  const response = await fetch(sttUrl, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`STT failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as { text?: string; transcript?: string };
  const text = (payload.text || payload.transcript || "").trim();
  if (!text) throw new Error("STT response missing transcript text");
  return text;
}

async function sendTelegramText(botToken: string, chatId: string, text: string, timeoutMs: number): Promise<void> {
  await telegramPostJson(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  }, timeoutMs);
}

async function handleUpdate(
  update: TelegramUpdate,
  cfg: {
    botToken: string;
    chatId?: string;
    sttUrl: string;
    sttApiKey?: string;
    sttModel: string;
    timeoutMs: number;
    sendAck: boolean;
    tenant: string;
    brain: BrainClient;
  }
): Promise<void> {
  const message = update.message;
  if (!message?.voice) return;

  const messageChatId = String(message.chat.id);
  if (cfg.chatId && messageChatId !== cfg.chatId) return;

  const fileResp = await telegramPostJson<FileResponse>(cfg.botToken, "getFile", { file_id: message.voice.file_id }, cfg.timeoutMs);
  const filePath = fileResp.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile response missing file_path");

  const audio = await downloadTelegramFile(cfg.botToken, filePath, cfg.timeoutMs);
  const transcript = await transcribeVoice(cfg.sttUrl, cfg.sttApiKey, audio, cfg.timeoutMs, cfg.sttModel);

  await cfg.brain.callToolJson("mind_observe", {
    mode: "whisper",
    content: transcript,
    tags: ["telegram", "voice", "transcript"],
  });

  if (cfg.sendAck) {
    const preview = transcript.length > 240 ? `${transcript.slice(0, 240)}…` : transcript;
    await sendTelegramText(
      cfg.botToken,
      messageChatId,
      `[${cfg.tenant.toUpperCase()}] voice transcript saved\n${preview}`,
      cfg.timeoutMs
    );
  }
}

async function main(): Promise<void> {
  const botToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const sttUrl = requiredEnv("VOICE_STT_URL");
  const brainUrl = requiredEnv("BRAIN_URL");
  const brainApiKey = requiredEnv("BRAIN_API_KEY");
  const tenant = optionalEnv("VOICE_BRIDGE_TENANT", "rainer");
  const chatId = process.env["TELEGRAM_CHAT_ID"]?.trim() || undefined;
  const sttApiKey = process.env["VOICE_STT_API_KEY"]?.trim();
  const sttModel = optionalEnv("VOICE_STT_MODEL", "whisper-1");
  const timeoutMs = intEnv("VOICE_BRIDGE_TIMEOUT_MS", 30_000);
  const pollSeconds = intEnv("VOICE_BRIDGE_POLL_SECONDS", 12);
  const sendAck = boolEnv("VOICE_BRIDGE_SEND_ACK", true);
  const statePath = optionalEnv("VOICE_BRIDGE_STATE_PATH", "./state/telegram-voice-bridge.json");

  const brain = new BrainClient(brainUrl, brainApiKey, tenant);
  const state = loadState(statePath);

  console.log(`[voice-bridge] starting (tenant=${tenant}, poll=${pollSeconds}s, ack=${sendAck})`);

  while (true) {
    try {
      const updates = await telegramPostJson<UpdatesResponse>(botToken, "getUpdates", {
        offset: state.offset > 0 ? state.offset + 1 : undefined,
        timeout: 20,
        allowed_updates: ["message"],
      }, timeoutMs);

      const rows = Array.isArray(updates.result) ? updates.result : [];
      for (const row of rows) {
        await handleUpdate(row, {
          botToken,
          chatId,
          sttUrl,
          sttApiKey,
          sttModel,
          timeoutMs,
          sendAck,
          tenant,
          brain,
        });
        state.offset = Math.max(state.offset, row.update_id);
      }

      if (rows.length > 0) {
        saveState(statePath, state);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[voice-bridge] tick error: ${msg}`);
    }

    await sleep(pollSeconds * 1000);
  }
}

await main();
