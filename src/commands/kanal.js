const { ChannelType, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { LEVEL } = require("../constants");
const { getGuild, updateGuild } = require("../store");
const { levelOf } = require("../staff");
const { UserError } = require("../errors");

const KEYS = [
  ["kategori-bilgi", "Bilgi kategorisi"],
  ["kategori-topluluk", "Topluluk kategorisi"],
  ["kategori-yazilim", "Yazılım kategorisi"],
  ["kategori-muzik", "Müzik kategorisi"],
  ["kategori-denetim", "Denetim kategorisi"],
  ["kurallar", "Kurallar"],
  ["duyurular", "Duyurular"],
  ["hos-geldin", "Karşılama"],
  ["genel", "Genel sohbet"],
  ["seviye", "Seviye"],
  ["komutlar", "Komutlar"],
  ["ses", "Ses kanalı"],
  ["yigin", "Yığın / roller"],
  ["yardim", "Yardım"],
  ["projeler", "Projeler"],
  ["muzik", "Müzik sohbeti"],
  ["muzik-ses", "Müzik sesi"],
  ["giris-log", "Giriş kaydı"],
  ["denetim-log", "Denetim kaydı"],
  ["yetkili-sohbet", "Yetkili sohbeti"],
  ["yildiz", "Yıldız panosu"],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kanal-ayarla")
    .setDescription("Bir kanal anahtarını seçtiğin kanala bağlar.")
    .addStringOption((option) => option
      .setName("anahtar")
      .setDescription("Botun kullanacağı kanal")
      .setRequired(true)
      .addChoices(...KEYS.map(([value, name]) => ({ name, value }))))
    .addChannelOption((option) => option
      .setName("kanal")
      .setDescription("Bağlanacak kanal")
      .setRequired(true)
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
        ChannelType.GuildStageVoice,
        ChannelType.GuildCategory,
      )),

  async execute(interaction) {
    if (levelOf(interaction.member) < LEVEL.Kurucu) {
      throw new UserError("Bunu yalnız kurucu ayarlar.");
    }
    const key = interaction.options.getString("anahtar", true);
    if (!KEYS.some(([value]) => value === key)) throw new UserError("Bu anahtar yok.");
    const channel = interaction.options.getChannel("kanal", true);
    await updateGuild(interaction.guildId, (entry) => {
      entry.channels ??= {};
      entry.channels[key] = channel.id;
    });
    const saved = getGuild(interaction.guildId)?.channels?.[key];
    if (saved !== channel.id) throw new UserError("Kanal kaydı yazılamadı.");
    await interaction.reply({
      content: `${key} artık ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
