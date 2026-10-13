const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { updateGuild } = require("../store");
const { levelOf } = require("../staff");
const { UserError } = require("../errors");
const { automodEnabled } = require("../events/automod");

const RULES = [
  "7 saniyede 6 mesaj (flood)",
  "Aynı mesajı bir dakikada 4 kez yazmak",
  "Bir mesajda 6 veya daha fazla etiket",
  "Büyük harfle bağırma (25+ harf, %75 büyük)",
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("otomod")
    .setDescription("Otomatik moderasyonu yönetir.")
    .addSubcommand((sub) => sub.setName("durum").setDescription("Otomatik moderasyonun durumunu ve kurallarını gösterir."))
    .addSubcommand((sub) => sub.setName("ac").setDescription("Otomatik moderasyonu açar."))
    .addSubcommand((sub) => sub.setName("kapat").setDescription("Otomatik moderasyonu kapatır.")),

  async execute(interaction) {
    if (levelOf(interaction.member) < 5) throw new UserError("Bunu Yönetici veya Kurucu ayarlar.");
    const sub = interaction.options.getSubcommand();
    if (sub === "ac" || sub === "kapat") {
      await updateGuild(interaction.guildId, (entry) => {
        entry.automod = { ...(entry.automod || {}), enabled: sub === "ac" };
      });
    }
    const on = automodEnabled(interaction.guildId);
    const lines = [
      `Otomatik moderasyon **${on ? "açık" : "kapalı"}**.`,
      "",
      ...RULES.map((rule) => `• ${rule}`),
      "",
      "İlk ihlalde mesaj silinir ve uyarılır. Bir saat içinde ikincisinde 5 dakika, üçüncüsünde 30 dakika susturulur.",
      "Denetçi ve üstü yetkililer etkilenmez.",
    ];
    await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
  },
};
