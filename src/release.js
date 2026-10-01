const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");
const { getGuild } = require("./store");

const VERSION = "1.4.0";

const NOTES = {
  atrium: [
    "Müzik komutları artık her yazı kanalında çalışır.",
    "`/muzik cal` ve `/muzik liste-cal` içinde ses kanalı seçebilirsin. Boş bırakırsan bulunduğun kanala girerim.",
    "Adımı yazınca veya etiketleyince cevap veririm.",
  ],
  stack: [
    "Adımı yazınca veya etiketleyince cevap veririm.",
    "Yardım başlığında üstündeki dil rollerini söylerim.",
  ],
  kaynak: [
    "`/github` ve `/dokuman` silinmiş kanala takılmaz.",
    "Projeler, yığın, yardım ve komut kanallarında, yardım başlığında da çalışır.",
    "Adımı yazınca cevap veririm.",
  ],
  rehber: [
    "Yardım için `/ticket` yaz. Konu ve açıklama yeter, başlığı ben açarım.",
    "Genel kanal 10 dakikadır sessizse kısa bir muhabbet başlatırım.",
  ],
};

const WAIT = { atrium: 2000, stack: 4000, kaynak: 6000, rehber: 8000 };
const COLOR = { atrium: 0xf1c40f, stack: 0x3498db, kaynak: 0x24292f, rehber: 0x9b59b6 };

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
