const IDLE_EVERY = 10 * 60 * 1000;
const QUIET_FOR = IDLE_EVERY;
const GAP = 1800;
const REPLY_GAP = 12000;
const talking = new Set();
const recentReplies = new Map();

const IDLE = [
  [
    ["rehber", "Arcade, ortalık sakın."],
    ["stack", "Sakinken menü daha net duruyor."],
    ["kaynak", "Ben de rafları düzüyorum. Birisi Python deyince gelirim."],
  ],
  [
    ["rehber", "Source, yeni gelene ne dersin?"],
    ["kaynak", "Önce ne yapmak istediğini yazsın. Doküman ondan sonra."],
    ["stack", "Rolünü de seçsin. Kapıda beklemeye gerek yok."],
  ],
  [
    ["stack", "Atrium, müzik açılırsa ben de kulak kabartırım."],
    ["atrium", "Ses kanalı dolunca açarım. Avlu şimdilik sessiz."],
    ["rehber", "Sessizlik de fena değil. Biri gelince haber veririm."],
  ],
  [
    ["kaynak", "Bugün raflarda JavaScript duruyor."],
    ["stack", "O rol bende hazır. İsteyen menüden alır."],
    ["rehber", "Güzel. Takılan olursa yardım kanalı açık."],
  ],
];

function say(emit, channelId, lines) {
  if (!channelId || talking.has(channelId)) return false;
  talking.add(channelId);
  setTimeout(() => talking.delete(channelId), lines.length * GAP + 1000);
  lines.forEach(([bot, text], index) => {
    emit("chat.say", { channelId, bot, text, delay: index * GAP });
  });
  return true;
}

function speakIfMine(client, bot, message) {
  if (message.event !== "chat.say" || message.data?.bot !== bot) return;
  const { channelId, text, delay = 0 } = message.data;
  if (!channelId || !text) return;
  setTimeout(() => {
    client.channels.fetch(channelId)
      .then((channel) => {
        if (channel?.isTextBased()) return channel.send(String(text).slice(0, 180));
        return null;
      })
      .catch((error) => console.error("Sohbet yazılamadı:", error.message));
  }, Math.min(Number(delay) || 0, 20000));
}

function joinLines(name) {
  const who = name || "Birisi";
  return [
    ["rehber", `${who} geldi. Arcade, kapıyı gösterir misin?`],
    ["stack", "Menü burada. Dilini seçsin, rolü ben takarım."],
    ["kaynak", "Takılırsa yardımda başlık açsın. Dokümanı ben bulurum."],
  ];
}

function idleLines() {
  return IDLE[Math.floor(Math.random() * IDLE.length)];
}

async function channelIsQuiet(channel) {
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const lastHuman = recent?.find((message) => !message.author.bot);
  if (!lastHuman) return true;
  return Date.now() - lastHuman.createdTimestamp >= QUIET_FOR;
}

const VOICES = {
  atrium: {
    names: /\b(atrium|atreium|atreum|aterum)\b/i,
    rules: [
      [/müzik|muzik|şarkı|sarki|\bçal\b|\bcal\b|playlist|liste/i, [
        "Şarkıyı /muzik ile yaz. Ses kanalı dolunca açarım.",
        "Listeye eklemek için /muzik ekle. Sırayı ben tutarım.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin|iyi misin/i, [
        "Buradayım. Avlu açık.",
        "İyiyim. Bir şey çalmamı istersen /muzik yaz.",
      ]],
      [/yardım|yardim|komut|ne yapı|ne yapi|ne iş|ne is/i, [
        "Müzik /muzik. Takılırsan yardım kanalında başlık aç.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "Atrium. Bu avlunun botuyum. Müzik ve karşılama bende.",
      ]],
    ],
    fallback: [
      "Duydum. Müzikse /muzik, başka bir şeyse kısaca yaz.",
      "Buradayım. Ne bakalım?",
    ],
  },
  stack: {
    names: /\barcade\b/i,
    rules: [
      [/rol|menü|menu|dil|javascript|python|typescript|java\b|rust|golang|\bgo\b/i, [
        "Rol menüsü yazılım kanalında. Dilini seç, ben takarım.",
        "Menüden seçmen yeterli. Üstüne o rolü ben koyarım.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin/i, [
        "Buradayım. Rol menüsü kapıda.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "Arcade. Dil ve alan rollerini ben dağıtırım.",
      ]],
    ],
    fallback: [
      "Rol menüsüne bak. İstediğin dili seçmen yeter.",
      "Duydum. Hangi rolü istediğini yaz.",
    ],
  },
  kaynak: {
    names: /\b(source|codex)\b/i,
    rules: [
      [/doküman|dokuman|github|depo|repo|link/i, [
        "Depoyu buraya yapıştır ya da /github yaz. Doküman için /dokuman.",
        "Ne aradığını bir cümle yaz. Uygun dokümanı ben seçerim.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin/i, [
        "Buradayım. Raf tarafı bende.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "Source. Doküman ve depo linkleri bende.",
      ]],
    ],
    fallback: [
      "Duydum. Doküman mı, depo mu? Kısaca yaz.",
      "Buradayım. Aradığın şeyi bir cümleyle söyle.",
    ],
  },
  rehber: {
    names: /\b(directory|portico|rehber)\b/i,
    rules: [
      [/yardım|yardim|başlık|baslik|kanal|nereye|nerede|ticket/i, [
        "Takıldığın yeri /ticket ile aç. Konu ve açıklamayı yaz, başlığı ben kurarım.",
        "Yeniysen yazılım kanalından rolünü al, sonra /ticket yaz.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin/i, [
        "Hoş geldin. Kapı bende.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "directory. Yeni geleni yönlendirir, yardım başlığına bakarım.",
      ]],
    ],
    fallback: [
      "Duydum. Nereye bakacağını kısaca yaz.",
      "Buradayım. Takıldığın yeri söyle.",
    ],
  },
};

function pickLine(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

function answerFor(text, voice) {
  const clean = String(text || "").replace(/<@!?\d+>/g, " ");
  for (const [test, lines] of voice.rules) {
    if (test.test(clean)) return pickLine(lines);
  }
  return pickLine(voice.fallback);
}

function answerMember(message, who = "atrium") {
  const voice = VOICES[who];
  if (!voice || !message.guild || message.author?.bot || !message.channel?.isTextBased()) return;
  const me = message.client.user;
  const named = voice.names.test(message.content || "");
  const mentioned = me && message.mentions.users.has(me.id);
  const replied = me && message.mentions.repliedUser?.id === me.id;
  if (!named && !mentioned && !replied) return;
  const key = `${who}:${message.channelId}:${message.author.id}`;
  const now = Date.now();
  if (now - (recentReplies.get(key) || 0) < REPLY_GAP) return;
  recentReplies.set(key, now);
  message.reply(answerFor(message.content, voice)).catch((error) => {
    console.error("Cevap yazılamadı:", error.message);
  });
}

module.exports = {
  say,
  speakIfMine,
  joinLines,
  idleLines,
  channelIsQuiet,
  answerMember,
  IDLE_EVERY,
};
