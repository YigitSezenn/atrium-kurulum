const { ActionRowBuilder, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require("discord.js");
const { getGuild, updateGuild } = require("./store");
const { emit } = require("./agents/bus");
const { liveId } = require("./liveChannel");

const STACKS = [
  { key: "JavaScript", color: 0xf7df1e, about: "Web ve Node" },
  { key: "TypeScript", color: 0x3178c6, about: "Tipli JavaScript" },
  { key: "Python", color: 0x3776ab, about: "Betik ve veri" },
  { key: "C#", color: 0x68217a, about: ".NET" },
  { key: "Java", color: 0xe76f00, about: "JVM" },
  { key: "Go", color: 0x00add8, about: "Servis ve araç" },
  { key: "Rust", color: 0xce422b, about: "Sistem programlama" },
  { key: "C / C++", color: 0x00599c, about: "Sistem ve performans" },
  { key: "PHP", color: 0x777bb4, about: "Web sunucusu" },
  { key: "SQL", color: 0x336791, about: "Veritabanı" },
  { key: "Frontend", color: 0x61dafb, about: "Arayüz" },
  { key: "Backend", color: 0x68a063, about: "API ve sunucu" },
  { key: "Mobil", color: 0x3ddc84, about: "Telefon uygulaması" },
  { key: "Oyun Geliştirme", color: 0xe74c3c, about: "Oyun ve motor" },
  { key: "DevOps", color: 0x0db7ed, about: "Dağıtım ve altyapı" },
];

const BOARDS = [
  { channel: "yigin", idKey: "stackPanelId", panel: true },
  {
    channel: "yardim",
    idKey: "helpGuideId",
    embed: {
      title: "Yardım",
      color: 0x3498db,
      description: [
        "Sorunu `/ticket` ile aç.",
        "Konu kısa olsun. Açıklamada ne yaptığını, ne beklediğini ve tam hata metnini yaz.",
        "Kodu üç tırnak içine koy.",
        "Başlık açılınca Arcade rollerini, Source doküman bağlantısını yazar.",
      ].join("\n"),
    },
  },
  {
    channel: "projeler",
    idKey: "projectGuideId",
    embed: {
      title: "Projeler",
      color: 0x9b59b6,
      description: [
        "Projeni paylaş: ne işe yaradığı, hangi dil, depo bağlantısı.",
        "Ekran görüntüsü varsa ekle.",
        "Depo kartı için `/github owner/repo` yaz.",
      ].join("\n"),
    },
  },
  {
    channel: "kaynaklar",
    idKey: "resourceGuideId",
    embed: {
      title: "Kaynaklar",
      color: 0x2ecc71,
      description: "Bir bağlantı bırakırken ne işe yaradığını tek cümleyle yaz.",
    },
  },
  {
    channel: "github",
    idKey: "githubGuideId",
    embed: {
      title: "GitHub",
      color: 0x24292f,
      description: "Depo kartı için `/github owner/repo` veya GitHub bağlantısı yaz.",
    },
  },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function channelMention(guild, key, fallback) {
  const id = liveId(guild, getGuild(guild.id)?.channels?.[key]);
  return id ? `<#${id}>` : fallback;
}

function stackPanel(guild) {
  const saved = getGuild(guild.id)?.stackRoles || {};
  const options = STACKS
    .filter((stack) => saved[stack.key])
    .map((stack) => ({
      label: stack.key.slice(0, 100),
      description: stack.about.slice(0, 100),
      value: stack.key.slice(0, 100),
    }));
  const help = channelMention(guild, "yardim", "yardım kanalı");
  const projects = channelMention(guild, "projeler", "projeler kanalı");
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Dil ve alan")
    .setDescription([
      "Çalıştığın dili ve alanı seç. Birden fazla rol alabilirsin.",
      "Hepsini bırakmak için menüyü boşaltıp gönder.",
      `Soru sormak için ${help} kanalında /ticket. Proje paylaşmak için ${projects}.`,
      "Depo kartı: `/github` · Doküman: `/dokuman`",
    ].join("\n"));
  if (!options.length) {
    return { embeds: [embed.setDescription("Dil rolleri henüz yok. Sunucu sahibi `/kurulum` çalıştırmalı.")] };
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("yigin:roller")
    .setPlaceholder("Dil ve alanını seç")
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function boardPayload(guild, board) {
  if (board.panel) return stackPanel(guild);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(board.embed.color)
        .setTitle(board.embed.title)
        .setDescription(board.embed.description),
    ],
  };
}

async function ensureStackRoles(guild) {
  const saved = getGuild(guild.id)?.stackRoles || {};
  const roles = {};
  for (const stack of STACKS) {
    let role = saved[stack.key] ? guild.roles.cache.get(saved[stack.key]) : null;
    if (!role) {
      role = guild.roles.cache.find((item) => item.name === stack.key && !item.managed) || null;
    }
    if (role) {
      await role.edit({
        colors: { primaryColor: stack.color },
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: "Atrium yığın rolü",
      });
    } else {
      role = await guild.roles.create({
        name: stack.key,
        colors: { primaryColor: stack.color },
        hoist: false,
        mentionable: false,
        permissions: [],
        position: 1,
        reason: "Atrium yığın rolü",
      });
      await wait(350);
    }
    roles[stack.key] = role;
  }
  return roles;
}

async function postSoftwareBoards(guild, onlyKeys) {
  const saved = getGuild(guild.id);
  if (!saved?.channels) return;
  for (const board of BOARDS) {
    if (onlyKeys && !onlyKeys.includes(board.channel)) continue;
    const channelId = saved.channels[board.channel];
    if (!channelId) continue;
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const payload = boardPayload(guild, board);
    const existingId = getGuild(guild.id)?.[board.idKey];
    const existing = existingId && await channel.messages.fetch(existingId).catch(() => null);
    const mine = guild.members.me?.id;
    if (existing && existing.author.id === mine) {
      await existing.edit(payload).catch((error) => {
        console.error("Yazılım kartı güncellenemedi:", error.message);
      });
      continue;
    }
    const message = await channel.send(payload);
    await message.pin().catch(() => {});
    await updateGuild(guild.id, (entry) => {
      entry[board.idKey] = message.id;
    });
  }
}

async function handleStackPick(interaction) {
  await interaction.deferUpdate();
  const saved = getGuild(interaction.guildId)?.stackRoles || {};
  const selected = new Set(interaction.values);
  const add = [];
  const remove = [];
  for (const [key, id] of Object.entries(saved)) {
    if (!id) continue;
    const role = interaction.guild.roles.cache.get(id);
    if (!role) continue;
    const has = interaction.member.roles.cache.has(role.id);
    const want = selected.has(key);
    if (want && !has) add.push(role);
    if (!want && has) remove.push(role);
  }
  try {
    if (add.length) await interaction.member.roles.add(add, "Yığın rolü");
    if (remove.length) await interaction.member.roles.remove(remove, "Yığın rolü");
  } catch (error) {
    console.error("Yığın rolü verilemedi:", error.message);
    await interaction.followUp({
      content: "Rol güncellenemedi. Bot rolü dil rollerinin üstünde olmalı.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.message.edit(stackPanel(interaction.guild)).catch(() => {});
  const names = interaction.values.filter((key) => saved[key]);
  emit("stack.changed", {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    roles: names,
  });
  const text = names.length ? `Rollerin: ${names.join(", ")}` : "Dil ve alan rolün kalmadı.";
  await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
}

async function releaseSoftwareBoards(guild) {
  const saved = getGuild(guild.id);
  const me = guild.members.me?.id;
  if (!saved?.channels || !me) return;
  const clear = [];
  for (const board of BOARDS) {
    const channelId = saved.channels[board.channel];
    if (!channelId) continue;
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const messageId = saved[board.idKey];
    const stored = messageId && await channel.messages.fetch(messageId).catch(() => null);
    if (!stored || stored.author.id === me) {
      if (stored) await stored.delete().catch(() => {});
      clear.push(board.idKey);
    }
    const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    for (const message of recent?.values() || []) {
      if (message.author.id === me && message.embeds.length) await message.delete().catch(() => {});
    }
  }
  if (!clear.length) return;
  await updateGuild(guild.id, (entry) => {
    for (const key of clear) entry[key] = null;
  });
}

module.exports = {
  STACKS,
  ensureStackRoles,
  postSoftwareBoards,
  handleStackPick,
  releaseSoftwareBoards,
};
