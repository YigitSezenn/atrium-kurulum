const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { UserError } = require("../errors");
const { githubToken } = require("../config");

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
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
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
    const parsed = parseRepo(interaction.options.getString("depo"));
    if (!parsed) throw new UserError("Depoyu `owner/repo` veya GitHub bağlantısı olarak yaz.");
    await interaction.deferReply();
    await interaction.editReply({ embeds: [await githubCard(parsed)] });
  },
};

const paket = {
  data: new SlashCommandBuilder()
    .setName("paket")
    .setDescription("npm paketinin sürümünü ve son haftaki indirilmesini gösterir.")
    .addStringOption((option) => option
      .setName("ad")
      .setDescription("Paket adı, örneğin discord.js")
      .setRequired(true)
      .setMaxLength(80)),

  async execute(interaction) {
    const name = interaction.options.getString("ad", true).trim().toLowerCase();
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new UserError("Paket adını npm'deki gibi yaz.");
    await interaction.deferReply();
    const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
    if (response.status === 404) throw new UserError("Bu paket npm'de yok.");
    if (!response.ok) throw new UserError("npm şu an yanıt vermedi. Biraz sonra tekrar dene.");
    const json = await response.json();
    const version = json["dist-tags"]?.latest || "yok";
    const info = json.versions?.[version] || {};
    let downloads = "bilinmiyor";
    try {
      const stats = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name.replace("/", "%2F")}`);
      if (stats.ok) {
        const body = await stats.json();
        if (Number.isFinite(body.downloads)) downloads = String(body.downloads);
      }
    } catch {
      downloads = "bilinmiyor";
    }
    const embed = new EmbedBuilder()
      .setColor(0xcb3837)
      .setTitle(json.name || name)
      .setURL(`https://www.npmjs.com/package/${encodeURIComponent(name)}`)
      .setDescription(String(info.description || json.description || "Açıklama yok.").slice(0, 350))
      .addFields(
        { name: "Sürüm", value: String(version), inline: true },
        { name: "Lisans", value: info.license || json.license || "Yok", inline: true },
        { name: "Son 7 gün", value: downloads, inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
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

const RUNNERS = [
  { name: "Python", value: "python", language: "Python", prefer: /^cpython-3\./, fallback: "cpython-3.13.8" },
  { name: "JavaScript", value: "javascript", language: "JavaScript", prefer: /^nodejs-/, fallback: "nodejs-20.17.0" },
  { name: "TypeScript", value: "typescript", language: "TypeScript", prefer: /^typescript-/, fallback: "typescript-5.6.2" },
  { name: "Lua", value: "lua", language: "Lua", prefer: /^lua-5\./, fallback: "lua-5.4.7" },
  { name: "C", value: "c", language: "C", prefer: /^gcc-\d[\d.]*-c$/, fallback: "gcc-13.2.0-c" },
  { name: "C++", value: "cpp", language: "C++", prefer: /^gcc-\d/, fallback: "gcc-13.2.0" },
  { name: "C#", value: "csharp", language: "C#", prefer: /^mono-/, fallback: "mono-6.12.0.199" },
  { name: "Java", value: "java", language: "Java", prefer: /^openjdk-/, fallback: "openjdk-jdk-22+36" },
  { name: "Go", value: "go", language: "Go", prefer: /^go-/, fallback: "go-1.23.2" },
  { name: "Rust", value: "rust", language: "Rust", prefer: /^rust-/, fallback: "rust-1.82.0" },
  { name: "Ruby", value: "ruby", language: "Ruby", prefer: /^ruby-\d/, fallback: "ruby-3.4.9" },
  { name: "PHP", value: "php", language: "PHP", prefer: /^php-/, fallback: "php-8.3.12" },
  { name: "Bash", value: "bash", language: "Bash script", prefer: /^bash/, fallback: "bash" },
  { name: "SQL (SQLite)", value: "sql", language: "SQL", prefer: /^sqlite-/, fallback: "sqlite-3.46.1" },
];
const WANDBOX = "https://wandbox.org/api";
const RUN_TIMEOUT = 25_000;
const RUN_GAP = 10_000;
const lastRun = new Map();
let compilerCache = { at: 0, list: null };

async function compilerFor(runner) {
  if (!compilerCache.list || Date.now() - compilerCache.at > 12 * 60 * 60 * 1000) {
    try {
      const response = await fetch(`${WANDBOX}/list.json`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) compilerCache = { at: Date.now(), list: await response.json() };
    } catch {
      compilerCache.at = Date.now();
    }
  }
  const found = (compilerCache.list || []).find((item) => (
    item.language === runner.language && runner.prefer.test(item.name) && !/head/.test(item.name)
  ));
  return found?.name || runner.fallback;
}

function prepare(runner, code) {
  if (runner.value === "java") return code.replace(/\bpublic\s+(?=(?:final\s+|abstract\s+)?class\b)/g, "");
  return code;
}

function block(text, limit) {
  const clean = String(text || "").replace(/```/g, "`\u200b``");
  const cut = clean.length > limit ? `${clean.slice(0, limit)}\n… (kısaltıldı)` : clean;
  return `\`\`\`\n${cut || " "}\n\`\`\``;
}

const calistir = {
  data: new SlashCommandBuilder()
    .setName("calistir")
    .setDescription("Kod parçasını güvenli bir ortamda çalıştırıp çıktısını gösterir.")
    .addStringOption((option) => option
      .setName("dil")
      .setDescription("Kodun dili")
      .setRequired(true)
      .addChoices(...RUNNERS.map(({ name, value }) => ({ name, value })))),

  async execute(interaction) {
    const runner = RUNNERS.find((item) => item.value === interaction.options.getString("dil"));
    if (!runner) throw new UserError("Bu dil desteklenmiyor.");
    const modal = new ModalBuilder()
      .setCustomId(`calistir:${runner.value}`)
      .setTitle(`${runner.name} çalıştır`)
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId("kod")
          .setLabel("Kod")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId("girdi")
          .setLabel("Girdi (stdin, isteğe bağlı)")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false)),
      );
    await interaction.showModal(modal);
  },
};

async function handleRunModal(interaction) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith("calistir:")) return false;
  const runner = RUNNERS.find((item) => item.value === interaction.customId.split(":")[1]);
  if (!runner) throw new UserError("Bu dil desteklenmiyor.");
  const wait = RUN_GAP - (Date.now() - (lastRun.get(interaction.user.id) || 0));
  if (wait > 0) throw new UserError(`Biraz bekle. ${Math.ceil(wait / 1000)} saniye sonra tekrar çalıştırabilirsin.`);
  lastRun.set(interaction.user.id, Date.now());
  if (lastRun.size > 500) lastRun.delete(lastRun.keys().next().value);

  const code = interaction.fields.getTextInputValue("kod");
  const stdin = interaction.fields.getTextInputValue("girdi") || "";
  await interaction.deferReply();
  const started = Date.now();
  let result;
  try {
    const response = await fetch(`${WANDBOX}/compile.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compiler: await compilerFor(runner), code: prepare(runner, code), stdin }),
      signal: AbortSignal.timeout(RUN_TIMEOUT),
    });
    if (!response.ok) throw new Error(`Wandbox ${response.status}`);
    result = await response.json();
  } catch (error) {
    const timedOut = error.name === "TimeoutError";
    console.error("Kod çalıştırılamadı:", error.message);
    throw new UserError(timedOut
      ? `Kod ${RUN_TIMEOUT / 1000} saniyede bitmedi. Sonsuz döngü olabilir.`
      : "Kod çalıştırma servisi şu an yanıt vermedi. Biraz sonra tekrar dene.");
  }

  const status = Number(result.status);
  const output = result.program_output || "";
  const errors = [result.compiler_error, result.program_error].filter(Boolean).join("\n");
  const killed = result.signal || status === 137;
  const ok = status === 0 && !errors;
  const embed = new EmbedBuilder()
    .setColor(ok ? 0x2ecc71 : 0xe74c3c)
    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`${runner.name} · ${killed ? "süre veya bellek sınırı aşıldı" : `çıkış kodu ${Number.isFinite(status) ? status : "?"}`}`)
    .addFields({ name: "Kod", value: block(code, 700) });
  if (output) embed.addFields({ name: "Çıktı", value: block(output, 900) });
  if (errors) embed.addFields({ name: "Hata", value: block(errors, 900) });
  if (!output && !errors) embed.addFields({ name: "Çıktı", value: "Çıktı yok." });
  embed.setFooter({ text: `${((Date.now() - started) / 1000).toFixed(1)} sn · Wandbox` });
  await interaction.editReply({ embeds: [embed] });
  return true;
}

module.exports = {
  commands: [github, dokuman, paket, calistir],
  handleRunModal,
  parseRepo,
  docUrl,
  suggestDocs,
  githubCard,
};
