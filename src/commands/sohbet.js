const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { LEVEL } = require("../constants");
const { UserError } = require("../errors");
const { levelOf } = require("../staff");
const { updateGuild } = require("../store");
const { chatKeyNote } = require("../agents/chat");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sohbet")
    .setDescription("Botların kendi aralarındaki konuşmasını açar veya kapatır.")
    .addSubcommand((sub) => sub.setName("ac").setDescription("Botlar genel sohbette yine kendi aralarında konuşur."))
    .addSubcommand((sub) => sub.setName("kapat").setDescription("Botların kendi aralarındaki konuşmasını keser.")),

  async execute(interaction) {
    if (levelOf(interaction.member) < LEVEL.Kurucu) {
      throw new UserError("Bunu yalnız kurucu ayarlar.");
    }
    const enabled = interaction.options.getSubcommand() === "ac";
    await updateGuild(interaction.guildId, (entry) => {
      entry.chatEnabled = enabled;
    });
    const extra = chatKeyNote();
    const text = enabled
      ? `Botlar yine kendi aralarında konuşur.${extra} Birini etiketleyince de cevap verirler.`
      : "Botların kendi aralarındaki konuşması kapalı. Birini etiketlersen yine cevap verir.";
    await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
  },
};
