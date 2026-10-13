async function lyricsFor(title, artist) {
  const name = String(title || "").trim();
  if (!name) return "";
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("track_name", name.slice(0, 120));
  const singer = String(artist || "").trim();
  if (singer) url.searchParams.set("artist_name", singer.slice(0, 80));
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Atrium" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return "";
  const list = await response.json();
  const hit = (Array.isArray(list) ? list : []).find((item) => String(item?.plainLyrics || "").trim());
  return String(hit?.plainLyrics || "").trim().slice(0, 3900);
}

module.exports = { lyricsFor };
