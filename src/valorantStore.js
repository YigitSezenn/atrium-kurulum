const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "data", "valorant.json");
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
    data.guilds[guildId] ??= { users: {} };
    const result = mutator(data.guilds[guildId]);
    write(data);
    return result === undefined ? data.guilds[guildId] : result;
  });
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function accountOf(guildId, userId) {
  return read().guilds[guildId]?.users?.[userId] || null;
}

module.exports = { update, accountOf };
