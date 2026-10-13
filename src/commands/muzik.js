const { EmbedBuilder, SlashCommandBuilder, ChannelType } = require("discord.js");
const { levelOf, sameVoice } = require("../staff");
const { UserError } = require("../errors");
const { playlistId, playlistVideos } = require("../music/invidious");
const { spotifyQueries } = require("../music/spotify");
const { getPlayer, LIST_CAP } = require("../music/player");
const { playingCard } = require("../music/card");
const { guard, fillQueries } = require("../music/fill");
const { lyricsFor } = require("../music/lyrics");

function splitSongs(text) {
  return String(text || "").split(/\r?\n|\|/).map((part) => part.trim()).filter(Boolean);
}

function listEmbed(lines, title) {
  const description = lines.length ? lines.join("\n").slice(0, 4000) : "Sıra boş. Başlatmak için `/oynat` yaz.";
  return new EmbedBuilder().setColor(0x9b59b6).setTitle(title).setDescription(description);
}

function songOption(option) {
  return option
    .setName("sarki")
    .setDescription("YouTube, Spotify veya SoundCloud linki, ya da şarkı adı. Çoklu için |")
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
      queries.push(...(await playlistVideos(part, LIST_CAP - queries.length)).map((item) => ({ text: item })));
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

function sameRoom(member, player) {
  if (!sameVoice(member, player.channelId) && player.channelId) {
    throw new UserError("Bunu yapmak için botla aynı ses kanalında olmalısın.");
  }
}

function canControl(member, player) {
  sameRoom(member, player);
  const ownsTrack = player.current?.requesterId === member.id;
  if (canDj(member) || ownsTrack || soleHuman(member)) return;
  throw new UserError("Bu şarkıyı sadece onu açan kişi, DJ ya da yetkili geçebilir.");
}

function canStop(member, player) {
  sameRoom(member, player);
  if (canDj(member) || soleHuman(member)) return;
  throw new UserError("Müziği kapatmak için DJ olman, yetkili olman ya da kanalda tek başına olman gerekir.");
}

function requirePlaying(member, player) {
  if (!player.current) throw new UserError("Şu an çalan bir şarkı yok.");
  canControl(member, player);
}

function replySkip(interaction, player) {
  const upcoming = player.queue[0]?.title;
  player.skip();
  const content = upcoming ? `Atlandı. Sıradaki: **${upcoming}**` : "Atlandı. Sırada başka şarkı yok.";
  return interaction.reply(content);
}

async function handleMusicButton(interaction) {
  const player = getPlayer(interaction.guildId);
  if (interaction.customId === "muzik:stop") {
    if (!player.current && !player.queue.length) throw new UserError("Şu an çalan bir şarkı yok.");
    canStop(interaction.member, player);
    player.stop();
    await interaction.reply("Şarkıyı kapattım ve odadan ayrıldım.");
    return;
  }
  requirePlaying(interaction.member, player);
  await replySkip(interaction, player);
}

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

function queueLines(player) {
  const waiting = player.queue.slice(0, 10).map((track, index) => `${index + 1}. ${track.title}`);
  if (player.queue.length > 10) waiting.push(`ve ${player.queue.length - 10} şarkı daha`);
  if (player.backlog?.length) waiting.push(`${player.backlog.length} şarkı çaldıkça eklenecek`);
  if (player.repeat && player.current) waiting.unshift("Tekrar açık. Bu şarkı bitince başa sarar.");
  if (player.filter && player.filter !== "kapat") waiting.unshift(`Filtre: ${player.filter}`);
  return waiting;
}

const oynat = {
  data: new SlashCommandBuilder()
    .setName("oynat")
    .setDescription("Bir şarkıyı oynatır.")
    .addStringOption(songOption)
    .addChannelOption(voiceOption),
  async execute(interaction) {
    await playNow(interaction, getPlayer(interaction.guildId));
  },
};

const kapat = {
  data: new SlashCommandBuilder().setName("kapat").setDescription("Şarkıyı kapatır ve odadan ayrılır."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player.current && !player.queue.length) throw new UserError("Şu an çalan bir şarkı yok.");
    canStop(interaction.member, player);
    player.stop();
    await interaction.reply("Şarkıyı kapattım ve odadan ayrıldım.");
  },
};

const duraklat = {
  data: new SlashCommandBuilder().setName("duraklat").setDescription("Şarkıyı duraklatır."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    requirePlaying(interaction.member, player);
    await interaction.reply(player.pause() ? "Şarkı duraklatıldı." : "Şu an duraklatılacak bir şarkı yok.");
  },
};

const devam = {
  data: new SlashCommandBuilder().setName("devam").setDescription("Şarkıyı devam ettirir."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player.current) throw new UserError("Şu an çalan bir şarkı yok.");
    canControl(interaction.member, player);
    await interaction.reply(player.resume() ? "Şarkı devam ediyor." : "Şarkı zaten çalıyor.");
  },
};

const atla = {
  data: new SlashCommandBuilder().setName("atla").setDescription("Şarkıyı atlar."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    requirePlaying(interaction.member, player);
    await replySkip(interaction, player);
  },
};

const tekrarla = {
  data: new SlashCommandBuilder().setName("tekrarla").setDescription("Şarkıyı tekrarlar."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    requirePlaying(interaction.member, player);
    const on = player.toggleRepeat();
    await interaction.reply(on ? "Tekrar açık. Bu şarkı bitince yeniden başlar." : "Tekrar kapalı.");
  },
};

const ses = {
  data: new SlashCommandBuilder()
    .setName("ses")
    .setDescription("Şarkının ses seviyesini değiştirir.")
    .addIntegerOption((option) => option.setName("seviye").setDescription("1 ile 100").setMinValue(1).setMaxValue(100).setRequired(true)),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!canDj(interaction.member)) throw new UserError("Sesi değiştirmek için DJ ya da yetkili olman gerekir.");
    sameRoom(interaction.member, player);
    const percent = interaction.options.getInteger("seviye");
    player.setVolume(percent / 100);
    await interaction.reply(`Ses seviyesi %${percent}.`);
  },
};

const sarki = {
  data: new SlashCommandBuilder().setName("sarki").setDescription("Şu anda oynatılan şarkıyı gösterir."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player.current) throw new UserError("Şu an çalan bir şarkı yok. Başlatmak için `/oynat` yaz.");
    await interaction.reply(playingCard(player.current, player));
  },
};

const liste = {
  data: new SlashCommandBuilder().setName("liste").setDescription("Oynatma listesini görüntüler."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    const waiting = queueLines(player);
    if (!player.current) {
      await interaction.reply(waiting.length
        ? { embeds: [listEmbed(waiting, "Sıra")] }
        : "Şu an çalan bir şarkı yok. Başlatmak için `/oynat` yaz.");
      return;
    }
    await interaction.reply(playingCard(player.current, player, { note: waiting.join("\n") }));
  },
};

const karistir = {
  data: new SlashCommandBuilder().setName("karistir").setDescription("Oynatma listesini karıştırır."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    sameRoom(interaction.member, player);
    if (!canDj(interaction.member) && !soleHuman(interaction.member)) {
      throw new UserError("Sırayı karıştırmak için DJ olman ya da kanalda tek başına olman gerekir.");
    }
    const count = player.shuffle();
    if (!count) throw new UserError("Karıştırılacak şarkı yok. Önce `/oynat` ile birkaç şarkı ekle.");
    await interaction.reply(`Sıradaki ${count} şarkının sırası karıştı.`);
  },
};

const sardir = {
  data: new SlashCommandBuilder()
    .setName("sardir")
    .setDescription("Şarkıyı belirtilen saniyeye sarar.")
    .addIntegerOption((option) => option.setName("saniye").setDescription("Kaçıncı saniyeye gidilsin").setRequired(true).setMinValue(0).setMaxValue(3 * 60 * 60)),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    requirePlaying(interaction.member, player);
    const at = player.seek(interaction.options.getInteger("saniye"));
    if (at == null) throw new UserError("Şu an sarılacak bir şarkı yok.");
    const minutes = Math.floor(at / 60);
    const rest = at % 60;
    await interaction.reply(`Şarkı ${minutes}:${String(rest).padStart(2, "0")} konumuna sarıldı.`);
  },
};

const lyrics = {
  data: new SlashCommandBuilder().setName("lyrics").setDescription("Şarkı sözlerini gösterir."),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player.current) throw new UserError("Şu an çalan bir şarkı yok.");
    await interaction.deferReply();
    const text = await lyricsFor(player.current.title, player.current.artist).catch(() => "");
    if (!text) {
      await interaction.editReply("Bu şarkının sözünü bulamadım.");
      return;
    }
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(player.current.title.slice(0, 250)).setDescription(text)],
    });
  },
};

const filtreler = {
  data: new SlashCommandBuilder()
    .setName("filtreler")
    .setDescription("Şarkıya belirtilen filtreleri ekler.")
    .addStringOption((option) => option
      .setName("ad")
      .setDescription("Uygulanacak filtre")
      .setRequired(true)
      .addChoices(
        { name: "Bas", value: "bas" },
        { name: "Nightcore", value: "nightcore" },
        { name: "Yavaş", value: "yavas" },
        { name: "Karaoke", value: "karaoke" },
        { name: "Kapat", value: "kapat" },
      )),
  async execute(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player.current) throw new UserError("Şu an çalan bir şarkı yok.");
    if (!canDj(interaction.member)) throw new UserError("Filtre için DJ ya da yetkili olman gerekir.");
    sameRoom(interaction.member, player);
    const name = interaction.options.getString("ad");
    if (!player.applyFilter(name)) throw new UserError("Bu filtreyi açamadım.");
    await interaction.reply(name === "kapat" ? "Filtreler kapatıldı." : `Filtre uygulandı: **${name}**.`);
  },
};

const commands = [oynat, kapat, duraklat, devam, atla, tekrarla, ses, sarki, liste, karistir, sardir, lyrics, filtreler];

module.exports = { commands, handleMusicButton };
