const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { buildServer } = require("../setup/structure");
const { suppressAudit } = require("../auditState");
const { UserError } = require("../errors");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kurulum")
    .setDescription("Rol, kanal, karşılama ve denetim yapısını kurar.")
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
      .setDescription("Yeni yapı dışındaki kanalları sil. Varsayılan: hayır")
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
        { name: "Yazılım", value: "Dil rolü #yigin kanalından alınır. Soru #yardim, proje #projeler. `/github` ve `/dokuman` yazılım kanallarında çalışır.", inline: false },
        { name: "Müzik", value: "`/muzik cal` komutunu ses kanalındayken müzik kanalında kullan.", inline: false },
        { name: "Denetim", value: "Giriş, silinen mesaj, ban, kick, susturma ve rol değişiklikleri denetim kanalına düşer.", inline: false },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
