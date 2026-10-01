const { EmbedBuilder } = require("discord.js");
const { getGuild, updateGuild } = require("../store");

const STAR = "⭐";
const NEED = 3;

async function fullReaction(reaction) {
  try {
    return reaction.partial ? await reaction.fetch() : reaction;
  } catch {
    return null;
  }
}

async function fullMessage(message) {
  try {
    return message.partial ? await message.fetch() : message;
  } catch {
    return null;
  }
}

function starEmbed(message, count) {
  const text = String(message.content || "").trim();
  const description = text ? text.slice(0, 500) : "Metin yok. Mesajda ek veya gömülü içerik var.";
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: message.author?.username || "Üye", iconURL: message.author?.displayAvatarURL?.() || undefined })
    .setDescription(`${description}\n\n[Mesaja git](${message.url})`)
    .setFooter({ text: `${STAR} ${count} · #${message.channel?.name || "kanal"}` });
}

async function refresh(reaction) {
  const current = await fullReaction(reaction);
  if (!current || current.emoji.name !== STAR) return;
  const message = await fullMessage(current.message);
  if (!message?.guild || message.author?.bot) return;
  const saved = getGuild(message.guild.id);
  const boardId = saved?.channels?.yildiz;
  if (!boardId || message.channelId === boardId) return;
  const count = current.count || 0;
  const board = message.guild.channels.cache.get(boardId)
    || await message.guild.channels.fetch(boardId).catch(() => null);
  if (!board?.isTextBased()) return;
  const posts = saved.starPosts || {};
  const existingId = posts[message.id];

  if (count < NEED) {
    if (!existingId) return;
    const old = await board.messages.fetch(existingId).catch(() => null);
    if (old) await old.delete().catch(() => {});
    await updateGuild(message.guild.id, (entry) => {
      if (entry.starPosts) delete entry.starPosts[message.id];
    });
    return;
  }

  const payload = { embeds: [starEmbed(message, count)] };
  if (existingId) {
    const old = await board.messages.fetch(existingId).catch(() => null);
    if (old) {
      await old.edit(payload).catch(() => {});
      return;
    }
  }
  const sent = await board.send(payload);
  await updateGuild(message.guild.id, (entry) => {
    entry.starPosts ??= {};
    entry.starPosts[message.id] = sent.id;
  });
}

function registerStarboard(client) {
  const run = (reaction) => {
    refresh(reaction).catch((error) => console.error("Yıldız panosu yazılamadı:", error.message));
  };
  client.on("messageReactionAdd", run);
  client.on("messageReactionRemove", run);
}

module.exports = { registerStarboard };
