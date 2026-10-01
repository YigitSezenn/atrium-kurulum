const { LEVEL } = require("./constants");
const { getGuild } = require("./store");

function levelOf(member) {
  if (!member) return 0;
  if (member.id === member.guild.ownerId) return LEVEL.Kurucu;
  const roles = getGuild(member.guild.id)?.roles || {};
  let level = 0;
  for (const [name, id] of Object.entries(roles)) {
    if (id && member.roles.cache.has(id)) {
      level = Math.max(level, LEVEL[name] || 0);
    }
  }
  return level;
}

function sameVoice(member, channelId) {
  return Boolean(channelId) && member.voice?.channelId === channelId;
}

module.exports = { levelOf, sameVoice };
