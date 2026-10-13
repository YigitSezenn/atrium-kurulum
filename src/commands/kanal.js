const { ChannelType, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { LEVEL } = require("../constants");
const { getGuild, updateGuild } = require("../store");
const { levelOf } = require("../staff");
const { UserError } = require("../errors");

const KEYS = [
  ["kategori-bilgi", "Bilgi kategorisi"],
  ["kurallar", "Kurallar"],
  ["duyurular", "Duyurular"],
  ["hos-geldin", "Karşılama"],
  ["genel", "Genel sohbet"],
  ["seviye", "Seviye"],
  ["komutlar", "Komutlar"],
  ["ses", "Ses kanalı"],
  ["takim-a", "Valorant Takım A"],
  ["takim-b", "Valorant Takım B"],
  ["yigin", "Yığın / roller"],
  ["yardim", "Yardım"],
  ["projeler", "Projeler"],
  ["muzik", "Müzik sohbeti"],
  ["muzik-ses", "Müzik sesi"],
  ["yetkili-sohbet", "Yetkili sohbeti"],
  ["ticket-bildirim", "Ticket bildirimleri (yoksa yetkili sohbeti)"],
  ["yildiz", "Yıldız panosu"],
];

const PANELS = {
  kurallar: ["rulesMessageId"],
  "hos-geldin": ["welcomeMessageId"],
  komutlar: ["valorantPanelId"],
  yigin: ["stackPanelId"],
  yardim: ["helpGuideId"],
  projeler: ["projectGuideId"],
};

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await updateGuild(interaction.guildId, (entry) => {
      entry.channels ??= {};
      entry.channels[key] = channel.id;
      for (const field of PANELS[key] || []) entry[field] = null;
    });
    const saved = getGuild(interaction.guildId)?.channels?.[key];
    if (saved !== channel.id) throw new UserError("Kanal kaydı yazılamadı.");
    const panel = PANELS[key] && channel.isTextBased()
      ? await require("./moderasyon").restorePanels(interaction.guild, [key])
      : null;
    const note = panel === true ? " Kanalın kartı da yazıldı." : panel === false ? " Kart yazılamadı, botun o kanala yazma izni var mı bak." : "";
    await interaction.editReply(`${key} artık ${channel}.${note}`);
  },
};
