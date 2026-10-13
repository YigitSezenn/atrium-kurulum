const path = require("path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require("discord.js");
const { UserError } = require("../errors");
const { jsonFile } = require("../jsonFile");

const reminders = jsonFile(path.join(__dirname, "..", "..", "data", "reminders.json"), () => ({ items: [] }));
const afk = jsonFile(path.join(__dirname, "..", "..", "data", "afk.json"), () => ({ users: {} }));

const SIGNS = ["koc", "boga", "ikizler", "yengec", "aslan", "basak", "terazi", "akrep", "yay", "oglak", "kova", "balik"];
const SIGN_NAMES = {
  koc: "Koç",
  boga: "Boğa",
  ikizler: "İkizler",
  yengec: "Yengeç",
  aslan: "Aslan",
  basak: "Başak",
  terazi: "Terazi",
  akrep: "Akrep",
  yay: "Yay",
  oglak: "Oğlak",
  kova: "Kova",
  balik: "Balık",
};
const JOKES = [
  "Elektrikçiye ne denir? Akım akrabası.",
  "Matematik kitabı neden üzgündü? Çok problemi vardı.",
  "Balık neden gitar çalmaz? Çünkü yüzgeçleri tel tutmaz.",
  "Saat neden geç kaldı? Zamanı yoktu.",
  "Kahve neden yalnızdı? Çünkü filtreli bir ilişki istiyordu.",
];
const HOROSCOPE = [
  "Bugün acele etme. Küçük bir işi bitirmek günü toplar.",
  "Birine kısa bir mesaj yazmak işini kolaylaştırır.",
  "Planın yarısı yeter. Geri kalanı akşama kalsın.",
  "Eski bir işi kapatmak yeni bir kapı açar.",
  "Bugün dinlemek, konuşmaktan daha işe yarar.",
];
const MAX_REMINDER_MS = 30 * 24 * 60 * 60 * 1000;
let reminderTimer = null;

function parseDelay(text) {
  const match = String(text || "").trim().toLocaleLowerCase("tr").match(/^(\d+)\s*(sn|saniye|dk|dakika|sa|saat|g|gun|gün)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!amount) return 0;
  const unit = match[2];
  const ms = unit.startsWith("sn") || unit === "saniye"
    ? amount * 1000
    : unit.startsWith("dk") || unit === "dakika"
      ? amount * 60_000
      : unit.startsWith("sa")
        ? amount * 3_600_000
        : amount * 86_400_000;
  if (ms > MAX_REMINDER_MS) return 0;
  return ms;
}

function quakeLines(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 10).map((row) => {
    const place = String(row.title || row.lokasyon || "Bilinmeyen yer").slice(0, 80);
    const size = row.mag ?? row.buyukluk ?? "?";
    const when = String(row.date || row.tarih || "").slice(0, 16);
    return `**${size}** · ${place}${when ? ` · ${when}` : ""}`;
  });
}

function command(name, description, execute, build) {
  const data = new SlashCommandBuilder().setName(name).setDescription(description);
  if (build) build(data);
  return { data, execute };
}

async function press(interaction, content, row, filter) {
  await interaction.reply({ content, components: [row] });
  const message = await interaction.fetchReply();
  return message.awaitMessageComponent({
    time: 20_000,
    filter: (button) => filter(button) && button.user.id,
  }).catch(() => null);
}

const commands = [
  command("afk", "Uzakta durumunu belirle.", async (interaction) => {
    const text = (interaction.options.getString("mesaj") || "Birazdan dönerim.").slice(0, 120);
    afk.update((data) => {
      data.users[interaction.user.id] = { text, at: Date.now() };
      return data;
    });
    await interaction.reply(`AFK oldun: ${text}`);
  }, (data) => data.addStringOption((option) => option.setName("mesaj").setDescription("Dönenlere görünecek not").setMaxLength(120))),

  command("depremler", "Türkiye'de yaşanan son 10 depremi gösterir.", async (interaction) => {
    await interaction.deferReply();
    const response = await fetch("https://api.orhanaydogdu.com.tr/deprem/kandilli/live", {
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    const lines = quakeLines(body?.result);
    if (!lines.length) throw new UserError("Deprem listesini alamadım. Biraz sonra tekrar dene.");
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("Son depremler").setDescription(lines.join("\n"))],
    });
  }),

  command("yardim", "Botta bulunan komutlar hakkında yardım almanı sağlar.", async (interaction) => {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("Komutlar").setDescription([
        "**Müzik:** `/cal` `/oynat` `/atla` `/duraklat` `/devam` `/kapat` `/ses` `/sarki` `/liste` `/karistir` `/sardir` `/tekrarla` `/lyrics` `/filtreler`",
        "**Soru:** `/sor` yanıtı özelden yollar.",
        "**Eğlence:** `/afk` `/hatirlat` `/depremler` `/iftar` `/ping` `/kedi` `/kopek` `/espri` `/yazitura` `/tkm` `/duello` `/rusruleti`",
      ].join("\n\n"))],
    });
  }),

  command("iftar", "Yaklaşan iftar ve sahur vakitlerini gösterir.", async (interaction) => {
    const city = interaction.options.getString("sehir") || "Istanbul";
    await interaction.deferReply();
    const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Turkey&method=13`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    const times = body?.data?.timings;
    if (!times?.Fajr || !times?.Maghrib) throw new UserError("Bu şehir için vakit bulamadım. Şehir adını tekrar yaz.");
    await interaction.editReply(`**${city}** · Sahur ${times.Fajr} · İftar ${times.Maghrib}`);
  }, (data) => data.addStringOption((option) => option.setName("sehir").setDescription("Boşsa İstanbul").setMaxLength(40))),

  command("ping", "Botun gecikme süresini hesaplar.", async (interaction) => {
    const gateway = Math.round(interaction.client.ws.ping);
    await interaction.reply(`Gecikme: **${gateway}** ms`);
  }),

  command("hatirlat", "Hatırlatıcı oluşturur.", async (interaction) => {
    const delay = parseDelay(interaction.options.getString("sure"));
    if (!delay) throw new UserError("Süreyi `10dk`, `2sa`, `1g` ya da `30sn` gibi yaz. En fazla 30 gün.");
    const text = interaction.options.getString("mesaj").slice(0, 300);
    const item = {
      id: `${Date.now()}`,
      userId: interaction.user.id,
      text,
      at: Date.now() + delay,
    };
    reminders.update((data) => {
      data.items = [...(data.items || []), item].slice(-100);
      return data;
    });
    await interaction.reply("Hatırlatıcı kuruldu. Vakti gelince özelden yazarım.");
  }, (data) => data
    .addStringOption((option) => option.setName("sure").setDescription("10dk, 2sa, 1g veya 30sn").setRequired(true).setMaxLength(12))
    .addStringOption((option) => option.setName("mesaj").setDescription("Hatırlatılacak not").setRequired(true).setMaxLength(300))),

  command("hatirlaticilar", "Hatırlatıcıları gösterir.", async (interaction) => {
    const mine = (reminders.read().items || []).filter((item) => item.userId === interaction.user.id);
    if (!mine.length) {
      await interaction.reply("Açık hatırlatıcın yok. Kurmak için `/hatirlat` yaz.");
      return;
    }
    const lines = mine.slice(0, 10).map((item) => `• ${new Date(item.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} — ${item.text}`);
    await interaction.reply(lines.join("\n"));
  }),

  command("ataturk", "Kısa bir saygı cümlesi.", async (interaction) => {
    await interaction.reply("Yurtta sulh, cihanda sulh.");
  }),

  command("kedi", "Birbirinden farklı kedi fotoğrafları!", async (interaction) => {
    await interaction.reply({ files: [`https://cataas.com/cat?width=600&t=${Date.now()}`] });
  }),

  command("kopek", "Birbirinden farklı köpek fotoğrafları!", async (interaction) => {
    await interaction.deferReply();
    const response = await fetch("https://dog.ceo/api/breeds/image/random", { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    if (!body?.message) throw new UserError("Köpek fotoğrafını alamadım. Biraz sonra tekrar dene.");
    await interaction.editReply({ files: [body.message] });
  }),

  command("hack", "Şaka amaçlı sahte bir ekran gösterir. Kimsenin verisine bakmaz.", async (interaction) => {
    const person = interaction.options.getUser("uye");
    const name = person ? person.username : interaction.user.username;
    await interaction.reply([
      `\`${name}\` için sahte tarama başladı...`,
      "Bağlantı kuruluyor... %40",
      "Bu bir şaka. Kimsenin gerçek verisine bakılmadı ve hiçbir şey satılmadı.",
    ].join("\n"));
  }, (data) => data.addUserOption((option) => option.setName("uye").setDescription("Şakanın konusu").setRequired(false))),

  command("burcyorum", "Günlük burç yorumuna kısa bir not düşer.", async (interaction) => {
    const sign = interaction.options.getString("burc");
    const day = new Date().getDate();
    const line = HOROSCOPE[(SIGNS.indexOf(sign) + day) % HOROSCOPE.length];
    await interaction.reply(`**${SIGN_NAMES[sign]}** · ${line}`);
  }, (data) => data.addStringOption((option) => option
    .setName("burc")
    .setDescription("Burcun")
    .setRequired(true)
    .addChoices(...SIGNS.map((value) => ({ name: SIGN_NAMES[value], value }))))),

  command("kaccm", "Rastgele bir ölçüm yapar.", async (interaction) => {
    const size = 8 + Math.floor(Math.random() * 22);
    await interaction.reply(`Ölçüm tamam: **${size}** cm. Ciddiye alma.`);
  }),

  command("espri", "Rastgele soğuk espriler!", async (interaction) => {
    await interaction.reply(JOKES[Math.floor(Math.random() * JOKES.length)]);
  }),

  command("askolcer", "Aşkınızı ölçün!", async (interaction) => {
    const other = interaction.options.getUser("uye");
    const score = Math.floor(Math.random() * 101);
    await interaction.reply(`${interaction.user} ve ${other} arasında **%${score}**.`);
  }, (data) => data.addUserOption((option) => option.setName("uye").setDescription("Ölçülecek kişi").setRequired(true))),

  command("avatar", "Bahsettiğin kişinin profil fotoğrafını gösterir.", async (interaction) => {
    const person = interaction.options.getUser("uye") || interaction.user;
    await interaction.reply(person.displayAvatarURL({ size: 512 }));
  }, (data) => data.addUserOption((option) => option.setName("uye").setDescription("Boşsa senin fotoğrafın"))),

  command("banner", "Bahsettiğin kişinin afiş fotoğrafını gösterir.", async (interaction) => {
    const person = interaction.options.getUser("uye") || interaction.user;
    const full = await person.fetch(true).catch(() => person);
    const banner = full.bannerURL?.({ size: 1024 });
    if (!banner) throw new UserError("Bu kişinin afişi yok.");
    await interaction.reply(banner);
  }, (data) => data.addUserOption((option) => option.setName("uye").setDescription("Boşsa senin afişin"))),

  command("yazitura", "Arkadaşlarınla beraber yazı tura at.", async (interaction) => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("yazi").setLabel("Yazı").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("tura").setLabel("Tura").setStyle(ButtonStyle.Secondary),
    );
    const click = await press(interaction, "Yazı mı, tura mı?", row, (button) => button.user.id === interaction.user.id);
    if (!click) {
      await interaction.editReply({ content: "Süre doldu.", components: [] }).catch(() => {});
      return;
    }
    const landed = Math.random() < 0.5 ? "yazi" : "tura";
    const label = landed === "yazi" ? "Yazı" : "Tura";
    const picked = click.customId === "yazi" ? "Yazı" : "Tura";
    await click.update({ content: `Sen **${picked}** dedin. Gelen **${label}**. ${picked === label ? "Tuttun." : "Tutmadı."}`, components: [] });
  }),

  command("duello", "Arkadaşlarınla beraber düello yap.", async (interaction) => {
    const rival = interaction.options.getUser("uye");
    if (!rival || rival.id === interaction.user.id || rival.bot) throw new UserError("Düello için başka birini seç.");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("kabul").setLabel("Kabul").setStyle(ButtonStyle.Danger),
    );
    const click = await press(interaction, `${rival}, ${interaction.user} düello istiyor.`, row, (button) => button.user.id === rival.id);
    if (!click) {
      await interaction.editReply({ content: "Düello kabul edilmedi.", components: [] }).catch(() => {});
      return;
    }
    const winner = Math.random() < 0.5 ? interaction.user : rival;
    await click.update({ content: `Düelloyu ${winner} kazandı.`, components: [] });
  }, (data) => data.addUserOption((option) => option.setName("uye").setDescription("Rakip").setRequired(true))),

  command("tkm", "Taş, kağıt, makas oyna.", async (interaction) => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("tas").setLabel("Taş").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("kagit").setLabel("Kağıt").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("makas").setLabel("Makas").setStyle(ButtonStyle.Primary),
    );
    const click = await press(interaction, "Seçimini yap.", row, (button) => button.user.id === interaction.user.id);
    if (!click) {
      await interaction.editReply({ content: "Süre doldu.", components: [] }).catch(() => {});
      return;
    }
    const hands = ["tas", "kagit", "makas"];
    const labels = { tas: "Taş", kagit: "Kağıt", makas: "Makas" };
    const mine = hands[Math.floor(Math.random() * hands.length)];
    const beats = { tas: "makas", kagit: "tas", makas: "kagit" };
    const result = click.customId === mine ? "Berabere." : beats[click.customId] === mine ? "Kazandın." : "Kaybettin.";
    await click.update({ content: `Sen **${labels[click.customId]}**, ben **${labels[mine]}**. ${result}`, components: [] });
  }),

  command("rusruleti", "Arkadaşlarınla rus ruleti oyna. Kimse kanaldan atılmaz.", async (interaction) => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("tetik").setLabel("Tetik").setStyle(ButtonStyle.Danger),
    );
    const click = await press(interaction, "Altı gözden biri dolu. Tetiği sen çek.", row, (button) => button.user.id === interaction.user.id);
    if (!click) {
      await interaction.editReply({ content: "Süre doldu.", components: [] }).catch(() => {});
      return;
    }
    const boom = Math.floor(Math.random() * 6) === 0;
    await click.update({ content: boom ? "Tıkladı. Bu tur sende bitti." : "Kuru sıkı. Tur devam eder.", components: [] });
  }),
];

function watchAfk(message) {
  if (!message.guild || message.author?.bot) return;
  const data = afk.read();
  const users = data.users || {};
  if (users[message.author.id]) {
    afk.update((entry) => {
      delete entry.users[message.author.id];
      return entry;
    });
    message.reply("AFK kalktı.").catch(() => {});
    return;
  }
  const away = message.mentions.users.find((user) => users[user.id]);
  if (!away) return;
  message.reply(`${away} uzakta: ${users[away.id].text}`).catch(() => {});
}

function startReminders(client) {
  if (reminderTimer) return;
  reminderTimer = setInterval(() => {
    const due = (reminders.read().items || []).filter((item) => item.at <= Date.now());
    if (!due.length) return;
    const gone = new Set(due.map((item) => item.id));
    reminders.update((data) => {
      data.items = (data.items || []).filter((item) => !gone.has(item.id));
      return data;
    });
    for (const item of due) {
      client.users.fetch(item.userId)
        .then((user) => user.send(`Hatırlatma: ${item.text}`))
        .catch(() => {});
    }
  }, 30_000);
  reminderTimer.unref?.();
}

module.exports = { commands, watchAfk, startReminders, parseDelay, quakeLines };
