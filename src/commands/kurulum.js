const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { buildServer } = require("../setup/structure");
const { suppressAudit } = require("../auditState");
const { UserError } = require("../errors");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kurulum")
    .setDescription("Rolleri ve Kurallar, Duyurular, Karşılama kanallarını kurar.")
    .addBooleanOption((option) => option
      .setName("onay")
      .setDescription("Bu işlemi uygulamak istediğini onayla")
      .setRequired(true))
    .addBooleanOption((option) => option
      .setName("rolleri-sifirla")
      .setDescription("Botun altındaki özel rolleri sil. Varsayılan: hayır")
      .setRequired(false))
    .addBooleanOption((option) => option
      .setName("kanallari-sifirla")
      .setDescription("Kurulum ve /kanal-ayarla ile bağlı olmayan kanalları sil. Varsayılan: hayır")
      .setRequired(false)),

  async execute(interaction) {
    if (interaction.user.id !== interaction.guild.ownerId) {
      throw new UserError("Bu komutu yalnız sunucu sahibi kullanabilir.");
    }
    if (!interaction.options.getBoolean("onay")) {
      throw new UserError("Kurulum için onay seçeneğini evet yap.");
    }

    await interaction.deferReply();
    suppressAudit(5 * 60 * 1000);

    const resetRoles = interaction.options.getBoolean("rolleri-sifirla") ?? false;
    const resetChannels = interaction.options.getBoolean("kanallari-sifirla") ?? false;
    const result = await buildServer(interaction.guild, { resetRoles, resetChannels });

    const skipped = result.skipped.length
      ? `\nSilinemeyen roller (botun üstünde): ${result.skipped.join(", ")}`
      : "";
    const removed = result.removedChannels.length
      ? `\nSilinen kanallar: ${result.removedChannels.length}`
      : "";

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("Kurulum tamam")
      .setDescription([
        "Kurucu rolü sana verildi. Diğer rolleri sunucu ayarlarından dağıt.",
        "Yeni gelenler kurallar kanalındaki butona basınca Üye olur.",
        `Silinen rol: ${result.deleted.length || 0}${skipped}${removed}`,
        "Bot rolü hâlâ senin rollerinin altındaysa onu en üste taşıyıp komutu tekrar çalıştır.",
      ].join("\n"))
      .addFields(
        { name: "Roller", value: "Kurucu, Yönetici, Moderatör, Denetçi, DJ, Üye ve dil rolleri", inline: false },
        { name: "Kanallar", value: "Kurallar, Duyurular ve Karşılama kuruldu. Diğer kanalları kendin aç ve `/kanal-ayarla` ile bağla: Genel, Komutlar (Valorant paneli), Seviye, Ses, Takım A/B, Müzik, Yetkili sohbeti, Ticket bildirimleri.", inline: false },
        { name: "Komutlar", value: "`/github`, `/dokuman`, `/calistir`, `/ticket` ve `/cal` her kanalda çalışır.", inline: false },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
