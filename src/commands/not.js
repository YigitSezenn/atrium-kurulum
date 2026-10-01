const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { getGuild, updateGuild } = require("../store");
const { levelOf } = require("../staff");
const { UserError } = require("../errors");

const MAX_TAGS = 40;

function slug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}

function tagsOf(guildId) {
  return getGuild(guildId)?.tags || {};
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("not")
    .setDescription("Sık sorulan cevabı kaydeder ve çağırır.")
    .addSubcommand((sub) => sub
      .setName("kaydet")
      .setDescription("Bir not kaydeder veya günceller.")
      .addStringOption((option) => option.setName("ad").setDescription("Kısa ad, örneğin node").setRequired(true).setMaxLength(32))
      .addStringOption((option) => option.setName("metin").setDescription("Gösterilecek cevap").setRequired(true).setMaxLength(1000)))
    .addSubcommand((sub) => sub
      .setName("goster")
      .setDescription("Kayıtlı notu yazar.")
      .addStringOption((option) => option.setName("ad").setDescription("Notun adı").setRequired(true).setMaxLength(32)))
    .addSubcommand((sub) => sub
      .setName("sil")
      .setDescription("Notu siler. Sahibi veya yetkili silebilir.")
      .addStringOption((option) => option.setName("ad").setDescription("Notun adı").setRequired(true).setMaxLength(32)))
    .addSubcommand((sub) => sub.setName("liste").setDescription("Kayıtlı notların adını listeler.")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const name = slug(interaction.options.getString("ad"));

    if (sub === "liste") {
      const names = Object.keys(tagsOf(interaction.guildId)).sort();
      const description = names.length ? names.map((item) => `\`/not goster ${item}\``).join("\n").slice(0, 4000) : "Henüz not yok. `/not kaydet` ile ekle.";
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("Notlar").setDescription(description)] });
      return;
    }

    if (!name) throw new UserError("Ad harf, rakam ve tire içermeli.");

    if (sub === "kaydet") {
      const text = interaction.options.getString("metin", true).trim();
      if (!text) throw new UserError("Metin boş olamaz.");
      const existing = tagsOf(interaction.guildId);
      if (!existing[name] && Object.keys(existing).length >= MAX_TAGS) {
        throw new UserError(`En fazla ${MAX_TAGS} not durabilir.`);
      }
      await updateGuild(interaction.guildId, (entry) => {
        entry.tags ??= {};
        entry.tags[name] = { text, authorId: interaction.user.id };
      });
      await interaction.reply(`Not kaydedildi: \`${name}\``);
      return;
    }

    const tag = tagsOf(interaction.guildId)[name];
    if (!tag) throw new UserError("Bu adda not yok. `/not liste` ile bak.");

    if (sub === "sil") {
      const own = tag.authorId === interaction.user.id;
      if (!own && levelOf(interaction.member) < 4) throw new UserError("Bu notu yalnız sahibi veya yetkili silebilir.");
      await updateGuild(interaction.guildId, (entry) => {
        if (entry.tags) delete entry.tags[name];
      });
      await interaction.reply(`Not silindi: \`${name}\``);
      return;
    }

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x3498db).setTitle(name).setDescription(String(tag.text).slice(0, 4000))],
    });
  },
};
