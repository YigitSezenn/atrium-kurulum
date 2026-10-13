const http = require("node:http");
const { Readable } = require("node:stream");
const { directAudio, UA } = require("./direct");

const PORT = Number(process.env.YT_BRIDGE_PORT || 4100);
const cache = new Map();
let server = null;

function bridgeUrl(id) {
  const base = String(process.env.YT_BRIDGE_URL || `http://atrium:${PORT}`).replace(/\/$/, "");
  return `${base}/yt/${id}`;
}

function videoFromRequest(value) {
  const path = String(value || "").split("?")[0];
  return path.match(/^\/yt\/([A-Za-z0-9_-]{11})$/)?.[1] || "";
}

function remember(id, upstream) {
  cache.set(id, { upstream, at: Date.now() });
}

async function upstreamFor(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 90 * 60 * 1000) return hit.upstream;
  const audio = await directAudio(id);
  remember(id, audio.url);
  return audio.url;
}

function startBridge() {
  if (server) return server;
  server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const detail = String(error?.message || "");
      if (!detail.includes("http")) console.error("Ses köprüsü:", detail || "ulaşılamadı");
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  server.requestTimeout = 0;
  server.timeout = 0;
  server.headersTimeout = 60_000;
  server.listen(PORT, "0.0.0.0");
  return server;
}

async function openUpstream(id, range) {
  const headers = { "User-Agent": UA, Range: range || "bytes=0-" };
  let upstream = await upstreamFor(id);
  let response = await fetch(upstream, { headers });
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel().catch(() => {});
    cache.delete(id);
    upstream = await upstreamFor(id);
    response = await fetch(upstream, { headers });
  }
  return response;
}

async function handle(req, res) {
  const id = videoFromRequest(req.url);
  if (!id || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setTimeout(0);
  const range = typeof req.headers.range === "string" ? req.headers.range : "";
  const upstream = await openUpstream(id, range);
  if (upstream.status !== 200 && upstream.status !== 206) {
    await upstream.body?.cancel().catch(() => {});
    res.writeHead(502);
    res.end();
    return;
  }
  const headers = {
    "Content-Type": upstream.headers.get("content-type") || "audio/mp4",
    "Accept-Ranges": "bytes",
  };
  const length = upstream.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  const partial = Boolean(range) && upstream.status === 206;
  if (partial) {
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers["Content-Range"] = contentRange;
  }
  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === "HEAD" || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(res);
}

async function bridgedYoutube(id) {
  const audio = await directAudio(id);
  if (!audio.title) throw new Error("ses yok");
  remember(id, audio.url);
  startBridge();
  return {
    url: bridgeUrl(id),
    title: audio.title,
    artist: audio.artist,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

module.exports = { bridgeUrl, videoFromRequest, remember, startBridge, bridgedYoutube };
