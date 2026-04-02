import type { NotificationEvent, Notifier } from "../notifier.js";

function renderMessage(event: NotificationEvent): string {
  const tag = `[${event.tenant.toUpperCase()}]`;
  const headline = `${tag} ${event.wake_type} ${event.event_type.replaceAll("_", " ")}`.trim();
  const artifact = event.artifact_path ? `\n${event.artifact_path}` : "";
  return `${headline}\n${event.summary}${artifact}`.trim();
}

interface VoiceConfig {
  enabled: boolean;
  ttsUrl: string;
  ttsApiKey?: string;
  defaultVoice: string;
  tenantVoices: Record<string, string>;
  timeoutMs: number;
  required: boolean;
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

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly voiceConfig: VoiceConfig | null = null
  ) {}

  private async sendText(message: string): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: message,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram notify failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }

  private voiceForTenant(tenant: string): string {
    const normalized = tenant.trim().toLowerCase();
    return this.voiceConfig?.tenantVoices[normalized] || this.voiceConfig?.defaultVoice || "lewis";
  }

  private async synthesizeVoiceNote(message: string, tenant: string): Promise<Uint8Array> {
    if (!this.voiceConfig) throw new Error("Voice config missing");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.voiceConfig.ttsApiKey) {
      headers["Authorization"] = `Bearer ${this.voiceConfig.ttsApiKey}`;
    }

    const voice = this.voiceForTenant(tenant);
    const response = await fetch(this.voiceConfig.ttsUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: message,
        voice,
        format: "ogg_opus",
        tenant,
      }),
      signal: AbortSignal.timeout(this.voiceConfig.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voice TTS failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { audio_base64?: string };
      if (!payload.audio_base64) {
        throw new Error("Voice TTS JSON response missing audio_base64");
      }
      const raw = Buffer.from(payload.audio_base64, "base64");
      return new Uint8Array(raw);
    }

    const audio = await response.arrayBuffer();
    return new Uint8Array(audio);
  }

  private async sendVoice(audio: Uint8Array, tenant: string): Promise<void> {
    const audioBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
    const form = new FormData();
    const voice = this.voiceForTenant(tenant);
    form.set("chat_id", this.chatId);
    form.set("caption", `[${tenant.toUpperCase()}] voice update (${voice})`);
    form.set("voice", new Blob([audioBuffer], { type: "audio/ogg" }), "wake-note.ogg");

    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendVoice`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram voice notify failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }

  async send(event: NotificationEvent): Promise<void> {
    if (!event.user_visible) return;
    const message = renderMessage(event);

    await this.sendText(message);

    if (!this.voiceConfig?.enabled) return;

    try {
      const audio = await this.synthesizeVoiceNote(message, event.tenant);
      await this.sendVoice(audio, event.tenant);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.voiceConfig.required) {
        throw new Error(`Voice note delivery failed: ${msg}`);
      }
      console.warn(`[telegram] voice note skipped: ${msg}`);
    }
  }
}

export function createTelegramNotifierFromEnv(): TelegramNotifier | null {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const chatId = process.env["TELEGRAM_CHAT_ID"]?.trim();
  if (!botToken || !chatId) return null;

  const voiceEnabled = boolEnv("TELEGRAM_VOICE_ENABLED", false);
  const ttsUrl = process.env["VOICE_TTS_URL"]?.trim();
  const voiceConfig: VoiceConfig | null = voiceEnabled && ttsUrl
    ? {
        enabled: true,
        ttsUrl,
        ttsApiKey: process.env["VOICE_TTS_API_KEY"]?.trim(),
        defaultVoice: process.env["VOICE_PERSONA_DEFAULT"]?.trim() || "lewis",
        tenantVoices: {
          rainer: process.env["VOICE_PERSONA_RAINER"]?.trim() || "lewis",
          companion: process.env["VOICE_PERSONA_COMPANION"]?.trim() || "onyx",
        },
        timeoutMs: intEnv("VOICE_TTS_TIMEOUT_MS", 20_000),
        required: boolEnv("TELEGRAM_VOICE_REQUIRED", false),
      }
    : null;

  return new TelegramNotifier(botToken, chatId, voiceConfig);
}
