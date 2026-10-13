const crypto = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags } = require("discord.js");
const { UserError } = require("../errors");
const { levelOf } = require("../staff");
const { RANKS } = require("../badges");
const { accountOf, update, tempVoiceOf } = require("../valorantStore");
const { getGuild, updateGuild } = require("../store");

const MAPS = ["Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Split", "Sunset"];
const DEFAULT_RATING = RANKS.findIndex((rank) => rank.name === "Gold 1");
const EXHAUSTIVE_UP_TO = 14;
const TTL = 60 * 60 * 1000;
const sessions = new Map();

function ratingOf(tier) {
  const index = RANKS.findIndex((rank) => rank.name === tier);
  return index > 0 ? index : null;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function* combinations(count, size, start = 0, chosen = []) {
  if (chosen.length === size) {
    yield chosen;
    return;
  }
  for (let index = start; index <= count - (size - chosen.length); index += 1) {
    chosen.push(index);
    yield* combinations(count, size, index + 1, chosen);
    chosen.pop();
  }
}

function balance(players) {
  const total = players.reduce((sum, player) => sum + player.rating, 0);
  const size = Math.floor(players.length / 2);
  if (players.length <= EXHAUSTIVE_UP_TO) {
    const options = [];
    let best = Infinity;
    for (const combo of combinations(players.length, size)) {
      const sum = combo.reduce((acc, index) => acc + players[index].rating, 0);
      const diff = Math.abs(total - 2 * sum);
      if (diff > best + 1) continue;
      if (diff < best) best = diff;
      options.push({ combo: [...combo], diff });
    }
    const chosen = pick(options.filter((option) => option.diff <= best + 1));
    const inA = new Set(chosen.combo);
    return {
      a: players.filter((_, index) => inA.has(index)),
      b: players.filter((_, index) => !inA.has(index)),
    };
  }
  const sorted = [...players].sort((x, y) => y.rating - x.rating || Math.random() - 0.5);
  const a = [];
  const b = [];
  const cap = Math.ceil(players.length / 2);
  const sum = (team) => team.reduce((acc, player) => acc + player.rating, 0);
  for (const player of sorted) {
    const target = (a.length < cap && (sum(a) <= sum(b) || b.length >= cap)) ? a : b;
    target.push(player);
  }
  return { a, b };
}

function playersIn(channel) {
  return [...channel.members.values()]
    .filter((member) => !member.user.bot)
    .map((member) => {
      const account = accountOf(channel.guild.id, member.id);
      const rating = ratingOf(account?.tier);
      return {
        id: member.id,
        name: member.displayName,
        tier: rating ? account.tier : account ? "Derecesiz" : "Bağlı değil",
        rating: rating ?? DEFAULT_RATING,
        known: Boolean(rating),
      };
    });
}

function teamField(label, team) {
  const sum = team.reduce((acc, player) => acc + player.rating, 0);
  const average = team.length ? RANKS[Math.round(sum / team.length)]?.name || "—" : "—";
  const lines = team.map((player) => `• ${player.name} — ${player.tier}${player.known ? "" : " (tahmini)"}`);
  return { name: `${label} · ortalama ${average}`, value: lines.join("\n").slice(0, 1024) || "—", inline: true };
}

function sessionPayload(id, session) {
  const embed = new EmbedBuilder()
    .setColor(0xff4655)
    .setTitle("Takımlar hazır")
    .addFields(teamField("Takım A", session.teams.a), teamField("Takım B", session.teams.b))
    .setFooter({ text: "Rankı bilinmeyen oyuncular Gold 1 sayıldı. Rankını göstermek için hesabını bağla." });
  if (session.map) embed.setDescription(`Harita: **${session.map}**`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vteam:reroll:${id}`).setLabel("Yeniden kur").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`vteam:split:${id}`).setLabel("Ses kanallarına dağıt").setStyle(ButtonStyle.Primary).setDisabled(Boolean(session.split)),
  );
  return { embeds: [embed], components: [row] };
}

async function buildTeams(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) throw new UserError("Önce oyuncularla aynı ses kanalına gir.");
  const players = playersIn(channel);
  if (players.length < 2) throw new UserError("Takım kurmak için ses kanalında en az 2 kişi olmalı.");
  const id = crypto.randomBytes(4).toString("hex");
  const session = {
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: channel.id,
    withMap: interaction.options.getBoolean("harita") ?? true,
    teams: balance(players),
    split: false,
  };
  session.map = session.withMap ? pick(MAPS) : null;
  sessions.set(id, session);
  setTimeout(() => sessions.delete(id), TTL).unref();
  await interaction.reply(sessionPayload(id, session));
}

async function teamChannel(source, key, name) {
  const { guild } = source;
  const savedId = getGuild(guild.id)?.channels?.[key];
  const saved = savedId && (guild.channels.cache.get(savedId) || await guild.channels.fetch(savedId).catch(() => null));
  if (saved?.type === ChannelType.GuildVoice) return saved;
  const template = guild.channels.cache.get(getGuild(guild.id)?.channels?.ses) || source;
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent: template.parentId || undefined,
    bitrate: template.bitrate,
    permissionOverwrites: template.permissionOverwrites.cache.map((row) => ({
      id: row.id,
      type: row.type,
      allow: row.allow.bitfield,
      deny: row.deny.bitfield,
    })),
    reason: "Valorant takım kanalı",
  });
  await updateGuild(guild.id, (entry) => {
    entry.channels ??= {};
    entry.channels[key] = channel.id;
  });
  return channel;
}

async function splitIntoChannels(interaction, session) {
  const source = interaction.guild.channels.cache.get(session.channelId);
  if (!source) throw new UserError("Takımın kurulduğu ses kanalı artık yok.");
  await interaction.deferUpdate();
  const a = await teamChannel(source, "takim-a", "🔴 Takım A");
  const b = await teamChannel(source, "takim-b", "🔵 Takım B");
  const moves = [];
  for (const [team, target] of [[session.teams.a, a], [session.teams.b, b]]) {
    for (const player of team) {
      const member = interaction.guild.members.cache.get(player.id);
      if (member?.voice?.channelId) moves.push(member.voice.setChannel(target, "Valorant takımı").catch(() => {}));
    }
  }
  await Promise.all(moves);
  session.split = true;
}

async function handleTeamButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("vteam:")) return false;
  const [, action, id] = interaction.customId.split(":");
  const session = sessions.get(id);
  if (!session) throw new UserError("Bu takımın süresi doldu. /valorant takim-kur ile yeniden kur.");
  if (interaction.user.id !== session.ownerId && levelOf(interaction.member) < 3) {
    throw new UserError("Takımı yalnız kuran kişi veya yetkili değiştirir.");
  }
  if (action === "reroll") {
    const source = interaction.guild.channels.cache.get(session.channelId);
    const players = source ? playersIn(source) : [...session.teams.a, ...session.teams.b];
    if (players.length < 2) throw new UserError("Ses kanalında yeterli oyuncu kalmadı.");
    session.teams = balance(players);
    session.map = session.withMap ? pick(MAPS) : null;
    session.split = false;
    await interaction.update(sessionPayload(id, session));
    return true;
  }
  if (action === "split") {
    if (session.split) {
      await interaction.reply({ content: "Takımlar zaten dağıtıldı.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await splitIntoChannels(interaction, session);
    await interaction.editReply(sessionPayload(id, session));
    return true;
  }
  return false;
}

async function dropIfEmpty(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (channel && channel.members.size > 0) return;
  if (channel) await channel.delete("Valorant takım kanalı boşaldı").catch(() => {});
  await update(guild.id, (entry) => {
    entry.tempVoice = (entry.tempVoice || []).filter((id) => id !== channelId);
  });
}

function watchTeamVoice(client) {
  client.on("voiceStateUpdate", (before) => {
    if (!before.channelId || !tempVoiceOf(before.guild.id).includes(before.channelId)) return;
    dropIfEmpty(before.guild, before.channelId).catch((error) => console.error("Takım kanalı silinemedi:", error.message));
  });
  for (const guild of client.guilds.cache.values()) {
    for (const channelId of tempVoiceOf(guild.id)) {
      dropIfEmpty(guild, channelId).catch(() => {});
    }
  }
}

module.exports = { buildTeams, handleTeamButton, watchTeamVoice, balance };
