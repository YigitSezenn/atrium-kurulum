const { ChannelType, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { UserError } = require("../errors");
const { levelOf } = require("../staff");
const { getGuild, updateGuild } = require("../store");
const { clearLegacyRole, hasStaffColor, restore, startRgb, stopRgb } = require("../rgb");
const { closeDisco, openDisco } = require("../disco");

function requireAdmin(interaction) {
  if (levelOf(interaction.member) < 5) throw new UserError("Bunu yönetici açar.");
}

const rgb = {
  data: new SlashCommandBuilder()
    .setName("rgb")
    .setDescription("Kurucu ve Yönetici renklerini döndürür.")
    .addSubcommand((sub) => sub.setName("ac").setDescription("Kurucu ve Yönetici renklerini döndürmeye başlar."))
    .addSubcommand((sub) => sub.setName("kapat").setDescription("Renkleri eski haline döndürür."))
    .addSubcommand((sub) => sub
      .setName("ver")
      .setDescription("Yalnız Kurucu veya Yönetici için RGB açar.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("al")
      .setDescription("RGB'nin nasıl kapanacağını söyler.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(true))),

  async execute(interaction) {
    requireAdmin(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === "kapat") {
      stopRgb(interaction.guildId);
      await updateGuild(interaction.guildId, (entry) => {
        if (entry.rgb) entry.rgb.enabled = false;
      });
      await restore(interaction.guild);
      await interaction.reply({ content: "RGB durdu. Kurucu ve Yönetici eski renklerine döndü.", flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getMember("uye") || interaction.member;
    if (!hasStaffColor(target)) {
      throw new UserError("RGB yalnız Kurucu ve Yönetici rollerinde.");
    }
    if (sub === "al") {
      await interaction.reply({ content: "Bu renk Kurucu ve Yönetici rolünün kendisi. Herkesi eski renge döndürmek için /rgb kapat yaz.", flags: MessageFlags.Ephemeral });
      return;
    }

    await clearLegacyRole(interaction.guild);
    await updateGuild(interaction.guildId, (entry) => {
      entry.rgb = { enabled: true, hue: entry.rgb?.hue || 0 };
    });
    startRgb(interaction.guild);
    await interaction.reply({ content: "Kurucu ve Yönetici renkleri yaklaşık 5 saniyede bir değişir.", flags: MessageFlags.Ephemeral });
  },
};

const disco = {
  data: new SlashCommandBuilder()
    .setName("disko")
    .setDescription("Disko topunu seçtiğin kanalda döndürür.")
    .addSubcommand((sub) => sub
      .setName("ac")
      .setDescription("Disko topunu bir kanala çağırır. Kanal seçmezsen müzik kanalı kullanılır.")
      .addChannelOption((option) => option
        .setName("kanal")
        .setDescription("Disko topunun döneceği kanal")
        .addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName("kapat").setDescription("Disko topunu kaldırır.")),

  async execute(interaction) {
    requireAdmin(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === "kapat") {
      await closeDisco(interaction.guild);
      await interaction.reply({ content: "Disko topu kalktı.", flags: MessageFlags.Ephemeral });
      return;
    }

    const picked = interaction.options.getChannel("kanal");
    const muzikId = getGuild(interaction.guildId)?.channels?.muzik;
    const channel = picked
      || (muzikId && interaction.guild.channels.cache.get(muzikId))
      || interaction.channel;
    if (!channel?.isTextBased()) throw new UserError("Disko topu için bir yazı kanalı lazım.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await openDisco(channel);
    await interaction.editReply(`Disko topu ${channel} kanalında dönüyor.`);
  },
};

module.exports = { commands: [rgb, disco] };
