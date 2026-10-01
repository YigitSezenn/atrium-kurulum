const { getGuild, updateGuild } = require("./store");
const { ROLE_DEFS } = require("./constants");

const timers = new Map();
const STAFF = ["Kurucu", "Yönetici"];

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
  if (timer) clearInterval(timer);
  timers.delete(guildId);
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
    colors: { primaryColor: hsl(hue + index * 48) },
    reason: "RGB renk",
  }).catch((error) => {
    console.error("RGB rengi değişmedi:", error.message);
  })));
}

async function restore(guild) {
  const roles = await staffRoles(guild);
  await Promise.all(roles.map(({ key, role }) => role.edit({
    colors: { primaryColor: baseColor(key) },
    reason: "RGB kapandı",
  }).catch(() => {})));
}

async function tick(guild) {
  const state = getGuild(guild.id)?.rgb;
  if (!state?.enabled) {
    stopRgb(guild.id);
    return;
  }
  const hue = ((state.hue || 0) + 12) % 360;
  await paint(guild, hue);
  await updateGuild(guild.id, (entry) => {
    entry.rgb ??= {};
    entry.rgb.enabled = true;
    entry.rgb.hue = hue;
  });
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
  liftStaff(guild).catch((error) => console.error(error.message));
  const timer = setInterval(() => {
    tick(guild).catch((error) => console.error(error.message));
  }, 5_000);
  timers.set(guild.id, timer);
  tick(guild).catch((error) => console.error(error.message));
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

module.exports = { startRgb, stopRgb, resumeRgb, restore, clearLegacyRole, hasStaffColor };
