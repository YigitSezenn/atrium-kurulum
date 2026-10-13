const { UserError } = require("../errors");
const { bridgedYoutube } = require("./bridge");

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,80}$/;
const FALLBACK = "https://invidious.f5.si";

let preferred = FALLBACK;

function hostOf(value) {
  return String(value || "").replace(/^(www|music|m)\./, "");
}

function videoId(value) {
  try {
    const url = new URL(String(value || ""));
    const host = hostOf(url.hostname);
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "youtu.be" && VIDEO_ID.test(parts[0] || "")) return parts[0];
    if (host !== "youtube.com") return "";
    const query = url.searchParams.get("v") || "";
    if (VIDEO_ID.test(query)) return query;
    if (["shorts", "embed", "live", "v"].includes(parts[0]) && VIDEO_ID.test(parts[1] || "")) return parts[1];
  } catch {
    return "";
  }
  return "";
}

function playlistId(value) {
  try {
    const url = new URL(String(value || ""));
    if (hostOf(url.hostname) !== "youtube.com") return "";
    if (url.pathname !== "/playlist") return "";
    const list = url.searchParams.get("list") || "";
    return PLAYLIST_ID.test(list) ? list : "";
  } catch {
    return "";
  }
}

function usableAudioUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const name = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return "";
    if (name !== "googlevideo.com" && !name.endsWith(".googlevideo.com")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function audioUrl(formats) {
  const audio = (Array.isArray(formats) ? formats : []).filter((format) => String(format?.type || "").startsWith("audio/"));
  const ranked = [
    ...audio.filter((format) => /mp4|m4a/i.test(format.type)),
    ...audio.filter((format) => !/mp4|m4a/i.test(format.type)),
  ];
  for (const format of ranked) {
    const url = usableAudioUrl(format.url);
    if (url) return url;
  }
  return "";
}

async function instanceList() {
  const found = [];
  try {
    const response = await fetch("https://api.invidious.io/instances.json?sort_by=health", {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4_000),
    });
    const list = response.ok ? await response.json() : [];
    for (const item of list) {
      const meta = item?.[1];
      if (!meta?.api || meta.type !== "https" || !meta.uri) continue;
      const uri = String(meta.uri).replace(/\/$/, "");
      if (!found.includes(uri)) found.push(uri);
      if (found.length >= 3) break;
    }
  } catch {
    found.length = 0;
  }
  return [preferred, ...found.filter((uri) => uri !== preferred)].slice(0, 4);
}

async function readJson(base, path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function failureStatus(error) {
  const name = error?.name || "";
  if (name === "TimeoutError" || name === "AbortError") return "zaman aşımı";
  const code = error?.cause?.code;
  if (code) return String(code);
  if (/^\d{3}$/.test(String(error?.message || ""))) return String(error.message);
  return "ulaşılamadı";
}

function networkFailure(status) {
  return status === "ulaşılamadı" || status === "zaman aşımı";
}

async function youtubeAudio(pageUrl) {
  const id = videoId(pageUrl);
  if (!id) throw new Error("Video sesi açılmadı.");
  let lastStatus = "yok";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let sawNetwork = false;
    for (const base of await instanceList()) {
      try {
        const body = await readJson(base, `/api/v1/videos/${id}`);
        if (body.liveNow) throw new UserError("Canlı yayın açamam. Kayıtlı bir video veya şarkı dene.");
        const url = audioUrl(body.adaptiveFormats);
        const title = String(body.title || "").trim().slice(0, 120);
        const artist = String(body.author || "").trim().slice(0, 80);
        if (!url || !title) {
          lastStatus = "ses yok";
          continue;
        }
        preferred = base;
        return { url, title, artist, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
      } catch (error) {
        if (error instanceof UserError) throw error;
        lastStatus = failureStatus(error);
        if (networkFailure(lastStatus)) sawNetwork = true;
      }
    }
    if (!sawNetwork || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  try {
    return await bridgedYoutube(id);
  } catch (error) {
    if (error instanceof UserError) throw error;
    const detail = String(error?.message || "");
    console.error("Video sesi açılmadı:", detail.includes("http") ? lastStatus : `${lastStatus} ${detail}`.trim());
    throw new Error("Video sesi açılmadı.");
  }
}

async function playlistVideos(pageUrl, limit = 100) {
  const id = playlistId(pageUrl);
  if (!id) return [];
  for (const base of await instanceList()) {
    try {
      const body = await readJson(base, `/api/v1/playlists/${encodeURIComponent(id)}`);
      const videos = (Array.isArray(body.videos) ? body.videos : [])
        .map((video) => video?.videoId)
        .filter((video) => VIDEO_ID.test(video || ""))
        .slice(0, limit)
        .map((video) => `https://www.youtube.com/watch?v=${video}`);
      if (!videos.length) continue;
      preferred = base;
      return videos;
    } catch {
      continue;
    }
  }
  throw new UserError("Bu listenin şarkılarını alamadım. Linki kontrol edip tekrar dene.");
}

module.exports = { videoId, playlistId, usableAudioUrl, youtubeAudio, playlistVideos };
