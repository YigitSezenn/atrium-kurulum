const { UserError } = require("../errors");
const { youtubeAudio } = require("./invidious");
const { loadTrack } = require("./node");
const { spotifyQueries } = require("./spotify");
const { youtubeSearch } = require("./youtube");

const MAX_SECONDS = 3 * 60 * 60;
const YOUTUBE_URL = /^https?:\/\/(?:www\.|music\.|m\.)?youtube\.com\/|^https?:\/\/youtu\.be\//i;
const SOUNDCLOUD_URL = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\//i;
const SPOTIFY_URL = /^https?:\/\/open\.spotify\.com\//i;

function depsFrom(loadOrDeps, titleOf, expandSpotify) {
  if (typeof loadOrDeps === "function") {
    return { load: loadOrDeps, titleOf, expandSpotify };
  }
  return loadOrDeps || {};
}

function pack(info) {
  if (!info?.title || !info.encoded) throw new UserError("Bu şarkıyı bulamadım. Adını ya da bağlantısını kontrol edip tekrar dene.");
  if (info.isStream && info.source !== "http" && info.source !== "youtube") {
    throw new UserError("Canlı yayın açamam. Kayıtlı bir video veya şarkı dene.");
  }
  if (info.duration > MAX_SECONDS) throw new UserError("Bu kayıt 3 saatten uzun. Daha kısa bir video dene.");
  const source = info.source || "soundcloud";
  return {
    title: info.title.slice(0, 120),
    artist: String(info.author || "").slice(0, 80),
    webpage: info.uri || info.webpage || "",
    page: info.uri || info.webpage || "",
    thumbnail: info.artwork || "",
    duration: info.duration || 0,
    encoded: info.encoded,
    source,
    service: source === "http" ? "youtube" : source,
  };
}

async function fromSoundCloud(query, load) {
  const found = pack(await load(`scsearch:${query}`));
  found.source = "soundcloud";
  found.service = "soundcloud";
  return found;
}

async function fromYoutubePage(pageUrl, load, audioOf) {
  const audio = await audioOf(pageUrl);
  const found = pack(await load(audio.url));
  if (audio.title) found.title = audio.title.slice(0, 120);
  if (audio.artist) found.artist = audio.artist.slice(0, 80);
  const pieces = found.title.split(" - ");
  if (pieces.length > 1) {
    const head = pieces.slice(0, -1).join(" - ").trim();
    const tail = pieces.at(-1).trim();
    if (head && tail && (!found.artist || found.artist.startsWith(head))) {
      found.title = tail.slice(0, 120);
      if (!found.artist) found.artist = head.slice(0, 80);
    }
  }
  if (audio.thumbnail) found.thumbnail = audio.thumbnail;
  found.webpage = pageUrl;
  found.page = pageUrl;
  found.source = "youtube";
  found.service = "youtube";
  return found;
}

async function fromName(query, load, audioOf, search) {
  try {
    const video = await search(query);
    if (video?.url) return await fromYoutubePage(video.url, load, audioOf);
  } catch (error) {
    if (error instanceof UserError) throw error;
    console.error("YouTube sesi açılmadı:", error.message);
  }
  return fromSoundCloud(query, load);
}

async function resolveTrack(query, loadOrDeps = loadTrack, titleOf, expandSpotify = spotifyQueries) {
  const deps = depsFrom(loadOrDeps, titleOf, expandSpotify);
  const load = deps.load || loadTrack;
  const audioOf = deps.audioOf || youtubeAudio;
  const search = deps.search || youtubeSearch;
  const namesFromSpotify = deps.expandSpotify || expandSpotify;
  const text = String(query || "").trim();
  if (text.length < 2) throw new UserError("Arama çok kısa. Şarkı adını biraz daha uzun yaz.");
  if (/^https?:\/\//i.test(text) && !YOUTUBE_URL.test(text) && !SOUNDCLOUD_URL.test(text) && !SPOTIFY_URL.test(text)) {
    throw new UserError("Bu bağlantıyı açamam. YouTube, Spotify veya SoundCloud linki yapıştır.");
  }

  try {
    if (YOUTUBE_URL.test(text)) return await fromYoutubePage(text, load, audioOf);
    if (SOUNDCLOUD_URL.test(text)) return pack(await load(text));
    if (SPOTIFY_URL.test(text)) {
      const expanded = await namesFromSpotify(text);
      const name = expanded?.queries?.[0];
      if (!name) throw new UserError("Bu şarkıyı bulamadım. Adını ya da bağlantısını kontrol edip tekrar dene.");
      return fromName(name, load, audioOf, search);
    }
    return fromName(text, load, audioOf, search);
  } catch (error) {
    if (error instanceof UserError) throw error;
    const message = String(error.message || "");
    const down = /ECONNREFUSED|fetch failed|ENOTFOUND|yanıt vermedi|bağlanılamadı|kapandı|hazır değil/i.test(message);
    console.error(down ? "Müzik sunucusu kapalı:" : "Parça aranamadı:", message);
    throw new UserError(message === "Video sesi açılmadı."
      ? "Bu videonun sesini açamadım. Biraz sonra aynı bağlantıyı tekrar dene."
      : down
        ? "Müzik şu an cevap vermiyor. Biraz sonra tekrar dene."
        : "Bu şarkıyı bulamadım. Adını ya da bağlantısını kontrol edip tekrar dene.");
  }
}

function formatDuration(seconds) {
  if (!seconds) return "süre yok";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatSpoken(seconds) {
  const total = Math.floor(Number(seconds) || 0);
  if (!total) return "süre yok";
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} sn`;
  return `${minutes} dk ${rest} sn`;
}

module.exports = { resolveTrack, formatDuration, formatSpoken };
