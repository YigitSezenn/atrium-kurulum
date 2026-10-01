const { GatewayIntentBits } = require("discord.js");
const { agentRehberToken } = require("../src/config");
const { getGuild } = require("../src/store");
const { connectBus, emit } = require("../src/agents/bus");
const { IDLE_EVERY, answerMember, botsMayTalk, say, speakIfMine, joinLines, idleLines, channelIsQuiet } = require("../src/agents/chat");
const { postSoftwareBoards } = require("../src/stack");
const { startBot } = require("./runtime");
const { handleTicket, ticket } = require("./ticket");
const { announceRelease } = require("../src/release");

const BOARD_KEYS = ["yardim", "projeler"];

async function postOwnBoards(client, guildId, keys) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const wanted = (keys || BOARD_KEYS).filter((key) => BOARD_KEYS.includes(key));
  if (keys && !wanted.length) return;
  await postSoftwareBoards(guild, wanted.length ? wanted : BOARD_KEYS);
}

startBot({
  token: agentRehberToken,
  name: "Portico",
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  commands: [ticket],
  onInteraction: async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === "ticket") {
      await ticket.execute(interaction, emit);
      return;
    }
    await handleTicket(interaction, emit);
  },
  onReady: async (client) => {
    connectBus("rehber", {
      onConnect() {
        emit("agent.ready", { name: "rehber" });
      },
      async onEvent(message) {
        speakIfMine(client, "rehber", message);
        if (message.event === "atrium.online") {
          emit("agent.ready", { name: "rehber" });
          return;
        }
        if (message.event === "setup.done") {
          await postOwnBoards(client, message.data?.guildId, message.data?.keys);
          return;
        }
        if (message.event !== "member.joined") return;
        if (!botsMayTalk(message.data.guildId)) return;
        const channelId = getGuild(message.data.guildId)?.channels?.yigin;
        if (!channelId) return;
        if (say(emit, channelId, joinLines(message.data.name))) return;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) return;
        await channel.send(`${message.data.name} geldi. Dil rolünü menüden alabilir.`);
      },
    });

    client.on("threadCreate", async (thread) => {
      try {
        if (thread.ownerId === client.user.id) return;
        const yardim = getGuild(thread.guildId)?.channels?.yardim;
        if (!yardim || thread.parentId !== yardim) return;
        const starter = await thread.fetchStarterMessage().catch(() => null);
        await thread.send("Arcade, Source, bu başlığa bir bakın.");
        emit("help.opened", {
          guildId: thread.guildId,
          threadId: thread.id,
          userId: starter?.author?.id || thread.ownerId,
          text: `${thread.name}\n${starter?.content || ""}`.slice(0, 500),
        });
      } catch (error) {
        console.error("Rehber konuyu iletemedi:", error.message);
      }
    });

    client.on("messageCreate", (message) => {
      answerMember(message, "rehber");
    });
    setTimeout(() => {
      for (const guild of client.guilds.cache.values()) {
        postOwnBoards(client, guild.id).catch((error) => console.error("Portico kartı yazılamadı:", error.message));
      }
    }, 4000);

    const talk = async () => {
      for (const guild of client.guilds.cache.values()) {
        if (!botsMayTalk(guild.id)) continue;
        const channelId = getGuild(guild.id)?.channels?.genel;
        if (!channelId) continue;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) continue;
        if (!await channelIsQuiet(channel)) continue;
        say(emit, channelId, await idleLines());
      }
    };
    setTimeout(() => talk().catch((error) => console.error("Sohbet açılmadı:", error.message)), IDLE_EVERY);
    setInterval(() => talk().catch((error) => console.error("Sohbet açılmadı:", error.message)), IDLE_EVERY);
    announceRelease(client, "rehber").catch((error) => console.error("Yama notu yazılamadı:", error.message));
  },
  onGuild: async (guild) => {
    await postOwnBoards(guild.client, guild.id);
  },
});
