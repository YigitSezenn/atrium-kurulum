const path = require("path");
const { jsonFile } = require("./jsonFile");

const db = jsonFile(path.join(__dirname, "..", "data", "valorant.json"), () => ({ guilds: {} }));

function update(guildId, mutator) {
  return db.update((data) => {
    data.guilds[guildId] ??= { users: {} };
    const result = mutator(data.guilds[guildId]);
    return result === undefined ? data.guilds[guildId] : result;
  });
}

function accountOf(guildId, userId) {
  return db.read().guilds[guildId]?.users?.[userId] || null;
}

function accountsOf(guildId) {
  return db.read().guilds[guildId]?.users || {};
}

function tempVoiceOf(guildId) {
  return db.read().guilds[guildId]?.tempVoice || [];
}

module.exports = { update, accountOf, accountsOf, tempVoiceOf };
