const { UserError } = require("../errors");
const { loadTrack } = require("./lavalink");
const { spotifyQueries } = require("./spotify");

const MAX_SECONDS = 3 * 60 * 60;
const CACHE_MS = 10 * 60 * 1000;
const YOUTUBE_URL = /^https?:\/\/(?:www\.|music\.|m\.)?youtube\.com\/|^https?:\/\/youtu\.be\//i;
const SOUNDCLOUD_URL = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\//i;
const SPOTIFY_URL = /^https?:\/\/open\.spotify\.com\//i;

const cache = new Map();

function pack(info) {
  if (!info.title) throw new UserError("Parça bulunamadı.");
  if (info.isStream) throw new UserError("Canlı yayınları çalmıyorum.");
  if (info.duration > MAX_SECONDS) throw new UserError("3 saatten uzun kayıtları kuyruğa almıyorum.");
  if (!info.uri) throw new UserError("Bu parçanın bağlantısı alınamadı.");
  return {
    title: info.title.slice(0, 120),
    webpage: info.uri,
    duration: info.duration,
    encoded: info.encoded,
    source: info.source || "",
  };
}

function recall(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return { ...hit.track };
}

function remember(key, track) {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { track, at: Date.now() });
}

async function youtubeTitle(url) {
  const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!response?.ok) return "";
  const body = await response.json().catch(() => ({}));
  return String(body.title || "").trim();
}

async function fromSoundCloud(query) {
  const key = `sc:${query.toLowerCase()}`;
  const cached = recall(key);
  if (cached) return cached;
  const track = pack(await loadTrack(`scsearch:${query}`));
  remember(key, track);
  return track;
}

async function resolveTrack(query) {
  const text = String(query || "").trim();
  if (text.length < 2) throw new UserError("Arama çok kısa.");
  if (/^https?:\/\//i.test(text) && !YOUTUBE_URL.test(text) && !SOUNDCLOUD_URL.test(text) && !SPOTIFY_URL.test(text)) {
    throw new UserError("YouTube, SoundCloud veya Spotify bağlantısı yaz.");
  }

  try {
    if (YOUTUBE_URL.test(text)) {
      const cached = recall(text);
      if (cached) return cached;
      const title = await youtubeTitle(text);
      if (!title) throw new UserError("Parça bulunamadı. Başka bir ad veya bağlantı dene.");
      const track = await fromSoundCloud(title);
      remember(text, track);
      return track;
    }
    if (SOUNDCLOUD_URL.test(text)) {
      const cached = recall(text);
      if (cached) return cached;
      const track = pack(await loadTrack(text));
      remember(text, track);
      return track;
    }
    if (SPOTIFY_URL.test(text)) {
      const expanded = await spotifyQueries(text);
      const name = expanded?.queries?.[0];
      if (!name) throw new UserError("Parça bulunamadı. Başka bir ad veya bağlantı dene.");
      return await fromSoundCloud(name);
    }
    return await fromSoundCloud(text);
  } catch (error) {
    if (error instanceof UserError) throw error;
    const message = String(error.message || "");
    const down = /ECONNREFUSED|fetch failed|ENOTFOUND|yanıt vermedi|bağlanılamadı|kapandı|hazır değil/i.test(message);
    console.error(down ? "Müzik sunucusu kapalı:" : "Parça aranamadı:", message);
    throw new UserError(down
      ? "Müzik sunucusu kapalı. Biraz sonra aynı komutu yeniden yaz."
      : "Parça bulunamadı. Başka bir ad veya bağlantı dene.");
  }
}

function formatDuration(seconds) {
  if (!seconds) return "süre yok";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

module.exports = { resolveTrack, formatDuration };
