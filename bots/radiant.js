const { GatewayIntentBits } = require("discord.js");
const { agentValorantToken } = require("../src/config");
const { commands, handleValorantInteraction, postValorantPanel, startValorant } = require("../src/valorant");
const { startBot } = require("./runtime");
const { announceRelease } = require("../src/release");

startBot({
  token: agentValorantToken,
  name: "Radiant",
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  commands,
  onInteraction: async (interaction) => {
    if (await handleValorantInteraction(interaction)) return;
    if (!interaction.isChatInputCommand()) return;
    const command = commands.find((item) => item.data.name === interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  },
  onReady: async (client) => {
    startValorant(client);
    announceRelease(client, "radiant").catch((error) => console.error("Yama notu yazılamadı:", error.message));
  },
  onGuild: (guild) => postValorantPanel(guild),
});
