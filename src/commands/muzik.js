const { EmbedBuilder, SlashCommandBuilder, ChannelType } = require("discord.js");
const { getGuild, updateGuild } = require("../store");
const { levelOf, sameVoice } = require("../staff");
const { UserError } = require("../errors");
const { spotifyQueries } = require("../music/spotify");
const { getPlayer, LIST_CAP } = require("../music/player");
const { guard, fillQueries } = require("../music/fill");

const LIST_MAX = 25;

function splitSongs(text) {
  return String(text || "").split(/\r?\n|\|/).map((part) => part.trim()).filter(Boolean);
}

function savedList(entry) {
  return Array.isArray(entry?.playlist)
    ? entry.playlist.filter((item) => typeof item === "string" && item.trim())
    : [];
}

function listEmbed(lines, title) {
  const description = lines.length ? lines.join("\n").slice(0, 4000) : "Liste boş. `/muzik ekle` ile şarkı yaz.";
  return new EmbedBuilder().setColor(0x9b59b6).setTitle(title).setDescription(description);
}

async function collectQueries(text) {
  const parts = splitSongs(text);
  if (!parts.length) throw new UserError("Şarkı adı yaz.");
  const queries = [];
  for (const part of parts) {
    const spotify = await spotifyQueries(part);
    queries.push(...(spotify?.queries?.length ? spotify.queries : [part]));
    if (queries.length >= LIST_CAP) break;
  }
  return queries.slice(0, LIST_CAP);
}

function voiceOrThrow(interaction) {
  const channel = interaction.member.voice?.channel;
  if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
    throw new UserError("Önce bir ses kanalına gir veya komutta kanal seç.");
  }
  return channel;
}

function chosenVoice(interaction) {
  const picked = interaction.options.getChannel("kanal");
  if (!picked) return voiceOrThrow(interaction);
  if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(picked.type)) {
    throw new UserError("Ses kanalı seç.");
  }
  return picked;
}

function canDj(member) {
  return levelOf(member) >= 2;
}

function soleHuman(member) {
  const channel = member.voice?.channel;
  if (!channel) return false;
  const humans = channel.members.filter((entry) => !entry.user.bot);
  return humans.size === 1 && humans.has(member.id);
}

function canControl(member, player) {
  if (!sameVoice(member, player.channelId) && player.channelId) {
    throw new UserError("Botun olduğu ses kanalında olmalısın.");
  }
  const ownsTrack = player.current?.requesterId === member.id;
  if (canDj(member) || ownsTrack || soleHuman(member)) return;
  throw new UserError("Bu şarkıyı yalnız isteyen kişi, DJ veya yetkili yönetebilir.");
}

function replySkip(interaction, player) {
  const upcoming = player.queue[0]?.title;
  player.skip();
  const content = upcoming ? `Geçildi. Sıradaki: **${upcoming}**` : "Geçildi.";
  return interaction.reply(content);
}

async function handleMusicButton(interaction) {
  const player = getPlayer(interaction.guildId);
  if (interaction.customId === "muzik:stop") {
    if (!player.current && !player.queue.length) throw new UserError("Çalan bir parça yok.");
    if (!canDj(interaction.member) && !soleHuman(interaction.member)) {
      throw new UserError("Sırayı yalnız DJ, yetkili veya kanalda tek başına olan kişi kapatabilir.");
    }
    player.stop();
    await interaction.reply("Müzik kapatıldı.");
    return;
  }
  if (!player.current) throw new UserError("Çalan bir parça yok.");
  canControl(interaction.member, player);
  await replySkip(interaction, player);
}

const skip = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Çalan şarkıyı geçer."),

  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player.current) throw new UserError("Çalan bir parça yok.");
    canControl(interaction.member, player);
    await replySkip(interaction, player);
  },
};

const muzik = {
  data: new SlashCommandBuilder()
    .setName("muzik")
    .setDescription("Sıra, liste, atlama ve ses kontrolü.")
    .addSubcommand((sub) => sub
      .setName("cal")
      .setDescription("Şarkı çalar veya kuyruğa ekler. Sonrakini | ile yaz.")
      .addStringOption((option) => option.setName("sorgu").setDescription("Şarkı adı veya bağlantı. Birden fazlaysa | ile ayır").setRequired(true).setMaxLength(1000))
      .addChannelOption((option) => option.setName("kanal").setDescription("Botun gireceği ses kanalı. Boşsa senin olduğun kanal.").addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
    .addSubcommand((sub) => sub
      .setName("ekle")
      .setDescription("Şarkıyı kalıcı listeye ekler. Sonrakini | ile yaz.")
      .addStringOption((option) => option.setName("sarki").setDescription("Şarkı adı veya bağlantı. Birden fazlaysa | ile ayır").setRequired(true).setMaxLength(1000)))
    .addSubcommand((sub) => sub.setName("liste").setDescription("Kayıtlı şarkı listesini gösterir."))
    .addSubcommand((sub) => sub
      .setName("cikar")
      .setDescription("Kayıtlı listeden bir şarkıyı çıkarır.")
      .addIntegerOption((option) => option.setName("sira").setDescription("Listedeki numara").setRequired(true).setMinValue(1).setMaxValue(LIST_MAX)))
    .addSubcommand((sub) => sub.setName("liste-temizle").setDescription("Kayıtlı şarkı listesini boşaltır."))
    .addSubcommand((sub) => sub
      .setName("liste-cal")
      .setDescription("Kayıtlı listedeki şarkıları sırayla çalar.")
      .addChannelOption((option) => option.setName("kanal").setDescription("Botun gireceği ses kanalı. Boşsa senin olduğun kanal.").addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
    .addSubcommand((sub) => sub.setName("gec").setDescription("Çalan şarkıyı geçer."))
    .addSubcommand((sub) => sub.setName("skip").setDescription("Çalan şarkıyı geçer."))
    .addSubcommand((sub) => sub.setName("durdur").setDescription("Sırayı temizler ve ses kanalından ayrılır."))
    .addSubcommand((sub) => sub.setName("duraklat").setDescription("Çalmayı duraklatır."))
    .addSubcommand((sub) => sub.setName("devam").setDescription("Duraklatılmış şarkıyı sürdürür."))
    .addSubcommand((sub) => sub.setName("kuyruk").setDescription("Şu anki sırayı gösterir."))
    .addSubcommand((sub) => sub
      .setName("ses")
      .setDescription("Ses seviyesini ayarlar.")
      .addIntegerOption((option) => option.setName("seviye").setDescription("1 ile 100").setMinValue(1).setMaxValue(100).setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const player = getPlayer(interaction.guildId);

    if (sub === "liste") {
      const lines = savedList(getGuild(interaction.guildId)).map((item, index) => `${index + 1}. ${item}`);
      await interaction.reply({ embeds: [listEmbed(lines, "Şarkı listesi")] });
      return;
    }

    if (sub === "ekle") {
      const incoming = splitSongs(interaction.options.getString("sarki"));
      if (!incoming.length) throw new UserError("Şarkı adı yaz.");
      let added = [];
      let total = 0;
      await updateGuild(interaction.guildId, (entry) => {
        const current = savedList(entry);
        const room = LIST_MAX - current.length;
        added = incoming.slice(0, Math.max(0, room));
        entry.playlist = [...current, ...added];
        total = entry.playlist.length;
      });
      if (!added.length) throw new UserError(`Liste dolu. En fazla ${LIST_MAX} şarkı.`);
      const lines = [
        ...added.map((item) => `Eklendi: **${item}**`),
        incoming.length > added.length ? `${incoming.length - added.length} şarkı sığmadığı için eklenmedi.` : "",
        `Listede **${total}** şarkı var. Çalmak için \`/muzik liste-cal\`.`,
      ].filter(Boolean);
      await interaction.reply(lines.join("\n"));
      return;
    }

    if (sub === "cikar") {
      const index = interaction.options.getInteger("sira") - 1;
      let removed = null;
      await updateGuild(interaction.guildId, (entry) => {
        const current = savedList(entry);
        if (!current[index]) return;
        removed = current.splice(index, 1)[0];
        entry.playlist = current;
      });
      if (!removed) throw new UserError("Bu numarada şarkı yok. `/muzik liste` ile bak.");
      await interaction.reply(`Listeden çıktı: **${removed}**`);
      return;
    }

    if (sub === "liste-temizle") {
      await updateGuild(interaction.guildId, (entry) => {
        entry.playlist = [];
      });
      await interaction.reply("Şarkı listesi temizlendi.");
      return;
    }

    if (sub === "liste-cal") {
      const list = savedList(getGuild(interaction.guildId));
      if (!list.length) throw new UserError("Liste boş. Önce `/muzik ekle` ile şarkı yaz.");
      await interaction.deferReply();
      const voice = chosenVoice(interaction);
      await guard(player, async () => {
        await interaction.editReply("Liste hazırlanıyor. Bitene kadar yeni çalma komutu alınmaz.");
        if (player.channelId && player.channelId !== voice.id && !canDj(interaction.member) && !soleHuman(interaction.member)) {
          throw new UserError("Bot başka bir ses kanalında. Onu taşımak için DJ olmalısın.");
        }
        await player.connect(voice);
        player.textChannel = interaction.channel;
        const queries = await collectQueries(list.join("\n"));
        await fillQueries(player, interaction, queries, interaction.user.id);
      });
      return;
    }

    if (sub === "kuyruk") {
      const lines = [
        player.current ? `Çalıyor: **${player.current.title}**` : "Çalan parça yok.",
        ...player.queue.slice(0, 10).map((track, index) => `${index + 1}. ${track.title}`),
      ];
      if (player.queue.length > 10) lines.push(`+${player.queue.length - 10} parça daha`);
      if (player.backlog?.length) lines.push(`Çaldıkça yüklenecek: ${player.backlog.length} parça`);
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle("Sıra").setDescription(lines.join("\n"))] });
      return;
    }

    if (sub === "cal") {
      await interaction.deferReply();
      const voice = chosenVoice(interaction);
      await guard(player, async () => {
        await interaction.editReply("İstek alındı. Arama bitene kadar yeni çalma komutu alınmaz.");
        const queries = await collectQueries(interaction.options.getString("sorgu"));
        if (player.channelId && player.channelId !== voice.id && !canDj(interaction.member) && !soleHuman(interaction.member)) {
          throw new UserError("Bot başka bir ses kanalında. Onu taşımak için DJ olmalısın.");
        }
        await player.connect(voice);
        player.textChannel = interaction.channel;
        await fillQueries(player, interaction, queries, interaction.user.id);
      });
      return;
    }

    if (!player.current && sub !== "durdur") throw new UserError("Çalan bir parça yok.");
    canControl(interaction.member, player);

    if (sub === "gec" || sub === "skip") {
      await replySkip(interaction, player);
      return;
    }
    if (sub === "duraklat") {
      player.pause();
      await interaction.reply("Duraklatıldı.");
      return;
    }
    if (sub === "devam") {
      player.resume();
      await interaction.reply("Devam ediyor.");
      return;
    }
    if (sub === "ses") {
      if (!canDj(interaction.member)) throw new UserError("Sesi DJ veya yetkili ayarlar.");
      const level = interaction.options.getInteger("seviye") / 100;
      player.setVolume(level);
      await interaction.reply(`Ses %${interaction.options.getInteger("seviye")} oldu.`);
      return;
    }
    if (sub === "durdur") {
      if (!canDj(interaction.member) && !soleHuman(interaction.member)) {
        throw new UserError("Sırayı yalnız DJ, yetkili veya kanalda tek başına olan kişi kapatabilir.");
      }
      player.stop();
      await interaction.reply("Müzik kapatıldı.");
    }
  },
};

module.exports = { commands: [muzik, skip], handleMusicButton };
