const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "..", "data", "levels.json");
let chain = Promise.resolve();

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { guilds: {} };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function update(guildId, mutator) {
  const run = chain.then(() => {
    const data = read();
    data.guilds[guildId] ??= { users: {}, rewards: {} };
    const result = mutator(data.guilds[guildId]);
    write(data);
    return result === undefined ? data.guilds[guildId] : result;
  });
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function getGuild(guildId) {
  return read().guilds[guildId] || { users: {}, rewards: {} };
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
