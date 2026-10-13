const { henrikApiKey } = require("../config");
const { UserError } = require("../errors");

const TTL = 5 * 60 * 1000;
const MAX_ENTRIES = 300;
const cache = new Map();
const inflight = new Map();

async function request(path) {
  const response = await fetch(`https://api.henrikdev.xyz${path}`, {
    headers: { Authorization: henrikApiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    if (error.name === "TimeoutError") throw new UserError("Valorant servisi geç yanıt verdi. Biraz sonra tekrar dene.");
    throw error;
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 429) throw new UserError("Valorant servisine çok istek gitti. Bir dakika sonra tekrar dene.");
  if (!response.ok) {
    const message = body.errors?.[0]?.message || body.message || `Henrik yanıtı ${response.status}`;
    throw new UserError(String(message).slice(0, 180));
  }
  return body.data;
}

async function henrik(path, { fresh = false } = {}) {
  if (!henrikApiKey) {
    throw new UserError("İstatistik için .env dosyasına HENRIK_API_KEY yaz. Anahtarı henrikdev.xyz üzerinden al; sohbete yapıştırma.");
  }
  const hit = cache.get(path);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.data;
  if (inflight.has(path)) return inflight.get(path);
  const job = request(path)
    .then((data) => {
      cache.delete(path);
      cache.set(path, { at: Date.now(), data });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, job);
  return job;
}

module.exports = { henrik };
