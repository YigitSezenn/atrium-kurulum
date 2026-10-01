const { UserError } = require("../errors");
const { LIST_CAP } = require("./player");
const { appAccess } = require("./spotifyAuth");

function parseSpotify(input) {
  const match = String(input).match(
    /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album|playlist)[/:]([A-Za-z0-9]+)/i,
  );
  if (!match) return null;
  return { kind: match[1].toLowerCase(), id: match[2] };
}

function artistOf(item) {
  if (typeof item.subtitle === "string" && item.subtitle.trim()) return item.subtitle.trim();
  const artists = Array.isArray(item.artists) ? item.artists : [];
  return artists.map((artist) => {
    if (typeof artist === "string") return artist;
    return artist?.name || artist?.title || "";
  }).filter(Boolean).join(", ");
}

function rowsFromEntity(entity) {
  if (!entity) return [];
  if (Array.isArray(entity.trackList) && entity.trackList.length) {
    return entity.trackList
      .filter((track) => track?.title)
      .map((track) => ({ title: track.title, artist: artistOf(track) }));
  }
  if (entity.title) return [{ title: entity.title, artist: artistOf(entity) }];
  return [];
}

function namedQuery(track) {
  const artist = (track.artists || []).map((item) => item.name).filter(Boolean).join(", ");
  return `${artist} ${track.name}`.replace(/\s+/g, " ").trim();
}

async function queriesFromApi(parsed) {
  const token = await appAccess();
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` };
  if (parsed.kind === "track") {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${parsed.id}?market=TR`, { headers });
    if (!response.ok) return null;
    const track = await response.json().catch(() => ({}));
    if (!track.name) return null;
    return { queries: [namedQuery(track)], total: 1 };
  }
  const path = parsed.kind === "album"
    ? `/albums/${parsed.id}/tracks?market=TR&limit=50`
    : `/playlists/${parsed.id}/tracks?market=TR&limit=50`;
  const queries = [];
  let url = `https://api.spotify.com/v1${path}`;
  let total = 0;
  while (url && queries.length < LIST_CAP) {
    const response = await fetch(url, { headers });
    if (!response.ok) return queries.length ? { queries, total: total || queries.length } : null;
    const body = await response.json().catch(() => ({}));
    total = body.total || total;
    for (const item of body.items || []) {
      const track = item.track || item;
      if (!track?.name || track.type === "episode") continue;
      queries.push(namedQuery(track));
      if (queries.length >= LIST_CAP) break;
    }
    url = queries.length >= LIST_CAP ? null : body.next;
  }
  if (!queries.length) return null;
  return { queries, total: total || queries.length };
}

async function spotifyQueries(input) {
  const parsed = parseSpotify(input);
  if (!parsed) return null;
  const fromApi = await queriesFromApi(parsed);
  if (fromApi) return fromApi;
  const response = await fetch(`https://open.spotify.com/embed/${parsed.kind}/${parsed.id}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new UserError("Spotify bağlantısı açılmadı.");
  const html = await response.text();
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) throw new UserError("Spotify listesinden parça adları okunamadı.");
  const jsonText = html.slice(start + marker.length, html.indexOf("</script>", start));
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new UserError("Spotify listesinden parça adları okunamadı.");
  }
  const entity = data?.props?.pageProps?.state?.data?.entity;
  const rows = rowsFromEntity(entity);
  if (!rows.length) throw new UserError("Bu Spotify bağlantısında çalınacak parça yok.");
  const queries = rows.slice(0, LIST_CAP).map((row) => `${row.artist} ${row.title}`.replace(/\s+/g, " ").trim());
  return { queries, total: rows.length };
}

module.exports = { spotifyQueries, parseSpotify };
