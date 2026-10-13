const { PermissionFlagsBits } = require("discord.js");
const { getGuild } = require("../store");
const { levelOf } = require("../staff");
const { sendLog, baseEmbed } = require("../log");

const FLOOD_COUNT = 6;
const FLOOD_WINDOW = 7_000;
const REPEAT_COUNT = 4;
const REPEAT_WINDOW = 60_000;
const MENTION_LIMIT = 6;
const CAPS_MIN = 25;
const CAPS_RATIO = 0.75;
const STRIKE_WINDOW = 60 * 60 * 1000;
const TIMEOUTS = [0, 5 * 60 * 1000, 30 * 60 * 1000];

const recent = new Map();
const strikes = new Map();

function automodEnabled(guildId) {
  return getGuild(guildId)?.automod?.enabled !== false;
}

function exempt(member) {
  if (!member) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  return levelOf(member) >= 3;
}

function normalize(text) {
  return String(text || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
}

function shouting(text) {
  const letters = [...String(text || "").replace(/<[@#:a-z!&]*\d+>|https?:\S+/gi, "")].filter((char) => char.toLocaleLowerCase("tr") !== char.toLocaleUpperCase("tr"));
  if (letters.length < CAPS_MIN) return false;
  const upper = letters.filter((char) => char === char.toLocaleUpperCase("tr")).length;
  return upper / letters.length >= CAPS_RATIO;
}

function track(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const list = (recent.get(key) || []).filter((item) => now - item.at < REPEAT_WINDOW);
  list.push({ at: now, id: message.id, channelId: message.channelId, text: normalize(message.content) });
  recent.set(key, list);
  return list;
}

function verdict(message, list) {
  const now = Date.now();
  const burst = list.filter((item) => now - item.at < FLOOD_WINDOW);
  if (burst.length >= FLOOD_COUNT) return { rule: "Flood", label: "çok hızlı mesaj atmak", ids: burst };
  const text = normalize(message.content);
  if (text.length >= 5) {
    const same = list.filter((item) => item.text === text);
    if (same.length >= REPEAT_COUNT) return { rule: "Tekrar", label: "aynı mesajı tekrar tekrar yazmak", ids: same };
  }
  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (mentions >= MENTION_LIMIT) return { rule: "Toplu etiket", label: "toplu etiketlemek", ids: [{ id: message.id, channelId: message.channelId }] };
  if (shouting(message.content)) return { rule: "Büyük harf", label: "büyük harfle bağırmak", ids: [{ id: message.id, channelId: message.channelId }], soft: true };
  return null;
}

function strike(key) {
  const now = Date.now();
  const list = (strikes.get(key) || []).filter((at) => now - at < STRIKE_WINDOW);
  list.push(now);
  strikes.set(key, list);
  return list.length;
}

async function removeMessages(message, items) {
  const byChannel = new Map();
  for (const item of items) {
    if (!byChannel.has(item.channelId)) byChannel.set(item.channelId, []);
    byChannel.get(item.channelId).push(item.id);
  }
  for (const [channelId, ids] of byChannel) {
    const channel = message.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;
    if (ids.length > 1 && typeof channel.bulkDelete === "function") {
      await channel.bulkDelete(ids, true).catch(() => {});
    } else {
      await channel.messages.delete(ids[0]).catch(() => {});
    }
  }
}

async function punish(message, found) {
  const key = `${message.guildId}:${message.author.id}`;
  const count = strike(key);
  recent.delete(key);
  await removeMessages(message, found.ids);

  const timeout = found.soft && count < 3 ? 0 : TIMEOUTS[Math.min(count - 1, TIMEOUTS.length - 1)];
  let action = "Mesaj silindi, uyarıldı.";
  if (timeout && message.member?.moderatable) {
    const minutes = timeout / 60_000;
    const done = await message.member.timeout(timeout, `Otomatik moderasyon: ${found.rule}`).then(() => true).catch(() => false);
    if (done) action = `${minutes} dakika susturuldu.`;
  }

  const notice = await message.channel.send({
    content: `${message.author}, ${found.label} yasak. ${action}`,
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 8_000);

  await sendLog(
    message.guild,
    "denetim-log",
    baseEmbed(0xe67e22, `Otomatik moderasyon: ${found.rule}`, `${message.author} ${message.channel}\n${action}\nSon bir saatteki ihlal: ${count}\n${String(message.content || "").slice(0, 300)}`),
  );
}

function sweep() {
  const now = Date.now();
  for (const [key, list] of recent) {
    if (!list.some((item) => now - item.at < REPEAT_WINDOW)) recent.delete(key);
  }
  for (const [key, list] of strikes) {
    if (!list.some((at) => now - at < STRIKE_WINDOW)) strikes.delete(key);
  }
}

function registerAutomod(client) {
  setInterval(sweep, 5 * 60 * 1000).unref();
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot || message.system) return;
    if (!automodEnabled(message.guildId) || exempt(message.member)) return;
    const list = track(message);
    const found = verdict(message, list);
    if (!found) return;
    await punish(message, found).catch((error) => console.error("Otomatik moderasyon işlemedi:", error.message));
  });
}

module.exports = { registerAutomod, automodEnabled };
