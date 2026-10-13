const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { formatSpoken } = require("./resolve");

const ICONS = {
  youtube: "https://www.google.com/s2/favicons?domain=youtube.com&sz=64",
  spotify: "https://www.google.com/s2/favicons?domain=spotify.com&sz=64",
  soundcloud: "https://www.google.com/s2/favicons?domain=soundcloud.com&sz=64",
};

const COLORS = {
  youtube: 0xff0033,
  spotify: 0x1db954,
  soundcloud: 0xff5500,
};

const OPEN = {
  youtube: "YouTube'da aç",
  spotify: "Spotify'da aç",
  soundcloud: "SoundCloud'da aç",
};

function pageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const host = url.hostname.toLowerCase();
    if (host === "googlevideo.com" || host.endsWith(".googlevideo.com")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function serviceOf(track) {
  const name = track?.service || track?.source;
  if (name === "spotify" || name === "youtube" || name === "soundcloud") return name;
  return "youtube";
}

function playingCard(track, player, { queued = false, note = "" } = {}) {
  const service = serviceOf(track);
  const embed = new EmbedBuilder()
    .setColor(COLORS[service])
    .setAuthor({ name: String(track.title || "Şarkı").slice(0, 256), iconURL: ICONS[service] })
    .addFields(
      { name: "DJ", value: track.requesterId ? `<@${track.requesterId}>` : "—", inline: true },
      { name: "Ses", value: `%${Math.round((player?.volume ?? 0.8) * 100)}`, inline: true },
      { name: "Süre", value: formatSpoken(track.duration), inline: true },
    )
    .setFooter({ text: queued ? "Sıraya eklendi." : "Şarkı oynatılıyor." });
  if (track.artist) embed.setDescription(String(track.artist).slice(0, 200));
  const image = pageUrl(track.thumbnail);
  if (image) embed.setThumbnail(image);
  const buttons = [];
  const page = pageUrl(track.page || track.webpage);
  if (page) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(OPEN[service]).setURL(page));
  buttons.push(
    new ButtonBuilder().setCustomId("muzik:skip").setLabel("Geç").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("muzik:stop").setLabel("Durdur").setStyle(ButtonStyle.Danger),
  );
  return {
    content: note || "",
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(buttons)],
  };
}

module.exports = { playingCard, pageUrl };
