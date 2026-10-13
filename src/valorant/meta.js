const zlib = require("zlib");
const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { UserError } = require("../errors");

const MAPS = [
  ["Abyss", "Infinity"],
  ["Ascent", "Ascent"],
  ["Bind", "Duality"],
  ["Breeze", "Foxtrot"],
  ["Corrode", "Rook"],
  ["Fracture", "Canyon"],
  ["Haven", "Triad"],
  ["Icebox", "Port"],
  ["Lotus", "Jam"],
  ["Pearl", "Pitt"],
  ["Split", "Bonsai"],
  ["Summit", "Plummet"],
  ["Sunset", "Juliett"],
];
const RANK_FLOORS = [
  ["Tüm ranklar", 0],
  ["Altın ve üstü", 13],
  ["Elmas ve üstü", 19],
  ["Yükseliş ve üstü", 22],
  ["Ölümsüz ve üstü", 25],
];
const ROLE_ORDER = ["Duelist", "Initiator", "Controller", "Sentinel"];
const TTL = 6 * 60 * 60 * 1000;
const cache = new Map();
const pending = new Map();

async function download(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Radiant Discord bot)", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => {
    throw new UserError(error.name === "TimeoutError" ? "Meta verisi zamanında gelmedi. Biraz sonra tekrar dene." : "Meta verisine ulaşılamadı.");
  });
  if (!response.ok) throw new UserError(`Meta verisi alınamadı (${response.status}).`);
  if (!/json/.test(response.headers.get("content-type") || "")) return null;
  const body = Buffer.from(await response.arrayBuffer());
  try {
    return JSON.parse(zlib.gunzipSync(body));
  } catch {
    return JSON.parse(body);
  }
}

function remember(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  if (pending.has(key)) return pending.get(key);
  const job = load()
    .then((value) => {
      cache.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

function acts() {
  return remember("acts", 12 * 60 * 60 * 1000, async () => {
    const seasons = (await download("https://valorant-api.com/v1/seasons"))?.data || [];
    const byId = Object.fromEntries(seasons.map((season) => [season.uuid, season]));
    return seasons
      .filter((season) => season.type === "EAresSeasonType::Act" && Date.parse(season.startTime) <= Date.now())
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
      .slice(0, 2)
      .map((season) => ({
        id: season.uuid,
        label: [byId[season.parentUuid]?.displayName, season.displayName].filter(Boolean).join(" · "),
      }));
  });
}

function agents() {
  return remember("agents", 24 * 60 * 60 * 1000, async () => {
    const list = (await download("https://valorant-api.com/v1/agents?isPlayableCharacter=true"))?.data || [];
    return Object.fromEntries(list.map((agent) => [agent.uuid, {
      name: agent.displayName,
      role: agent.role?.developerName || agent.role?.displayName || "",
    }]));
  });
}

function mapComps(mapId) {
  return remember(`map:${mapId}`, TTL, async () => {
    for (const act of await acts()) {
      const rows = await download(`https://www.vstats.gg/statistics/${act.id}/ALL/${mapId}/comp.json.gz`);
      if (!Array.isArray(rows)) continue;
      const comps = new Map();
      for (const row of rows) {
        const key = [...row.as].sort().join("|");
        const entry = comps.get(key) || { agents: row.as, ranks: [] };
        entry.ranks.push([row.r, row.m, (row.wr * row.m) / 100]);
        comps.set(key, entry);
      }
      return { act: act.label, comps: [...comps.values()] };
    }
    return null;
  });
}

function lowerBound(wins, matches) {
  const z = 1.96;
  const p = wins / matches;
  const z2 = z * z;
  return (p + z2 / (2 * matches) - z * Math.sqrt((p * (1 - p) + z2 / (4 * matches)) / matches)) / (1 + z2 / matches);
}

function rankComps(data, floor) {
  const list = data.comps.map((comp) => {
    let matches = 0;
    let wins = 0;
    for (const [rank, m, w] of comp.ranks) {
      if (rank < floor) continue;
      matches += m;
      wins += w;
    }
    return { agents: comp.agents, matches, wins };
  }).filter((comp) => comp.matches > 0);
  const total = list.reduce((sum, comp) => sum + comp.matches, 0);
  const minimum = Math.max(250, Math.round(total * 0.002));
  const best = list
    .filter((comp) => comp.matches >= minimum)
    .map((comp) => ({ ...comp, score: lowerBound(comp.wins, comp.matches) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const popular = [...list].sort((a, b) => b.matches - a.matches)[0];
  return { best, popular, total };
}

function lineup(ids, names) {
  return ids
    .map((id) => names[id] || { name: "?", role: "" })
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name))
    .map((agent) => agent.name)
    .join(" · ");
}

function rate(comp) {
  return `%${((comp.wins / comp.matches) * 100).toFixed(1)} kazanma · ${comp.matches.toLocaleString("tr-TR")} maç`;
}

const command = {
  data: new SlashCommandBuilder()
    .setName("map")
    .setDescription("Seçtiğin haritada güncel rekabetçi maçlarda en çok kazanan kompozisyonları gösterir.")
    .addStringOption((option) => option
      .setName("harita")
      .setDescription("Harita")
      .setRequired(true)
      .addChoices(...MAPS.map(([name, id]) => ({ name, value: id }))))
    .addIntegerOption((option) => option
      .setName("rank")
      .setDescription("Hangi ranklardaki maçlar sayılsın? Varsayılan tüm ranklar.")
      .addChoices(...RANK_FLOORS.map(([name, value]) => ({ name, value })))),

  async execute(interaction) {
    const mapId = interaction.options.getString("harita", true);
    const floor = interaction.options.getInteger("rank") ?? 0;
    const mapName = MAPS.find(([, id]) => id === mapId)?.[0] || mapId;
    const rankName = RANK_FLOORS.find(([, value]) => value === floor)?.[0] || "Tüm ranklar";
    await interaction.deferReply();
    const [data, names] = await Promise.all([mapComps(mapId), agents()]);
    if (!data) throw new UserError(`${mapName} şu an rekabetçi harita havuzunda değil, güncel verisi yok.`);
    const { best, popular, total } = rankComps(data, floor);
    if (!best.length) throw new UserError(`${mapName} için ${rankName.toLocaleLowerCase("tr")} yeterli maç yok.`);
    const [top, ...rest] = best;
    const embed = new EmbedBuilder()
      .setColor(0xff4655)
      .setTitle(`${mapName} · en çok kazanan kompozisyon`)
      .setDescription(`**${lineup(top.agents, names)}**\n${rate(top)}`)
      .addFields(
        ...rest.map((comp, index) => ({ name: `${index + 2}.`, value: `${lineup(comp.agents, names)}\n${rate(comp)}` })),
        { name: "En çok oynanan", value: `${lineup(popular.agents, names)}\n${rate(popular)}` },
      )
      .setFooter({ text: `${rankName} · ${data.act} · ${Math.round(total / 2).toLocaleString("tr-TR")} maç · Kaynak: vstats.gg` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = { command };
