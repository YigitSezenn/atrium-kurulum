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
const { henrikApiKey } = require("../config");
const { UserError } = require("../errors");
const { getGuild, updateGuild } = require("../store");
const { accountOf, update } = require("../valorantStore");
const { syncRankBadge } = require("../badges");

const REGION = "eu";

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

async function henrik(path) {
  if (!henrikApiKey) {
    throw new UserError("İstatistik için .env dosyasına HENRIK_API_KEY yaz. Anahtarı henrikdev.xyz üzerinden al; sohbete yapıştırma.");
  }
  const response = await fetch(`https://api.henrikdev.xyz${path}`, {
    headers: { Authorization: henrikApiKey, Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.errors?.[0]?.message || body.message || `Henrik yanıtı ${response.status}`;
    throw new UserError(String(message).slice(0, 180));
  }
  return body.data;
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

async function refresh(member, account) {
  const name = encodeURIComponent(account.name);
  const tag = encodeURIComponent(account.tag);
  const mmr = await henrik(`/valorant/v2/mmr/${REGION}/${name}/${tag}`);
  const tier = mmr?.current_data?.currenttierpatched || "";
  const roleName = await syncRankBadge(member, tier);
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
    entry.users[userId] = clean;
  });
  return clean;
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
        .setDescription("Hesabını bağla. Profilindeki rank rol olarak verilir. Bölge EU."),
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
  if (existing) {
    await existing.edit(panelPayload()).catch(() => {});
    return;
  }
  const message = await channel.send(panelPayload());
  await updateGuild(guild.id, (entry) => {
    entry.valorantPanelId = message.id;
  });
}

const command = {
  data: new SlashCommandBuilder()
    .setName("valorant")
    .setDescription("Valorant hesabını bağlar ve istatistik gösterir.")
    .addSubcommand((sub) => sub.setName("profil").setDescription("Bağlı hesabın rankını, RR ve son maçlarını gösterir."))
    .addSubcommand((sub) => sub.setName("bagla").setDescription("İsim ve etiket formunu açar.")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "bagla") {
      await interaction.showModal(linkModal());
      return;
    }
    const account = accountOf(interaction.guildId, interaction.user.id);
    if (!account) throw new UserError("Önce Valorant hesabını bağla. #komutlar kanalındaki butonu veya /valorant bagla kullan.");
    await interaction.deferReply();
    const embed = await refresh(interaction.member, account);
    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = { commands: [command], handleValorantButton, handleValorantModal, postValorantPanel };
