const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { MessageFlags } = require("discord.js");
const { LIST_CAP } = require("./player");
const { spotifyClientId, spotifyClientSecret, spotifyRedirectUri } = require("../config");
const { UserError } = require("../errors");

const file = path.join(__dirname, "..", "..", "data", "spotify.json");
const pending = new Map();
let server = null;

function redirectParts() {
  const url = new URL(spotifyRedirectUri);
  return { hostname: url.hostname, port: Number(url.port || 80), path: url.pathname || "/callback" };
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { users: {} };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function saveUser(userId, entry) {
  const data = read();
  data.users[userId] = entry;
  write(data);
}

function dropUser(userId) {
  const data = read();
  delete data.users[userId];
  write(data);
}

function session(userId) {
  return read().users[userId] || null;
}

function requireApp() {
  if (!spotifyClientId) {
    throw new UserError("Spotify uygulaması bağlı değil. .env içine SPOTIFY_CLIENT_ID ve SPOTIFY_CLIENT_SECRET yazılmalı.");
  }
}

let appCache = { token: "", expires: 0 };

async function appAccess() {
  if (!spotifyClientId || !spotifyClientSecret) return "";
  if (appCache.token && appCache.expires - Date.now() > 60_000) return appCache.token;
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) return "";
  appCache = { token: body.access_token, expires: Date.now() + (body.expires_in * 1000) };
  return appCache.token;
}

async function tokenRequest(params) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (spotifyClientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64")}`;
  }
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers,
    body: new URLSearchParams(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new UserError("Spotify girişi tamamlanamadı. Uygulama kimliğini ve yönlendirme adresini kontrol et.");
  return body;
}

async function profile(access) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!response.ok) return "Spotify";
  const body = await response.json().catch(() => ({}));
  return body.display_name || body.id || "Spotify";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureServer() {
  if (server) return;
  const { hostname, port, path: callbackPath } = redirectParts();
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, spotifyRedirectUri);
    if (url.pathname !== callbackPath) {
      response.writeHead(404);
      response.end("Yok");
      return;
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const login = state && pending.get(state);
    pending.delete(state);
    if (!login || !code || login.expires < Date.now()) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<p>Giriş süresi doldu. Discord'da /spotify login yazıp yeniden dene.</p>");
      return;
    }
    try {
      const token = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: spotifyRedirectUri,
        client_id: spotifyClientId,
        code_verifier: login.verifier,
      });
      const name = await profile(token.access_token);
      saveUser(login.userId, {
        refresh: token.refresh_token,
        access: token.access_token,
        expires: Date.now() + (token.expires_in * 1000),
        name,
      });
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<p>${escapeHtml(name)} bağlandı. Bu sekmeyi kapatıp Discord'a dön.</p>`);
      await login.interaction.followUp({
        content: `Spotify bağlandı: **${name}**. Şarkı aramak için \`/spotify ara\` yaz.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<p>${escapeHtml(error.message)}</p>`);
    }
  });
  server.on("error", (error) => {
    console.error("Spotify giriş kapısı açılmadı:", error.message);
    server = null;
  });
  server.listen(port, hostname);
}

function loginUrl(userId, interaction) {
  requireApp();
  ensureServer();
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  pending.set(state, { verifier, userId, interaction, expires: Date.now() + (10 * 60 * 1000) });
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", spotifyClientId);
  url.searchParams.set("redirect_uri", spotifyRedirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("scope", "user-read-private user-read-email playlist-read-private user-library-read");
  return url.toString();
}

async function accessToken(userId) {
  const current = session(userId);
  if (!current?.refresh) throw new UserError("Önce `/spotify login` yaz.");
  if (current.access && current.expires - Date.now() > 60_000) return current.access;
  const token = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: current.refresh,
    client_id: spotifyClientId,
  });
  const next = {
    ...current,
    access: token.access_token,
    expires: Date.now() + (token.expires_in * 1000),
    refresh: token.refresh_token || current.refresh,
  };
  saveUser(userId, next);
  return next.access;
}

async function searchTracks(userId, query) {
  const access = await accessToken(userId);
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "10");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new UserError("Spotify oturumu düştü. `/spotify login` ile yeniden bağlan.");
  if (!response.ok) throw new UserError("Spotify araması açılmadı.");
  return (body.tracks?.items || []).filter((track) => track?.name).map((track) => {
    const artist = (track.artists || []).map((item) => item.name).filter(Boolean).join(", ");
    return {
      name: track.name,
      artist,
      query: `${artist} ${track.name}`.replace(/\s+/g, " ").trim(),
    };
  });
}

async function spotifyGet(userId, pathname) {
  const access = await accessToken(userId);
  const response = await fetch(`https://api.spotify.com/v1${pathname}`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new UserError("Spotify oturumu düştü. `/spotify login` ile yeniden bağlan.");
  if (!response.ok) throw new UserError("Spotify listesi açılmadı.");
  return body;
}

function asQuery(track) {
  const artist = (track.artists || []).map((item) => item.name).filter(Boolean).join(", ");
  return {
    name: track.name,
    artist,
    query: `${artist} ${track.name}`.replace(/\s+/g, " ").trim(),
  };
}

async function playlistTotal(userId, playlist) {
  const known = playlist.tracks?.total;
  if (typeof known === "number" && known > 0) return known;
  for (const path of ["tracks", "items"]) {
    try {
      const page = await spotifyGet(userId, `/playlists/${playlist.id}/${path}?limit=1`);
      if (typeof page.total === "number") return page.total;
    } catch {
      // diğer uç noktayı dene
    }
  }
  return 0;
}

async function listPlaylists(userId) {
  const me = await spotifyGet(userId, "/me");
  const body = await spotifyGet(userId, "/me/playlists?limit=50");
  const playlists = (body.items || [])
    .filter((playlist) => playlist?.id && playlist.name && playlist.owner?.id === me.id)
    .slice(0, 25);
  return Promise.all(playlists.map(async (playlist) => ({
    id: playlist.id,
    name: playlist.name,
    total: await playlistTotal(userId, playlist),
  })));
}

function trackFrom(entry) {
  const track = entry?.track || entry?.item;
  if (!track?.name || track.type === "episode") return null;
  return track;
}

async function playlistTracks(userId, playlistId) {
  let path = null;
  for (const name of ["items", "tracks"]) {
    try {
      const probe = await spotifyGet(userId, `/playlists/${playlistId}/${name}?limit=1`);
      if (Array.isArray(probe.items) && probe.items.some(trackFrom)) {
        path = name;
        break;
      }
    } catch {
      path = null;
    }
  }
  if (!path) return [];
  const tracks = [];
  let offset = 0;
  let total = Infinity;
  while (tracks.length < LIST_CAP && offset < total) {
    const body = await spotifyGet(userId, `/playlists/${playlistId}/${path}?limit=50&offset=${offset}`);
    const page = (body.items || []).map(trackFrom).filter(Boolean);
    total = typeof body.total === "number" ? body.total : offset + page.length;
    if (!(body.items || []).length) break;
    tracks.push(...page);
    offset += (body.items || []).length || page.length;
  }
  return tracks.slice(0, LIST_CAP).map(asQuery);
}

module.exports = {
  loginUrl,
  session,
  dropUser,
  searchTracks,
  listPlaylists,
  playlistTracks,
  requireApp,
  appAccess,
};
