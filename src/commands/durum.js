const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");
const ffmpegPath = require("ffmpeg-static");
const { getGuild } = require("../store");
const { levelOf } = require("../staff");
const { UserError } = require("../errors");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("durum")
    .setDescription("Kurulum, roller ve müzik bağımlılıklarının durumunu gösterir."),

  async execute(interaction) {
    if (levelOf(interaction.member) < 3) {
      throw new UserError("Bu komut denetçi ve üstü içindir.");
    }

    const config = getGuild(interaction.guildId);
    const roles = config?.roles
      ? Object.entries(config.roles).map(([name, id]) => {
        const exists = interaction.guild.roles.cache.has(id);
        return `${exists ? "açık" : "eksik"} ${name}`;
      }).join("\n")
      : "Henüz kurulmadı";

    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`${interaction.guild.name} durum`)
      .addFields(
        { name: "Kurulum", value: config?.setupAt || "yok", inline: true },
        { name: "ffmpeg", value: ffmpegPath ? "hazır" : "yok", inline: true },
        { name: "Uyarı kaydı", value: String(Object.keys(config?.warns || {}).length), inline: true },
        { name: "Roller", value: roles.slice(0, 1000) },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
