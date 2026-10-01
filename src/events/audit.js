const { AuditLogEvent } = require("discord.js");
const { levelOf } = require("../staff");
const { sendLog, baseEmbed } = require("../log");

const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;

async function recentEntry(guild, type, predicate) {
  const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
  if (!logs) return null;
  return logs.entries.find((entry) => Date.now() - entry.createdTimestamp < 10_000 && predicate(entry)) || null;
}

function registerAudit(client) {
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    if (!INVITE.test(message.content || "")) return;
    if (levelOf(message.member) >= 4) return;
    await message.delete().catch(() => {});
    await sendLog(
      message.guild,
      "denetim-log",
      baseEmbed(0xe74c3c, "Davet bağlantısı silindi", `${message.author} ${message.channel} kanalına davet yapıştırdı.`),
    );
  });

  client.on("messageDelete", async (message) => {
    if (!message.guild || message.author?.bot) return;
    const bulk = await recentEntry(
      message.guild,
      AuditLogEvent.MessageBulkDelete,
      (item) => item.target?.id === message.channel.id,
    );
    if (bulk) return;
    const entry = await recentEntry(
      message.guild,
      AuditLogEvent.MessageDelete,
      (item) => item.extra?.channel?.id === message.channel.id && item.target?.id === message.author?.id,
    );
    const who = entry ? `${entry.executor}` : "tespit edilemedi";
    const content = message.content ? message.content.slice(0, 500) : "İçerik önbellekte yok.";
    await sendLog(
      message.guild,
      "denetim-log",
      baseEmbed(0x95a5a6, "Mesaj silindi", `Kanal: ${message.channel}\nYazan: ${message.author || "bilinmiyor"}\nSilen: ${who}\n${content}`),
    );
  });

  client.on("guildBanAdd", async (ban) => {
    const entry = await recentEntry(ban.guild, AuditLogEvent.MemberBanAdd, (item) => item.target?.id === ban.user.id);
    await sendLog(
      ban.guild,
      "denetim-log",
      baseEmbed(0xe74c3c, "Yasak", `${ban.user.tag}\nYetkili: ${entry?.executor || "bilinmiyor"}\nSebep: ${entry?.reason || ban.reason || "yok"}`),
    );
  });

  client.on("guildMemberRemove", async (member) => {
    const entry = await recentEntry(member.guild, AuditLogEvent.MemberKick, (item) => item.target?.id === member.id);
    if (!entry) return;
    await sendLog(
      member.guild,
      "denetim-log",
      baseEmbed(0xe67e22, "Atılma", `${member.user?.tag || member.id}\nYetkili: ${entry.executor}\nSebep: ${entry.reason || "yok"}`),
    );
  });

  client.on("guildMemberUpdate", async (before, after) => {
    if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) {
      const until = after.communicationDisabledUntil;
      const text = until
        ? `${after} susturuldu. Bitiş: <t:${Math.floor(until.getTime() / 1000)}:R>`
        : `${after} susturması kalktı.`;
      await sendLog(after.guild, "denetim-log", baseEmbed(0xf1c40f, "Susturma", text));
    }

    const added = after.roles.cache.filter((role) => !before.roles.cache.has(role.id));
    const removed = before.roles.cache.filter((role) => !after.roles.cache.has(role.id));
    if (!added.size && !removed.size) return;
    const lines = [
      ...added.map((role) => `+ ${role.name}`),
      ...removed.map((role) => `- ${role.name}`),
    ];
    await sendLog(after.guild, "denetim-log", baseEmbed(0x3498db, "Rol değişikliği", `${after}\n${lines.join("\n")}`));
  });

  client.on("channelCreate", (channel) => {
    if (!channel.guild) return;
    return sendLog(channel.guild, "denetim-log", baseEmbed(0x3498db, "Kanal açıldı", `${channel.name}`));
  });

  client.on("channelDelete", (channel) => {
    if (!channel.guild) return;
    return sendLog(channel.guild, "denetim-log", baseEmbed(0x95a5a6, "Kanal silindi", channel.name || channel.id));
  });
}

module.exports = { registerAudit };
