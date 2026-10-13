const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { getGuild } = require("../store");
const { emit } = require("../agents/bus");
const { sendLog, baseEmbed } = require("../log");
const { mention } = require("../liveChannel");

const bannerPath = path.join(__dirname, "..", "..", "assets", "welcome.gif");
const greetPath = path.join(__dirname, "..", "..", "assets", "karsilama.gif");
const GREET_COLOR = 0xff4655;
const VOICE_GAP = 60_000;
const voiceSeen = new Map();

function bannerFile() {
  if (!fs.existsSync(bannerPath)) {
    throw new Error("Karşılama görseli eksik.");
  }
  return new AttachmentBuilder(bannerPath, { name: "welcome.gif" });
}

function greetFiles() {
  return fs.existsSync(greetPath) ? [new AttachmentBuilder(greetPath, { name: "karsilama.gif" })] : [];
}

function welcomeEmbed(guild, member) {
  const saved = getGuild(guild.id)?.channels || {};
  const rules = mention(guild, saved.kurallar, "kurallar kanalı");
  const stack = mention(guild, saved.yigin, null);
  const help = mention(guild, saved.yardim, null);
  const embed = new EmbedBuilder()
    .setColor(GREET_COLOR)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 128 }) || undefined })
    .setTimestamp();
  if (fs.existsSync(greetPath)) embed.setImage("attachment://karsilama.gif");

  if (member) {
    embed
      .setTitle(`Hoş geldin, ${member.displayName}`)
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .setDescription([
        `${member}, ${guild.name} kapısından içeri girdi.`,
        "Burası yazılım topluluğu. Kod, proje ve birlikte çalışma var.",
        `${rules} kanalındaki butona basınca topluluk kanalları açılır.`,
        stack ? `Dil rolünü ${stack} kanalından al.` : null,
        "Takıldığın yeri /ticket ile aç. Yazılım komutları her kanalda çalışır.",
        `Şu an **${guild.memberCount}** kişiyiz.`,
      ].filter(Boolean).join("\n"));
  } else {
    embed
      .setTitle(guild.name)
      .setDescription([
        "Yazılım konuşulur, proje paylaşılır, birlikte kod yazılır.",
        `${rules} kanalındaki butona bas, Üye rolünü al.`,
        stack ? `Dil rolü için ${stack}.` : null,
        help ? `Soru için ${help} ya da /ticket.` : "Soru için /ticket. `/github`, `/dokuman`, `/calistir` her kanalda çalışır.",
        "Müzik için bir ses kanalına girip `/oynat` yaz. YouTube, Spotify veya SoundCloud linki ya da şarkı adı olur.",
      ].filter(Boolean).join("\n"));
  }

  return embed;
}

function memberWelcome(member) {
  const embed = new EmbedBuilder()
    .setColor(GREET_COLOR)
    .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL({ size: 128 }) || undefined })
    .setTitle(`Hoş geldin, ${member.displayName}`)
    .setThumbnail(member.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${member.guild.memberCount} kişi · Kurallar kanalındaki butona bas` })
    .setTimestamp();
  const files = greetFiles();
  if (files.length) embed.setImage("attachment://karsilama.gif");

  return { embeds: [embed], files };
}

async function handleAccept(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = getGuild(interaction.guildId);
  const roleId = config?.roles?.Üye;
  const role = roleId && interaction.guild.roles.cache.get(roleId);
  if (!role) {
    await interaction.editReply("Üye rolü henüz yok. Sunucu sahibi /kurulum çalıştırmalı.");
    return;
  }
  if (interaction.member.roles.cache.has(role.id)) {
    await interaction.editReply("Zaten üyeysin.");
    return;
  }
  await interaction.member.roles.add(role, "Kurallar kabul edildi");
  await interaction.editReply("Kuralları kabul ettin. Topluluk kanalları açıldı.");
  await sendLog(
    interaction.guild,
    "giris-log",
    baseEmbed(0x2ecc71, "Kural onayı", `${interaction.user} kuralları kabul etti.`),
  );
}

async function postWelcomeCard(guild) {
  const channelId = getGuild(guild.id)?.channels?.["hos-geldin"];
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  const payload = { embeds: [welcomeEmbed(guild)], files: greetFiles() };
  const existingId = getGuild(guild.id)?.welcomeMessageId;
  if (existingId) {
    const existing = await channel.messages.fetch(existingId).catch(() => null);
    if (existing) return existing.edit({ ...payload, attachments: [] });
  }

  const message = await channel.send(payload);
  await message.pin().catch(() => {});
  return message;
}

function personName(member) {
  return member.displayName || member.user?.globalName || member.user?.username || "birisi";
}

async function welcomeChannel(guild) {
  const welcomeId = getGuild(guild.id)?.channels?.["hos-geldin"];
  if (!welcomeId) return null;
  const channel = guild.channels.cache.get(welcomeId)
    || await guild.channels.fetch(welcomeId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

async function announceWelcome(member, left) {
  const welcome = await welcomeChannel(member.guild);
  if (!welcome) return;
  if (left) {
    await welcome.send(`hoşçakal ${personName(member)}`).catch((error) => {
      console.error("Ayrılış yazılamadı:", error.message);
    });
    return;
  }
  await welcome.send({
    content: `hoşgeldin ${personName(member)}`,
    embeds: [welcomeEmbed(member.guild, member)],
    files: greetFiles(),
  }).catch((error) => {
    console.error("Karşılama yazılamadı:", error.message);
  });
}

async function announceVoice(member, channel, joined) {
  const key = `${member.guild.id}:${member.id}:${joined ? "in" : "out"}`;
  const last = voiceSeen.get(key) || 0;
  if (Date.now() - last < VOICE_GAP) return;
  voiceSeen.set(key, Date.now());
  if (voiceSeen.size > 500) {
    for (const [entry, at] of voiceSeen) if (Date.now() - at > VOICE_GAP) voiceSeen.delete(entry);
  }
  const welcome = await welcomeChannel(member.guild);
  if (!welcome) return;
  const embed = new EmbedBuilder()
    .setColor(joined ? 0x2ecc71 : 0x95a5a6)
    .setAuthor({ name: personName(member), iconURL: member.displayAvatarURL({ size: 64 }) })
    .setDescription(joined
      ? `${member}, ${channel} ses kanalına girdi. Hoş geldin!`
      : `${member}, ${channel} ses kanalından çıktı. Görüşürüz!`);
  await welcome.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((error) => {
    console.error("Ses karşılaması yazılamadı:", error.message);
  });
}

function registerWelcome(client) {
  client.on("guildMemberAdd", async (member) => {
    if (member.user?.bot) return;
    if (member.partial) await member.fetch().catch(() => {});
    await announceWelcome(member, false);
    emit("member.joined", {
      guildId: member.guild.id,
      userId: member.id,
      name: personName(member),
    });

    await sendLog(
      member.guild,
      "giris-log",
      baseEmbed(0x2ecc71, "Giriş", `${member} katıldı.\nHesap: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`),
    );
  });

  client.on("voiceStateUpdate", async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;
    if (oldState.channelId === newState.channelId) return;
    if (!oldState.channelId && newState.channel) await announceVoice(member, newState.channel, true);
    else if (oldState.channel && !newState.channelId) await announceVoice(member, oldState.channel, false);
  });

  client.on("guildMemberRemove", async (member) => {
    if (member.user?.bot) return;
    await announceWelcome(member, true);
    emit("member.left", {
      guildId: member.guild.id,
      userId: member.id,
      name: personName(member),
    });

    await sendLog(
      member.guild,
      "giris-log",
      baseEmbed(0xe67e22, "Çıkış", `${member.user?.tag || member.id} ayrıldı.`),
    );
  });
}

module.exports = { handleAccept, registerWelcome, postWelcomeCard, bannerFile, memberWelcome };
