const { ChannelType, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { getGuild, updateGuild } = require("../store");
const { levelOf } = require("../staff");
const { UserError } = require("../errors");
const { sendLog, baseEmbed } = require("../log");
const { postWelcomeCard } = require("../events/welcome");
const { postValorantPanel } = require("./valorant");
const { postSoftwareBoards } = require("../stack");
const { agentsEnabled } = require("../agents/mode");
const { busReady, emit } = require("../agents/bus");
const { upsertRules } = require("../setup/structure");
const { commandPlace, liveId } = require("../liveChannel");

const TEXT_CHANNEL = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

function staffChannelOrThrow(interaction) {
  const channelId = liveId(interaction.guild, getGuild(interaction.guildId)?.channels?.["yetkili-sohbet"]);
  if (channelId && commandPlace(interaction) !== channelId) {
    throw new UserError(`Moderasyon komutlarını <#${channelId}> kanalında kullan.`);
  }
}

function requireLevel(interaction, level) {
  staffChannelOrThrow(interaction);
  if (levelOf(interaction.member) < level) {
    throw new UserError("Bu işlem için yetkin yok.");
  }
}

function assertTarget(actor, target) {
  if (!target) throw new UserError("Bu üye sunucuda değil.");
  if (target.id === target.guild.ownerId) throw new UserError("Sunucu sahibine işlem uygulanamaz.");
  if (target.id === actor.id) throw new UserError("Bunu kendine uygulayamazsın.");
  if (actor.id !== actor.guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    throw new UserError("Seninle aynı veya daha yüksek roldeki birine işlem uygulanamaz.");
  }
  if (target.roles.highest.position >= actor.guild.members.me.roles.highest.position) {
    throw new UserError("Botun rolü hedefin rolünden yukarıda olmalı.");
  }
}

async function tell(user, text) {
  await user.send(text).catch(() => {});
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("uyar")
      .setDescription("Üyeye uyarı yazar.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setRequired(true).setMaxLength(300)),
    async execute(interaction) {
      requireLevel(interaction, 3);
      const member = interaction.options.getMember("uye");
      assertTarget(interaction.member, member);
      const reason = interaction.options.getString("sebep");
      const record = await updateGuild(interaction.guildId, (entry) => {
        entry.warns ??= {};
        entry.warns[member.id] ??= [];
        entry.warns[member.id].push({
          reason,
          moderatorId: interaction.user.id,
          at: new Date().toISOString(),
        });
      });
      const count = record.warns[member.id].length;
      await tell(member.user, `${interaction.guild.name} sunucusunda uyarıldın (${count}): ${reason}`);
      await sendLog(interaction.guild, "denetim-log", baseEmbed(0xf1c40f, "Uyarı", `${member} — ${reason}\nYetkili: ${interaction.user}\nToplam: ${count}`));
      await interaction.reply({ content: `${member} uyarıldı. Toplam: ${count}`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("uyarilar")
      .setDescription("Bir üyenin uyarılarını listeler.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true)),
    async execute(interaction) {
      requireLevel(interaction, 3);
      const user = interaction.options.getUser("uye");
      const warns = getGuild(interaction.guildId)?.warns?.[user.id] || [];
      if (!warns.length) {
        await interaction.reply({ content: "Kayıtlı uyarı yok.", flags: MessageFlags.Ephemeral });
        return;
      }
      const lines = warns.slice(-10).map((warn, index) => `${index + 1}. ${warn.reason} — <t:${Math.floor(new Date(warn.at).getTime() / 1000)}:R>`);
      await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("uyari-sil")
      .setDescription("Üyenin uyarı kayıtlarını siler.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true)),
    async execute(interaction) {
      requireLevel(interaction, 4);
      const user = interaction.options.getUser("uye");
      await updateGuild(interaction.guildId, (entry) => {
        if (entry.warns) delete entry.warns[user.id];
      });
      await interaction.reply({ content: "Uyarı kayıtları silindi.", flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("sustur")
      .setDescription("Üyeyi belirtilen dakika boyunca susturur.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addIntegerOption((option) => option.setName("dakika").setDescription("1-40320").setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setMaxLength(300)),
    async execute(interaction) {
      requireLevel(interaction, 3);
      const member = interaction.options.getMember("uye");
      assertTarget(interaction.member, member);
      const minutes = interaction.options.getInteger("dakika");
      const reason = interaction.options.getString("sebep") || "Sebep belirtilmedi";
      await member.timeout(minutes * 60 * 1000, reason);
      await tell(member.user, `${interaction.guild.name} sunucusunda ${minutes} dakika susturuldun: ${reason}`);
      await interaction.reply({ content: `${member} ${minutes} dakika susturuldu.`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("susturma-kaldir")
      .setDescription("Susturmayı kaldırır.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true)),
    async execute(interaction) {
      requireLevel(interaction, 3);
      const member = interaction.options.getMember("uye");
      assertTarget(interaction.member, member);
      await member.timeout(null, "Susturma kaldırıldı");
      await interaction.reply({ content: `${member} tekrar yazabilir.`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("at")
      .setDescription("Üyeyi sunucudan atar.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setMaxLength(300)),
    async execute(interaction) {
      requireLevel(interaction, 4);
      const member = interaction.options.getMember("uye");
      assertTarget(interaction.member, member);
      const reason = interaction.options.getString("sebep") || "Sebep belirtilmedi";
      await tell(member.user, `${interaction.guild.name} sunucusundan atıldın: ${reason}`);
      await member.kick(reason);
      await interaction.reply({ content: `${member.user.tag} atıldı.`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("yasakla")
      .setDescription("Üyeyi yasaklar.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))
      .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setMaxLength(300))
      .addIntegerOption((option) => option.setName("mesaj-sil").setDescription("Kaç günlük mesaj silinsin").setMinValue(0).setMaxValue(7)),
    async execute(interaction) {
      requireLevel(interaction, 5);
      const member = interaction.options.getMember("uye");
      assertTarget(interaction.member, member);
      const reason = interaction.options.getString("sebep") || "Sebep belirtilmedi";
      const days = interaction.options.getInteger("mesaj-sil") ?? 0;
      await tell(member.user, `${interaction.guild.name} sunucusundan yasaklandın: ${reason}`);
      await member.ban({ deleteMessageSeconds: days * 24 * 60 * 60, reason });
      await interaction.reply({ content: `${member.user.tag} yasaklandı.`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("yasak-kaldir")
      .setDescription("Kullanıcı kimliğiyle yasağı kaldırır.")
      .addStringOption((option) => option.setName("kullanici-id").setDescription("Kullanıcı kimliği").setRequired(true))
      .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setMaxLength(300)),
    async execute(interaction) {
      requireLevel(interaction, 5);
      const id = interaction.options.getString("kullanici-id").trim();
      if (!/^\d{17,20}$/.test(id)) throw new UserError("Kimlik 17-20 haneli bir sayı olmalı.");
      await interaction.guild.members.unban(id, interaction.options.getString("sebep") || "Yasak kaldırıldı");
      await interaction.reply({ content: "Yasak kaldırıldı.", flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("temizle")
      .setDescription("Bulunduğun kanaldaki son mesajları siler.")
      .addIntegerOption((option) => option.setName("adet").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100)),
    async execute(interaction) {
      requireLevel(interaction, 3);
      const amount = interaction.options.getInteger("adet");
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await sendLog(
        interaction.guild,
        "denetim-log",
        baseEmbed(0x95a5a6, "Mesaj temizliği", `${interaction.channel} kanalında ${deleted.size} mesaj silindi.\nYetkili: ${interaction.user}`),
      );
      await interaction.reply({ content: `${deleted.size} mesaj silindi.`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("sil")
      .setDescription("Bir kanaldaki mesajları siler.")
      .addSubcommand((sub) => sub
        .setName("hepsi")
        .setDescription("Kanaldaki bütün mesajları siler. 14 günden eskiler de gider.")
        .addStringOption((option) => option.setName("onay").setDescription("Onay için sil yaz").setRequired(true).setMaxLength(8))
        .addChannelOption((option) => option
          .setName("kanal")
          .setDescription("Temizlenecek kanal. Boşsa bulunduğun kanal.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))),
    async execute(interaction) {
      if (levelOf(interaction.member) < 5) throw new UserError("Bu işlem için Yönetici veya Kurucu olmalısın.");
      const onay = interaction.options.getString("onay").trim().toLocaleLowerCase("tr").replaceAll("ı", "i");
      if (onay !== "sil") throw new UserError("Onay kutusuna sil yaz.");
      const channel = interaction.options.getChannel("kanal") || interaction.channel;
      if (!TEXT_CHANNEL.has(channel?.type)) throw new UserError("Yalnız yazı kanalları temizlenebilir.");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const reason = `${interaction.user.tag} tüm sohbeti sildi`;
      const clone = await channel.clone({ reason });
      if (clone.rawPosition !== channel.rawPosition) {
        await clone.setPosition(channel.rawPosition).catch(() => {});
      }
      const keys = await retargetChannel(interaction.guild, channel.id, clone.id);
      try {
        await channel.delete(reason);
      } catch (error) {
        await retargetChannel(interaction.guild, clone.id, channel.id);
        await clone.delete("Silme geri alındı").catch(() => {});
        console.error(error);
        throw new UserError("Eski kanal silinemedi. Sohbet duruyor.");
      }
      const restored = await restorePanels(interaction.guild, keys);
      await sendLog(
        interaction.guild,
        "denetim-log",
        baseEmbed(0x95a5a6, "Sohbet silindi", `${clone} kanalındaki tüm mesajlar silindi.\nYetkili: ${interaction.user}`),
      );

      const extra = restored ? "" : " Sabit kart yeniden yazılamadı.";
      const text = `${clone} kanalındaki tüm mesajlar silindi.${extra}`;
      if (channel.id === interaction.channelId) {
        await clone.send(`${interaction.user} bu kanalın tüm mesajlarını sildi.`).catch(() => {});
      }
      await interaction.editReply(text).catch(() => {});
    },
  },
];

async function retargetChannel(guild, oldId, newId) {
  const before = getGuild(guild.id);
  const keys = Object.entries(before?.channels || {})
    .filter(([, id]) => id === oldId)
    .map(([key]) => key);
  await updateGuild(guild.id, (entry) => {
    entry.channels ??= {};
    for (const key of keys) entry.channels[key] = newId;
    if (keys.includes("hos-geldin")) entry.welcomeMessageId = null;
    if (keys.includes("kurallar")) entry.rulesMessageId = null;
    if (keys.includes("komutlar")) entry.valorantPanelId = null;
    if (keys.includes("yigin")) entry.stackPanelId = null;
    if (keys.includes("yardim")) entry.helpGuideId = null;
    if (keys.includes("projeler")) entry.projectGuideId = null;
    if (keys.includes("kaynaklar")) entry.resourceGuideId = null;
    if (keys.includes("github")) entry.githubGuideId = null;
    if (entry.disco?.channelId === oldId) entry.disco = null;
  });
  return keys;
}

async function restorePanels(guild, keys) {
  try {
    if (keys.includes("kurallar")) {
      const channelId = getGuild(guild.id)?.channels?.kurallar;
      const channel = channelId && (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null));
      if (channel) {
        const message = await upsertRules(guild, channel, null);
        await updateGuild(guild.id, (entry) => {
          entry.rulesMessageId = message.id;
        });
      }
    }
    if (keys.includes("hos-geldin")) {
      const message = await postWelcomeCard(guild);
      if (message) {
        await updateGuild(guild.id, (entry) => {
          entry.welcomeMessageId = message.id;
        });
      }
    }
    if (keys.includes("komutlar")) await postValorantPanel(guild);
    if (agentsEnabled() && busReady()) emit("setup.done", { guildId: guild.id, keys });
    else await postSoftwareBoards(guild, keys);
    return true;
  } catch (error) {
    console.error("Silinen kanalın kartı yazılamadı:", error.message);
    return false;
  }
}

module.exports = { commands };
