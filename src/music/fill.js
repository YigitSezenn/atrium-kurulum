const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { UserError } = require("../errors");
const { MAX_QUEUE } = require("./player");
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
  if (!player.backlog?.length || player.queue.length >= MAX_QUEUE) return;
  player.topping = true;
  const token = player.loadGeneration;
  try {
    while (
      player.backlog.length
      && player.queue.length < MAX_QUEUE
      && player.loadGeneration === token
      && !player.leaving
    ) {
      const next = player.backlog.shift();
      try {
        const found = await resolveTrack(next.query);
        if (player.loadGeneration !== token || player.leaving) return;
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
  const firstBatch = Math.min(MAX_QUEUE, queries.length);
  if (many) {
    await interaction.editReply(`Liste ${queries.length} parça. İlk ${firstBatch} aranıyor. Bitene kadar yeni çalma komutu alınmaz.`);
  } else {
    await interaction.editReply("Şarkı aranıyor. Bitene kadar yeni çalma komutu alınmaz.");
  }

  const added = [];
  let skipped = 0;
  let announced = false;
  let index = 0;

  while (index < queries.length && player.queue.length < MAX_QUEUE) {
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
      if (!announced) {
        announced = true;
        await player.startIfIdle();
      }
      if (many) {
        const head = added[0]
          ? `Başlıyor: **${added[0].title}**. Aranan ${index}/${queries.length}, sırada ${added.length}.`
          : `Aranan ${index}/${queries.length}.`;
        await interaction.editReply({
          content: `${head} Bitene kadar yeni çalma komutu alınmaz.`,
          components: [controlRow()],
        }).catch(() => {});
      } else {
        const line = wasPlaying
          ? `Sıraya eklendi: **${track.title}** (${formatDuration(track.duration)})`
          : `Başlıyor: **${track.title}** (${formatDuration(track.duration)})`;
        await interaction.editReply({ content: line, components: [controlRow()] }).catch(() => {});
      }
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
  if (many && player.loadGeneration === token) {
    const notes = [];
    if (skipped) notes.push(`${skipped} parça bulunamadı.`);
    if (player.backlog.length) notes.push(`Kalan ${player.backlog.length} parça çaldıkça eklenecek.`);
    const tail = notes.length ? ` ${notes.join(" ")}` : "";
    await interaction.followUp({ content: `Sırada ${added.length} parça.${tail}` }).catch(() => {});
  }
  return { added, skipped, waiting: player.backlog.length, cancelled: player.loadGeneration !== token };
}

module.exports = { BUSY, claim, guard, fillQueries, topUp };
