const { UserError } = require("../errors");

const UA = "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip";
const MAX_SECONDS = 3 * 60 * 60;

function mediaUrl(value) {
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

function totalBytes(header) {
  const match = /\/(\d+)\s*$/.exec(String(header || ""));
  return match ? Number(match[1]) : 0;
}

async function readableMedia(upstream) {
  const head = await fetch(upstream, {
    headers: { Range: "bytes=0-31", "User-Agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  const bytes = Buffer.from(await head.arrayBuffer());
  const total = totalBytes(head.headers.get("content-range"));
  if (head.status !== 206 || total < 32 || !bytes.includes(Buffer.from("ftyp"))) return false;
  const tail = await fetch(upstream, {
    headers: { Range: `bytes=${total - 32}-${total - 1}`, "User-Agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  await tail.body?.cancel().catch(() => {});
  return tail.status === 206;
}

async function directAudio(id) {
  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: "21.26.364",
          androidSdkVersion: 30,
          osName: "Android",
          osVersion: "11",
          hl: "en",
          gl: "US",
        },
      },
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(String(response.status));
  const body = await response.json();
  const details = body.videoDetails || {};
  if (details.isLive || body.playabilityStatus?.status === "LIVE_STREAM") {
    throw new UserError("Canlı yayın açamam. Kayıtlı bir video veya şarkı dene.");
  }
  const seconds = Number(details.lengthSeconds) || 0;
  if (seconds > MAX_SECONDS) throw new UserError("Bu kayıt 3 saatten uzun. Daha kısa bir video dene.");
  const formats = [...(body.streamingData?.formats || []), ...(body.streamingData?.adaptiveFormats || [])];
  const audio = formats.filter((format) => mediaUrl(format?.url) && String(format.mimeType || "").startsWith("audio/"));
  const chosen = formats.find((format) => format.itag === 18 && mediaUrl(format.url))
    || audio.find((format) => format.itag === 140)
    || audio.find((format) => /mp4/.test(format.mimeType || ""))
    || audio[0];
  const upstream = mediaUrl(chosen?.url);
  if (!upstream || !(await readableMedia(upstream))) throw new Error(body.playabilityStatus?.status || "ses yok");
  return {
    url: upstream,
    title: String(details.title || "").trim().slice(0, 120),
    artist: String(details.author || "").trim().slice(0, 80),
  };
}

module.exports = { directAudio, UA };
