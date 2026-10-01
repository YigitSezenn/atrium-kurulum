const fs = require("fs");
const path = require("path");
const { ActivityType, Client, GatewayIntentBits, MessageFlags, Partials, REST, Routes } = require("discord.js");
const { token } = require("./config");
const { getGuild } = require("./store");
const { UserError } = require("./errors");
const { handleAccept, postWelcomeCard, registerWelcome } = require("./events/welcome");
const { registerAudit } = require("./events/audit");
const { watchVoice } = require("./music/player");
const { registerLevels } = require("./events/levels");
const { resumeRgb } = require("./rgb");
const { ensureYtdlp } = require("./music/ytdlp");
const { handleSpotifyComponent } = require("./commands/spotify");
const { handleMusicButton } = require("./commands/muzik");
const { handleValorantButton, handleValorantModal, postValorantPanel } = require("./commands/valorant");
const { handleStackPick, postSoftwareBoards, releaseSoftwareBoards } = require("./stack");
const { agentsEnabled } = require("./agents/mode");
const { connectBus, emit } = require("./agents/bus");
const { answerMember, speakIfMine } = require("./agents/chat");
const { announceRelease } = require("./release");

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
  return { commands, body };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

const { commands, body } = loadCommands();
client.commands = commands;
const readyAgents = new Set();
let handedOff = false;

async function handoffSoftware(applicationId) {
  const first = !handedOff;
  handedOff = true;
  if (first) {
    commands.delete("github");
    commands.delete("dokuman");
  }
  const nextBody = body.filter((command) => command.name !== "github" && command.name !== "dokuman");
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
registerAudit(client);
registerLevels(client);
watchVoice(client);

const inviteFor = (applicationId) => (
  `https://discord.com/api/oauth2/authorize?client_id=${applicationId}&permissions=8&scope=bot%20applications.commands`
);

async function publishCommands(applicationId, guild, commandBody = body) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: commandBody });
  console.log(`Komutlar ${guild.name} sunucusuna yazıldı.`);
}

function bootGuild(guild) {
  const saved = getGuild(guild.id);
  if (saved?.channels?.["hos-geldin"]) {
    postWelcomeCard(guild).catch((error) => console.error("Karşılama kartı yazılamadı:", error.message));
  }
  if (saved?.channels?.komutlar) {
    postValorantPanel(guild).catch((error) => console.error("Valorant paneli yazılamadı:", error.message));
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
  ensureYtdlp()
    .then(() => console.log("yt-dlp hazır."))
    .catch((error) => console.error("yt-dlp indirilemedi:", error.message));
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
    if (interaction.isButton() && interaction.customId.startsWith("muzik:")) {
      await handleMusicButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "valorant:link") {
      await handleValorantButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === "valorant:modal") {
      await handleValorantModal(interaction);
      return;
    }
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
    const detail = String(error.message || "bilinmeyen hata").slice(0, 180);
    const content = error instanceof UserError ? error.message : `Komut çalışırken bir hata oluştu: ${detail}`;
    if (!(error instanceof UserError)) console.error(error);
    const payload = { content, flags: MessageFlags.Ephemeral };
    if (interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else if (interaction.deferred) {
      await interaction.editReply({ content }).catch(() => interaction.followUp(payload));
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(token);
