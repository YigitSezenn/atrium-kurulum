const { getGuild, updateGuild } = require("./store");
const { ROLE_DEFS } = require("./constants");

const timers = new Map();
const generations = new Map();
const inflight = new Map();
const budgets = new Map();
const tracked = new WeakSet();
const STAFF = ["Kurucu", "Yönetici"];
const STEP = 30;
const MIN_GAP = 15_000;
const RESERVE = 150;
const ROLE_ROUTE = "/guilds/:id/roles/:id";

function trackBudget(client) {
  if (tracked.has(client)) return;
  tracked.add(client);
  client.rest.on("response", (request, response) => {
    if (request.method !== "PATCH" || request.route !== ROLE_ROUTE) return;
    const guildId = request.path.split("/")[2];
    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    const limit = Number(response.headers.get("x-ratelimit-limit"));
    const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"));
    if (!guildId || ![remaining, limit, resetAfter].every(Number.isFinite)) return;
    const used = limit - remaining;
    const refill = used > 0 ? (resetAfter * 1000) / used : budgets.get(guildId)?.refill || 86_400;
    budgets.set(guildId, { remaining, limit, refill, at: Date.now() });
  });
}

function tokens(guildId) {
  const budget = budgets.get(guildId);
  if (!budget) return Infinity;
  const gained = Math.floor((Date.now() - budget.at) / budget.refill);
  return Math.min(budget.limit, budget.remaining + gained);
}

function nextDelay(guildId) {
  const missing = RESERVE + STAFF.length - tokens(guildId);
  if (missing <= 0) return MIN_GAP;
  return Math.max(MIN_GAP, Math.ceil(missing * budgets.get(guildId).refill) + 1000);
}

function hsl(hue) {
  const h = ((hue % 360) + 360) % 360;
  const s = 1;
  const l = 0.55;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const channel = (value) => Math.round(value * 255);
  return (channel(f(0)) << 16) + (channel(f(8)) << 8) + channel(f(4));
}

function baseColor(key) {
  return ROLE_DEFS.find((role) => role.key === key)?.color || 0xffffff;
}

function stopRgb(guildId) {
  const timer = timers.get(guildId);
  if (timer) clearTimeout(timer);
  timers.delete(guildId);
  generations.set(guildId, (generations.get(guildId) || 0) + 1);
}

async function staffRoles(guild) {
  const saved = getGuild(guild.id)?.roles || {};
  const roles = [];
  for (const key of STAFF) {
    const id = saved[key];
    if (!id) continue;
    const role = guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
    if (role) roles.push({ key, role });
  }
  return roles;
}

async function paint(guild, hue) {
  const roles = await staffRoles(guild);
  await Promise.all(roles.map(({ role }, index) => role.edit({
    colors: {
      primaryColor: hsl(hue + index * 48),
      secondaryColor: null,
      tertiaryColor: null,
    },
    reason: "RGB renk",
  }).catch((error) => {
    console.error("RGB rengi değişmedi:", error.message);
  })));
}

async function restore(guild) {
  const roles = await staffRoles(guild);
  await Promise.all(roles.map(({ key, role }) => role.edit({
    colors: {
      primaryColor: baseColor(key),
      secondaryColor: null,
      tertiaryColor: null,
    },
    reason: "RGB kapandı",
  }).catch((error) => {
    console.error("RGB rengi dönmedi:", error.message);
  })));
}

function currentGeneration(guildId) {
  return generations.get(guildId) || 0;
}

async function tick(guild, generation) {
  const state = getGuild(guild.id)?.rgb;
  if (!state?.enabled || generation !== currentGeneration(guild.id)) return;
  if (tokens(guild.id) - RESERVE < STAFF.length) return;
  const hue = ((state.hue || 0) + STEP) % 360;
  await paint(guild, hue);
  if (generation !== currentGeneration(guild.id)) return;
  let stopped = false;
  await updateGuild(guild.id, (entry) => {
    if (!entry.rgb?.enabled || generation !== currentGeneration(guild.id)) {
      stopped = true;
      return;
    }
    entry.rgb.hue = hue;
  });
  if (!stopped || generation !== currentGeneration(guild.id)) return;
  stopRgb(guild.id);
  await restore(guild);
}

function enqueueTick(guild) {
  const generation = currentGeneration(guild.id);
  const prev = inflight.get(guild.id) || Promise.resolve();
  const job = prev.catch(() => {}).then(() => tick(guild, generation));
  inflight.set(guild.id, job);
  job.catch((error) => console.error("RGB karesi olmadı:", error.message));
  job.finally(() => {
    if (inflight.get(guild.id) === job) inflight.delete(guild.id);
  });
  return job;
}

function loop(guild, generation, delay) {
  const timer = setTimeout(async () => {
    if (generation !== currentGeneration(guild.id)) return;
    await enqueueTick(guild).catch(() => {});
    if (generation !== currentGeneration(guild.id)) return;
    loop(guild, generation, nextDelay(guild.id));
  }, delay);
  timers.set(guild.id, timer);
}

async function closeRgb(guild) {
  stopRgb(guild.id);
  const pending = inflight.get(guild.id);
  if (pending) await pending.catch(() => {});
  await updateGuild(guild.id, (entry) => {
    if (entry.rgb) entry.rgb.enabled = false;
  });
  await restore(guild);
}

async function liftStaff(guild) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const top = me?.roles.highest?.position;
  if (!top) return;
  const roles = await staffRoles(guild);
  let slot = top - 1;
  for (const { role } of roles) {
    if (slot < 1) break;
    if (role.position !== slot) {
      await role.setPosition(slot, { reason: "RGB rengi görünsün" }).catch((error) => {
        console.error("RGB sırası değişmedi:", error.message);
      });
    }
    slot -= 1;
  }
}

function startRgb(guild) {
  stopRgb(guild.id);
  trackBudget(guild.client);
  liftStaff(guild).catch((error) => console.error(error.message));
  loop(guild, currentGeneration(guild.id), 0);
}

async function clearLegacyRole(guild) {
  const roleId = getGuild(guild.id)?.rgb?.roleId;
  const role = roleId && (guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null));
  if (!role || role.name !== "RGB") return;
  const members = await guild.members.fetch().catch(() => null);
  if (members) {
    for (const member of members.values()) {
      if (!member.roles.cache.has(role.id)) continue;
      await member.roles.remove(role, "RGB yalnız Kurucu ve Yönetici").catch(() => {});
    }
  }
  await role.delete("RGB artık Kurucu ve Yönetici rengidir").catch(() => {});
  await updateGuild(guild.id, (entry) => {
    if (entry.rgb) delete entry.rgb.roleId;
  });
}

function resumeRgb(client) {
  for (const guild of client.guilds.cache.values()) {
    const state = getGuild(guild.id)?.rgb;
    if (!state?.enabled) continue;
    clearLegacyRole(guild).catch((error) => console.error(error.message));
    startRgb(guild);
  }
}

function hasStaffColor(member) {
  const saved = getGuild(member.guild.id)?.roles || {};
  return STAFF.some((key) => saved[key] && member.roles.cache.has(saved[key]));
}

module.exports = { startRgb, stopRgb, closeRgb, resumeRgb, restore, clearLegacyRole, hasStaffColor };
