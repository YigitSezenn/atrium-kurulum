const http = require("node:http");
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

const CHUNK = 512 * 1024;

function spanOf(header, total) {
  const match = /bytes=(\d*)-(\d*)/i.exec(String(header || ""));
  if (!match || total < 1) return { start: 0, end: Math.max(0, total - 1) };
  const suffix = !match[1] && match[2];
  const start = suffix ? Math.max(0, total - Number(match[2])) : Number(match[1] || 0);
  const end = suffix || !match[2] ? total - 1 : Number(match[2]);
  const from = Math.max(0, Math.min(start, total - 1));
  const to = Math.max(from, Math.min(end, total - 1));
  return { start: from, end: to };
}

async function totalSize(upstream) {
  const response = await fetch(upstream, {
    headers: { "User-Agent": UA, Range: "bytes=0-0" },
    signal: AbortSignal.timeout(12_000),
  });
  const total = Number((/\/(\d+)\s*$/.exec(response.headers.get("content-range") || "") || [])[1] || 0);
  await response.body?.cancel().catch(() => {});
  return total;
}

async function readChunk(id, start, end) {
  const expected = end - start + 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const upstream = await upstreamFor(id);
      const response = await fetch(upstream, {
        headers: { "User-Agent": UA, Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 403 || response.status === 410) {
        await response.body?.cancel().catch(() => {});
        cache.delete(id);
        continue;
      }
      if (response.status !== 206 && response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === expected) return bytes;
    } catch {
      cache.delete(id);
    }
  }
  return null;
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

async function handle(req, res) {
  const id = videoFromRequest(req.url);
  if (!id || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setTimeout(0);
  const upstream = await upstreamFor(id);
  const total = await totalSize(upstream);
  if (!total) {
    res.writeHead(502);
    res.end();
    return;
  }
  const range = typeof req.headers.range === "string" ? req.headers.range : "";
  const { start, end } = spanOf(range, total);
  const headers = {
    "Content-Type": "audio/mp4",
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  let closed = false;
  const stop = () => {
    closed = true;
  };
  res.on("close", stop);
  res.on("error", stop);
  for (let offset = start; offset <= end && !closed; offset += CHUNK) {
    const bytes = await readChunk(id, offset, Math.min(end, offset + CHUNK - 1));
    if (!bytes || closed) break;
    try {
      if (!res.write(bytes)) await new Promise((resolve) => res.once("drain", resolve));
    } catch {
      break;
    }
  }
  if (!closed) res.end();
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

module.exports = { bridgeUrl, videoFromRequest, remember, startBridge, bridgedYoutube, spanOf };
