const { getGuild, updateGuild } = require("./store");

const GROUPS = [
  ["Unrated", 0x7f8c8d],
  ["Iron", 0x5e5e5e],
  ["Bronze", 0xa97142],
  ["Silver", 0xb8b8b8],
  ["Gold", 0xecc85a],
  ["Platinum", 0x4eb0b0],
  ["Diamond", 0xb489e8],
  ["Ascendant", 0x2f9e5a],
  ["Immortal", 0xb83d5a],
  ["Radiant", 0xffe7a3],
];

const RANKS = GROUPS.flatMap(([name, color]) => (
  name === "Unrated" || name === "Radiant"
    ? [{ name, color }]
    : [1, 2, 3].map((step) => ({ name: `${name} ${step}`, color }))
));

const COLORS = Object.fromEntries(RANKS.map((rank) => [rank.name, rank.color]));
const filling = new Map();
const chains = new Map();

function enqueueGuild(guildId, task) {
  const prev = chains.get(guildId) || Promise.resolve();
  const run = prev.then(task, task);
  chains.set(guildId, run.then(() => undefined, () => undefined));
  return run;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wantedBadge(tier) {
  const text = String(tier || "").trim();
  if (!text || /unrated|derecesiz/i.test(text)) return "Unrated";
  if (/radiant/i.test(text)) return "Radiant";
  const match = text.match(/(iron|bronze|silver|gold|platinum|diamond|ascendant|immortal)\s*([1-3])?/i);
  if (!match) return "Unrated";
  const base = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  return `${base} ${match[2] || "1"}`;
}

async function ensureRankRole(guild, name) {
  return enqueueGuild(guild.id, () => createRankRole(guild, name));
}

async function createRankRole(guild, name) {
  const color = COLORS[name] ?? 0x7f8c8d;
  const saved = getGuild(guild.id)?.rankRoles?.[name];
  let role = saved && (guild.roles.cache.get(saved) || await guild.roles.fetch(saved).catch(() => null));
  if (!role) role = guild.roles.cache.find((item) => item.name === name && item.id !== guild.id);
  let created = false;
  if (!role) {
    role = await guild.roles.create({
      name,
      colors: { primaryColor: color },
      hoist: false,
      mentionable: false,
      reason: "Valorant rankı",
    });
    created = true;
    await role.setPosition(1, { reason: "Rank rengi yetkili rengini ezmesin" }).catch(() => {});
  }
  await updateGuild(guild.id, (entry) => {
    entry.rankRoles ??= {};
    entry.rankRoles[name] = role.id;
  });
  if (created) await wait(400);
  return role;
}

function fillRemaining(guild) {
  if (filling.has(guild.id)) return filling.get(guild.id);
  const job = (async () => {
    for (const rank of RANKS) {
      await ensureRankRole(guild, rank.name);
    }
    const legacyId = getGuild(guild.id)?.rankRoles?.Immortal;
    const legacy = legacyId && guild.roles.cache.get(legacyId);
    if (legacy?.name === "Immortal") {
      await legacy.delete("Ranklar Immortal 1, 2 ve 3 olarak ayrıldı").catch(() => {});
      await updateGuild(guild.id, (entry) => {
        if (entry.rankRoles) delete entry.rankRoles.Immortal;
      });
    }
  })().catch((error) => {
    filling.delete(guild.id);
    console.error("Rank rolleri eksik:", error.message);
  });
  filling.set(guild.id, job);
  return job;
}

async function syncRankBadge(member, tier) {
  const want = wantedBadge(tier);
  const keep = await ensureRankRole(member.guild, want);
  const saved = getGuild(member.guild.id)?.rankRoles || {};
  const rankIds = new Set(Object.values(saved));
  const remove = member.roles.cache.filter((role) => (
    role.id !== keep.id && (rankIds.has(role.id) || role.name === "Immortal")
  ));
  if (remove.size) {
    await member.roles.remove(remove, "Valorant rankı").catch((error) => {
      console.error("Eski rank rolü alınamadı:", error.message);
    });
  }
  if (!member.roles.cache.has(keep.id)) {
    await member.roles.add(keep, "Valorant rankı").catch((error) => {
      console.error("Rank rolü verilemedi:", error.message);
    });
  }
  fillRemaining(member.guild);
  return want;
}

module.exports = { syncRankBadge, wantedBadge, RANKS };
