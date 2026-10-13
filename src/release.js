const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");
const { getGuild } = require("./store");
const { agentValorantToken } = require("./config");

const VERSION = "1.11.0";

const VALORANT_NOTES = [
  "`/valorant takim-kur` ses kanalındakileri ranka göre dengeli iki takıma böler; butonla yeniden karıştırılır veya iki ses kanalına dağıtılır.",
  "Rank rolleri her gün kendiliğinden güncellenir. Rank atlayınca sohbete duyurulur.",
  "`/valorant kaldir` hesap bağlantısını ve rank rolünü kaldırır.",
  "`/map` seçtiğin haritada güncel rekabetçi maçlarda en çok kazanan kompozisyonları gösterir. Rank filtresi de var.",
];

const NOTES = {
  radiant: VALORANT_NOTES,
  atrium: [
    ...(agentValorantToken ? [] : VALORANT_NOTES),
    "Otomatik moderasyon açıldı: flood, aynı mesajı tekrarlama, toplu etiket ve büyük harfle bağırma. Ayar için `/otomod`.",
    "`/muzik ses` artık müziği kesmeden anında değişir.",
    "RGB, Discord sınırına takılıp donmuyor. Renkler önce hızlı, sonra birkaç dakikada bir değişir.",
    "Sunucu verisi her gün yedeklenir. Son 7 gün saklanır.",
    "Karşılama yenilendi. Biri ses kanalına girip çıkınca da karşılamaya yazılır.",
    "`/kurulum` yalnız Kurallar, Duyurular ve Karşılama kanallarını kurar. Diğer kanalları `/kanal-ayarla` ile bağla.",
  ],
  ban: [],
  stack: [],
  kaynak: [
    "`/calistir` ile Python, JavaScript, Lua, C++, Java, Go, Rust ve daha fazla dilde kod çalıştırılır.",
    "`/github-takip ekle` ile bir deponun yeni commit ve sürümleri kanala düşer.",
    "`/github`, `/dokuman` ve `/calistir` artık her kanalda çalışır. GitHub linkleri her kanalda tanınır; aynı depo 10 dakikada bir kartlanır.",
  ],
  rehber: [
    "`/ticket` gizli başlık açar, yetkililere bildirim gönderir. Arcade ve Source de başlığa girer; yetkili Üstlen ile talebi alır.",
  ],
};

const WAIT = { atrium: 2000, stack: 4000, kaynak: 6000, rehber: 8000, ban: 10000, radiant: 12000 };
const COLOR = { atrium: 0xf1c40f, stack: 0x3498db, kaynak: 0x24292f, rehber: 0x9b59b6, ban: 0xe74c3c, radiant: 0xff4655 };

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
