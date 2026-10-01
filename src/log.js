const { EmbedBuilder } = require("discord.js");
const { getGuild } = require("./store");
const { isAuditSuppressed } = require("./auditState");

async function sendLog(guild, channelKey, embed) {
  if (isAuditSuppressed()) return;
  const channelId = getGuild(guild.id)?.channels?.[channelKey];
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch((error) => {
    console.error("Kayıt kanalına yazılamadı:", error.message);
  });
}

function baseEmbed(color, title, description) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}

module.exports = { sendLog, baseEmbed };
