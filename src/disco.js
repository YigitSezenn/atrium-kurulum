const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { getGuild, updateGuild } = require("./store");

const discoPath = path.join(__dirname, "..", "assets", "disko.gif");

function discoFile() {
  if (!fs.existsSync(discoPath)) throw new Error("Disko görseli eksik.");
  return new AttachmentBuilder(discoPath, { name: "disko.gif" });
}

function discoEmbed(guild) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(guild.name)
    .setDescription("Disko topu dönüyor.")
    .setImage("attachment://disko.gif");
}

async function openDisco(channel) {
  const payload = { embeds: [discoEmbed(channel.guild)], files: [discoFile()] };
  const saved = getGuild(channel.guild.id)?.disco;
  if (saved?.channelId === channel.id && saved.messageId) {
    const existing = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (existing) return existing.edit(payload);
  }
  if (saved?.channelId && saved.messageId && saved.channelId !== channel.id) {
    const previous = channel.guild.channels.cache.get(saved.channelId)
      || await channel.guild.channels.fetch(saved.channelId).catch(() => null);
    const oldMessage = previous && await previous.messages.fetch(saved.messageId).catch(() => null);
    if (oldMessage) await oldMessage.delete().catch(() => {});
  }
  const message = await channel.send(payload);
  await updateGuild(channel.guild.id, (entry) => {
    entry.disco = { channelId: channel.id, messageId: message.id };
  });
  return message;
}

async function closeDisco(guild) {
  const saved = getGuild(guild.id)?.disco;
  if (!saved?.channelId || !saved.messageId) return;
  const channel = guild.channels.cache.get(saved.channelId)
    || await guild.channels.fetch(saved.channelId).catch(() => null);
  const message = channel && await channel.messages.fetch(saved.messageId).catch(() => null);
  if (message) await message.delete().catch(() => {});
  await updateGuild(guild.id, (entry) => {
    entry.disco = null;
  });
}

module.exports = { openDisco, closeDisco };
