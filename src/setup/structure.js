const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  GuildVerificationLevel,
  GuildExplicitContentFilter,
  GuildDefaultMessageNotifications,
  GuildSystemChannelFlags,
} = require("discord.js");
const { ROLE_DEFS, STAFF_KEYS, RULES } = require("../constants");
const { getGuild, updateGuild } = require("../store");
const { bannerFile, postWelcomeCard } = require("../events/welcome");
const { ensureStackRoles, postSoftwareBoards, releaseSoftwareBoards } = require("../stack");
const { agentsEnabled } = require("../agents/mode");
const { busReady, emit } = require("../agents/bus");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETIRED_CHANNELS = ["medya", "oyun", "kod", "oyun-ses", "kod-ses", "kaynaklar", "github", "birlikte-ses"];

const CATEGORIES = [
  {
    key: "kategori-bilgi",
    name: "📜・Bilgi",
    previousNames: ["📜・bilgi"],
    mode: "info",
    channels: [
      { key: "kurallar", name: "📜・Kurallar", previousNames: ["📜・kurallar"], topic: "Sunucu kuralları", readOnly: true },
      { key: "duyurular", name: "📣・Duyurular", previousNames: ["📣・duyurular"], topic: "Duyurular", readOnly: true },
      { key: "hos-geldin", name: "👋・Karsilama", previousNames: ["👋・karsilama"], topic: "Yeni gelenler", readOnly: true },
    ],
  },
  {
    key: "kategori-topluluk",
    name: "💬・Topluluk",
    previousNames: ["💬・topluluk"],
    mode: "members",
    channels: [
      { key: "genel", name: "💬・Genel", previousNames: ["💬・genel"], topic: "Genel sohbet" },
      { key: "seviye", name: "⭐・Seviye", previousNames: ["⭐・seviye"], topic: "Seviye atlamaları ve sıralama", readOnly: true },
      { key: "komutlar", name: "🤖・Komutlar", previousNames: ["🤖・komutlar"], topic: "Bot komutları" },
      { key: "ses", name: "🔊 Ses", voice: true },
    ],
  },
  {
    key: "kategori-yazilim",
    name: "💻・Yazilim",
    previousNames: ["💻・yazilim"],
    mode: "members",
    channels: [
      { key: "yigin", name: "🧩・Yigin", previousNames: ["🧩・yigin"], topic: "Dil ve alan rolünü seç", readOnly: true },
      { key: "yardim", name: "❓・Yardim", previousNames: ["❓・yardim"], topic: "Takıldığın yeri yeni bir başlık olarak aç" },
      { key: "projeler", name: "🚀・Projeler", previousNames: ["🚀・projeler"], topic: "Proje, kaynak ve depo. /github burada da çalışır." },
    ],
  },
  {
    key: "kategori-muzik",
    name: "🎵・Muzik",
    previousNames: ["🎵・muzik"],
    mode: "music",
    channels: [
      { key: "muzik", name: "🎵・Muzik", previousNames: ["🎵・muzik"], topic: "Müzik komutları ve sıra" },
      { key: "muzik-ses", name: "🎵 Müzik", previousNames: ["🎵 Müzik"], voice: true },
    ],
  },
  {
    key: "kategori-denetim",
    name: "🛡️・Denetim",
    previousNames: ["🛡️・denetim"],
    mode: "staff",
    channels: [
      { key: "giris-log", name: "🛡️・Giris-log", previousNames: ["🛡️・giris-log"], topic: "Giriş, çıkış ve kural onayı" },
      { key: "denetim-log", name: "🛡️・Denetim-log", previousNames: ["🛡️・denetim-log"], topic: "Moderasyon ve denetim kaydı" },
      { key: "yetkili-sohbet", name: "🛡️・Yetkili", previousNames: ["🛡️・yetkili-sohbet"], topic: "Yetkili sohbeti" },
    ],
  },
];

function allowSend(extra = []) {
  return [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessagesInThreads,
    ...extra,
  ];
}

function overwritesFor(guild, roles, mode, readOnly = false, channelVoice = false) {
  const everyone = guild.roles.everyone;
  const uye = roles.Üye;
  const staff = STAFF_KEYS.map((key) => roles[key]).filter(Boolean);
  const rows = [];

  if (mode === "info") {
    rows.push({
      id: everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    });
  } else if (mode === "members" || mode === "music") {
    const voice = mode === "music" || channelVoice
      ? [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
      : [];
    rows.push({ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
    if (uye && readOnly) {
      rows.push({
        id: uye.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads],
      });
    } else if (uye) {
      rows.push({ id: uye.id, allow: allowSend(voice) });
    }
  } else if (mode === "staff") {
    rows.push({ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
  }

  for (const role of staff) {
    rows.push({
      id: role.id,
      allow: allowSend([
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ]),
    });
  }

  const botRole = guild.members.me?.roles.highest;
  if (botRole) {
    rows.push({
      id: botRole.id,
      allow: allowSend([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]),
    });
  }

  return rows;
}

function sameName(left, right) {
  return left.toLocaleLowerCase("tr") === right.toLocaleLowerCase("tr");
}

function keepUserName(current, next, previousNames = []) {
  if (!current || current === next) return true;
  return ![next, ...previousNames].some((item) => sameName(item, current));
}

async function findOrCreate(guild, savedId, name, type, options) {
  const { reason, previousNames = [], ...editOptions } = options;
  let existing = savedId ? guild.channels.cache.get(savedId) : null;
  if (!existing && savedId) existing = await guild.channels.fetch(savedId).catch(() => null);
  if (existing && existing.type !== type) existing = null;
  if (!existing) {
    const accepted = [name, ...previousNames];
    existing = guild.channels.cache.find((channel) => (
      channel.type === type && accepted.some((item) => sameName(channel.name, item))
    )) || null;
  }
  if (editOptions.parent) {
    let parent = guild.channels.cache.get(editOptions.parent);
    if (!parent) parent = await guild.channels.fetch(editOptions.parent).catch(() => null);
    const parentIsCategory = parent?.type === ChannelType.GuildCategory;
    if (!parentIsCategory || parent.id === existing?.id) {
      throw new Error(`Kanal kategorisi geçersiz: ${name}`);
    }
  }
  if (existing) {
    if (!keepUserName(existing.name, name, previousNames)) editOptions.name = name;
    await existing.edit(editOptions, reason);
    return existing;
  }
  const createdChannel = await guild.channels.create({ name, type, ...editOptions, reason });
  guild.channels.cache.set(createdChannel.id, createdChannel);
  return createdChannel;
}

async function buildServer(guild, { resetRoles, resetChannels }) {
  const me = await guild.members.fetchMe();
  const deleted = [];
  const skipped = [];

  if (resetRoles) {
    const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
    for (const role of roles) {
      if (role.id === guild.id || role.managed) continue;
      if (role.position >= me.roles.highest.position) {
        skipped.push(role.name);
        continue;
      }
      await role.delete("Atrium rol sıfırlama");
      deleted.push(role.name);
      await wait(350);
    }
    await guild.roles.fetch();
  }

  const created = {};
  for (const def of [...ROLE_DEFS].reverse()) {
    let role = resetRoles
      ? null
      : guild.roles.cache.find((item) => item.name === def.key && !item.managed);
    if (role) {
      await role.edit({
        colors: { primaryColor: def.color },
        hoist: def.hoist,
        mentionable: false,
        permissions: def.permissions,
        reason: "Atrium rol kurulumu",
      });
    } else {
      role = await guild.roles.create({
        name: def.key,
        colors: { primaryColor: def.color },
        hoist: def.hoist,
        mentionable: false,
        permissions: def.permissions,
        reason: "Atrium rol kurulumu",
      });
      await wait(350);
    }
    created[def.key] = role;
  }

  const ordered = ["Üye", "DJ", "Denetçi", "Moderatör", "Yönetici", "Kurucu"];
  const positions = ordered.map((key, index) => ({ role: created[key].id, position: index + 1 }));
  await guild.roles.setPositions(positions).catch(async (error) => {
    console.error("Rol sırası ayarlanamadı:", error.message);
    for (let index = 0; index < ordered.length; index += 1) {
      await created[ordered[index]].setPosition(index + 1).catch(() => {});
      await wait(300);
    }
  });

  const owner = await guild.fetchOwner();
  await owner.roles.add(created.Kurucu, "Atrium kurucu rolü");
  const stackRoles = await ensureStackRoles(guild);

  const previous = getGuild(guild.id) || {};
  const channels = {};
  const categories = {};

  for (const categoryDef of CATEGORIES) {
    const overwrites = overwritesFor(guild, created, categoryDef.mode);
    const category = await findOrCreate(
      guild,
      previous.channels?.[categoryDef.key],
      categoryDef.name,
      ChannelType.GuildCategory,
      {
        permissionOverwrites: overwrites,
        reason: "Atrium kategori kurulumu",
        previousNames: categoryDef.previousNames || [],
      },
    );
    categories[categoryDef.key] = category.id;

    for (const channelDef of categoryDef.channels) {
      const channelOptions = {
        parent: category.id,
        permissionOverwrites: overwritesFor(guild, created, categoryDef.mode, channelDef.readOnly, channelDef.voice),
        reason: "Atrium kanal kurulumu",
        previousNames: channelDef.previousNames || [],
      };
      if (!channelDef.voice) channelOptions.topic = channelDef.topic;
      const channel = await findOrCreate(
        guild,
        previous.channels?.[channelDef.key],
        channelDef.name,
        channelDef.voice ? ChannelType.GuildVoice : ChannelType.GuildText,
        channelOptions,
      );
      channels[channelDef.key] = channel.id;
      await wait(250);
    }
  }

  const removedChannels = [];
  const keptIds = new Set([...Object.values(channels), ...Object.values(categories)]);
  for (const key of RETIRED_CHANNELS) {
    const retiredId = previous.channels?.[key];
    if (!retiredId || keptIds.has(retiredId)) continue;
    const retired = guild.channels.cache.get(retiredId)
      || await guild.channels.fetch(retiredId).catch(() => null);
    if (!retired) continue;
    await retired.delete("Atrium sade kanal listesi").catch(() => {});
    removedChannels.push(retired.name);
    await wait(250);
  }
  if (resetChannels) {
    const keep = new Set([...Object.values(channels), ...Object.values(categories)]);
    const victims = [...guild.channels.cache.values()].sort((a, b) => {
      if (a.type === ChannelType.GuildCategory) return 1;
      if (b.type === ChannelType.GuildCategory) return -1;
      return 0;
    });
    for (const channel of victims) {
      if (keep.has(channel.id)) continue;
      await channel.delete("Atrium kanal sıfırlama").catch(() => {});
      removedChannels.push(channel.name);
      await wait(250);
    }
  }

  const rulesChannel = guild.channels.cache.get(channels.kurallar);
  const rulesMessage = await upsertRules(guild, rulesChannel, previous.rulesMessageId);

  await guild.edit({
    verificationLevel: GuildVerificationLevel.Medium,
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
    defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
    systemChannel: channels["giris-log"],
    systemChannelFlags: GuildSystemChannelFlags.SuppressJoinNotifications,
    reason: "Atrium sunucu ayarları",
  }).catch((error) => {
    console.error("Sunucu ayarları güncellenemedi:", error.message);
  });

  await updateGuild(guild.id, (entry) => {
    entry.roles = Object.fromEntries(Object.entries(created).map(([key, role]) => [key, role.id]));
    entry.stackRoles = Object.fromEntries(Object.entries(stackRoles).map(([key, role]) => [key, role.id]));
    entry.channels = { ...categories, ...channels };
    entry.rulesMessageId = rulesMessage.id;
    entry.setupAt = new Date().toISOString();
    entry.warns ??= {};
  });

  const welcomeMessage = await postWelcomeCard(guild).catch((error) => {
    console.error("Karşılama kartı yazılamadı:", error.message);
    return null;
  });
  const saved = await updateGuild(guild.id, (entry) => {
    if (welcomeMessage) entry.welcomeMessageId = welcomeMessage.id;
  });
  if (agentsEnabled() && busReady()) {
    await releaseSoftwareBoards(guild).catch((error) => {
      console.error("Yazılım kartları ajanlara bırakılamadı:", error.message);
    });
    emit("setup.done", { guildId: guild.id });
  } else {
    await postSoftwareBoards(guild).catch((error) => {
      console.error("Yazılım kartları yazılamadı:", error.message);
    });
  }

  return { deleted, skipped, roles: saved.roles, channels, removedChannels };
}

async function upsertRules(guild, channel, messageId) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() || undefined })
    .setTitle(`${guild.name} kuralları`)
    .setDescription(RULES.join("\n"))
    .setImage("attachment://welcome.gif")
    .setFooter({ text: "Devam etmek için butona bas. Üye rolü topluluk kanallarını açar." });
  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("lua:accept_rules")
        .setLabel("Kuralları kabul ediyorum")
        .setStyle(ButtonStyle.Success),
    ),
  ];
  const payload = { embeds: [embed], components, files: [bannerFile()] };

  if (messageId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing) return existing.edit(payload);
  }

  const message = await channel.send(payload);
  await message.pin().catch(() => {});
  return message;
}

module.exports = { buildServer, upsertRules };
