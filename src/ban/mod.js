const crypto = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { getGuild, updateGuild } = require("../store");
const { levelOf } = require("../staff");
const { LEVEL } = require("../constants");
const { UserError } = require("../errors");
const { sendLog, baseEmbed } = require("../log");
const { commandPlace, liveId } = require("../liveChannel");

const pending = new Map();
const MAX_MINUTES = 30 * 24 * 60;

function staffChannelOrThrow(interaction) {
  const channelId = liveId(interaction.guild, getGuild(interaction.guildId)?.channels?.["yetkili-sohbet"]);
  if (channelId && commandPlace(interaction) !== channelId) {
    throw new UserError(`Bunu <#${channelId}> kanalında kullan.`);
  }
}

function requireLevel(interaction, level) {
  staffChannelOrThrow(interaction);
  if (levelOf(interaction.member) < level) throw new UserError("Bu işlem için yetkin yok.");
}

function assertTarget(actor, target) {
  if (!target) throw new UserError("Bu üye sunucuda değil.");
  if (target.id === target.guild.ownerId) throw new UserError("Sunucu sahibine işlem uygulanamaz.");
  if (target.id === actor.id) throw new UserError("Bunu kendine uygulayamazsın.");
  if (target.id === actor.guild.members.me?.id) throw new UserError("Bota işlem uygulanamaz.");
  if (actor.id !== actor.guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    throw new UserError("Seninle aynı veya daha yüksek roldeki birine işlem uygulanamaz.");
  }
  if (target.roles.highest.position >= actor.guild.members.me.roles.highest.position) {
    throw new UserError("Botun rolü hedefin rolünden yukarıda olmalı.");
  }
}

function assertUser(actor, user) {
  if (user.id === actor.id) throw new UserError("Bunu kendine uygulayamazsın.");
  if (user.id === actor.guild.ownerId) throw new UserError("Sunucu sahibine işlem uygulanamaz.");
  if (user.id === actor.guild.members.me?.id) throw new UserError("Bota işlem uygulanamaz.");
}

function parseDuration(raw) {
  const match = String(raw || "").trim().toLocaleLowerCase("tr").match(/^(\d+)\s*(d|dk|s|sa|g|gün|gun)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const minutes = unit.startsWith("g") ? amount * 24 * 60 : (unit === "s" || unit === "sa") ? amount * 60 : amount;
  if (!Number.isInteger(amount) || minutes < 1 || minutes > MAX_MINUTES) return null;
  return minutes;
}

function durationLabel(minutes) {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} gün`;
  if (minutes % 60 === 0) return `${minutes / 60} saat`;
  return `${minutes} dakika`;
}

async function tell(user, text) {
  await user.send(text).catch(() => {});
}

function stage(interaction, job) {
  const id = crypto.randomBytes(4).toString("hex");
  pending.set(id, { ...job, actorId: interaction.user.id, guildId: interaction.guildId });
  setTimeout(() => pending.delete(id), 120000);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ban:yes:${id}`).setLabel("Onayla").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ban:no:${id}`).setLabel("Vazgeç").setStyle(ButtonStyle.Secondary),
  );
  return { content: job.ask, components: [row], flags: MessageFlags.Ephemeral };
}

async function kickMember(guild, actor, member, reason) {
  assertTarget(actor, member);
  await tell(member.user, `${guild.name} sunucusundan atıldın: ${reason}`);
  await member.kick(reason.slice(0, 500));
  return `${member.user.tag} sunucudan atıldı.`;
}

async function banUser(guild, actor, user, reason, days) {
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) assertTarget(actor, member);
  else assertUser(actor, user);
  await tell(user, `${guild.name} sunucusundan yasaklandın: ${reason}`);
  await guild.members.ban(user.id, {
    deleteMessageSeconds: days * 24 * 60 * 60,
    reason: reason.slice(0, 500),
  });
  await updateGuild(guild.id, (entry) => {
    if (entry.tempBans) delete entry.tempBans[user.id];
  });
  return `${user.tag} yasaklandı.`;
}

async function softBan(guild, actor, user, reason, days) {
  const text = await banUser(guild, actor, user, `Yumuşak yasak: ${reason}`, days);
  await guild.members.unban(user.id, "Yumuşak yasak, tekrar girebilir").catch(() => {});
  return `${text} Mesajları silindi, tekrar girebilir.`;
}

async function tempBan(guild, actor, user, reason, days, minutes) {
  const until = Date.now() + minutes * 60 * 1000;
  const label = durationLabel(minutes);
  await banUser(guild, actor, user, `Süreli yasak (${label}): ${reason}`, days);
  await updateGuild(guild.id, (entry) => {
    entry.tempBans ??= {};
    entry.tempBans[user.id] = { until, reason, moderatorId: actor.id };
  });
  return `${user.tag} ${label} yasaklandı. Süre bitince yasağı kalkar.`;
}

async function perform(interaction, job) {
  const guild = interaction.guild;
  const actor = interaction.member;
  requireLevel(interaction, job.level);
  if (job.action === "kick") {
    const member = await guild.members.fetch(job.userId).catch(() => null);
    return kickMember(guild, actor, member, job.reason);
  }
  const user = await interaction.client.users.fetch(job.userId);
  if (job.action === "ban") return banUser(guild, actor, user, job.reason, job.days);
  if (job.action === "soft") return softBan(guild, actor, user, job.reason, job.days);
  if (job.action === "temp") return tempBan(guild, actor, user, job.reason, job.days, job.minutes);
  throw new UserError("Bu işlem tanınmıyor.");
}

async function handleBan(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("ban:")) return false;
  const [, choice, id] = interaction.customId.split(":");
  const job = pending.get(id);
  if (!job || job.actorId !== interaction.user.id || job.guildId !== interaction.guildId) {
    throw new UserError("Bu onayın süresi doldu. Komutu yeniden yaz.");
  }
  pending.delete(id);
  if (choice !== "yes") {
    await interaction.update({ content: "İptal edildi.", components: [] });
    return true;
  }
  await interaction.deferUpdate();
  try {
    const text = await perform(interaction, job);
    await interaction.editReply({ content: text, components: [] });
  } catch (error) {
    if (!(error instanceof UserError)) console.error(error);
    const content = error instanceof UserError ? error.message : "İşlem tamamlanamadı.";
    await interaction.editReply({ content, components: [] }).catch(() => {});
  }
  return true;
}

async function sweep(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const bans = getGuild(guild.id)?.tempBans || {};
    for (const [userId, record] of Object.entries(bans)) {
      if (!record?.until || record.until > now) continue;
      await guild.members.unban(userId, "Süreli yasak bitti").catch(() => {});
      await updateGuild(guild.id, (entry) => {
        if (entry.tempBans) delete entry.tempBans[userId];
      });
      await sendLog(
        guild,
        "denetim-log",
        baseEmbed(0x2ecc71, "Süreli yasak bitti", `<@${userId}> tekrar girebilir.`),
      );
    }
  }
}

function watchBans(client) {
  const run = () => sweep(client).catch((error) => console.error("Süreli yasak bakılamadı:", error.message));
  setTimeout(run, 8000);
  setInterval(run, 60 * 1000);
}

const reasonOption = (option) => option.setName("sebep").setDescription("Sebep").setMaxLength(300);
const daysOption = (option) => option
  .setName("mesaj-sil")
  .setDescription("Kaç günlük mesaj silinsin")
  .setMinValue(0)
  .setMaxValue(7);

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("at")
      .setDescription("Üyeyi sunucudan atar. Tekrar davetle girebilir.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addStringOption(reasonOption),
    async execute(interaction) {
      requireLevel(interaction, LEVEL.Moderatör);
      const member = interaction.options.getMember("uye");
      const reason = interaction.options.getString("sebep") || "Sebep belirtilmedi";
      assertTarget(interaction.member, member);
      await interaction.reply(stage(interaction, {
        action: "kick",
        level: LEVEL.Moderatör,
        userId: member.id,
        reason,
        ask: `${member} sunucudan atılsın mı? Sebep: ${reason}`,
      }));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("yasakla")
      .setDescription("Üyeyi yasaklar. Sunucuda olmasa da olur.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addStringOption(reasonOption)
      .addIntegerOption(daysOption),
    async execute(interaction) {
      requireLevel(interaction, LEVEL.Yönetici);
      const user = interaction.options.getUser("uye", true);
      const member = interaction.options.getMember("uye");
      const reason = interaction.options.getString("sebep") || "Sebep belirtilmedi";
      const days = interaction.options.getInteger("mesaj-sil") ?? 0;
      if (member) assertTarget(interaction.member, member);
      else assertUser(interaction.member, user);
      await interaction.reply(stage(interaction, {
        action: "ban",
        level: LEVEL.Yönetici,
        userId: user.id,
        reason,
        days,
        ask: `${user.tag} yasaklansın mı? Sebep: ${reason}`,
      }));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("gecici-yasak")
      .setDescription("Süresi bitince yasağı kaldırır. En fazla 30 gün.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addStringOption((option) => option
        .setName("sure")
        .setDescription("30d dakika, 12s saat, 2g gün")
        .setRequired(true)
        .setMaxLength(8))
      .addStringOption(reasonOption)
      .addIntegerOption(daysOption),
    async execute(interaction) {
      requireLevel(interaction, LEVEL.Yönetici);
      const user = interaction.options.getUser("uye", true);
      const member = interaction.options.getMember("uye");
      const minutes = parseDuration(interaction.options.getString("sure", true));
      if (!minutes) throw new UserError("Süreyi 30d, 12s veya 2g gibi yaz. En fazla 30 gün.");
      const reason = interaction.options.getString("sebep") || "Sebep belirtilmedi";
      const days = interaction.options.getInteger("mesaj-sil") ?? 0;
      if (member) assertTarget(interaction.member, member);
      else assertUser(interaction.member, user);
      await interaction.reply(stage(interaction, {
        action: "temp",
        level: LEVEL.Yönetici,
        userId: user.id,
        reason,
        days,
        minutes,
        ask: `${user.tag} ${durationLabel(minutes)} yasaklansın mı? Sebep: ${reason}`,
      }));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("yumusak-yasak")
      .setDescription("Mesajları siler ve yasağı hemen kaldırır. Kişi tekrar girebilir.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addStringOption(reasonOption)
      .addIntegerOption((option) => daysOption(option).setDescription("Kaç günlük mesaj silinsin, varsayılan 1")),
    async execute(interaction) {
      requireLevel(interaction, LEVEL.Yönetici);
      const user = interaction.options.getUser("uye", true);
      const member = interaction.options.getMember("uye");
      const reason = interaction.options.getString("sebep") || "Sebep belirtilmedi";
      const days = interaction.options.getInteger("mesaj-sil") ?? 1;
      if (member) assertTarget(interaction.member, member);
      else assertUser(interaction.member, user);
      await interaction.reply(stage(interaction, {
        action: "soft",
        level: LEVEL.Yönetici,
        userId: user.id,
        reason,
        days,
        ask: `${user.tag} için yumuşak yasak uygulansın mı? Son ${days} günün mesajı silinir, tekrar girebilir.`,
      }));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("yasak-kaldir")
      .setDescription("Yasağı kaldırır.")
      .addStringOption((option) => option.setName("kullanici-id").setDescription("Kullanıcı kimliği").setRequired(true))
      .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setMaxLength(300)),
    async execute(interaction) {
      requireLevel(interaction, LEVEL.Yönetici);
      const id = interaction.options.getString("kullanici-id").replace(/[<@!>]/g, "").trim();
      if (!/^\d{17,20}$/.test(id)) throw new UserError("Kimlik 17-20 haneli bir sayı olmalı.");
      const reason = interaction.options.getString("sebep") || "Yasak kaldırıldı";
      await interaction.guild.members.unban(id, reason.slice(0, 500));
      await updateGuild(interaction.guildId, (entry) => {
        if (entry.tempBans) delete entry.tempBans[id];
      });
      await interaction.reply({ content: "Yasak kaldırıldı.", flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("yasaklar")
      .setDescription("Son yasakları listeler."),
    async execute(interaction) {
      requireLevel(interaction, LEVEL.Denetçi);
      const bans = await interaction.guild.bans.fetch({ limit: 15 });
      if (!bans.size) {
        await interaction.reply({ content: "Yasaklı kimse yok.", flags: MessageFlags.Ephemeral });
        return;
      }
      const temps = getGuild(interaction.guildId)?.tempBans || {};
      const lines = [...bans.values()].map((ban) => {
        const until = temps[ban.user.id]?.until;
        const when = until ? ` — <t:${Math.floor(until / 1000)}:R> kalkar` : "";
        return `${ban.user.tag} \`${ban.user.id}\`${when} — ${ban.reason || "sebep yok"}`;
      });
      await interaction.reply({ content: lines.join("\n").slice(0, 1900), flags: MessageFlags.Ephemeral });
    },
  },
];

module.exports = { commands, handleBan, watchBans };
