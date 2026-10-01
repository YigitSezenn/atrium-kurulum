const { GatewayIntentBits } = require("discord.js");
const { agentStackToken } = require("../src/config");
const { getGuild } = require("../src/store");
const { connectBus, emit } = require("../src/agents/bus");
const { answerMember, speakIfMine } = require("../src/agents/chat");
const { handleStackPick, postSoftwareBoards } = require("../src/stack");
const { startBot } = require("./runtime");
const { announceRelease } = require("../src/release");

const BOARD_KEYS = ["yigin"];

async function rolesOf(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(userId);
  const saved = getGuild(guildId)?.stackRoles || {};
  const roles = Object.entries(saved)
    .filter(([, id]) => id && member.roles.cache.has(id))
    .map(([key]) => key);
  return { roles };
}

async function postOwnBoards(client, guildId, keys) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const wanted = (keys || BOARD_KEYS).filter((key) => BOARD_KEYS.includes(key));
  if (keys && !wanted.length) return;
  await postSoftwareBoards(guild, wanted.length ? wanted : BOARD_KEYS);
}

startBot({
  token: agentStackToken,
  name: "Arcade",
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  onInteraction: async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === "yigin:roller") {
      await handleStackPick(interaction);
    }
  },
  onReady: async (client) => {
    connectBus("stack", {
      methods: {
        "stack.rolesOf": ({ guildId, userId }) => rolesOf(client, guildId, userId),
      },
      onConnect() {
        emit("agent.ready", { name: "stack" });
      },
      async onEvent(message) {
        speakIfMine(client, "stack", message);
        if (message.event === "atrium.online") {
          emit("agent.ready", { name: "stack" });
          return;
        }
        if (message.event === "setup.done") {
          await postOwnBoards(client, message.data?.guildId, message.data?.keys);
          return;
        }
        if (message.event !== "help.opened") return;
        const result = await rolesOf(client, message.data.guildId, message.data.userId);
        const channel = await client.channels.fetch(message.data.threadId);
        const line = result.roles.length
          ? `${result.roles.join(", ")}. Bunlar onda var.`
          : "Üstünde dil rolü yok. Menüden seçsin.";
        await channel.send(line);
      },
    });
    client.on("messageCreate", (message) => {
      answerMember(message, "stack");
    });
    setTimeout(() => {
      for (const guild of client.guilds.cache.values()) {
        postOwnBoards(client, guild.id).catch((error) => console.error("Arcade kartı yazılamadı:", error.message));
      }
    }, 4000);
    announceRelease(client, "stack").catch((error) => console.error("Yama notu yazılamadı:", error.message));
  },
  onGuild: async (guild) => {
    await postOwnBoards(guild.client, guild.id);
  },
});
