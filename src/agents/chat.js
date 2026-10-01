const { chatApiBase, chatApiExpires, chatApiKey, chatModel } = require("../config");
const { getGuild } = require("../store");

const IDLE_EVERY = 10 * 60 * 1000;
const QUIET_FOR = IDLE_EVERY;
const GAP = 1800;
const REPLY_GAP = 12000;
const talking = new Set();
const recentReplies = new Map();
const BOTS = new Set(["atrium", "stack", "kaynak", "rehber"]);

const WHO = {
  atrium: "Atrium. Avlunun botu. Müzik ve karşılama onda. Sakin ve kısa konuşur.",
  stack: "Arcade. Dil ve alan rollerini dağıtır. Menüye yönlendirir, kısa konuşur.",
  kaynak: "Source. Doküman ve GitHub raflarına bakar. Net ve kısa konuşur.",
  rehber: "directory. Yeni geleni karşılar, yardım başlığı açar. Sıcak ve kısa konuşur.",
};

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
  [
    ["atrium", "Avluda rüzgâr var. Kimse şarkı istemedi daha."],
    ["rehber", "İsteyen yazsın. Ben kapıyı tutarım."],
    ["kaynak", "Yazmadan önce bir cümle yeter. Ne aradığını bileyim."],
  ],
  [
    ["stack", "TypeScript rolü boş duruyor. Seven varsa menüde."],
    ["kaynak", "Tip yazmayı seven, dokümanı da sever. İkisini de bulurum."],
    ["rehber", "Kararsız olan yardımda sorsun. Yönü ben gösteririm."],
  ],
  [
    ["rehber", "Source, biri hata yapıştırırsa ilk nereye bakıyorsun?"],
    ["kaynak", "Hata satırına. Sonra dilin dokümanına. Tahminle gitmem."],
    ["atrium", "Ben de öyle. Şarkı adını yazmazlarsa çalamam."],
  ],
  [
    ["kaynak", "Rust seven az konuşur, çok derler."],
    ["stack", "Rolü yine de menüde. Sessiz seven de alsın."],
    ["rehber", "Sessiz gelen de hoş. Zorla sohbet ettirmem."],
  ],
  [
    ["atrium", "Playlist biriksin diye bekliyorum. Tek şarkılık avlu da olur."],
    ["stack", "Tek kişi de rol alır. Kalabalık şart değil."],
    ["kaynak", "Tek soru da yeter. Raf ona göre açılır."],
  ],
  [
    ["rehber", "Arcade, yeni biri gelince menüyü uzatman yetiyor mu?"],
    ["stack", "Yetiyor. Seçsin, ben takayım. Peşinden koşmam."],
    ["kaynak", "Takılırsa depo linkini buraya bırakır. Gerisini ben okurum."],
  ],
  [
    ["kaynak", "Go mu, Java mı, bugün ikisi de rafta."],
    ["stack", "İkisinin rolü ayrı. Karıştırmam."],
    ["atrium", "Ben karıştırmam da şarkıları. Sıra sırayla gider."],
  ],
  [
    ["rehber", "Akşam oldu. Birisi takıldıysa başlık hâlâ açık."],
    ["kaynak", "Başlıkta dilini yazsın. Dokümanı ona göre seçerim."],
    ["stack", "Rolü yoksa önce menü. Sonra sorsun."],
  ],
];

const JOIN = [
  (who) => [
    ["rehber", `${who} geldi. Arcade, kapıyı gösterir misin?`],
    ["stack", "Menü burada. Dilini seçsin, rolü ben takarım."],
    ["kaynak", "Takılırsa yardımda başlık açsın. Dokümanı ben bulurum."],
  ],
  (who) => [
    ["stack", `${who} için menü hazır. Dilini seçmesi yeter.`],
    ["rehber", "Hoş geldi. Yolunu şaşırırsa bana sorsun."],
    ["atrium", "Avlu açık. Şarkı isterse ses kanalına geçsin."],
  ],
  (who) => [
    ["kaynak", `${who} geldi. Ne yapmak istediğini yazarsa rafı açarım.`],
    ["rehber", "Acele ettirmeyelim. Önce baksın, sonra sorsun."],
    ["stack", "Rol menüsü duruyor. İstediği zaman alır."],
  ],
  (who) => [
    ["rehber", `Kapı açıldı. ${who}, burası yazılım avlusu.`],
    ["stack", "Dilini menüden seç. Rolü ben koyarım."],
    ["kaynak", "Doküman ya da depo lazımsa adını yazması yeter."],
  ],
];

function botsMayTalk(guildId) {
  return getGuild(guildId)?.chatEnabled !== false;
}

function say(emit, channelId, lines) {
  if (!channelId || !lines?.length || talking.has(channelId)) return false;
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
        if (!channel?.isTextBased() || !botsMayTalk(channel.guildId)) return null;
        return channel.send(String(text).slice(0, 180));
      })
      .catch((error) => console.error("Sohbet yazılamadı:", error.message));
  }, Math.min(Number(delay) || 0, 20000));
}

function joinLines(name) {
  const who = name || "Birisi";
  const scene = JOIN[Math.floor(Math.random() * JOIN.length)];
  return scene(who);
}

function scriptedIdle() {
  return IDLE[Math.floor(Math.random() * IDLE.length)];
}

async function idleLines() {
  const generated = await sceneFromModel().catch((error) => {
    console.error("Sohbet üretilemedi:", error.message);
    return null;
  });
  return generated || scriptedIdle();
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
        "Birden fazla şarkıysa araya | koy. Sırayla açarım.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin|iyi misin/i, [
        "Buradayım. Avlu açık.",
        "İyiyim. Bir şey çalmamı istersen /muzik yaz.",
        "Selam. Ses tarafı sakın, istek gelince açarım.",
      ]],
      [/yardım|yardim|komut|ne yapı|ne yapi|ne iş|ne is/i, [
        "Müzik /muzik. Takılırsan yardım kanalında başlık aç.",
        "Bende müzik ve karşılama var. Başka iş için directory'ye bak.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "Atrium. Bu avlunun botuyum. Müzik ve karşılama bende.",
      ]],
    ],
    fallback: [
      "Duydum. Müzikse /muzik, başka bir şeyse kısaca yaz.",
      "Buradayım. Ne bakalım?",
      "Dinliyorum. Bir cümle yeter.",
    ],
  },
  stack: {
    names: /\barcade\b/i,
    rules: [
      [/rol|menü|menu|dil|javascript|python|typescript|java\b|rust|golang|\bgo\b/i, [
        "Rol menüsü yazılım kanalında. Dilini seç, ben takarım.",
        "Menüden seçmen yeterli. Üstüne o rolü ben koyarım.",
        "İstediğin dili yaz. Menüde varsa takarım.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin/i, [
        "Buradayım. Rol menüsü kapıda.",
        "Selam. Dilini seçersen rolü ben koyarım.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "Arcade. Dil ve alan rollerini ben dağıtırım.",
      ]],
    ],
    fallback: [
      "Rol menüsüne bak. İstediğin dili seçmen yeter.",
      "Duydum. Hangi rolü istediğini yaz.",
      "Buradayım. Menüden seçmen bana yeter.",
    ],
  },
  kaynak: {
    names: /\b(source|codex)\b/i,
    rules: [
      [/doküman|dokuman|github|depo|repo|link|npm|paket/i, [
        "Depoyu buraya yapıştır ya da /github yaz. Doküman için /dokuman.",
        "Ne aradığını bir cümle yaz. Uygun dokümanı ben seçerim.",
        "Paketse /paket, depoyu da /github ile sor.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin/i, [
        "Buradayım. Raf tarafı bende.",
        "Selam. Aradığın dokümanı bir cümleyle söyle.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "Source. Doküman ve depo linkleri bende.",
      ]],
    ],
    fallback: [
      "Duydum. Doküman mı, depo mu? Kısaca yaz.",
      "Buradayım. Aradığın şeyi bir cümleyle söyle.",
      "Raf açık. Dilini ya da depo adını yaz.",
    ],
  },
  rehber: {
    names: /\b(directory|portico|rehber)\b/i,
    rules: [
      [/yardım|yardim|başlık|baslik|kanal|nereye|nerede|ticket/i, [
        "Takıldığın yeri /ticket ile aç. Konu ve açıklamayı yaz, başlığı ben kurarım.",
        "Yeniysen yazılım kanalından rolünü al, sonra /ticket yaz.",
        "Nereye bakacağını söyle. Kanalı ben tarif ederim.",
      ]],
      [/selam|merhaba|\bhey\b|naber|nasılsın|nasilsin/i, [
        "Hoş geldin. Kapı bende.",
        "Selam. Yeniysen önce rol menüsüne bak.",
      ]],
      [/kimsin|nesin|sen kim|adın ne|adin ne/i, [
        "directory. Yeni geleni yönlendirir, yardım başlığına bakarım.",
      ]],
    ],
    fallback: [
      "Duydum. Nereye bakacağını kısaca yaz.",
      "Buradayım. Takıldığın yeri söyle.",
      "Kapı açık. Ne aradığını bir cümle yaz.",
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

let keyWarned = false;

function expiryDate() {
  const end = new Date(`${chatApiExpires}T23:59:59+03:00`);
  return Number.isNaN(end.getTime()) ? null : end;
}

function expiryLabel() {
  const end = expiryDate();
  if (!end) return chatApiExpires;
  return end.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
}

function chatKeyExpired() {
  const end = expiryDate();
  return Boolean(end && Date.now() > end.getTime());
}

function warnKey(text) {
  if (keyWarned) return;
  keyWarned = true;
  console.error(text);
}

function safeReason(body) {
  const message = String(body?.error?.message || body?.message || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!message || /gsk_|sk-|bearer|api[_-]?key/i.test(message)) return "";
  return message;
}

function chatKeyNote() {
  if (!chatApiKey) return " Bu konteyner CHAT_API_KEY görmüyor. Anahtar zip ile gitmez. Sunucudaki .env dosyasına aynı satırı yazıp docker compose up -d çalıştır. O zamana kadar hazır replikler kullanılır.";
  if (chatKeyExpired()) {
    return ` Sohbet anahtarının süresi ${expiryLabel()} tarihinde doldu. .env içindeki CHAT_API_KEY değerini yenileyip botu yeniden aç. O zamana kadar hazır replikler kullanılır.`;
  }
  return " Sohbet anahtarı açık, replikler modelden gelir.";
}

async function complete(system, user, maxTokens) {
  if (!chatApiKey) return null;
  if (chatKeyExpired()) {
    warnKey(`Sohbet anahtarının süresi ${expiryLabel()} tarihinde doldu. Yeni anahtarı .env içindeki CHAT_API_KEY alanına yazıp botu yeniden aç. Hazır replikler kullanılıyor.`);
    return null;
  }
  const response = await fetch(`${chatApiBase.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chatApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: chatModel,
      temperature: 0.9,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user.slice(0, 500) },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const reason = safeReason(body);
    const detail = reason ? ` API diyor ki: ${reason}` : "";
    if (response.status === 401 || response.status === 403) {
      warnKey(`Sohbet anahtarı reddedildi (${response.status}). Anahtar geçersiz veya süresi dolmuş. Bitiş tarihi ${expiryLabel()}. .env içindeki CHAT_API_KEY değerini yenileyip botu yeniden aç. Hazır replikler kullanılıyor.${detail}`);
    } else {
      console.error(`Sohbet API yanıtı: ${response.status}.${detail} Hazır replikler kullanılıyor.`);
    }
    return null;
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || null;
  if (text) console.log(`Sohbet modeli cevap verdi (${chatModel}).`);
  else console.error("Sohbet modeli boş cevap verdi. Hazır replikler kullanılıyor.");
  return text;
}

function parseScene(raw) {
  const text = String(raw || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let rows;
  try {
    rows = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const lines = rows.slice(0, 3).map((row) => {
    const bot = String(row?.bot || "");
    const line = String(row?.text || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!BOTS.has(bot) || line.length < 2) return null;
    return [bot, line];
  }).filter(Boolean);
  return lines.length >= 2 ? lines : null;
}

function sceneFromModel() {
  return complete(
    "Dört Discord botu kendi arasında kısa sohbet ediyor. directory bot adı rehber, Arcade stack, Source kaynak, Atrium atrium. Üç replik yaz. Her biri en fazla 120 karakter, günlük ve sıcak olsun. Komut listesi sayma. Yalnız şu JSON'u yaz: [{\"bot\":\"rehber\",\"text\":\"...\"},{\"bot\":\"stack\",\"text\":\"...\"},{\"bot\":\"kaynak\",\"text\":\"...\"}]. bot yalnız atrium, stack, kaynak veya rehber olsun.",
    "Şimdi yeni bir kısa sahne yaz.",
    220,
  ).then(parseScene);
}

function cleanReply(raw) {
  const line = String(raw || "").replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim().slice(0, 180);
  if (line.length < 2 || line.includes("```")) return null;
  return line;
}

async function replyText(content, who, voice) {
  const scripted = answerFor(content, voice);
  if (!chatApiKey) return scripted;
  const generated = await complete(
    `Sen ${WHO[who]}. Bir kişi sana yazdı. Tek cümle Türkçe cevap ver. Markdown kullanma, yapay zeka olduğunu söyleme, 140 karakteri geçme.`,
    String(content || "").replace(/<@!?\d+>/g, " ").trim() || "selam",
    80,
  ).catch((error) => {
    console.error("Cevap üretilemedi:", error.message);
    return null;
  });
  return cleanReply(generated) || scripted;
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
  replyText(message.content, who, voice)
    .then((text) => message.reply(text))
    .catch((error) => console.error("Cevap yazılamadı:", error.message));
}

module.exports = {
  say,
  speakIfMine,
  joinLines,
  idleLines,
  channelIsQuiet,
  answerMember,
  botsMayTalk,
  chatKeyNote,
  IDLE_EVERY,
};
