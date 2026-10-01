const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");
const { getGuild } = require("./store");

const VERSION = "1.8.0";

const NOTES = {
  atrium: [
    "Müzik aracı konteynerde hazır gelir. Şarkı araması, araç inmeden başlamaz.",
    "`/muzik cal` Discord'a hemen cevap verir. Komut üç saniyelik süre aşımına düşmez.",
    "Şarkı geçilince veya durunca kalan ffmpeg boru uyarısı loga yazılmaz.",
  ],
  ban: [],
  stack: [],
  kaynak: [],
  rehber: [],
};

const WAIT = { atrium: 2000, stack: 4000, kaynak: 6000, rehber: 8000, ban: 10000 };
const COLOR = { atrium: 0xf1c40f, stack: 0x3498db, kaynak: 0x24292f, rehber: 0x9b59b6, ban: 0xe74c3c };

function alreadyPosted(bot) {
  try {
    const saved = JSON.parse(fs.readFileSync(markerPath(bot), "utf8"));
    return saved.version === VERSION;
  } catch {
    return false;
  }
}

function markerPath(bot) {
  return path.join(__dirname, "..", "data", `release-${bot}.json`);
}

function markPosted(bot) {
  const file = markerPath(bot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: VERSION }));
}

async function announceRelease(client, bot) {
  const lines = NOTES[bot];
  if (!lines?.length || alreadyPosted(bot)) return;
  await new Promise((resolve) => setTimeout(resolve, WAIT[bot] || 2000));
  if (alreadyPosted(bot)) return;
  let posted = 0;
  for (const guild of client.guilds.cache.values()) {
    const channelId = getGuild(guild.id)?.channels?.duyurular;
    if (!channelId) continue;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR[bot] || 0xf1c40f)
          .setTitle(`${client.user.username} · ${VERSION}`)
          .setDescription(lines.map((line) => `• ${line}`).join("\n")),
      ],
    });
    posted += 1;
  }
  if (!posted) return;
  markPosted(bot);
  console.log(`${bot} yama notunu yazdı (${VERSION}).`);
}

module.exports = { VERSION, announceRelease };
