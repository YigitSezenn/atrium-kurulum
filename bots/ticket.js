const { ChannelType, MessageFlags, SlashCommandBuilder, ThreadAutoArchiveDuration } = require("discord.js");
const { getGuild, updateGuild } = require("../src/store");
const { UserError } = require("../src/errors");

function isHelpChannel(channel) {
  if (!channel || channel.isThread?.()) return false;
  if (typeof channel.threads?.create !== "function") return false;
  const name = channel.name.toLocaleLowerCase("tr");
  return name.includes("yardim") || name.includes("yardım");
}

async function helpChannel(interaction) {
  const guild = interaction.guild;
  const saved = getGuild(guild.id)?.channels?.yardim;
  if (saved) {
    const stored = await guild.channels.fetch(saved).catch(() => null);
    if (isHelpChannel(stored)) return stored;
  }
  await guild.channels.fetch().catch(() => null);
  const found = guild.channels.cache.find((channel) => isHelpChannel(channel));
  if (!found) return null;
  await updateGuild(guild.id, (entry) => {
    entry.channels ??= {};
    entry.channels.yardim = found.id;
  });
  return found;
}

const ticket = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Yardım başlığı açar.")
    .addStringOption((option) => option
      .setName("konu")
      .setDescription("Kısa başlık")
      .setRequired(true)
      .setMaxLength(80))
    .addStringOption((option) => option
      .setName("aciklama")
      .setDescription("Ne yaptın, ne bekliyordun, hata ne")
      .setRequired(true)
      .setMaxLength(1000)),
  async execute(interaction, emit) {
    const konu = interaction.options.getString("konu", true).replace(/\s+/g, " ").trim();
    const aciklama = interaction.options.getString("aciklama", true).trim();
    if (!konu || !aciklama) throw new UserError("Konu ve açıklama gerekli.");
    const parent = await helpChannel(interaction);
    if (!parent) throw new UserError("Yardım kanalını bulamadım.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const thread = await parent.threads.create({
      name: konu.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      type: ChannelType.PublicThread,
      reason: `${interaction.user.tag} ticket`,
    });
    await thread.members.add(interaction.user.id).catch(() => {});
    await thread.send(`<@${interaction.user.id}> Arcade, Source, bu başlığa bir bakın.\n\n${aciklama}`.slice(0, 1900));
    emit("help.opened", {
      guildId: interaction.guildId,
      threadId: thread.id,
      userId: interaction.user.id,
      text: `${konu}\n${aciklama}`.slice(0, 500),
    });
    await interaction.editReply(`Başlık açıldı: ${thread}`);
  },
};

module.exports = { ticket };
