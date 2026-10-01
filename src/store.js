const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "data", "guild.json");
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

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function getGuild(guildId) {
  return read().guilds[guildId] || null;
}

function updateGuild(guildId, mutator) {
  return enqueue(() => {
    const data = read();
    data.guilds[guildId] ??= { roles: {}, channels: {}, warns: {} };
    mutator(data.guilds[guildId]);
    write(data);
    return data.guilds[guildId];
  });
}

module.exports = { getGuild, updateGuild };
