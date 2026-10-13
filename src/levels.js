const fs = require("fs");
const path = require("path");
const { jsonFile } = require("./jsonFile");

const file = path.join(__dirname, "..", "data", "levels.json");
const legacy = path.join(__dirname, "..", "..", "data", "levels.json");
if (!fs.existsSync(file) && fs.existsSync(legacy)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(legacy, file);
}

const db = jsonFile(file, () => ({ guilds: {} }));

function update(guildId, mutator) {
  return db.update((data) => {
    data.guilds[guildId] ??= { users: {}, rewards: {} };
    const result = mutator(data.guilds[guildId]);
    return result === undefined ? data.guilds[guildId] : result;
  });
}

function getGuild(guildId) {
  return db.read().guilds[guildId] || { users: {}, rewards: {} };
}

function xpToNext(level) {
  return 5 * level * level + 50 * level + 100;
}

const MAX_LEVEL = 50;

function progress(xp) {
  let level = 0;
  let rest = Math.max(0, xp);
  let need = xpToNext(level);
  while (level < MAX_LEVEL && rest >= need) {
    rest -= need;
    level += 1;
    need = xpToNext(level);
  }
  if (level >= MAX_LEVEL) return { level: MAX_LEVEL, into: need, need };
  return { level, into: rest, need };
}

function bar(ratio) {
  const width = 16;
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

module.exports = { update, getGuild, progress, bar, xpToNext, MAX_LEVEL };
