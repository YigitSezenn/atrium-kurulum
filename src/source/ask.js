const { SlashCommandBuilder } = require("discord.js");
const { UserError } = require("../errors");
const { askQuestion } = require("../agents/chat");

const sor = {
  data: new SlashCommandBuilder()
    .setName("sor")
    .setDescription("Sorunu yapay zekaya yollar ve yanıtı özelden gönderir.")
    .addStringOption((option) => option
      .setName("soru")
      .setDescription("Sormak istediğin şey")
      .setRequired(true)
      .setMaxLength(1500)),

  async execute(interaction) {
    const question = interaction.options.getString("soru");
    await interaction.deferReply({ ephemeral: true });
    const answer = await askQuestion(question);
    if (!answer) throw new UserError("Şu an yanıt alamadım. Biraz sonra aynı soruyu tekrar dene.");
    const body = answer.slice(0, 1900);
    try {
      await interaction.user.send(body);
    } catch {
      await interaction.editReply("Özelden yollayamadım. Sunucu üyelerinden mesaj almaya izin ver, sonra tekrar dene.");
      return;
    }
    await interaction.editReply("Yanıtı özelden yolladım.");
  },
};

module.exports = { command: sor };
