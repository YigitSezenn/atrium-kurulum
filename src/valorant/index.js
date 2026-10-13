const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { UserError } = require("../errors");
const { getGuild, updateGuild } = require("../store");
const { accountOf, accountsOf, update } = require("../valorantStore");
const { RANKS, removeRankBadges, syncRankBadge } = require("../badges");
const { henrik } = require("./henrik");
const { buildTeams, handleTeamButton, watchTeamVoice } = require("./teams");
const { command: metaCommand } = require("./meta");

const REGION = "eu";
const WATCH_EVERY = 30 * 60 * 1000;
const RECHECK_AFTER = 24 * 60 * 60 * 1000;
const WATCH_BATCH = 10;

function cleanName(value) {
  return String(value || "").trim().replace(/^#/, "").slice(0, 16);
}

function cleanTag(value) {
  return String(value || "").trim().replace(/^#/, "").slice(0, 5);
}

function linkModal() {
  const modal = new ModalBuilder().setCustomId("valorant:modal").setTitle("Valorant hesabı");
  const name = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("İsim")
    .setPlaceholder("Yiğit")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16);
  const tag = new TextInputBuilder()
    .setCustomId("tag")
    .setLabel("Etiket")
    .setPlaceholder("TR1")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(5);
  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(tag),
  );
  return modal;
}

function playerOf(match, name, tag) {
  const players = match.players?.all_players || [];
  return players.find((player) => (
    player.name?.toLowerCase() === name.toLowerCase()
    && player.tag?.toLowerCase() === tag.toLowerCase()
  ));
}

function summarize(matches, name, tag) {
  const counts = new Map();
  const lines = [];
  for (const match of matches || []) {
    const me = playerOf(match, name, tag);
    if (!me) continue;
    const team = String(me.team || "").toLowerCase();
    const won = match.teams?.[team]?.has_won;
    const agent = me.character || "Bilinmiyor";
    const row = counts.get(agent) || { wins: 0, games: 0 };
    row.games += 1;
    if (won) row.wins += 1;
    counts.set(agent, row);
    const kills = me.stats?.kills ?? "?";
    const deaths = me.stats?.deaths ?? "?";
    const map = match.metadata?.map || "Harita";
    const result = won ? "Galibiyet" : won === false ? "Yenilgi" : "Maç";
    lines.push(`${result} · ${agent} · ${map} · ${kills}/${deaths}`);
  }
  const meta = [...counts.entries()]
    .sort((a, b) => b[1].wins - a[1].wins || b[1].games - a[1].games)
    .map(([agent, row]) => `${agent}: ${row.wins} galibiyet / ${row.games} maç`)
    .join("\n");
  return { lines: lines.slice(0, 5), meta };
}

function rankEmoji(guild, tier) {
  if (!/radiant/i.test(tier)) return "";
  const emoji = guild.emojis.cache.find((item) => item.name === "valorantradiant");
  return emoji ? `${emoji} ` : "";
}

function card(guild, account, mmr, matches) {
  const current = mmr?.current_data || {};
  const tier = current.currenttierpatched || "Derecesiz";
  const rr = Number.isFinite(current.ranking_in_tier) ? current.ranking_in_tier : "—";
  const { lines, meta } = summarize(matches, account.name, account.tag);
  const embed = new EmbedBuilder()
    .setColor(/radiant/i.test(tier) ? 0xffe7a3 : /immortal/i.test(tier) ? 0xb83d5a : 0x8d8d8d)
    .setTitle(`${rankEmoji(guild, tier)}${account.name}#${account.tag}`)
    .setDescription(`**${tier}** · ${rr} RR`)
    .addFields(
      { name: "Son maçlar", value: lines.join("\n") || "Maç bulunamadı.", inline: false },
      { name: "Ajanlar", value: meta || "Bu maçlarda ajan çıkmadı.", inline: false },
    )
    .setFooter({ text: "EU · Henrik" });
  const image = current.images?.small;
  if (image) embed.setThumbnail(image);
  return embed;
}

function rankIndex(name) {
  return RANKS.findIndex((rank) => rank.name === name);
}

async function announceRankUp(member, account, from, to) {
  const channels = getGuild(member.guild.id)?.channels || {};
  const channelId = channels.genel || channels.komutlar;
  const channel = channelId && (member.guild.channels.cache.get(channelId)
    || await member.guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setColor(/radiant/i.test(to) ? 0xffe7a3 : 0xff4655)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setTitle(`${to} oldu`)
    .setDescription(`${member} rank atladı: **${from}** → **${to}**`)
    .setFooter({ text: `${account.name}#${account.tag}` })
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function syncTier(member, account, mmr) {
  const tier = mmr?.current_data?.currenttierpatched || "";
  const roleName = await syncRankBadge(member, tier);
  const before = account.tier;
  await update(member.guild.id, (entry) => {
    if (!entry.users[member.id]) return;
    entry.users[member.id].tier = roleName;
    entry.users[member.id].checkedAt = Date.now();
  });
  if (before && rankIndex(roleName) > rankIndex(before) && roleName !== "Unrated") {
    await announceRankUp(member, account, before, roleName);
  }
  return roleName;
}

async function fetchMmr(account, options) {
  return henrik(`/valorant/v2/mmr/${REGION}/${encodeURIComponent(account.name)}/${encodeURIComponent(account.tag)}`, options);
}

async function refresh(member, account) {
  const name = encodeURIComponent(account.name);
  const tag = encodeURIComponent(account.tag);
  const mmr = await fetchMmr(account);
  const roleName = await syncTier(member, account, mmr);
  let matches = [];
  try {
    matches = await henrik(`/valorant/v3/matches/${REGION}/${name}/${tag}?mode=competitive&size=5`);
  } catch (error) {
    console.error("Valorant maçları alınamadı:", error.message);
  }
  const embed = card(member.guild, account, mmr, matches);
  if (roleName) embed.setFooter({ text: `EU · Henrik · Rol: ${roleName}` });
  return embed;
}

async function saveAccount(guildId, userId, name, tag) {
  const clean = { name: cleanName(name), tag: cleanTag(tag), region: REGION };
  if (clean.name.length < 3 || clean.tag.length < 2) {
    throw new UserError("İsim ve etiket Riot biçiminde olmalı. Örnek: Yiğit ve TR1.");
  }
  await update(guildId, (entry) => {
    const previous = entry.users[userId];
    const same = previous && previous.name.toLowerCase() === clean.name.toLowerCase() && previous.tag.toLowerCase() === clean.tag.toLowerCase();
    entry.users[userId] = same ? { ...previous, ...clean } : clean;
  });
  return accountOf(guildId, userId);
}

async function unlink(interaction) {
  const account = accountOf(interaction.guildId, interaction.user.id);
  if (!account) throw new UserError("Bağlı bir Valorant hesabın yok.");
  await update(interaction.guildId, (entry) => {
    delete entry.users[interaction.user.id];
  });
  await removeRankBadges(interaction.member);
  await interaction.reply({ content: `${account.name}#${account.tag} bağlantısı kaldırıldı. Rank rolün alındı.`, flags: MessageFlags.Ephemeral });
}

async function watchRanks(client) {
  for (const guild of client.guilds.cache.values()) {
    const due = Object.entries(accountsOf(guild.id))
      .filter(([, account]) => Date.now() - (account.checkedAt || 0) > RECHECK_AFTER)
      .sort((a, b) => (a[1].checkedAt || 0) - (b[1].checkedAt || 0))
      .slice(0, WATCH_BATCH);
    for (const [userId, account] of due) {
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await update(guild.id, (entry) => {
          if (entry.users[userId]) entry.users[userId].checkedAt = Date.now();
        });
        continue;
      }
      try {
        await syncTier(member, account, await fetchMmr(account, { fresh: true }));
      } catch (error) {
        console.error(`Valorant rankı güncellenemedi (${account.name}#${account.tag}):`, error.message);
        await update(guild.id, (entry) => {
          if (entry.users[userId]) entry.users[userId].checkedAt = Date.now() - RECHECK_AFTER + 2 * 60 * 60 * 1000;
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function handleValorantButton(interaction) {
  await interaction.showModal(linkModal());
}

async function handleValorantModal(interaction) {
  const account = await saveAccount(
    interaction.guildId,
    interaction.user.id,
    interaction.fields.getTextInputValue("name"),
    interaction.fields.getTextInputValue("tag"),
  );
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const embed = await refresh(interaction.member, account);
  await interaction.editReply({ embeds: [embed] });
}

function panelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xff4655)
        .setTitle("Valorant")
        .setDescription("Hesabını bağla. Rankın rol olarak verilir ve her gün kendiliğinden güncellenir. Bölge EU.\n\n`/valorant profil` · `/valorant takim-kur` · `/valorant kaldir`"),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("valorant:link")
          .setLabel("Valorant hesabını bağla")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

async function postValorantPanel(guild) {
  const channelId = getGuild(guild.id)?.channels?.komutlar;
  const channel = channelId && (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;
  const saved = getGuild(guild.id)?.valorantPanelId;
  const existing = saved && await channel.messages.fetch(saved).catch(() => null);
  if (existing?.author?.id === guild.client.user.id) {
    await existing.edit(panelPayload()).catch(() => {});
    return;
  }
  if (existing) await existing.delete().catch(() => {});
  const message = await channel.send(panelPayload());
  await updateGuild(guild.id, (entry) => {
    entry.valorantPanelId = message.id;
  });
}

async function handleValorantInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === "valorant:link") {
    await handleValorantButton(interaction);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId === "valorant:modal") {
    await handleValorantModal(interaction);
    return true;
  }
  return handleTeamButton(interaction);
}

function startValorant(client) {
  const panels = () => {
    for (const guild of client.guilds.cache.values()) {
      postValorantPanel(guild).catch((error) => console.error("Valorant paneli yazılamadı:", error.message));
    }
  };
  panels();
  setInterval(panels, 10 * 60 * 1000).unref();
  watchTeamVoice(client);
  const loop = () => {
    watchRanks(client)
      .catch((error) => console.error("Valorant rankları güncellenemedi:", error.message))
      .finally(() => setTimeout(loop, WATCH_EVERY).unref());
  };
  setTimeout(loop, 60_000).unref();
}

const command = {
  data: new SlashCommandBuilder()
    .setName("valorant")
    .setDescription("Valorant hesabını bağlar, istatistik gösterir ve takım kurar.")
    .addSubcommand((sub) => sub.setName("profil").setDescription("Bağlı hesabın rankını, RR ve son maçlarını gösterir."))
    .addSubcommand((sub) => sub.setName("bagla").setDescription("İsim ve etiket formunu açar."))
    .addSubcommand((sub) => sub.setName("kaldir").setDescription("Valorant hesabının bağlantısını ve rank rolünü kaldırır."))
    .addSubcommand((sub) => sub
      .setName("takim-kur")
      .setDescription("Ses kanalındaki oyuncuları ranklarına göre dengeli iki takıma böler.")
      .addBooleanOption((option) => option.setName("harita").setDescription("Rastgele harita da seçilsin mi? Varsayılan evet."))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "bagla") {
      await interaction.showModal(linkModal());
      return;
    }
    if (sub === "kaldir") {
      await unlink(interaction);
      return;
    }
    if (sub === "takim-kur") {
      await buildTeams(interaction);
      return;
    }
    const account = accountOf(interaction.guildId, interaction.user.id);
    if (!account) throw new UserError("Önce Valorant hesabını bağla. #komutlar kanalındaki butonu veya /valorant bagla kullan.");
    await interaction.deferReply();
    const embed = await refresh(interaction.member, account);
    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = { commands: [command, metaCommand], handleValorantInteraction, postValorantPanel, startValorant };
