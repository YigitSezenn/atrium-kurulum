function videoTitle(video) {
  const runs = video?.title?.runs;
  if (Array.isArray(runs) && runs.length) return runs.map((part) => part.text || "").join("").trim();
  return String(video?.title?.simpleText || "").trim();
}

function isLive(video) {
  const badge = JSON.stringify(video?.badges || video?.thumbnailOverlays || "");
  return /LIVE|CANLI/i.test(badge);
}

function firstVideo(root) {
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < 8000) {
    const node = stack.pop();
    seen += 1;
    if (!node || typeof node !== "object") continue;
    const video = node.videoRenderer;
    if (video?.videoId && video.lengthText && !isLive(video)) {
      const title = videoTitle(video);
      if (title) return { url: `https://www.youtube.com/watch?v=${video.videoId}`, title: title.slice(0, 120) };
    }
    const values = Array.isArray(node) ? node : Object.values(node);
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

async function youtubeSearch(query) {
  const text = String(query || "").trim();
  if (text.length < 2) return null;
  const response = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      context: {
        client: {
          hl: "tr",
          gl: "TR",
          clientName: "WEB",
          clientVersion: "2.20241001.00.00",
        },
      },
      query: text,
    }),
    signal: AbortSignal.timeout(6_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null);
  return firstVideo(body);
}

module.exports = { firstVideo, youtubeSearch };
