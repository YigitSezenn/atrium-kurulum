const pending = new Map();

function levelName(level) {
  return `Seviye ${level}`;
}

function levelColor(level) {
  const hue = (200 + level * 18) % 360;
  const s = 0.65;
  const l = 0.55;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const channel = (value) => Math.round(value * 255);
  return (channel(f(0)) << 16) + (channel(f(8)) << 8) + channel(f(4));
}

async function ensureLevelRole(guild, level) {
  const name = levelName(level);
  const cached = guild.roles.cache.find((role) => role.name === name);
  if (cached) return cached;
  const key = `${guild.id}:${level}`;
  if (pending.has(key)) return pending.get(key);
  const job = guild.roles.create({
    name,
    hoist: true,
    mentionable: false,
    colors: { primaryColor: levelColor(level) },
    reason: "Seviye rolü",
  }).then(async (role) => {
    await role.setPosition(1, { reason: "Seviye rolleri altta kalsın" }).catch(() => {});
    return role;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

async function syncLevelRole(member, level) {
  const name = level > 0 ? levelName(level) : null;
  const stale = [...member.roles.cache.values()].filter((role) => /^Seviye \d+$/.test(role.name) && role.name !== name);
  if (stale.length) await member.roles.remove(stale, "Seviye güncellendi");
  if (!name) return null;
  const role = await ensureLevelRole(member.guild, level);
  if (!member.roles.cache.has(role.id)) await member.roles.add(role, `${level}. seviye`);
  return role;
}

module.exports = { syncLevelRole, levelName };
