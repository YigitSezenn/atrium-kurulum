const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
} = require("discord.js");
const { getGuild, updateGuild } = require("../src/store");
const { UserError } = require("../src/errors");
const { levelOf } = require("../src/staff");
const { LEVEL } = require("../src/constants");
const { liveId } = require("../src/liveChannel");

const PANEL = "ticket:panel";
const FORM = "ticket:form";
const CLAIM = "ticket:claim";
const UNCLAIM = "ticket:unclaim";
const CLOSE = "ticket:close";
const CLOSE_YES = "ticket:close-yes";
const CLOSE_NO = "ticket:close-no";
const REOPEN = "ticket:reopen";
const TAKE = "ticket:take:";
const JOIN = "ticket:join:";
const PING_ROLES = ["Moderatör", "Denetçi"];

function staffChannelId(guild) {
  const channels = getGuild(guild.id)?.channels || {};
  return liveId(guild, channels["ticket-bildirim"]) || liveId(guild, channels["yetkili-sohbet"]);
}

function staffRoleIds(guild) {
  const roles = getGuild(guild.id)?.roles || {};
  return PING_ROLES.map((key) => roles[key]).filter((id) => id && guild.roles.cache.has(id));
}

function notifyPayload(threadId, record, url) {
  const status = record.status !== "open"
    ? "Kapandı"
    : record.claimerId ? `<@${record.claimerId}> ilgileniyor` : "Bekliyor, kimse üstlenmedi";
  const color = record.status !== "open" ? 0x95a5a6 : record.claimerId ? 0x3498db : 0xe67e22;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎫 ${record.konu}`.slice(0, 250))
    .setDescription((record.aciklama || "").slice(0, 1000) || null)
    .addFields(
      { name: "Açan", value: `<@${record.openerId}>`, inline: true },
      { name: "Durum", value: status, inline: true },
      { name: "Başlık", value: `<#${threadId}>`, inline: true },
    )
    .setTimestamp(record.openedAt);
  const row = new ActionRowBuilder();
  if (record.status === "open") {
    if (!record.claimerId) {
      row.addComponents(new ButtonBuilder().setCustomId(`${TAKE}${threadId}`).setLabel("Üstlen").setStyle(ButtonStyle.Success));
    }
    row.addComponents(new ButtonBuilder().setCustomId(`${JOIN}${threadId}`).setLabel("Başlığa katıl").setStyle(ButtonStyle.Secondary));
  }
  if (url) row.addComponents(new ButtonBuilder().setLabel("Başlığa git").setStyle(ButtonStyle.Link).setURL(url));
  return { embeds: [embed], components: row.components.length ? [row] : [] };
}

async function refreshNotify(guild, threadId, record) {
  if (!record.notifyChannelId || !record.notifyId) return;
  const channel = guild.channels.cache.get(record.notifyChannelId)
    || await guild.channels.fetch(record.notifyChannelId).catch(() => null);
  const message = channel?.isTextBased() && await channel.messages.fetch(record.notifyId).catch(() => null);
  if (!message) return;
  const url = `https://discord.com/channels/${guild.id}/${threadId}`;
  await message.edit(notifyPayload(threadId, record, url)).catch(() => {});
}

function isHelpChannel(channel) {
  if (!channel || channel.isThread?.()) return false;
  if (typeof channel.threads?.create !== "function") return false;
  const name = channel.name.toLocaleLowerCase("tr");
  return name.includes("yardim") || name.includes("yardım");
}

async function ticketParent(interaction) {
  const found = await helpChannel(interaction.guild);
  if (found) return found;
  const here = interaction.channel?.isThread?.() ? interaction.channel.parent : interaction.channel;
  if (typeof here?.threads?.create !== "function") throw new UserError("Bu kanalda başlık açılamıyor. Bir yazı kanalında dene.");
  return here;
}

async function helpChannel(guild) {
  const saved = getGuild(guild.id)?.channels?.yardim;
  if (saved) {
    const stored = await guild.channels.fetch(saved).catch(() => null);
    if (isHelpChannel(stored)) return stored;
  }
  await guild.channels.fetch().catch(() => null);
  const found = guild.channels.cache.find((channel) => isHelpChannel(channel));
  if (!found) return null;
  await updateGuild(guild.id, (entry) => {
    entry.channels ??= {};
    entry.channels.yardim = found.id;
  });
  return found;
}

function isStaff(member) {
  return levelOf(member) >= LEVEL.Denetçi;
}

function controls(record) {
  const claimed = Boolean(record?.claimerId);
  const claim = new ButtonBuilder()
    .setCustomId(claimed ? UNCLAIM : CLAIM)
    .setLabel(claimed ? "Bırak" : "Üstlen")
    .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Primary);
  const close = new ButtonBuilder()
    .setCustomId(CLOSE)
    .setLabel("Kapat")
    .setStyle(ButtonStyle.Danger);
  return [new ActionRowBuilder().addComponents(claim, close)];
}

function reopenRow() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(REOPEN).setLabel("Yeniden aç").setStyle(ButtonStyle.Success),
  )];
}

function saveTicket(guildId, threadId, record) {
  return updateGuild(guildId, (entry) => {
    entry.tickets ??= {};
    const closed = Object.entries(entry.tickets).filter(([, item]) => item.status !== "open");
    while (Object.keys(entry.tickets).length >= 60 && closed.length) {
      delete entry.tickets[closed.shift()[0]];
    }
    entry.tickets[threadId] = record;
  });
}

function patchTicket(guildId, threadId, patch) {
  return updateGuild(guildId, (entry) => {
    const current = entry.tickets?.[threadId];
    if (!current) return;
    Object.assign(current, patch);
  });
}

const fetchedGuilds = new Set();

async function inviteBots(thread) {
  const { guild } = thread;
  const me = guild.members.me?.id;
  if (!fetchedGuilds.has(guild.id)) {
    await guild.members.fetch().catch(() => {});
    fetchedGuilds.add(guild.id);
  }
  for (const member of guild.members.cache.values()) {
    if (!member.user.bot || member.id === me) continue;
    await thread.members.add(member.id).catch(() => {});
  }
}

async function openThread(user, parent, konu, aciklama) {
  const already = await existingOpen(parent.guild, user.id);
  if (already) throw new UserError(`Açık başlığın var: ${already}`);
  const { guild } = parent;
  const staffId = staffChannelId(guild);
  const roleIds = staffRoleIds(guild);
  const pings = roleIds.map((id) => `<@&${id}>`).join(" ");
  const hidden = Boolean(staffId);
  const thread = await parent.threads.create({
    name: `🎫 ${konu}`.slice(0, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    type: hidden ? ChannelType.PrivateThread : ChannelType.PublicThread,
    ...(hidden ? { invitable: false } : {}),
    reason: `${user.tag} ticket`,
  });
  await thread.members.add(user.id).catch(() => {});
  if (hidden) await inviteBots(thread);
  const message = await thread.send({
    content: hidden ? `<@${user.id}>` : `<@${user.id}> ${pings}`.trim(),
    embeds: [
      new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(konu.slice(0, 250))
        .setDescription(aciklama.slice(0, 4000))
        .setFooter({ text: "Yetkililere haber verildi. Biri üstlenince burada yazacak." }),
    ],
    components: controls(null),
    allowedMentions: { users: [user.id], roles: hidden ? [] : roleIds },
  });
  const record = {
    openerId: user.id,
    claimerId: null,
    controlId: message.id,
    status: "open",
    konu,
    aciklama: aciklama.slice(0, 1000),
    openedAt: Date.now(),
    notifyChannelId: staffId || null,
    notifyId: null,
  };
  if (staffId) {
    const staff = guild.channels.cache.get(staffId)
      || await guild.channels.fetch(staffId).catch(() => null);
    const notice = staff?.isTextBased() && await staff.send({
      content: pings ? `${pings} yeni destek talebi.` : "Yeni destek talebi.",
      ...notifyPayload(thread.id, record, thread.url),
      allowedMentions: { roles: roleIds },
    }).catch((error) => {
      console.error("Ticket bildirimi yazılamadı:", error.message);
      return null;
    });
    record.notifyId = notice?.id || null;
    if (!record.notifyId) {
      await parent.send({
        content: `${pings || "Yetkililer"} yeni destek talebi: ${thread}`.trim(),
        allowedMentions: { roles: roleIds },
      }).catch(() => {});
    }
  }
  await saveTicket(guild.id, thread.id, record);
  return thread;
}

async function staffJoin(interaction, take) {
  const threadId = interaction.customId.slice((take ? TAKE : JOIN).length);
  const record = getGuild(interaction.guildId)?.tickets?.[threadId];
  if (!record) throw new UserError("Bu talep artık kayıtlı değil.");
  if (!isStaff(interaction.member)) throw new UserError("Bunun için denetçi veya üstü rol gerekir.");
  const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (!thread?.isThread?.()) throw new UserError("Başlık silinmiş.");
  if (record.status !== "open") throw new UserError("Bu talep kapandı.");
  await thread.members.add(interaction.user.id).catch(() => {});
  if (!take) {
    await interaction.reply({ content: `Başlığa eklendin: ${thread}`, flags: MessageFlags.Ephemeral });
    await thread.send(`<@${interaction.user.id}> başlığa katıldı.`).catch(() => {});
    return;
  }
  if (record.claimerId && record.claimerId !== interaction.user.id) {
    throw new UserError(`Bunu <@${record.claimerId}> üstlendi. "Başlığa katıl" ile yardım edebilirsin.`);
  }
  record.claimerId = interaction.user.id;
  await patchTicket(interaction.guildId, threadId, { claimerId: record.claimerId });
  await interaction.update(notifyPayload(threadId, record, thread.url));
  await editControls(thread, record);
  await thread.send(`<@${interaction.user.id}> talebini üstlendi, seninle ilgilenecek. <@${record.openerId}>`).catch(() => {});
}

async function existingOpen(guild, userId) {
  const tickets = getGuild(guild.id)?.tickets || {};
  for (const [id, record] of Object.entries(tickets)) {
    if (record.openerId !== userId || record.status !== "open") continue;
    const thread = await guild.channels.fetch(id).catch(() => null);
    if (!thread?.isThread?.() || thread.archived) {
      await patchTicket(guild.id, id, { status: "closed" });
      continue;
    }
    return thread;
  }
  return null;
}

function ticketOf(interaction) {
  const thread = interaction.channel;
  if (!thread?.isThread?.()) throw new UserError("Bunu bir yardım başlığında kullan.");
  const record = getGuild(interaction.guildId)?.tickets?.[thread.id];
  if (!record) throw new UserError("Bu başlık bottan açılmamış.");
  return { thread, record };
}

function canClose(interaction, record) {
  return interaction.user.id === record.openerId || isStaff(interaction.member);
}

async function editControls(thread, record) {
  if (!record.controlId) return;
  const message = await thread.messages.fetch(record.controlId).catch(() => null);
  if (!message) return;
  const components = record.status === "open" ? controls(record) : [];
  await message.edit({ components }).catch(() => {});
}

async function transcript(thread, record, closer) {
  const fetched = await thread.messages.fetch({ limit: 50 }).catch(() => null);
  const lines = [...(fetched?.values() || [])]
    .reverse()
    .filter((message) => message.content || message.embeds.length)
    .map((message) => {
      const when = message.createdAt.toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      const text = (message.content || message.embeds[0]?.description || "").replace(/\s+/g, " ").trim();
      return `[${when}] ${message.author.username}: ${text}`.slice(0, 400);
    });
  const body = lines.join("\n").slice(0, 12000) || "(mesaj yok)";
  const staffId = staffChannelId(thread.guild);
  const staff = staffId && await thread.client.channels.fetch(staffId).catch(() => null);
  if (!staff?.isTextBased()) return false;
  const claim = record.claimerId ? `<@${record.claimerId}>` : "kimse üstlenmedi";
  await staff.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(record.konu.slice(0, 240) || "Yardım başlığı")
        .setDescription([
          `Açan: <@${record.openerId}>`,
          `Üstlenen: ${claim}`,
          `Kapatan: <@${closer.id}>`,
          `Başlık: ${thread}`,
        ].join("\n")),
    ],
    files: [new AttachmentBuilder(Buffer.from(body, "utf8"), { name: "ticket.txt" })],
  });
  return true;
}

async function claim(interaction) {
  const { thread, record } = ticketOf(interaction);
  if (record.status !== "open") throw new UserError("Bu başlık kapalı.");
  if (!isStaff(interaction.member)) throw new UserError("Üstlenmek için denetçi veya üstü rol gerekir.");
  if (record.claimerId && record.claimerId !== interaction.user.id && levelOf(interaction.member) < LEVEL.Moderatör) {
    throw new UserError(`Bunu <@${record.claimerId}> üstlendi.`);
  }
  record.claimerId = interaction.user.id;
  await patchTicket(interaction.guildId, thread.id, { claimerId: interaction.user.id });
  await interaction.update({ components: controls(record) });
  await thread.send(`Bunu <@${interaction.user.id}> üstlendi.`);
  await refreshNotify(interaction.guild, thread.id, record);
}

async function unclaim(interaction) {
  const { thread, record } = ticketOf(interaction);
  if (record.status !== "open") throw new UserError("Bu başlık kapalı.");
  const mine = record.claimerId === interaction.user.id;
  if (!mine && levelOf(interaction.member) < LEVEL.Moderatör) throw new UserError("Bunu üstlenen veya moderatör bırakır.");
  record.claimerId = null;
  await patchTicket(interaction.guildId, thread.id, { claimerId: null });
  await interaction.update({ components: controls(record) });
  await thread.send("Üstlenme bırakıldı.");
  await refreshNotify(interaction.guild, thread.id, record);
}

async function askClose(interaction) {
  const { record } = ticketOf(interaction);
  if (record.status !== "open") throw new UserError("Bu başlık zaten kapalı.");
  if (!canClose(interaction, record)) throw new UserError("Bunu başlığı açan veya yetkili kapatır.");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CLOSE_YES).setLabel("Kapat").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CLOSE_NO).setLabel("Vazgeç").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content: "Başlık kapanacak. Emin misin?", components: [row] });
}

async function finishClose(interaction) {
  const { thread, record } = ticketOf(interaction);
  if (!canClose(interaction, record)) throw new UserError("Bunu başlığı açan veya yetkili kapatır.");
  if (record.status !== "open") {
    await interaction.update({ content: "Bu başlık zaten kapalı.", components: [] });
    return;
  }
  await interaction.update({ content: "Kapanıyor.", components: [] });
  const saved = await transcript(thread, record, interaction.user);
  record.status = "closed";
  await patchTicket(interaction.guildId, thread.id, { status: "closed", claimerId: record.claimerId });
  await editControls(thread, record);
  await refreshNotify(interaction.guild, thread.id, record);
  const note = saved
    ? "Kapandı. Konuşma yetkili kanalına yazıldı."
    : "Kapandı. Yetkili sohbet kanalı bağlı olmadığı için döküm yazılamadı.";
  await thread.send({ content: note, components: reopenRow() });
  await thread.setLocked(true, "ticket kapandı").catch(() => {});
  await thread.setArchived(true, "ticket kapandı").catch(() => {});
}

async function reopen(interaction) {
  const { thread, record } = ticketOf(interaction);
  if (!canClose(interaction, record)) throw new UserError("Bunu başlığı açan veya yetkili açar.");
  if (record.status === "open" && !thread.archived) throw new UserError("Bu başlık zaten açık.");
  await thread.setArchived(false).catch(() => {});
  await thread.setLocked(false, "ticket açıldı").catch(() => {});
  record.status = "open";
  await patchTicket(interaction.guildId, thread.id, { status: "open" });
  await editControls(thread, record);
  await refreshNotify(interaction.guild, thread.id, record);
  await interaction.update({ content: `<@${interaction.user.id}> başlığı yeniden açtı.`, components: [] });
}

function formModal() {
  return new ModalBuilder()
    .setCustomId(FORM)
    .setTitle("Yardım başlığı")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("konu")
          .setLabel("Kısa başlık")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("aciklama")
          .setLabel("Ne yaptın, ne bekliyordun, hata ne")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
}

async function handleTicket(interaction, emit) {
  const id = interaction.customId;
  if (interaction.isButton() && id === PANEL) {
    await interaction.showModal(formModal());
    return;
  }
  if (interaction.isModalSubmit() && id === FORM) {
    const konu = interaction.fields.getTextInputValue("konu").replace(/\s+/g, " ").trim();
    const aciklama = interaction.fields.getTextInputValue("aciklama").trim();
    if (!konu || !aciklama) throw new UserError("Konu ve açıklama gerekli.");
    const parent = await ticketParent(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const thread = await openThread(interaction.user, parent, konu, aciklama);
    emit("help.opened", {
      guildId: interaction.guildId,
      threadId: thread.id,
      userId: interaction.user.id,
      text: `${konu}\n${aciklama}`.slice(0, 500),
    });
    await interaction.editReply(`Başlık açıldı: ${thread}`);
    return;
  }
  if (!interaction.isButton()) return;
  if (id.startsWith(TAKE)) await staffJoin(interaction, true);
  else if (id.startsWith(JOIN)) await staffJoin(interaction, false);
  else if (id === CLAIM) await claim(interaction);
  else if (id === UNCLAIM) await unclaim(interaction);
  else if (id === CLOSE) await askClose(interaction);
  else if (id === CLOSE_NO) await interaction.update({ content: "Kapatma iptal.", components: [] });
  else if (id === CLOSE_YES) await finishClose(interaction);
  else if (id === REOPEN) await reopen(interaction);
}

const ticket = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Yardım başlığı açar.")
    .addStringOption((option) => option
      .setName("konu")
      .setDescription("Kısa başlık")
      .setRequired(true)
      .setMaxLength(80))
    .addStringOption((option) => option
      .setName("aciklama")
      .setDescription("Ne yaptın, ne bekliyordun, hata ne")
      .setRequired(true)
      .setMaxLength(1000)),
  async execute(interaction, emit) {
    const konu = interaction.options.getString("konu", true).replace(/\s+/g, " ").trim();
    const aciklama = interaction.options.getString("aciklama", true).trim();
    if (!konu || !aciklama) throw new UserError("Konu ve açıklama gerekli.");
    const parent = await ticketParent(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const thread = await openThread(interaction.user, parent, konu, aciklama);
    emit("help.opened", {
      guildId: interaction.guildId,
      threadId: thread.id,
      userId: interaction.user.id,
      text: `${konu}\n${aciklama}`.slice(0, 500),
    });
    await interaction.editReply(`Başlık açıldı: ${thread}`);
  },
};

module.exports = { ticket, handleTicket };
