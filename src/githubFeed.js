const path = require("path");
const { EmbedBuilder } = require("discord.js");
const { githubToken } = require("./config");
const { jsonFile } = require("./jsonFile");

const db = jsonFile(path.join(__dirname, "..", "data", "github.json"), () => ({ guilds: {} }));
const POLL_EVERY = 10 * 60 * 1000;
const MAX_REPOS = 10;
const ANON_BUDGET = 45;
const etags = new Map();
let pausedUntil = 0;
let polling = false;

async function gh(pathname, { cache = true } = {}) {
  if (Date.now() < pausedUntil) throw new Error("GitHub istek sınırı doldu, bekleniyor");
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "atrium-kurulum" };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const etag = cache && etags.get(pathname);
  if (etag) headers["If-None-Match"] = etag;
  const response = await fetch(`https://api.github.com${pathname}`, { headers, signal: AbortSignal.timeout(10_000) });
  if (response.status === 304) return { changed: false };
  if (response.status === 404) return { missing: true };
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    pausedUntil = reset ? reset * 1000 + 5000 : Date.now() + 15 * 60 * 1000;
    throw new Error("GitHub istek sınırı doldu");
  }
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const tag = response.headers.get("etag");
  if (cache && tag) etags.set(pathname, tag);
  return { changed: true, body: await response.json() };
}

function reposOf(guildId) {
  return db.read().guilds[guildId]?.repos || {};
}

function saveRepo(guildId, name, patch) {
  return db.update((data) => {
    data.guilds[guildId] ??= { repos: {} };
    const repos = data.guilds[guildId].repos;
    if (patch === null) delete repos[name];
    else repos[name] = { ...(repos[name] || {}), ...patch };
    return repos;
  });
}

async function latest(name) {
  const [commits, releases] = await Promise.all([
    gh(`/repos/${name}/commits?per_page=5`, { cache: false }),
    gh(`/repos/${name}/releases?per_page=5`, { cache: false }),
  ]);
  const release = Array.isArray(releases.body) ? releases.body.find((item) => !item.draft) : null;
  return {
    commit: Array.isArray(commits.body) ? commits.body[0]?.sha || null : null,
    release: release?.id || null,
  };
}

async function follow(guildId, input, channelId) {
  const repos = reposOf(guildId);
  const repo = await gh(`/repos/${input.owner}/${input.repo}`, { cache: false });
  if (repo.missing) return { error: "Bu depo yok veya gizli." };
  const name = repo.body.full_name;
  if (!repos[name] && Object.keys(repos).length >= MAX_REPOS) return { error: `En fazla ${MAX_REPOS} depo takip edilebilir.` };
  const base = await latest(name);
  await saveRepo(guildId, name, { channelId, ...base });
  return { name, url: repo.body.html_url };
}

async function unfollow(guildId, input) {
  const repos = reposOf(guildId);
  const wanted = `${input.owner}/${input.repo}`.toLowerCase();
  const name = Object.keys(repos).find((key) => key.toLowerCase() === wanted);
  if (!name) return null;
  await saveRepo(guildId, name, null);
  return name;
}

function firstLine(text) {
  return String(text || "").split("\n")[0].slice(0, 90);
}

function commitEmbed(name, commits) {
  const lines = commits.map((item) => {
    const who = item.author?.login || item.commit?.author?.name || "bilinmiyor";
    return `[\`${item.sha.slice(0, 7)}\`](${item.html_url}) ${firstLine(item.commit?.message)} — ${who}`;
  });
  return new EmbedBuilder()
    .setColor(0x24292f)
    .setTitle(`${name} · ${commits.length} yeni commit`)
    .setURL(`https://github.com/${name}/commits`)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setTimestamp();
}

function releaseEmbed(name, release) {
  const body = String(release.body || "").replace(/\r/g, "").trim();
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${name} · ${release.name || release.tag_name} yayınlandı`.slice(0, 250))
    .setURL(release.html_url)
    .setDescription(body ? `${body.slice(0, 600)}${body.length > 600 ? "…" : ""}` : "Sürüm notu yok.")
    .setFooter({ text: `${release.tag_name}${release.prerelease ? " · ön sürüm" : ""}` })
    .setTimestamp(release.published_at ? new Date(release.published_at) : new Date());
}

function newerThan(list, matches) {
  const index = list.findIndex(matches);
  return index === -1 ? list : list.slice(0, index);
}

async function checkRepo(client, guildId, name, entry) {
  const channel = await client.channels.fetch(entry.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const patch = {};
  const embeds = [];

  const commits = await gh(`/repos/${name}/commits?per_page=5`);
  if (commits.changed && Array.isArray(commits.body) && commits.body.length) {
    const fresh = newerThan(commits.body, (item) => item.sha === entry.commit);
    if (entry.commit && fresh.length) embeds.push(commitEmbed(name, fresh.reverse()));
    patch.commit = commits.body[0].sha;
  }

  const releases = await gh(`/repos/${name}/releases?per_page=5`);
  if (releases.changed && Array.isArray(releases.body)) {
    const published = releases.body.filter((item) => !item.draft);
    const fresh = newerThan(published, (item) => item.id === entry.release);
    if (entry.release && fresh.length) embeds.push(...fresh.slice(0, 3).reverse().map((item) => releaseEmbed(name, item)));
    if (published[0]) patch.release = published[0].id;
  }

  if (embeds.length) await channel.send({ embeds: embeds.slice(0, 10) });
  if (Object.keys(patch).length && (patch.commit !== entry.commit || patch.release !== entry.release)) {
    await saveRepo(guildId, name, patch);
  }
}

async function poll(client) {
  if (polling) return;
  polling = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      for (const [name, entry] of Object.entries(reposOf(guild.id))) {
        if (Date.now() < pausedUntil) return;
        await checkRepo(client, guild.id, name, entry).catch((error) => {
          console.error(`GitHub akışı okunamadı (${name}):`, error.message);
        });
      }
    }
  } finally {
    polling = false;
  }
}

function nextPoll(client) {
  if (githubToken) return POLL_EVERY;
  let repos = 0;
  for (const guild of client.guilds.cache.values()) repos += Object.keys(reposOf(guild.id)).length;
  return Math.max(POLL_EVERY, Math.ceil((repos * 2 * 60 * 60 * 1000) / ANON_BUDGET));
}

function startGithubFeed(client) {
  const loop = (delay) => {
    setTimeout(async () => {
      await poll(client).catch((error) => console.error("GitHub akışı çalışmadı:", error.message));
      loop(nextPoll(client));
    }, delay).unref();
  };
  loop(30_000);
}

module.exports = { follow, unfollow, reposOf, startGithubFeed, MAX_REPOS };
