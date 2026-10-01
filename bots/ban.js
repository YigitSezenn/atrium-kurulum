const { GatewayIntentBits } = require("discord.js");
const { agentBanToken } = require("../src/config");
const { commands, handleBan, watchBans } = require("../src/ban/mod");
const { startBot } = require("./runtime");
const { announceRelease } = require("../src/release");

startBot({
  token: agentBanToken,
  name: "Ward",
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
  commands,
  onInteraction: async (interaction) => {
    if (await handleBan(interaction)) return;
    if (!interaction.isChatInputCommand()) return;
    const command = commands.find((item) => item.data.name === interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  },
  onReady: async (client) => {
    watchBans(client);
    announceRelease(client, "ban").catch((error) => console.error("Yama notu yazılamadı:", error.message));
  },
});
