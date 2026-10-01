const { EmbedBuilder } = require("discord.js");
const { getGuild, update, progress, bar, MAX_LEVEL } = require("../levels");
const { syncLevelRole } = require("../levelRole");

const MESSAGE_COOLDOWN = 45_000;

async function grant(member, amount, extra = {}) {
  const current = getGuild(member.guild.id);
  const before = current.users?.[member.id]?.xp || 0;
  if (progress(before).level >= MAX_LEVEL) {
    const named = `Seviye ${MAX_LEVEL}`;
    const wrong = member.roles.cache.some((role) => /^Seviye \d+$/.test(role.name) && role.name !== named);
    if (wrong) await syncLevelRole(member, MAX_LEVEL).catch(() => {});
    return;
  }
  const saved = await update(member.guild.id, (entry) => {
    entry.users[member.id] ??= { xp: 0 };
    entry.users[member.id].xp += amount;
    Object.assign(entry.users[member.id], extra);
    return {
      xp: entry.users[member.id].xp,
      rewards: entry.rewards || {},
    };
  });
  const previous = progress(before).level;
  const next = progress(saved.xp).level;
  const hasRole = next > 0 && member.roles.cache.some((role) => role.name === `Seviye ${next}`);
  if (next !== previous || !hasRole) {
    await syncLevelRole(member, next).catch((error) => {
      console.error("Seviye rolü güncellenemedi:", error.message);
    });
  }
  if (next <= previous) return;

  const lines = [];
  for (const [level, roleId] of Object.entries(saved.rewards)) {
    const target = Number(level);
    if (target <= previous || target > next) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (!role) continue;
    await member.roles.add(role, `${target}. seviye ödülü`).catch(() => {});
    lines.push(role.name);
  }

  const channels = require("../store").getGuild(member.guild.id)?.channels || {};
  const channelId = channels.seviye || channels.genel;
  const channel = (channelId && member.guild.channels.cache.get(channelId)) || null;
  const rewardText = lines.length ? `\nÖdül: ${lines.join(", ")}` : "";
  const state = progress(saved.xp);
  const ratio = state.need ? state.into / state.need : 0;
  if (channel?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
      .setTitle(`Seviye ${next}`)
      .setDescription(`${member} **${next}.** seviyeye çıktı.\n${bar(ratio)}\n${state.into} / ${state.need} XP\nToplam: **${saved.xp}**${rewardText}`)
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

async function syncGuild(guild) {
  const users = getGuild(guild.id).users || {};
  await guild.members.fetch().catch(() => {});
  for (const [id, user] of Object.entries(users)) {
    const member = guild.members.cache.get(id);
    if (!member || member.user.bot) continue;
    await syncLevelRole(member, progress(user.xp || 0).level).catch((error) => {
      console.error("Seviye rolü güncellenemedi:", error.message);
    });
  }
}

function registerLevels(client) {
  client.once("clientReady", () => {
    for (const guild of client.guilds.cache.values()) {
      syncGuild(guild).catch((error) => console.error(error.message));
    }
  });

  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot || !message.member) return;
    if ((message.content || "").trim().length < 3) return;
    const now = Date.now();
    const user = getGuild(message.guild.id).users?.[message.author.id];
    if (user?.lastMessage && now - user.lastMessage < MESSAGE_COOLDOWN) return;
    const gain = 15 + Math.floor(Math.random() * 11);
    await grant(message.member, gain, { lastMessage: now }).catch((error) => {
      console.error("Mesaj deneyimi yazılamadı:", error.message);
    });
  });

  setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (!state.channelId || !state.member || state.member.user.bot) continue;
        grant(state.member, 8).catch(() => {});
      }
    }
  }, 60_000);
}

module.exports = { registerLevels };
