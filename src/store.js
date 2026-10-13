const path = require("path");
const { jsonFile } = require("./jsonFile");

const db = jsonFile(path.join(__dirname, "..", "data", "guild.json"), () => ({ guilds: {} }));

function getGuild(guildId) {
  return db.read().guilds[guildId] || null;
}

function updateGuild(guildId, mutator) {
  return db.update((data) => {
    data.guilds[guildId] ??= { roles: {}, channels: {}, warns: {} };
    mutator(data.guilds[guildId]);
    return data.guilds[guildId];
  });
}

module.exports = { getGuild, updateGuild };
