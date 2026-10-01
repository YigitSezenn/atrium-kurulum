const { GatewayIntentBits } = require("discord.js");
const { agentKaynakToken } = require("../src/config");
const { getGuild } = require("../src/store");
const { liveId } = require("../src/liveChannel");
const { call, connectBus, emit } = require("../src/agents/bus");
const { answerMember, speakIfMine } = require("../src/agents/chat");
const { UserError } = require("../src/errors");
const { commands, githubCard, parseRepo, suggestDocs } = require("../src/commands/yazilim");
const { startBot } = require("./runtime");
const { announceRelease } = require("../src/release");

async function answerHelp(client, data) {
  let roles = [];
  try {
    const result = await call("stack.rolesOf", { guildId: data.guildId, userId: data.userId });
    roles = result?.roles || [];
  } catch (error) {
    console.error("Yığın cevap vermedi:", error.message);
  }
  const docs = suggestDocs(data.text, roles);
  const channel = await client.channels.fetch(data.threadId);
  if (!docs.length) {
    await channel.send("Bu metinden bir doküman çıkaramadım.");
    return;
  }
  const lines = docs.map((item) => `${item.label}: ${item.url}`);
  await channel.send(["Şunlara bakabilir:", ...lines].join("\n"));
}

startBot({
  token: agentKaynakToken,
  name: "Codex",
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  commands,
  onInteraction: async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = commands.find((item) => item.data.name === interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  },
  onReady: async (client) => {
    connectBus("kaynak", {
      onConnect() {
        emit("agent.ready", { name: "kaynak" });
      },
      async onEvent(message) {
        speakIfMine(client, "kaynak", message);
        if (message.event === "atrium.online") {
          emit("agent.ready", { name: "kaynak" });
          return;
        }
        if (message.event === "stack.changed") {
          const roles = message.data?.roles?.join(", ") || "yok";
          console.log(`Kaynak duydu, roller: ${roles}`);
          return;
        }
        if (message.event === "help.opened") await answerHelp(client, message.data);
      },
    });

    client.on("messageCreate", async (message) => {
      try {
        if (!message.guild || message.author.bot) return;
        answerMember(message, "kaynak");
        const channels = getGuild(message.guildId)?.channels || {};
        const here = message.channel?.isThread?.() ? message.channel.parentId : message.channelId;
        const watched = [channels.projeler, channels.github]
          .map((id) => liveId(message.guild, id))
          .filter(Boolean);
        if (!watched.includes(here)) return;
        const parsed = parseRepo(message.content);
        if (!parsed) return;
        const embed = await githubCard(parsed);
        await message.reply({ embeds: [embed] });
        console.log(`Kaynak depo baktı: ${parsed.owner}/${parsed.repo}`);
      } catch (error) {
        if (error instanceof UserError) await message.reply(error.message).catch(() => {});
        else console.error("Kaynak depo bakamadı:", error.message);
      }
    });
    announceRelease(client, "kaynak").catch((error) => console.error("Yama notu yazılamadı:", error.message));
  },
});
