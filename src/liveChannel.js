function liveId(guild, id) {
  if (!id || !guild?.channels?.cache?.has(id)) return null;
  return id;
}

function mention(guild, id, fallback) {
  const live = liveId(guild, id);
  return live ? `<#${live}>` : fallback;
}

function commandPlace(interaction) {
  const channel = interaction.channel;
  if (typeof channel?.isThread === "function" && channel.isThread()) {
    return channel.parentId || interaction.channelId;
  }
  return interaction.channelId;
}

module.exports = { liveId, mention, commandPlace };
