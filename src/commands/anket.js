const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { updateGuild, getGuild } = require("../store");

const MAX = 5;

function pollId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function optionsFrom(text) {
  return String(text || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, MAX);
}

function tally(poll) {
  const counts = poll.options.map(() => 0);
  for (const choice of Object.values(poll.votes || {})) {
    if (counts[choice] !== undefined) counts[choice] += 1;
  }
  return counts;
}

function pollEmbed(poll) {
  const counts = tally(poll);
  const total = counts.reduce((sum, count) => sum + count, 0) || 1;
  const lines = poll.options.map((label, index) => {
    const count = counts[index];
    const width = Math.round((count / total) * 8);
    const bar = "▰".repeat(width) + "▱".repeat(8 - width);
    return `${bar}  ${label} · ${count}`;
  });
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(poll.question.slice(0, 250))
    .setDescription(lines.join("\n"));
}

function pollRows(id, poll) {
  const row = new ActionRowBuilder();
  poll.options.forEach((label, index) => {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`anket:${id}:${index}`)
      .setLabel(label.slice(0, 80))
      .setStyle(ButtonStyle.Secondary));
  });
  return [row];
}

async function handlePoll(interaction) {
  const [, id, indexRaw] = interaction.customId.split(":");
  const index = Number(indexRaw);
  const poll = getGuild(interaction.guildId)?.polls?.[id];
  if (!poll || !poll.options[index]) {
    await interaction.reply({ content: "Bu anket artık yok.", ephemeral: true });
    return;
  }
  await updateGuild(interaction.guildId, (entry) => {
    const current = entry.polls?.[id];
    if (!current) return;
    current.votes ??= {};
    current.votes[interaction.user.id] = index;
  });
  const next = getGuild(interaction.guildId)?.polls?.[id] || poll;
  await interaction.update({ embeds: [pollEmbed(next)], components: pollRows(id, next) });
}

module.exports = {
  handlePoll,
  data: new SlashCommandBuilder()
    .setName("anket")
    .setDescription("Butonlu bir anket açar.")
    .addStringOption((option) => option.setName("soru").setDescription("Soru").setRequired(true).setMaxLength(200))
    .addStringOption((option) => option.setName("secenekler").setDescription("Seçenekleri | ile ayır. En az iki, en fazla beş.").setRequired(true).setMaxLength(400)),

  async execute(interaction) {
    const question = interaction.options.getString("soru", true).trim();
    const options = optionsFrom(interaction.options.getString("secenekler"));
    if (options.length < 2) {
      await interaction.reply({ content: "En az iki seçenek yaz. Aralarına | koy.", ephemeral: true });
      return;
    }
    const id = pollId();
    const poll = { question, options, votes: {} };
    await updateGuild(interaction.guildId, (entry) => {
      entry.polls ??= {};
      entry.polls[id] = poll;
    });
    await interaction.reply({ embeds: [pollEmbed(poll)], components: pollRows(id, poll) });
  },
};
