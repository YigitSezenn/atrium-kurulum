const { UserError } = require("../errors");
const { runYtdlp } = require("./ytdlp");

const MAX_SECONDS = 3 * 60 * 60;
const ALLOWED_URL = [
  /^https?:\/\/(?:www\.|music\.|m\.)?youtube\.com\//i,
  /^https?:\/\/youtu\.be\//i,
  /^https?:\/\/open\.spotify\.com\//i,
];

function targetFor(query) {
  const text = String(query || "").trim();
  if (text.length < 2) throw new UserError("Arama çok kısa.");
  if (/^https?:\/\//i.test(text)) {
    if (!ALLOWED_URL.some((pattern) => pattern.test(text))) {
      throw new UserError("Yalnız YouTube veya Spotify bağlantısı çalınır.");
    }
    return text;
  }
  return `ytsearch1:${text}`;
}

async function resolveTrack(query) {
  const target = targetFor(query);
  let info;
  try {
    info = await runYtdlp(target);
  } catch (error) {
    if (error instanceof UserError) throw error;
    const missing = error?.code === "ENOENT" || /yt-dlp indirilemedi|ENOENT/.test(error.message || "");
    console.error(missing ? "yt-dlp hazır değil:" : "Parça aranamadı:", error.message);
    throw new UserError(missing
      ? "Müzik aracı henüz hazır değil. Biraz sonra aynı komutu yeniden yaz."
      : "Parça bulunamadı. Başka bir ad veya bağlantı dene.");
  }

  if (!info.title) throw new UserError("Parça bulunamadı.");
  if (info.is_live) throw new UserError("Canlı yayınları çalmıyorum.");
  if (info.duration > MAX_SECONDS) throw new UserError("3 saatten uzun kayıtları kuyruğa almıyorum.");
  if (!info.webpage_url) throw new UserError("Bu parçanın bağlantısı alınamadı.");

  return {
    title: info.title.slice(0, 120),
    webpage: info.webpage_url,
    duration: info.duration,
  };
}

function formatDuration(seconds) {
  if (!seconds) return "süre yok";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

module.exports = { resolveTrack, formatDuration };
