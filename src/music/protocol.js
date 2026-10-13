function clean(value) {
  return String(value || "").trim();
}

function voiceState({ token, endpoint, sessionId, channelId }) {
  const state = {
    token: clean(token),
    endpoint: clean(endpoint).replace(/^wss?:\/\//i, "").replace(/\/+$/, ""),
    sessionId: clean(sessionId),
    channelId: clean(channelId),
  };
  if (!state.token || !state.endpoint || !state.sessionId || !state.channelId) {
    throw new Error("Ses bilgisi eksik.");
  }
  return state;
}

function playBody({ encoded, positionMs = 0, volume = 100 }) {
  if (typeof encoded !== "string" || !encoded) throw new Error("Parça kodu yok.");
  return {
    track: { encoded },
    position: Math.max(0, Math.floor(Number(positionMs) || 0)),
    volume: Math.max(0, Math.min(1000, Math.round(Number(volume) || 0))),
    paused: false,
  };
}

function isPreview(track) {
  try {
    return Buffer.from(track?.encoded || "", "base64").toString("latin1").includes("/preview/");
  } catch {
    return false;
  }
}

function listedTracks(body) {
  if (!body || body.loadType === "error" || body.loadType === "empty") return [];
  if (body.loadType === "track") return body.data ? [body.data] : [];
  if (body.loadType === "search") return body.data || [];
  if (body.loadType === "playlist") return body.data?.tracks || [];
  return [];
}

function readLoad(body) {
  const track = listedTracks(body).find((item) => item?.encoded && item.info?.title && !isPreview(item));
  if (!track) throw new Error("Parça bulunamadı.");
  return {
    title: String(track.info.title).slice(0, 120),
    author: String(track.info.author || "").slice(0, 80),
    uri: track.info.uri || "",
    artwork: track.info.artworkUrl || "",
    duration: Math.floor((Number(track.info.length) || 0) / 1000),
    isStream: Boolean(track.info.isStream),
    encoded: track.encoded,
    source: track.info.sourceName || "",
  };
}

module.exports = { voiceState, playBody, readLoad };
