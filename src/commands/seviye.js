const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { UserError } = require("../errors");
const { levelOf } = require("../staff");
const { bar, getGuild, progress, update } = require("../levels");
const { getGuild: getServer } = require("../store");

async function publish(interaction, payload) {
  const channelId = getServer(interaction.guildId)?.channels?.seviye;
  const channel = channelId && interaction.guild.channels.cache.get(channelId);
  if (channel?.isTextBased() && channel.id !== interaction.channelId) {
    await channel.send(payload);
    await interaction.reply({ content: `Seviye bilgisi ${channel} kanalına yazıldı.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply(payload);
}

function card(member, xp) {
  const state = progress(xp);
  const ratio = state.need ? state.into / state.need : 0;
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setTitle(`Seviye ${state.level}`)
    .setDescription(`${bar(ratio)}\n${state.into} / ${state.need} XP\nToplam: **${xp}**`);
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("seviye")
      .setDescription("Seviyeni veya bir üyenin seviyesini gösterir.")
      .addUserOption((option) => option.setName("uye").setDescription("Üye")),
    async execute(interaction) {
      const member = interaction.options.getMember("uye") || interaction.member;
      const xp = getGuild(interaction.guildId).users?.[member.id]?.xp || 0;
      await publish(interaction, { embeds: [card(member, xp)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("liderlik")
      .setDescription("En yüksek on seviyeyi listeler."),
    async execute(interaction) {
      const users = getGuild(interaction.guildId).users || {};
      const top = Object.entries(users)
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 10);
      if (!top.length) throw new UserError("Henüz deneyim yok. Sohbet ettikçe seviye birikir.");
      const lines = await Promise.all(top.map(async ([id, user], index) => {
        const member = await interaction.guild.members.fetch(id).catch(() => null);
        const name = member?.displayName || id;
        return `**${index + 1}.** ${name} — seviye ${progress(user.xp).level} (${user.xp} XP)`;
      }));
      await publish(interaction, {
        embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle("Liderlik").setDescription(lines.join("\n"))],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("seviye-odul")
      .setDescription("Belirli bir seviyeye rol ödülü bağlar.")
      .addSubcommand((sub) => sub
        .setName("ekle")
        .setDescription("Seviyeye rol ekler.")
        .addIntegerOption((option) => option.setName("seviye").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100))
        .addRoleOption((option) => option.setName("rol").setDescription("Verilecek rol").setRequired(true)))
      .addSubcommand((sub) => sub
        .setName("kaldir")
        .setDescription("Seviye ödülünü kaldırır.")
        .addIntegerOption((option) => option.setName("seviye").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100)))
      .addSubcommand((sub) => sub.setName("liste").setDescription("Ödülleri listeler.")),
    async execute(interaction) {
      if (levelOf(interaction.member) < 5) throw new UserError("Bunu yönetici ayarlar.");
      const sub = interaction.options.getSubcommand();
      if (sub === "liste") {
        const rewards = getGuild(interaction.guildId).rewards || {};
        const lines = Object.entries(rewards)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([level, roleId]) => `Seviye **${level}** — <@&${roleId}>`);
        await interaction.reply({ content: lines.join("\n") || "Ödül yok.", flags: MessageFlags.Ephemeral });
        return;
      }
      const level = String(interaction.options.getInteger("seviye"));
      if (sub === "kaldir") {
        await update(interaction.guildId, (entry) => {
          delete entry.rewards[level];
        });
        await interaction.reply({ content: `${level}. seviye ödülü kalktı.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const role = interaction.options.getRole("rol");
      if (role.managed || role.id === interaction.guild.id) throw new UserError("Bu rol ödül olamaz.");
      await update(interaction.guildId, (entry) => {
        entry.rewards[level] = role.id;
      });
      await interaction.reply({ content: `${level}. seviyeye ${role} bağlandı.`, flags: MessageFlags.Ephemeral });
    },
  },
];

module.exports = { commands };
