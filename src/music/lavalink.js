const { lavalinkPassword, lavalinkUrl } = require("../config");

const hooks = new Map();
const voice = new Map();
const waiters = new Map();

let client = null;
let socket = null;
let sessionId = null;
let opening = null;
let retryTimer = null;

function restBase() {
  return lavalinkUrl.replace(/\/$/, "");
}

function socketUrl() {
  const base = restBase().replace(/^http/i, "ws");
  return `${base}/v4/websocket`;
}

function connected() {
  return Boolean(sessionId && socket && socket.readyState === 1);
}

function sendVoice(guildId, channelId) {
  const shard = client?.ws?.shards?.first();
  if (!shard) throw new Error("Discord bağlantısı yok.");
  shard.send({
    op: 4,
    d: {
      guild_id: guildId,
      channel_id: channelId,
      self_mute: false,
      self_deaf: true,
    },
  });
}

function rememberVoice(guildId, patch) {
  const current = voice.get(guildId) || {};
  const next = { ...current, ...patch };
  voice.set(guildId, next);
  if (next.channelId) hooks.get(guildId)?.onChannel?.(next.channelId);
  if (!next.sessionId || !next.token || !next.endpoint) return;
  const waiter = waiters.get(guildId);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  waiters.delete(guildId);
  waiter.resolve(next);
}

function onPacket(packet) {
  if (!packet || packet.op !== 0 && !packet.t) return;
  if (packet.t === "VOICE_STATE_UPDATE") {
    if (!client?.user || packet.d?.user_id !== client.user.id) return;
    if (!packet.d.channel_id) {
      voice.delete(packet.d.guild_id);
      hooks.get(packet.d.guild_id)?.onChannel?.(null);
      return;
    }
    rememberVoice(packet.d.guild_id, {
      sessionId: packet.d.session_id,
      channelId: packet.d.channel_id,
    });
    return;
  }
  if (packet.t === "VOICE_SERVER_UPDATE") {
    rememberVoice(packet.d.guild_id, {
      token: packet.d.token,
      endpoint: packet.d.endpoint,
    });
  }
}

function onMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (message.op === "ready") {
    sessionId = message.sessionId;
    socket.send(JSON.stringify({ op: "configureResuming", key: "atrium", timeout: 60 }));
    return;
  }
  if (message.op === "playerUpdate") {
    hooks.get(message.guildId)?.onPosition?.(message.state?.position);
    return;
  }
  if (message.op !== "event") return;
  const hook = hooks.get(message.guildId);
  if (!hook) return;
  if (message.type === "TrackEndEvent") hook.onEnd?.(message.reason);
  if (message.type === "TrackExceptionEvent") hook.onException?.(message.exception?.message || "Parça çalınamadı.");
  if (message.type === "TrackStuckEvent") hook.onException?.("Parça takıldı.");
}

function openSocket() {
  if (connected()) return Promise.resolve();
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!client?.user) {
      reject(new Error("Bot henüz hazır değil."));
      return;
    }
    let settled = false;
    const ws = new WebSocket(socketUrl(), {
      headers: {
        Authorization: lavalinkPassword,
        "User-Id": client.user.id,
        "Client-Name": "Atrium",
      },
    });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      opening = null;
      reject(error instanceof Error ? error : new Error("Müzik sunucusuna bağlanılamadı."));
    };
    const timer = setTimeout(() => fail(new Error("Müzik sunucusu yanıt vermedi.")), 8_000);
    ws.addEventListener("open", () => {
      socket = ws;
    });
    ws.addEventListener("message", (event) => {
      onMessage(event.data);
      if (!settled && sessionId) {
        settled = true;
        clearTimeout(timer);
        opening = null;
        resolve();
      }
    });
    ws.addEventListener("error", () => fail(new Error("Müzik sunucusuna bağlanılamadı.")));
    ws.addEventListener("close", () => {
      const wasCurrent = socket === ws;
      if (wasCurrent) {
        socket = null;
        sessionId = null;
      }
      clearTimeout(timer);
      if (!settled) fail(new Error("Müzik sunucusu kapandı."));
      if (wasCurrent) scheduleRetry();
    });
  });
  return opening;
}

function scheduleRetry() {
  if (retryTimer || !client) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    openSocket().catch((error) => console.error("Müzik sunucusu:", error.message));
  }, 5_000);
}

function bindLavalink(discord) {
  client = discord;
  discord.on("raw", onPacket);
  discord.once("clientReady", () => {
    openSocket()
      .then(() => console.log("Müzik sunucusu hazır."))
      .catch((error) => console.error("Müzik sunucusu:", error.message));
  });
}

async function ensureSocket() {
  if (connected()) return;
  await openSocket();
  if (!sessionId) throw new Error("Müzik sunucusu hazır değil.");
}

async function api(method, path, body) {
  await ensureSocket();
  const response = await fetch(`${restBase()}${path}`, {
    method,
    headers: {
      Authorization: lavalinkPassword,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text.slice(0, 300) || `Müzik sunucusu ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function registerGuild(guildId, hook) {
  hooks.set(guildId, hook);
}

function loadFailure(message) {
  const error = new Error(String(message || "Müzik sunucusu parçayı açamadı.").replace(/\s+/g, " ").trim().slice(0, 500));
  error.lavalinkLoad = true;
  return error;
}

async function loadTrack(identifier) {
  await ensureSocket();
  const response = await fetch(`${restBase()}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`, {
    headers: { Authorization: lavalinkPassword },
    signal: AbortSignal.timeout(8_000),
  }).catch((error) => {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error("Müzik sunucusu yanıt vermedi.");
    }
    throw error;
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw loadFailure(text || `Müzik sunucusu ${response.status}`);
  }
  const body = await response.json();
  if (body.loadType === "error") {
    throw loadFailure(body.data?.message || body.data?.cause);
  }
  const track = body.loadType === "track"
    ? body.data
    : body.loadType === "search"
      ? body.data?.[0]
      : body.loadType === "playlist"
        ? body.data?.tracks?.[0]
        : null;
  if (!track?.encoded || !track.info?.title) throw new Error("Parça bulunamadı.");
  return {
    title: track.info.title,
    uri: track.info.uri || "",
    duration: Math.floor((Number(track.info.length) || 0) / 1000),
    isStream: Boolean(track.info.isStream),
    encoded: track.encoded,
    source: track.info.sourceName || "",
  };
}

function awaitVoice(guildId) {
  const current = voice.get(guildId);
  if (current?.sessionId && current.token && current.endpoint) return Promise.resolve(current);
  const previous = waiters.get(guildId);
  if (previous) {
    clearTimeout(previous.timer);
    waiters.delete(guildId);
    previous.reject(new Error("Ses isteği yenilendi."));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(guildId);
      reject(new Error("Ses kanalına girilemedi."));
    }, 10_000);
    waiters.set(guildId, { resolve, reject, timer });
  });
}

async function stopTrack(guildId) {
  if (!sessionId) return;
  await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, {
    track: { encoded: null },
  });
}

async function join(guildId, channelId) {
  await ensureSocket();
  const current = voice.get(guildId);
  if (current?.channelId === channelId && current.sessionId && current.token && current.endpoint) return;
  voice.delete(guildId);
  const pending = awaitVoice(guildId);
  sendVoice(guildId, channelId);
  const update = await pending;
  await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, {
    voice: {
      token: update.token,
      endpoint: update.endpoint,
      sessionId: update.sessionId,
    },
  });
}

async function play(guildId, encoded, position, volume) {
  await ensureSocket();
  await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}?noReplace=false`, {
    track: { encoded },
    position: Math.max(0, Math.floor(position) || 0),
    volume: Math.max(0, Math.min(1000, Math.round(volume))),
    paused: false,
  });
}

function setPaused(guildId, paused) {
  if (!sessionId) return;
  api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { paused: Boolean(paused) }).catch((error) => {
    console.error("Duraklatma iletilemedi:", error.message);
  });
}

function setVolume(guildId, volume) {
  if (!sessionId) return;
  api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, {
    volume: Math.max(0, Math.min(1000, Math.round(volume))),
  }).catch((error) => {
    console.error("Ses iletilemedi:", error.message);
  });
}

async function destroy(guildId) {
  voice.delete(guildId);
  const waiter = waiters.get(guildId);
  if (waiter) {
    clearTimeout(waiter.timer);
    waiters.delete(guildId);
    waiter.reject(new Error("Ses kanalından çıkıldı."));
  }
  try {
    sendVoice(guildId, null);
  } catch {
    // Bot kapanırken shard kalmayabilir.
  }
  if (!sessionId) return;
  await api("DELETE", `/v4/sessions/${sessionId}/players/${guildId}`).catch(() => {});
}

module.exports = {
  bindLavalink,
  connected,
  registerGuild,
  loadTrack,
  join,
  play,
  setPaused,
  setVolume,
  stopTrack,
  destroy,
};
