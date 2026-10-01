const { Client, MessageFlags, REST, Routes } = require("discord.js");
const { UserError } = require("../src/errors");

function inviteFor(applicationId) {
  return `https://discord.com/api/oauth2/authorize?client_id=${applicationId}&permissions=8&scope=bot%20applications.commands`;
}

async function publishCommands(token, client, commands) {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = commands.map((command) => command.data.toJSON());
  for (const guild of client.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body });
    console.log(`${client.user.username} komutları ${guild.name} sunucusuna yazdı.`);
  }
}

async function report(interaction, error) {
  const detail = String(error.message || "bilinmeyen hata").slice(0, 180);
  const content = error instanceof UserError ? error.message : `Komut çalışırken bir hata oluştu: ${detail}`;
  if (!(error instanceof UserError)) console.error(error);
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.replied) await interaction.followUp(payload).catch(() => {});
  else if (interaction.deferred) await interaction.editReply({ content }).catch(() => interaction.followUp(payload));
  else await interaction.reply(payload).catch(() => {});
}

function startBot({ token, name, intents, commands = [], onInteraction, onReady, onGuild }) {
  if (!token) {
    console.error(`${name} için token yok.`);
    process.exit(1);
  }
  const client = new Client({ intents });
  client.on("interactionCreate", async (interaction) => {
    try {
      await onInteraction(interaction, client);
    } catch (error) {
      await report(interaction, error);
    }
  });
  client.on("guildCreate", async (guild) => {
    if (commands.length) {
      await publishCommands(token, client, commands).catch((error) => {
        console.error(`${name} komut yazamadı:`, error.message);
      });
    }
    if (onGuild) {
      await onGuild(guild, client).catch((error) => {
        console.error(`${name} sunucuya yazamadı:`, error.message);
      });
    }
  });
  client.once("clientReady", async () => {
    console.log(`${client.user.tag} giriş yaptı.`);
    console.log(inviteFor(client.user.id));
    if (commands.length) {
      await publishCommands(token, client, commands).catch((error) => {
        console.error(`${name} komut yazamadı:`, error.message);
      });
    }
    await onReady(client);
  });
  client.login(token);
  return client;
}

module.exports = { startBot };
