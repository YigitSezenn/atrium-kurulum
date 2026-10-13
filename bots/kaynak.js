const { GatewayIntentBits } = require("discord.js");
const { agentKaynakToken } = require("../src/config");
const { call, connectBus, emit } = require("../src/agents/bus");
const { answerMember, speakIfMine } = require("../src/agents/chat");
const { UserError } = require("../src/errors");
const { commands: softwareCommands, githubCard, handleRunModal, parseRepo, suggestDocs } = require("../src/commands/yazilim");
const githubFollow = require("../src/commands/githubTakip");
const { startGithubFeed } = require("../src/githubFeed");
const { startBot } = require("./runtime");
const { announceRelease } = require("../src/release");
const { command: sor } = require("../src/source/ask");
const { commands: funCommands, watchAfk, startReminders } = require("../src/source/fun");

const commands = [...softwareCommands, githubFollow, sor, ...funCommands];
const CARD_GAP = 10 * 60 * 1000;
const recentCards = new Map();

function visibleRepo(message) {
  const text = String(message.content || "").replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
  return parseRepo(text);
}

function cardDue(channelId, parsed) {
  const key = `${channelId}:${parsed.owner}/${parsed.repo}`.toLowerCase();
  const last = recentCards.get(key) || 0;
  if (Date.now() - last < CARD_GAP) return false;
  recentCards.set(key, Date.now());
  if (recentCards.size > 200) {
    for (const [entry, at] of recentCards) if (Date.now() - at > CARD_GAP) recentCards.delete(entry);
  }
  return true;
}

async function answerHelp(client, data) {
  let roles = [];
  try {
    const result = await call("stack.rolesOf", { guildId: data.guildId, userId: data.userId });
    roles = result?.roles || [];
  } catch (error) {
    console.error("Yığın cevap vermedi:", error.message);
  }
  const docs = suggestDocs(data.text, roles);
  if (!docs.length) return;
  const channel = await client.channels.fetch(data.threadId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const lines = docs.map((item) => `${item.label}: ${item.url}`);
  await channel.send(["Yetkili gelene kadar şunlara bakabilirsin:", ...lines].join("\n")).catch(() => {});
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
    if (await handleRunModal(interaction)) return;
    if (!interaction.isChatInputCommand()) return;
    const command = commands.find((item) => item.data.name === interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  },
  onReady: async (client) => {
    startGithubFeed(client);
    startReminders(client);
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
        watchAfk(message);
        answerMember(message, "kaynak");
        if (!/github\.com\/[\w.-]+\/[\w.-]+/i.test(message.content || "")) return;
        const parsed = visibleRepo(message);
        if (!parsed || !cardDue(message.channelId, parsed)) return;
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
