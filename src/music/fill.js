const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { UserError } = require("../errors");
const { resolveTrack, formatDuration } = require("./resolve");

const BUSY = "Bir liste sıraya giriyor. Bitene kadar /muzik cal ve /spotify cal çalışmaz.";

function controlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("muzik:skip").setLabel("Geç").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("muzik:stop").setLabel("Durdur").setStyle(ButtonStyle.Danger),
  );
}

function claim(player) {
  if (player.loading) throw new UserError(BUSY);
  player.loading = true;
  player.loadGeneration = (player.loadGeneration || 0) + 1;
  return player.loadGeneration;
}

function release(player, token) {
  if (player.loadGeneration === token) player.loading = false;
  topUp(player).catch((error) => console.error("Sıra tamamlanamadı:", error.message));
}

async function guard(player, work) {
  const token = claim(player);
  try {
    return await work(token);
  } finally {
    release(player, token);
  }
}

async function topUp(player) {
  if (player.loading || player.topping || player.leaving) return;
  if (!player.backlog?.length || player.queue.length >= 1) return;
  player.topping = true;
  const token = player.loadGeneration;
  try {
    while (player.backlog.length && player.queue.length < 1 && !player.loading && !player.leaving) {
      const next = player.backlog.shift();
      if (!next) return;
      try {
        const found = await resolveTrack(next.query);
        if (player.loadGeneration !== token || player.leaving) {
          player.backlog.unshift(next);
          return;
        }
        if (!player.enqueue({ ...found, requesterId: next.requesterId })) {
          player.backlog.unshift(next);
          return;
        }
        await player.startIfIdle();
      } catch (error) {
        console.error("Parça sıraya girmedi:", error.message);
      }
    }
  } finally {
    player.topping = false;
  }
}

async function fillQueries(player, interaction, queries, requesterId) {
  const token = player.loadGeneration;
  const wasPlaying = Boolean(player.current);
  const many = queries.length > 1;
  if (many) {
    await interaction.editReply(`Liste ${queries.length} parça. İlki aranıyor. Kalanlar çaldıkça eklenecek.`);
  } else {
    await interaction.editReply("Şarkı aranıyor. Bitene kadar yeni çalma komutu alınmaz.");
  }

  const added = [];
  let skipped = 0;
  let index = 0;

  while (index < queries.length && !added.length) {
    if (player.loadGeneration !== token) return { added, skipped, waiting: player.backlog.length, cancelled: true };
    const query = queries[index];
    index += 1;
    try {
      const found = await resolveTrack(query);
      if (player.loadGeneration !== token) return { added, skipped, waiting: player.backlog.length, cancelled: true };
      const track = { ...found, requesterId };
      if (!player.enqueue(track)) {
        index -= 1;
        break;
      }
      added.push(track);
      await player.startIfIdle();
    } catch (error) {
      if (queries.length === 1) throw error;
      skipped += 1;
      console.error("Parça sıraya girmedi:", error.message);
    }
  }

  if (index < queries.length && player.loadGeneration === token) {
    player.backlog.push(...queries.slice(index).map((query) => ({ query, requesterId })));
  }

  if (!added.length && !player.backlog.length) throw new UserError("Parça bulunamadı. Başka bir ad veya bağlantı dene.");
  if (player.loadGeneration === token && added.length) {
    const track = added[0];
    const line = wasPlaying
      ? `Sıraya eklendi: **${track.title}** (${formatDuration(track.duration)})`
      : `Başlıyor: **${track.title}** (${formatDuration(track.duration)})`;
    const rest = player.backlog.length ? ` Kalan ${player.backlog.length} parça çaldıkça eklenecek.` : "";
    const missed = skipped ? ` ${skipped} parça bulunamadı.` : "";
    await interaction.editReply({ content: `${line}${rest}${missed}`, components: [controlRow()] }).catch(() => {});
  }
  return { added, skipped, waiting: player.backlog.length, cancelled: player.loadGeneration !== token };
}

module.exports = { BUSY, claim, guard, fillQueries, topUp };
