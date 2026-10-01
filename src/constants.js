const { PermissionFlagsBits } = require("discord.js");

const P = PermissionFlagsBits;

const memberPerms = [
  P.ViewChannel,
  P.SendMessages,
  P.ReadMessageHistory,
  P.EmbedLinks,
  P.AttachFiles,
  P.AddReactions,
  P.UseExternalEmojis,
  P.Connect,
  P.Speak,
  P.SendMessagesInThreads,
  P.CreatePublicThreads,
];

const ROLE_DEFS = [
  {
    key: "Kurucu",
    color: 0xf1c40f,
    hoist: true,
    permissions: [P.Administrator],
  },
  {
    key: "Yönetici",
    color: 0xe74c3c,
    hoist: true,
    permissions: [
      P.ViewChannel,
      P.SendMessages,
      P.ManageGuild,
      P.ManageRoles,
      P.ManageChannels,
      P.BanMembers,
      P.KickMembers,
      P.ModerateMembers,
      P.ManageMessages,
      P.ViewAuditLog,
      P.MentionEveryone,
      P.ManageNicknames,
      P.MuteMembers,
      P.DeafenMembers,
      P.MoveMembers,
      P.ManageEmojisAndStickers,
      P.ReadMessageHistory,
      P.EmbedLinks,
      P.AttachFiles,
      P.AddReactions,
      P.Connect,
      P.Speak,
      P.UseExternalEmojis,
      P.CreateInstantInvite,
      P.PrioritySpeaker,
      P.ManageWebhooks,
    ],
  },
  {
    key: "Moderatör",
    color: 0x3498db,
    hoist: true,
    permissions: [
      P.ViewChannel,
      P.SendMessages,
      P.KickMembers,
      P.ModerateMembers,
      P.ManageMessages,
      P.ViewAuditLog,
      P.ManageNicknames,
      P.MuteMembers,
      P.DeafenMembers,
      P.MoveMembers,
      P.ReadMessageHistory,
      P.EmbedLinks,
      P.AttachFiles,
      P.AddReactions,
      P.Connect,
      P.Speak,
      P.CreateInstantInvite,
    ],
  },
  {
    key: "Denetçi",
    color: 0x1abc9c,
    hoist: true,
    permissions: [
      P.ViewChannel,
      P.SendMessages,
      P.ModerateMembers,
      P.ManageMessages,
      P.ViewAuditLog,
      P.ReadMessageHistory,
      P.EmbedLinks,
      P.AttachFiles,
      P.AddReactions,
      P.Connect,
      P.Speak,
    ],
  },
  {
    key: "DJ",
    color: 0x9b59b6,
    hoist: true,
    permissions: [P.Connect, P.Speak, P.PrioritySpeaker, P.Stream],
  },
  {
    key: "Üye",
    color: 0x2ecc71,
    hoist: false,
    permissions: memberPerms,
  },
];

const STAFF_KEYS = ["Kurucu", "Yönetici", "Moderatör", "Denetçi"];
const LEVEL = {
  Üye: 1,
  DJ: 2,
  Denetçi: 3,
  Moderatör: 4,
  Yönetici: 5,
  Kurucu: 6,
};

const RULES = [
  "Hakaret, taciz ve hedef gösterme yok.",
  "Spam, flood ve izinsiz reklam yok.",
  "NSFW ve yasa dışı içerik yok.",
  "Kanalları amacına uygun kullan.",
  "Yetkili kararlarına uy. İtirazını saygılı şekilde ilet.",
  "Kod paylaşırken kaynak belirt. Token, şifre ve zararlı yazılım paylaşma.",
  "Discord Topluluk Kuralları bu sunucuda da geçerlidir.",
].map((line, index) => `**${index + 1}.** ${line}`);

module.exports = { ROLE_DEFS, STAFF_KEYS, LEVEL, RULES, memberPerms };
