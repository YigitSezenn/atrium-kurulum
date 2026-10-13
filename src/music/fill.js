const { UserError } = require("../errors");
const { playingCard } = require("./card");
const { resolveTrack } = require("./resolve");

const BUSY = "Şu an bir şarkı aranıyor. Birkaç saniye bekle, sonra tekrar yaz.";

function requestOf(query) {
  return typeof query === "string" ? { text: query } : (query || { text: "" });
}

function present(found, request, requesterId) {
  const track = { ...found, requesterId };
  if (!track.service) track.service = track.source === "http" ? "youtube" : track.source;
  if (!track.page) track.page = track.webpage || "";
  if (request.service !== "spotify") return track;
  track.service = "spotify";
  if (request.title) track.title = String(request.title).slice(0, 120);
  if (request.artist) track.artist = String(request.artist).slice(0, 80);
  track.page = request.link || "";
  if (request.image) track.thumbnail = request.image;
  return track;
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
        const request = requestOf(next.query);
        const found = await resolveTrack(request.text);
        if (player.loadGeneration !== token || player.leaving) {
          player.backlog.unshift(next);
          return;
        }
        if (!player.enqueue(present(found, request, next.requesterId))) {
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
    await interaction.editReply(`${queries.length} şarkı var. İlki hazırlanıyor, kalanlar çaldıkça eklenecek.`);
  } else {
    await interaction.editReply("Şarkı aranıyor…");
  }

  const added = [];
  let skipped = 0;
  let index = 0;

  while (index < queries.length && !added.length) {
    if (player.loadGeneration !== token) return { added, skipped, waiting: player.backlog.length, cancelled: true };
    const request = requestOf(queries[index]);
    index += 1;
    try {
      const found = await resolveTrack(request.text);
      if (player.loadGeneration !== token) return { added, skipped, waiting: player.backlog.length, cancelled: true };
      const track = present(found, request, requesterId);
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

  if (!added.length && !player.backlog.length) throw new UserError("Bu şarkıyı bulamadım. Adını ya da bağlantısını kontrol edip tekrar dene.");
  if (player.loadGeneration === token && added.length) {
    const track = added[0];
    const notes = [];
    if (player.backlog.length) notes.push(`Kalan ${player.backlog.length} şarkı çaldıkça eklenecek.`);
    if (skipped) notes.push(`${skipped} şarkı bulunamadı, onlar atlandı.`);
    await interaction.editReply(playingCard(track, player, { queued: wasPlaying, note: notes.join(" ") })).catch(() => {});
  }
  return { added, skipped, waiting: player.backlog.length, cancelled: player.loadGeneration !== token };
}

module.exports = { BUSY, claim, guard, fillQueries, topUp };
