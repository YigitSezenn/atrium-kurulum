const { EmbedBuilder, SlashCommandBuilder, ChannelType } = require("discord.js");
const { getGuild, updateGuild } = require("../store");
const { levelOf, sameVoice } = require("../staff");
const { UserError } = require("../errors");
const { playlistId, playlistVideos } = require("../music/invidious");
const { spotifyQueries } = require("../music/spotify");
const { getPlayer, LIST_CAP } = require("../music/player");
const { playingCard } = require("../music/card");
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
  const description = lines.length ? lines.join("\n").slice(0, 4000) : "Liste boş. Şarkı eklemek için `/muzik ekle` yaz.";
  return new EmbedBuilder().setColor(0x9b59b6).setTitle(title).setDescription(description);
}

function songOption(option) {
  return option
    .setName("sarki")
    .setDescription("Link yapıştır ya da şarkı yaz. YouTube, Spotify, SoundCloud. Çoklu için |")
    .setRequired(true)
    .setMaxLength(1000);
}

function voiceOption(option) {
  return option
    .setName("kanal")
    .setDescription("Boş bırakırsan bulunduğun ses kanalına girerim.")
    .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice);
}

async function collectQueries(text) {
  const parts = splitSongs(text);
  if (!parts.length) throw new UserError("Ne çalacağını yaz. Şarkı adı ya da link olur.");
  const queries = [];
  for (const part of parts) {
    if (playlistId(part)) {
      queries.push(...(await playlistVideos(part, LIST_CAP - queries.length)).map((text) => ({ text })));
    } else {
      const spotify = await spotifyQueries(part);
      if (spotify?.queries?.length) {
        for (let index = 0; index < spotify.queries.length && queries.length < LIST_CAP; index += 1) {
          const meta = spotify.meta?.[index] || {};
          queries.push({
            text: spotify.queries[index],
            service: "spotify",
            title: meta.title || "",
            artist: meta.artist || "",
            link: meta.link || "",
            image: meta.image || "",
          });
        }
      } else {
        queries.push({ text: part });
      }
    }
    if (queries.length >= LIST_CAP) break;
  }
  return queries.slice(0, LIST_CAP);
}

function voiceOrThrow(interaction) {
  const channel = interaction.member.voice?.channel;
  if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
    throw new UserError("Önce bir ses kanalına gir. İstersen komutta kanal da seçebilirsin.");
  }
  return channel;
}

function chosenVoice(interaction) {
  const picked = interaction.options.getChannel("kanal");
  if (!picked) return voiceOrThrow(interaction);
  if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(picked.type)) {
    throw new UserError("Seçtiğin kanal bir ses kanalı değil.");
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
    throw new UserError("Bunu yapmak için botla aynı ses kanalında olmalısın.");
  }
  const ownsTrack = player.current?.requesterId === member.id;
  if (canDj(member) || ownsTrack || soleHuman(member)) return;
  throw new UserError("Bu şarkıyı sadece onu açan kişi, DJ ya da yetkili geçebilir.");
}

function replySkip(interaction, player) {
  const upcoming = player.queue[0]?.title;
  player.skip();
  const content = upcoming ? `Geçildi. Sıradaki: **${upcoming}**` : "Geçildi. Sırada başka şarkı yok.";
  return interaction.reply(content);
}

async function handleMusicButton(interaction) {
  const player = getPlayer(interaction.guildId);
  if (interaction.customId === "muzik:stop") {
    if (!player.current && !player.queue.length) throw new UserError("Şu an çalan bir şarkı yok.");
    if (!sameVoice(interaction.member, player.channelId)) {
      throw new UserError("Bunu yapmak için botla aynı ses kanalında olmalısın.");
    }
    if (!canDj(interaction.member) && !soleHuman(interaction.member)) {
      throw new UserError("Müziği kapatmak için DJ olman, yetkili olman ya da kanalda tek başına olman gerekir.");
    }
    player.stop();
    await interaction.reply("Müziği kapattım ve ses kanalından çıktım.");
    return;
  }
  if (!player.current) throw new UserError("Şu an çalan bir şarkı yok.");
  canControl(interaction.member, player);
  await replySkip(interaction, player);
}

const skip = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Çalan şarkıyı geçer."),

  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player.current) throw new UserError("Şu an çalan bir şarkı yok.");
    canControl(interaction.member, player);
    await replySkip(interaction, player);
  },
};

const cal = {
  data: new SlashCommandBuilder()
    .setName("cal")
    .setDescription("YouTube, Spotify veya SoundCloud linkiyle ya da şarkı adıyla çalar.")
    .addStringOption(songOption)
    .addChannelOption(voiceOption),

  async execute(interaction) {
    await playNow(interaction, getPlayer(interaction.guildId));
  },
};

const muzik = {
  data: new SlashCommandBuilder()
    .setName("muzik")
    .setDescription("Sırayı, sesi ve kayıtlı listeyi yönetir. Çalmak için /cal yaz.")
    .addSubcommand((sub) => sub
      .setName("cal")
      .setDescription("Link ya da şarkı adıyla çalar. Kısayol: /cal")
      .addStringOption(songOption)
      .addChannelOption(voiceOption))
    .addSubcommand((sub) => sub
      .setName("ekle")
      .setDescription("Şarkıyı kayıtlı listeye ekler. Çalmaz, sadece saklar.")
      .addStringOption((option) => option.setName("sarki").setDescription("Link ya da şarkı adı. YouTube, Spotify, SoundCloud. Çoklu için |").setRequired(true).setMaxLength(1000)))
    .addSubcommand((sub) => sub.setName("liste").setDescription("Kayıtlı şarkı listesini gösterir."))
    .addSubcommand((sub) => sub
      .setName("cikar")
      .setDescription("Kayıtlı listeden bir şarkıyı çıkarır.")
      .addIntegerOption((option) => option.setName("sira").setDescription("Listedeki numara").setRequired(true).setMinValue(1).setMaxValue(LIST_MAX)))
    .addSubcommand((sub) => sub.setName("liste-temizle").setDescription("Kayıtlı şarkı listesini boşaltır."))
    .addSubcommand((sub) => sub
      .setName("liste-cal")
      .setDescription("Kayıtlı listedeki şarkıları sırayla çalar.")
      .addChannelOption(voiceOption))
    .addSubcommand((sub) => sub.setName("gec").setDescription("Çalan şarkıyı geçer."))
    .addSubcommand((sub) => sub.setName("skip").setDescription("Çalan şarkıyı geçer."))
    .addSubcommand((sub) => sub.setName("durdur").setDescription("Sırayı temizler ve ses kanalından ayrılır."))
    .addSubcommand((sub) => sub.setName("duraklat").setDescription("Çalmayı duraklatır."))
    .addSubcommand((sub) => sub.setName("devam").setDescription("Duraklatılmış şarkıyı sürdürür."))
    .addSubcommand((sub) => sub.setName("dongu").setDescription("Çalan şarkıyı bitince başa sarar. Tekrar yazınca kapanır."))
    .addSubcommand((sub) => sub.setName("basa").setDescription("Çalan şarkıyı hemen başa sarar."))
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
      if (!incoming.length) throw new UserError("Ne ekleyeceğini yaz. Şarkı adı ya da link olur.");
      let added = [];
      let total = 0;
      await updateGuild(interaction.guildId, (entry) => {
        const current = savedList(entry);
        const room = LIST_MAX - current.length;
        added = incoming.slice(0, Math.max(0, room));
        entry.playlist = [...current, ...added];
        total = entry.playlist.length;
      });
      if (!added.length) throw new UserError(`Liste dolu. En fazla ${LIST_MAX} şarkı ekleyebilirsin.`);
      const lines = [
        ...added.map((item) => `**${item}** listeye eklendi.`),
        incoming.length > added.length ? `${incoming.length - added.length} şarkı sığmadı, onlar eklenmedi.` : "",
        `Listede **${total}** şarkı var. Çalmak için \`/muzik liste-cal\` yaz.`,
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
      await interaction.reply(`**${removed}** listeden çıktı.`);
      return;
    }

    if (sub === "liste-temizle") {
      await updateGuild(interaction.guildId, (entry) => {
        entry.playlist = [];
      });
      await interaction.reply("Kayıtlı liste temizlendi.");
      return;
    }

    if (sub === "liste-cal") {
      const list = savedList(getGuild(interaction.guildId));
      if (!list.length) throw new UserError("Liste boş. Önce `/muzik ekle` ile şarkı yaz.");
      await interaction.deferReply();
      const voice = chosenVoice(interaction);
      await guard(player, async () => {
        await interaction.editReply("Listedeki şarkılar hazırlanıyor…");
        if (player.channelId && player.channelId !== voice.id && !canDj(interaction.member)) {
          throw new UserError("Bot şu an başka bir ses kanalında. Taşımak için DJ olman gerekir.");
        }
        await player.connect(voice);
        player.textChannel = interaction.channel;
        const queries = await collectQueries(list.join("\n"));
        await fillQueries(player, interaction, queries, interaction.user.id);
      });
      return;
    }

    if (sub === "kuyruk") {
      const waiting = player.queue.slice(0, 10).map((track, index) => `${index + 1}. ${track.title}`);
      if (player.queue.length > 10) waiting.push(`ve ${player.queue.length - 10} şarkı daha`);
      if (player.backlog?.length) waiting.push(`${player.backlog.length} şarkı çaldıkça eklenecek`);
      if (player.repeat && player.current) waiting.unshift("Döngü açık. Bu şarkı bitince başa sarar.");
      if (!player.current) {
        await interaction.reply(waiting.length
          ? { embeds: [listEmbed(waiting, "Sıra")] }
          : "Şu an çalan bir şarkı yok. Başlatmak için `/cal` yaz. Link ya da şarkı adı olur.");
        return;
      }
      await interaction.reply(playingCard(player.current, player, { note: waiting.join("\n") }));
      return;
    }

    if (sub === "cal") {
      await playNow(interaction, player);
      return;
    }

    if (!player.current && sub !== "durdur") throw new UserError("Şu an çalan bir şarkı yok.");
    canControl(interaction.member, player);

    if (sub === "gec" || sub === "skip") {
      await replySkip(interaction, player);
      return;
    }
    if (sub === "duraklat") {
      await interaction.reply(player.pause() ? "Duraklatıldı. Devam etmek için `/muzik devam` yaz." : "Şu an duraklatılacak bir şarkı yok.");
      return;
    }
    if (sub === "devam") {
      await interaction.reply(player.resume() ? "Şarkı devam ediyor." : "Şarkı zaten çalıyor.");
      return;
    }
    if (sub === "dongu") {
      const on = player.toggleRepeat();
      await interaction.reply(on ? "Döngü açık. Bu şarkı bitince yeniden başlar." : "Döngü kapalı.");
      return;
    }
    if (sub === "basa") {
      player.restart();
      await interaction.reply("Şarkı başa sarıldı.");
      return;
    }
    if (sub === "ses") {
      if (!canDj(interaction.member)) throw new UserError("Sesi değiştirmek için DJ ya da yetkili olman gerekir.");
      const percent = interaction.options.getInteger("seviye");
      player.setVolume(percent / 100);
      await interaction.reply(`Ses seviyesi %${percent}.`);
      return;
    }
    if (sub === "durdur") {
      if (!canDj(interaction.member) && !soleHuman(interaction.member)) {
        throw new UserError("Müziği kapatmak için DJ olman, yetkili olman ya da kanalda tek başına olman gerekir.");
      }
      player.stop();
      await interaction.reply("Müziği kapattım ve ses kanalından çıktım.");
    }
  },
};

async function playNow(interaction, player) {
  await interaction.deferReply();
  const voice = chosenVoice(interaction);
  await guard(player, async () => {
    await interaction.editReply("Şarkı aranıyor…");
    const queries = await collectQueries(interaction.options.getString("sarki"));
    if (player.channelId && player.channelId !== voice.id && !canDj(interaction.member)) {
      throw new UserError("Bot şu an başka bir ses kanalında. Taşımak için DJ olman gerekir.");
    }
    await player.connect(voice);
    player.textChannel = interaction.channel;
    await fillQueries(player, interaction, queries, interaction.user.id);
  });
}

module.exports = { commands: [cal, muzik, skip], handleMusicButton };
