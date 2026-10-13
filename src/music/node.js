const { lavalinkPassword, lavalinkUrl } = require("../config");
const { startBridge } = require("./bridge");
const { playBody, readLoad, voiceState } = require("./protocol");

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
  return `${restBase().replace(/^http/i, "ws")}/v4/websocket`;
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
  const next = { ...(voice.get(guildId) || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value;
  }
  voice.set(guildId, next);
  if (next.channelId) hooks.get(guildId)?.onChannel?.(next.channelId);
  if (!next.sessionId || !next.token || !next.endpoint || !next.channelId) return;
  const waiter = waiters.get(guildId);
  if (waiter) {
    clearTimeout(waiter.timer);
    waiters.delete(guildId);
    waiter.resolve(next);
    return;
  }
  if (!next.sent || !sessionId) return;
  const state = voiceState(next);
  if (next.sentToken === state.token && next.sentEndpoint === state.endpoint && next.sentSession === state.sessionId && next.sentChannel === state.channelId) return;
  api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { voice: state })
    .then(() => {
      const latest = voice.get(guildId);
      if (!latest) return;
      voice.set(guildId, {
        ...latest,
        ...state,
        sent: true,
        sentToken: state.token,
        sentEndpoint: state.endpoint,
        sentSession: state.sessionId,
        sentChannel: state.channelId,
        lavalinkSession: sessionId,
      });
    })
    .catch((error) => console.error("Ses bağlantısı güncellenemedi:", error.message));
}

function onPacket(packet) {
  if (!packet?.t) return;
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
  if (message.type === "TrackEndEvent" && message.reason === "finished") hook.onEnd?.();
  if (message.type === "TrackExceptionEvent" || message.type === "TrackStuckEvent") hook.onException?.();
}

function openSocket() {
  if (connected()) return Promise.resolve();
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!client?.user) {
      reject(new Error("Müzik sunucusu hazır değil."));
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
  startBridge();
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
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    console.error("Müzik sunucusu:", response.status, text.slice(0, 300));
    throw new Error(response.status === 400 ? "Ses bağlantısı kurulamadı." : "Müzik sunucusu isteği reddetti.");
  }
  if (!text) return null;
  return JSON.parse(text);
}

function registerGuild(guildId, hook) {
  hooks.set(guildId, hook);
}

async function loadTrack(identifier) {
  await ensureSocket();
  const response = await fetch(`${restBase()}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`, {
    headers: { Authorization: lavalinkPassword },
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error("Müzik sunucusu yanıt vermedi.");
    throw error;
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    console.error("Müzik sunucusu:", response.status, text.slice(0, 300));
    throw new Error("Parça bulunamadı.");
  }
  return readLoad(JSON.parse(text));
}

function awaitVoice(guildId) {
  const current = voice.get(guildId);
  if (current?.sessionId && current.token && current.endpoint && current.channelId) return Promise.resolve(current);
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

async function join(guildId, channelId) {
  await ensureSocket();
  const current = voice.get(guildId);
  const sameChannel = current?.channelId === channelId && current.sessionId && current.token && current.endpoint;
  if (sameChannel && current.sent && current.lavalinkSession === sessionId) return;
  if (sameChannel) {
    const state = voiceState(current);
    await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { voice: state });
    voice.set(guildId, {
      ...voice.get(guildId),
      ...state,
      sent: true,
      sentToken: state.token,
      sentEndpoint: state.endpoint,
      sentSession: state.sessionId,
      sentChannel: state.channelId,
      lavalinkSession: sessionId,
    });
    return;
  }

  const carried = {};
  if (current?.token) carried.token = current.token;
  if (current?.endpoint) carried.endpoint = current.endpoint;
  if (current?.sessionId) carried.sessionId = current.sessionId;
  voice.delete(guildId);
  if (Object.keys(carried).length) voice.set(guildId, carried);

  const pending = awaitVoice(guildId);
  sendVoice(guildId, channelId);
  await pending;
  const update = voice.get(guildId) || {};
  const state = voiceState({ ...update, channelId: update.channelId || channelId });
  await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { voice: state });
  const latest = voice.get(guildId) || {};
  const finalState = voiceState({
    token: latest.token || state.token,
    endpoint: latest.endpoint || state.endpoint,
    sessionId: latest.sessionId || state.sessionId,
    channelId: latest.channelId || state.channelId,
  });
  if (finalState.token !== state.token || finalState.endpoint !== state.endpoint || finalState.sessionId !== state.sessionId || finalState.channelId !== state.channelId) {
    await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { voice: finalState });
  }
  voice.set(guildId, {
    ...finalState,
    sent: true,
    sentToken: finalState.token,
    sentEndpoint: finalState.endpoint,
    sentSession: finalState.sessionId,
    sentChannel: finalState.channelId,
    lavalinkSession: sessionId,
  });
}

async function play(guildId, encoded, positionMs, volume) {
  await ensureSocket();
  await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}?noReplace=false`, playBody({
    encoded,
    positionMs,
    volume,
  }));
}

function setPaused(guildId, paused) {
  if (!sessionId) return;
  api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { paused: Boolean(paused) }).catch((error) => {
    console.error("Duraklatma iletilemedi:", error.message);
  });
}

function setVolume(guildId, volume) {
  if (!sessionId) return;
  const level = Math.max(0, Math.min(1000, Math.round(Number(volume) || 0)));
  api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { volume: level }).catch((error) => {
    console.error("Ses iletilemedi:", error.message);
  });
}

function seek(guildId, positionMs) {
  if (!sessionId) return;
  const position = Math.max(0, Math.floor(Number(positionMs) || 0));
  api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { position }).catch((error) => {
    console.error("Sarma iletilemedi:", error.message);
  });
}

function setFilters(guildId, filters) {
  if (!sessionId) return;
  api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { filters: filters || {} }).catch((error) => {
    console.error("Filtre iletilemedi:", error.message);
  });
}

async function stopTrack(guildId) {
  if (!sessionId) return;
  await api("PATCH", `/v4/sessions/${sessionId}/players/${guildId}`, { track: { encoded: null } });
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
  seek,
  setFilters,
  stopTrack,
  destroy,
};
