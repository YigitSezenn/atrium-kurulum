const test = require("node:test");
const assert = require("node:assert/strict");
const { lavalinkPassword, lavalinkUrl } = require("../src/config");
const { playBody, readLoad, voiceState } = require("../src/music/protocol");

const base = lavalinkUrl.replace(/\/$/, "");
const guild = "1219048713209516062";

async function openSession() {
  const socketUrl = `${base.replace(/^http/i, "ws")}/v4/websocket`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, {
      headers: {
        Authorization: lavalinkPassword,
        "User-Id": "999999999999999999",
        "Client-Name": "AtriumTest",
      },
    });
    const timer = setTimeout(() => reject(new Error("Lavalink açılmadı")), 8_000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.op !== "ready") return;
      clearTimeout(timer);
      resolve({ socket, sessionId: message.sessionId, events: [] , listen(handler) {
        socket.addEventListener("message", (next) => handler(JSON.parse(next.data.toString())));
      } });
    });
    socket.addEventListener("error", () => reject(new Error("Lavalink açılmadı")));
  });
}

async function patch(sessionId, body) {
  return fetch(`${base}/v4/sessions/${sessionId}/players/${guild}`, {
    method: "PATCH",
    headers: {
      Authorization: lavalinkPassword,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
}

test("Lavalink SoundCloud search and voice payload", async (t) => {
  let session;
  try {
    session = await openSession();
  } catch {
    t.skip("Lavalink bu makinede kapalı");
    return;
  }

  try {
    const missingChannel = await patch(session.sessionId, {
      voice: { token: "token", endpoint: "c-ams.discord.media:443", sessionId: "voice-session" },
    });
    assert.equal(missingChannel.status, 400);
    voiceState({
      token: "token",
      endpoint: "wss://c-ams.discord.media:443",
      sessionId: "voice-session",
      channelId: "1554849724278902905",
    });

    const started = Date.now();
    const response = await fetch(`${base}/v4/loadtracks?identifier=${encodeURIComponent("scsearch:never gonna give you up")}`, {
      headers: { Authorization: lavalinkPassword },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.loadType, "search");
    const found = readLoad(body);
    assert.equal(found.source, "soundcloud");
    assert.equal(Buffer.from(found.encoded, "base64").toString("latin1").includes("/preview/"), false);
    assert.ok(found.duration > 60);
    assert.ok(Date.now() - started < 12_000);

    const playGuild = "1219048713209516063";
    const playing = new Promise((resolve) => {
      session.listen((message) => {
        if (message.op === "event" && message.type === "TrackStartEvent" && message.guildId === playGuild) resolve(message);
      });
    });
    const played = await fetch(`${base}/v4/sessions/${session.sessionId}/players/${playGuild}?noReplace=false`, {
      method: "PATCH",
      headers: {
        Authorization: lavalinkPassword,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(playBody({ encoded: found.encoded, positionMs: 0, volume: 80 })),
      signal: AbortSignal.timeout(8_000),
    });
    assert.equal(played.status, 200);
    const start = await Promise.race([
      playing,
      new Promise((resolve) => setTimeout(() => resolve(null), 6_000)),
    ]);
    assert.equal(start?.type, "TrackStartEvent");
    await fetch(`${base}/v4/sessions/${session.sessionId}/players/${playGuild}`, {
      method: "DELETE",
      headers: { Authorization: lavalinkPassword },
    });
  } finally {
    session.socket.close();
  }
});
