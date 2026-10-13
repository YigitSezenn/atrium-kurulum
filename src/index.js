const fs = require("fs");
const path = require("path");
const { ActivityType, Client, GatewayIntentBits, MessageFlags, Options, Partials, REST, Routes } = require("discord.js");
const { agentBanToken, agentValorantToken, token } = require("./config");
const { getGuild } = require("./store");
const { UserError } = require("./errors");
const { handleAccept, postWelcomeCard, registerWelcome } = require("./events/welcome");
const { registerStarboard } = require("./events/starboard");
const { handlePoll } = require("./commands/anket");
const { dropLogChannels } = require("./setup/structure");
const { stopAll, watchVoice } = require("./music/player");
const { guardProcess, onShutdown } = require("./lifecycle");
const { registerLevels } = require("./events/levels");
const { resumeRgb } = require("./rgb");
const { bindLavalink } = require("./music/node");
const { handleSpotifyComponent } = require("./commands/spotify");
const { handleMusicButton } = require("./commands/muzik");
const valorant = require("./valorant");
const { handleStackPick, postSoftwareBoards, releaseSoftwareBoards } = require("./stack");
const { agentsEnabled } = require("./agents/mode");
const { connectBus, emit } = require("./agents/bus");
const { answerMember, speakIfMine } = require("./agents/chat");
const { announceRelease } = require("./release");
const { registerAutomod } = require("./events/automod");
const { startBackups } = require("./backup");
const { startGithubFeed } = require("./githubFeed");
const { handleRunModal } = require("./commands/yazilim");

const SOFTWARE_COMMANDS = ["github", "dokuman", "paket", "calistir", "github-takip"];

const { commands: banCommands, handleBan, watchBans } = require("./ban/mod");

if (!token) {
  console.error("DISCORD_TOKEN eksik.");
  console.error(".env.example dosyasını .env olarak kopyala ve bot tokenini yaz.");
  process.exit(1);
}

function loadCommands() {
  const commands = new Map();
  const body = [];
  const dir = path.join(__dirname, "commands");
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".js"))) {
    const loaded = require(path.join(dir, file));
    const list = loaded.commands || [loaded];
    for (const command of list) {
      commands.set(command.data.name, command);
      body.push(command.data.toJSON());
    }
  }
  const owned = [
    ...(agentBanToken ? [] : banCommands),
    ...(agentValorantToken ? [] : valorant.commands),
  ];
  for (const command of owned) {
    commands.set(command.data.name, command);
    body.push(command.data.toJSON());
  }
  return { commands, body };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction],
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 30 * 60, lifetime: 6 * 60 * 60 },
  },
});

guardProcess(client);
onShutdown(stopAll);
bindLavalink(client);

const { commands, body } = loadCommands();
client.commands = commands;
const readyAgents = new Set();
let handedOff = false;

async function handoffSoftware(applicationId) {
  const first = !handedOff;
  handedOff = true;
  if (first) {
    for (const name of SOFTWARE_COMMANDS) commands.delete(name);
  }
  const nextBody = body.filter((command) => !SOFTWARE_COMMANDS.includes(command.name));
  for (const guild of client.guilds.cache.values()) {
    if (first) {
      await publishCommands(applicationId, guild, nextBody).catch((error) => {
        console.error(`Komutlar yazılamadı (${guild.name}):`, error.message);
      });
      await releaseSoftwareBoards(guild).catch((error) => {
        console.error("Yazılım kartları ajanlara bırakılamadı:", error.message);
      });
    }
    emit("setup.done", { guildId: guild.id });
  }
  if (first) console.log("Yazılım işi Arcade, Codex ve Portico botlarına bırakıldı.");
}
registerWelcome(client);
registerStarboard(client);
registerLevels(client);
registerAutomod(client);
watchVoice(client);
startBackups();

const inviteFor = (applicationId) => (
  `https://discord.com/api/oauth2/authorize?client_id=${applicationId}&permissions=8&scope=bot%20applications.commands`
);

async function publishCommands(applicationId, guild, commandBody = body) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: commandBody });
  console.log(`Komutlar ${guild.name} sunucusuna yazıldı.`);
}

function bootGuild(guild) {
  dropLogChannels(guild).catch((error) => console.error("Log kanalları kaldırılamadı:", error.message));
  const saved = getGuild(guild.id);
  if (saved?.channels?.["hos-geldin"]) {
    postWelcomeCard(guild).catch((error) => console.error("Karşılama kartı yazılamadı:", error.message));
  }
  if (!handedOff && saved?.channels?.yigin) {
    postSoftwareBoards(guild).catch((error) => console.error("Yazılım kartları yazılamadı:", error.message));
  }
}

client.once("clientReady", async () => {
  console.log(`${client.user.tag} giriş yaptı.`);
  console.log(inviteFor(client.user.id));
  client.user.setActivity("Atrium", { type: ActivityType.Watching });
  if (agentsEnabled()) {
    connectBus("atrium", {
      onConnect() {
        emit("atrium.online");
      },
      onEvent(message) {
        speakIfMine(client, "atrium", message);
        if (message.event !== "agent.ready") return;
        readyAgents.add(message.data?.name);
        const complete = ["stack", "kaynak", "rehber"].every((name) => readyAgents.has(name));
        if (!complete) return;
        handoffSoftware(client.user.id).catch((error) => {
          console.error("Ajan devri olmadı:", error.message);
        });
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  for (const guild of client.guilds.cache.values()) {
    if (!handedOff) {
      await publishCommands(client.user.id, guild).catch((error) => {
        console.error(`Komutlar yazılamadı (${guild.name}):`, error.message);
      });
    }
    bootGuild(guild);
  }
  resumeRgb(client);
  if (!agentBanToken) watchBans(client);
  if (!agentsEnabled()) startGithubFeed(client);
  if (!agentValorantToken) valorant.startValorant(client);
  announceRelease(client, "atrium").catch((error) => console.error("Yama notu yazılamadı:", error.message));
});

client.on("messageCreate", (message) => {
  answerMember(message);
});

client.on("guildCreate", async (guild) => {
  await publishCommands(client.user.id, guild).catch((error) => {
    console.error(`Komutlar yazılamadı (${guild.name}):`, error.message);
  });
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === "lua:accept_rules") {
      await handleAccept(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("ban:")) {
      await handleBan(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("anket:")) {
      await handlePoll(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("muzik:")) {
      await handleMusicButton(interaction);
      return;
    }
    if (!agentValorantToken && await valorant.handleValorantInteraction(interaction)) return;
    if (await handleRunModal(interaction)) return;
    if (interaction.isStringSelectMenu() && interaction.customId === "yigin:roller") {
      await handleStackPick(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "spotify:playlist") {
      await handleSpotifyComponent(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (error) {
    if (error?.code === 10062) {
      console.error("Komut zaman aşımına düştü. Discord 3 saniye içinde cevap bekler; istek kapandı. Komutu yeniden yaz.");
      return;
    }
    const detail = String(error.message || "bilinmeyen hata").slice(0, 180);
    const content = error instanceof UserError ? error.message : `Komut çalışırken bir hata oluştu: ${detail}`;
    if (!(error instanceof UserError)) console.error(error);
    const payload = { content, flags: MessageFlags.Ephemeral };
    if (interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else if (interaction.deferred) {
      await interaction.editReply({ content, embeds: [], components: [] }).catch(() => interaction.followUp(payload));
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(token);
