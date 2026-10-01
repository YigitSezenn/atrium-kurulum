const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { getGuild } = require("../store");
const { UserError } = require("../errors");
const { commandPlace, liveId, mention } = require("../liveChannel");

const DEV_CHANNELS = ["projeler", "yigin", "yardim", "komutlar"];

const DOCS = [
  { name: "JavaScript", value: "javascript" },
  { name: "TypeScript", value: "typescript" },
  { name: "Python", value: "python" },
  { name: "C#", value: "csharp" },
  { name: "Java", value: "java" },
  { name: "Go", value: "go" },
  { name: "Rust", value: "rust" },
  { name: "Node.js", value: "node" },
  { name: "React", value: "react" },
  { name: "Discord.js", value: "discordjs" },
  { name: "SQL", value: "sql" },
  { name: "npm", value: "npm" },
];

function devChannelOrThrow(interaction) {
  const channels = getGuild(interaction.guildId)?.channels || {};
  const allowed = DEV_CHANNELS
    .map((key) => liveId(interaction.guild, channels[key]))
    .filter(Boolean);
  if (allowed.length && !allowed.includes(commandPlace(interaction))) {
    const hint = mention(interaction.guild, channels.projeler, null)
      || mention(interaction.guild, channels.yigin, null)
      || mention(interaction.guild, channels.yardim, null);
    throw new UserError(hint ? `Bunu ${hint} kanalında kullan.` : "Bunu yazılım kanallarında kullan.");
  }
}

function parseRepo(input) {
  const text = String(input || "").trim();
  const fromUrl = text.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  const pair = fromUrl || text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!pair) return null;
  return { owner: pair[1], repo: pair[2].replace(/\.git$/i, "") };
}

function docUrl(kind, query) {
  const q = encodeURIComponent(query);
  const links = {
    javascript: `https://developer.mozilla.org/en-US/search?q=${q}`,
    typescript: `https://learn.microsoft.com/en-us/search/?terms=${encodeURIComponent(`typescript ${query}`)}`,
    python: `https://docs.python.org/3/search.html?q=${q}`,
    csharp: `https://learn.microsoft.com/en-us/dotnet/api/?term=${q}`,
    java: `https://docs.oracle.com/en/search/?q=${q}`,
    go: `https://pkg.go.dev/search?q=${q}`,
    rust: `https://doc.rust-lang.org/std/index.html?search=${q}`,
    node: `https://devdocs.io/#q=${encodeURIComponent(`node ${query}`)}`,
    react: `https://devdocs.io/#q=${encodeURIComponent(`react ${query}`)}`,
    discordjs: `https://discord.js.org/docs/packages/discord.js/main`,
    sql: `https://devdocs.io/#q=${encodeURIComponent(`sql ${query}`)}`,
    npm: `https://www.npmjs.com/search?q=${q}`,
  };
  return links[kind];
}

const ROLE_KIND = {
  JavaScript: "javascript",
  TypeScript: "typescript",
  Python: "python",
  "C#": "csharp",
  Java: "java",
  Go: "go",
  Rust: "rust",
  SQL: "sql",
};

const TEXT_KIND = [
  [/typescript|\bts\b/i, "typescript"],
  [/javascript|\bjs\b/i, "javascript"],
  [/python|\bpy\b/i, "python"],
  [/c#|csharp|dotnet/i, "csharp"],
  [/golang|\bgo\b/i, "go"],
  [/\brust\b/i, "rust"],
  [/react/i, "react"],
  [/discord\.js|discordjs/i, "discordjs"],
  [/\bnode\b/i, "node"],
  [/sql|postgres|mysql/i, "sql"],
  [/\bjava\b/i, "java"],
  [/\bnpm\b/i, "npm"],
];

function topicFrom(text) {
  const clean = String(text || "")
    .replace(/<@!?\d+>/g, "")
    .replace(/https?:\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.split(" ").filter(Boolean).slice(0, 8).join(" ").slice(0, 80) || "başlangıç";
}

function suggestDocs(text, roles) {
  const found = new Set();
  for (const [pattern, kind] of TEXT_KIND) {
    if (pattern.test(text || "")) found.add(kind);
  }
  for (const role of roles || []) {
    if (ROLE_KIND[role]) found.add(ROLE_KIND[role]);
  }
  const topic = topicFrom(text);
  return [...found].slice(0, 3).map((kind) => ({
    label: DOCS.find((item) => item.value === kind)?.name || kind,
    url: docUrl(kind, topic),
  }));
}

async function githubCard(parsed) {
  const response = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "atrium-kurulum",
    },
  });
  if (response.status === 404) throw new UserError("Bu depo yok veya gizli.");
  if (!response.ok) throw new UserError("GitHub şu an yanıt vermedi. Biraz sonra tekrar dene.");
  const repo = await response.json();
  const topics = Array.isArray(repo.topics) && repo.topics.length
    ? repo.topics.slice(0, 8).map((topic) => `\`${topic}\``).join(" ")
    : "Etiket yok";
  return new EmbedBuilder()
    .setColor(0x24292f)
    .setTitle(repo.full_name || `${parsed.owner}/${parsed.repo}`)
    .setURL(repo.html_url)
    .setDescription(String(repo.description || "Açıklama yok.").slice(0, 350))
    .addFields(
      { name: "Dil", value: repo.language || "Belirtilmemiş", inline: true },
      { name: "Yıldız", value: String(repo.stargazers_count ?? 0), inline: true },
      { name: "Fork", value: String(repo.forks_count ?? 0), inline: true },
      { name: "Lisans", value: repo.license?.spdx_id || "Yok", inline: true },
      { name: "Açık konu", value: String(repo.open_issues_count ?? 0), inline: true },
      { name: "Durum", value: repo.archived ? "Arşivlenmiş" : "Açık", inline: true },
      { name: "Etiketler", value: topics, inline: false },
    );
}

const github = {
  data: new SlashCommandBuilder()
    .setName("github")
    .setDescription("Herkese açık bir GitHub deposunun kartını gösterir.")
    .addStringOption((option) => option
      .setName("depo")
      .setDescription("owner/repo veya GitHub bağlantısı")
      .setRequired(true)
      .setMaxLength(200)),

  async execute(interaction) {
    devChannelOrThrow(interaction);
    const parsed = parseRepo(interaction.options.getString("depo"));
    if (!parsed) throw new UserError("Depoyu `owner/repo` veya GitHub bağlantısı olarak yaz.");
    await interaction.deferReply();
    await interaction.editReply({ embeds: [await githubCard(parsed)] });
  },
};

const dokuman = {
  data: new SlashCommandBuilder()
    .setName("dokuman")
    .setDescription("Seçilen dilin resmi dokümanında arama bağlantısı verir.")
    .addStringOption((option) => option
      .setName("dil")
      .setDescription("Dokümanın dili veya aracı")
      .setRequired(true)
      .addChoices(...DOCS))
    .addStringOption((option) => option
      .setName("konu")
      .setDescription("Aranacak başlık")
      .setRequired(true)
      .setMaxLength(100)),

  async execute(interaction) {
    devChannelOrThrow(interaction);
    const kind = interaction.options.getString("dil");
    const query = interaction.options.getString("konu").trim();
    const label = DOCS.find((item) => item.value === kind)?.name || kind;
    const url = docUrl(kind, query);
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${label}: ${query}`.slice(0, 250))
      .setURL(url)
      .setDescription(`[Dokümanı aç](${url})`);
    await interaction.reply({ embeds: [embed] });
  },
};

module.exports = {
  commands: [github, dokuman],
  parseRepo,
  docUrl,
  suggestDocs,
  githubCard,
  devChannelOrThrow,
};
