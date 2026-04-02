import assert from "node:assert/strict";
import test from "node:test";
import { BrainClient } from "../src/brain.ts";
import { CompositeNotifier, NullNotifier, type NotificationEvent } from "../src/notifier.ts";
import { TelegramNotifier, createTelegramNotifierFromEnv } from "../src/notifiers/telegram.ts";

test("CompositeNotifier fans out and aggregates notifier failures", async () => {
  const seen: string[] = [];
  const event: NotificationEvent = {
    event_type: "task_completed",
    tenant: "rainer",
    wake_type: "duty",
    summary: "done",
    timestamp: new Date().toISOString(),
    user_visible: true,
  };

  const notifier = new CompositeNotifier([
    {
      async send() {
        seen.push("ok");
      },
    },
    {
      async send() {
        throw new Error("telegram down");
      },
    },
  ]);

  await assert.rejects(() => notifier.send(event), /Notifier failures: telegram down/);
  assert.deepEqual(seen, ["ok"]);

  const nullNotifier = new NullNotifier();
  await nullNotifier.send(event);
});

test("TelegramNotifier honors user visibility and reports API failures", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      fetchCalls += 1;
      return new Response("nope", { status: 500, statusText: "ERR" });
    }) as typeof fetch;

    const notifier = new TelegramNotifier("bot-token", "chat-id");

    await notifier.send({
      event_type: "task_completed",
      tenant: "rainer",
      wake_type: "duty",
      summary: "hidden",
      timestamp: new Date().toISOString(),
      user_visible: false,
    });

    assert.equal(fetchCalls, 0);

    await assert.rejects(
      () =>
        notifier.send({
          event_type: "task_completed",
          tenant: "rainer",
          wake_type: "duty",
          summary: "visible",
          timestamp: new Date().toISOString(),
          user_visible: true,
        }),
      /Telegram notify failed \(500\): nope/
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createTelegramNotifierFromEnv returns notifier only when both env vars exist", () => {
  const snapshot = { ...process.env };
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    assert.equal(createTelegramNotifierFromEnv(), null);

    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_CHAT_ID = "chat";
    assert.ok(createTelegramNotifierFromEnv());
  } finally {
    process.env = snapshot;
  }
});

test("TelegramNotifier can send optional synthesized voice note", async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = { ...process.env };
  const calls: string[] = [];

  try {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_CHAT_ID = "chat";
    process.env.TELEGRAM_VOICE_ENABLED = "true";
    process.env.VOICE_TTS_URL = "https://tts.example/synthesize";
    process.env.VOICE_PERSONA_RAINER = "lewis";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push(target);

      if (target.includes("/sendMessage")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (target === "https://tts.example/synthesize") {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "Content-Type": "audio/ogg" },
        });
      }

      if (target.includes("/sendVoice")) {
        const body = init?.body;
        assert.ok(body instanceof FormData);
        assert.equal(body.get("caption"), "[RAINER] voice update (lewis)");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      throw new Error(`unexpected fetch target: ${target}`);
    }) as typeof fetch;

    const notifier = createTelegramNotifierFromEnv();
    assert.ok(notifier);

    await notifier.send({
      event_type: "task_completed",
      tenant: "rainer",
      wake_type: "duty",
      summary: "voice test",
      timestamp: new Date().toISOString(),
      user_visible: true,
    });

    assert.equal(calls.length, 3);
    assert.ok(calls.some((url) => url.includes("/sendMessage")));
    assert.ok(calls.some((url) => url === "https://tts.example/synthesize"));
    assert.ok(calls.some((url) => url.includes("/sendVoice")));
  } finally {
    globalThis.fetch = originalFetch;
    process.env = snapshot;
  }
});

test("BrainClient surfaces network, auth, and RPC failures", async () => {
  const originalFetch = globalThis.fetch;

  try {
    const client = new BrainClient("https://brain.example/mcp", "brain-key", "rainer");

    globalThis.fetch = (async () => {
      throw new Error("network exploded");
    }) as typeof fetch;

    await assert.rejects(() => client.callTool("mind_wake", {}), /Brain network error: network exploded/);

    globalThis.fetch = (async () => new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })) as typeof fetch;
    await assert.rejects(() => client.callTool("mind_wake", {}), /Brain auth failed/);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nope" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    await assert.rejects(() => client.callTool("mind_wake", {}), /Brain RPC error -32000: nope/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
