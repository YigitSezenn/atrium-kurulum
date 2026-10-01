const {
  ActionRowBuilder,
  MessageFlags,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { UserError } = require("../errors");
const { levelOf } = require("../staff");
const { getPlayer } = require("../music/player");
const { guard, fillQueries } = require("../music/fill");
const {
  dropUser,
  listPlaylists,
  loginUrl,
  playlistTracks,
  requireApp,
  searchTracks,
  session,
} = require("../music/spotifyAuth");

function voiceOrThrow(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) throw new UserError("Önce bir ses kanalına gir.");
  return channel;
}

async function queueQueries(interaction, queries) {
  const voice = voiceOrThrow(interaction);
  const player = getPlayer(interaction.guildId);
  const alone = voice.members.filter((entry) => !entry.user.bot).size === 1;
  if (player.channelId && player.channelId !== voice.id && levelOf(interaction.member) < 2 && !alone) {
    throw new UserError("Bot başka bir ses kanalında. Onu taşımak için DJ olmalısın.");
  }
  await player.connect(voice);
  player.textChannel = interaction.channel;
  await fillQueries(player, interaction, queries, interaction.user.id);
}

const spotify = {
  data: new SlashCommandBuilder()
    .setName("spotify")
    .setDescription("Spotify hesabınla liste çal.")
    .addSubcommand((sub) => sub.setName("login").setDescription("Spotify hesabını bağlar."))
    .addSubcommand((sub) => sub.setName("cikis").setDescription("Spotify bağlantısını kaldırır."))
    .addSubcommand((sub) => sub
      .setName("ara")
      .setDescription("Arama sonucunu sıraya koyup sırayla çalar.")
      .addStringOption((option) => option.setName("sorgu").setDescription("Şarkı veya sanatçı").setRequired(true).setMaxLength(100)))
    .addSubcommand((sub) => sub.setName("liste").setDescription("Bir çalma listesini sırayla çalar.")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "cikis") {
      dropUser(interaction.user.id);
      await interaction.reply({ content: "Spotify bağlantısı kalktı.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === "login") {
      requireApp();
      const url = loginUrl(interaction.user.id, interaction);
      await interaction.reply({
        content: `Bu bağlantıyı **bu bilgisayarda** aç ve Spotify'a izin ver:\n${url}\nBağlantı 10 dakika geçerli.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!session(interaction.user.id)) throw new UserError("Önce `/spotify login` yaz.");

    if (sub === "liste") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const playlists = await listPlaylists(interaction.user.id);
      if (!playlists.length) throw new UserError("Senin oluşturduğun çalma listesi yok.");
      const menu = new StringSelectMenuBuilder()
        .setCustomId("spotify:playlist")
        .setPlaceholder("Çalınacak listeyi seç")
        .addOptions(playlists.map((playlist) => ({
          label: playlist.name.slice(0, 100),
          description: `${playlist.total} parça`.slice(0, 100),
          value: playlist.id,
        })));
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x1db954).setTitle("Listeler").setDescription("Bir liste seç. Parçalar sırayla çalar.")],
        components: [new ActionRowBuilder().addComponents(menu)],
      });
      return;
    }

    const player = getPlayer(interaction.guildId);
    voiceOrThrow(interaction);
    await guard(player, async () => {
      await interaction.deferReply();
      await interaction.editReply("Aranıyor. Bitene kadar yeni çalma komutu alınmaz.");
      const tracks = await searchTracks(interaction.user.id, interaction.options.getString("sorgu"));
      if (!tracks.length) throw new UserError("Spotify'da bu aramaya parça çıkmadı.");
      await queueQueries(interaction, tracks.map((track) => track.query));
    });
  },
};

async function handleSpotifyComponent(interaction) {
  if (!session(interaction.user.id)) throw new UserError("Önce `/spotify login` yaz.");
  const playlistId = interaction.values[0];
  if (!playlistId) throw new UserError("Liste seçilemedi.");
  const player = getPlayer(interaction.guildId);
  voiceOrThrow(interaction);
  await guard(player, async () => {
    await interaction.deferReply();
    await interaction.editReply("Liste okunuyor. Bitene kadar yeni çalma komutu alınmaz.");
    const tracks = await playlistTracks(interaction.user.id, playlistId);
    if (!tracks.length) throw new UserError("Bu listede çalınacak parça yok.");
    await queueQueries(interaction, tracks.map((track) => track.query));
  });
}

module.exports = { commands: [spotify], handleSpotifyComponent };
