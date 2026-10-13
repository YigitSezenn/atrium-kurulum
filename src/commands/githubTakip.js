const { ChannelType, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { getGuild } = require("../store");
const { levelOf } = require("../staff");
const { UserError } = require("../errors");
const { liveId } = require("../liveChannel");
const { follow, unfollow, reposOf, MAX_REPOS } = require("../githubFeed");
const { parseRepo } = require("./yazilim");

function repoOrThrow(interaction) {
  const parsed = parseRepo(interaction.options.getString("depo", true));
  if (!parsed) throw new UserError("Depoyu `owner/repo` veya GitHub bağlantısı olarak yaz.");
  return parsed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("github-takip")
    .setDescription("GitHub deposunun yeni commit ve sürümlerini kanala yazar.")
    .addSubcommand((sub) => sub
      .setName("ekle")
      .setDescription("Bir depoyu takibe alır.")
      .addStringOption((option) => option.setName("depo").setDescription("owner/repo veya GitHub bağlantısı").setRequired(true).setMaxLength(200))
      .addChannelOption((option) => option
        .setName("kanal")
        .setDescription("Bildirimlerin düşeceği kanal. Boşsa bulunduğun kanal.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) => sub
      .setName("cikar")
      .setDescription("Depoyu takipten çıkarır.")
      .addStringOption((option) => option.setName("depo").setDescription("owner/repo").setRequired(true).setMaxLength(200)))
    .addSubcommand((sub) => sub.setName("liste").setDescription("Takip edilen depoları listeler.")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "liste") {
      const repos = Object.entries(reposOf(interaction.guildId));
      const content = repos.length
        ? repos.map(([name, entry]) => `• [${name}](<https://github.com/${name}>) → <#${entry.channelId}>`).join("\n")
        : "Takip edilen depo yok. `/github-takip ekle` ile ekle.";
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    if (levelOf(interaction.member) < 4) throw new UserError("Depo takibini Moderatör ve üstü ayarlar.");
    const parsed = repoOrThrow(interaction);

    if (sub === "cikar") {
      const name = await unfollow(interaction.guildId, parsed);
      if (!name) throw new UserError("Bu depo takipte değil.");
      await interaction.reply({ content: `${name} takipten çıktı.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const picked = interaction.options.getChannel("kanal");
    const saved = liveId(interaction.guild, getGuild(interaction.guildId)?.channels?.github);
    const channelId = picked?.id || saved || interaction.channelId;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await follow(interaction.guildId, parsed, channelId).catch((error) => {
      console.error("Depo takibe alınamadı:", error.message);
      throw new UserError("GitHub şu an yanıt vermedi. Biraz sonra tekrar dene.");
    });
    if (result.error) throw new UserError(result.error);
    await interaction.editReply(`${result.name} takipte. Yeni commit ve sürümler <#${channelId}> kanalına düşer. Depolar 10-30 dakikada bir taranır, en fazla ${MAX_REPOS} depo takip edilir.`);
  },
};
