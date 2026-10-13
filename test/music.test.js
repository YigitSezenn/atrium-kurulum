const test = require("node:test");
const assert = require("node:assert/strict");
const { playBody, readLoad, voiceState } = require("../src/music/protocol");
const { createGuildPlayer } = require("../src/music/player");
const { resolveTrack, formatDuration, formatSpoken } = require("../src/music/resolve");
const { playingCard } = require("../src/music/card");
const { videoFromRequest } = require("../src/music/bridge");
const { playlistId, usableAudioUrl, videoId } = require("../src/music/invidious");
const { UserError } = require("../src/errors");

const track = {
  title: "Never Gonna Give You Up",
  uri: "https://soundcloud.com/example",
  length: 213000,
  isStream: false,
  sourceName: "soundcloud",
};

function fakeApi() {
  const hooks = new Map();
  const calls = [];
  return {
    calls,
    registerGuild(guildId, hook) {
      hooks.set(guildId, hook);
    },
    hook(guildId) {
      return hooks.get(guildId);
    },
    async join(guildId, channelId) {
      calls.push(["join", guildId, channelId]);
    },
    async play(guildId, encoded, position, volume) {
      calls.push(["play", guildId, encoded, position, volume]);
    },
    async stopTrack(guildId) {
      calls.push(["stop", guildId]);
    },
    setPaused(guildId, paused) {
      calls.push(["pause", guildId, paused]);
    },
    setVolume(guildId, volume) {
      calls.push(["volume", guildId, volume]);
    },
    async destroy(guildId) {
      calls.push(["destroy", guildId]);
    },
  };
}

test("voice update includes the channel id Lavalink 4.2 requires", () => {
  const state = voiceState({
    token: "token",
    endpoint: "wss://c-ams.discord.media:443/",
    sessionId: "voice-session",
    channelId: "1219048713209516062",
  });
  assert.deepEqual(state, {
    token: "token",
    endpoint: "c-ams.discord.media:443",
    sessionId: "voice-session",
    channelId: "1219048713209516062",
  });
});

test("voice update without a channel id is refused before it can 400", () => {
  assert.throws(
    () => voiceState({ token: "token", endpoint: "c-ams.discord.media:443", sessionId: "voice-session" }),
    /Ses bilgisi eksik/,
  );
});

test("play body uses an integer volume and the encoded track", () => {
  assert.deepEqual(playBody({ encoded: "abc", positionMs: 0, volume: 80.2 }), {
    track: { encoded: "abc" },
    position: 0,
    volume: 80,
    paused: false,
  });
});

test("search load keeps the first SoundCloud track", () => {
  const found = readLoad({
    loadType: "search",
    data: [{ encoded: "abc", info: track }],
  });
  assert.equal(found.title, "Never Gonna Give You Up");
  assert.equal(found.source, "soundcloud");
  assert.equal(found.duration, 213);
  assert.equal(found.encoded, "abc");
});

test("a 30 second SoundCloud preview is skipped for the full upload", () => {
  const preview = { encoded: Buffer.from("https://api.soundcloud.com/preview/hls").toString("base64"), info: track };
  const full = { encoded: Buffer.from("https://api.soundcloud.com/stream/hls").toString("base64"), info: { ...track, title: "Full" } };
  const found = readLoad({ loadType: "search", data: [preview, full] });
  assert.equal(found.title, "Full");
});

test("empty and failed loads do not invent a track", () => {
  assert.throws(() => readLoad({ loadType: "empty", data: [] }), /Parça bulunamadı/);
  assert.throws(() => readLoad({ loadType: "error", data: { message: "nope" } }), /Parça bulunamadı/);
});

test("a song name plays the YouTube result", async () => {
  const loads = [];
  const found = await resolveTrack("Dreams Joakim Karud", {
    load: async (identifier) => {
      loads.push(identifier);
      return readLoad({ loadType: "track", data: { encoded: "abc", info: { ...track, title: "file", sourceName: "http" } } });
    },
    search: async () => ({ url: "https://www.youtube.com/watch?v=dreams", title: "Dreams" }),
    audioOf: async (page) => {
      loads.push(page);
      return { url: "https://rr1.googlevideo.com/videoplayback?id=dreams", title: "Dreams" };
    },
  });
  assert.deepEqual(loads, [
    "https://www.youtube.com/watch?v=dreams",
    "https://rr1.googlevideo.com/videoplayback?id=dreams",
  ]);
  assert.equal(found.source, "youtube");
  assert.equal(found.title, "Dreams");
  assert.equal(formatDuration(213), "3:33");
  assert.equal(formatSpoken(112), "1 dk 52 sn");
  assert.equal(formatSpoken(191), "3 dk 11 sn");

  const api = fakeApi();
  const player = createGuildPlayer("guild", api);
  await player.connect({ id: "channel", guild: { id: "guild" } });
  assert.equal(player.enqueue({ ...found, requesterId: "user" }), true);
  await player.startIfIdle();
  assert.deepEqual(api.calls, [
    ["join", "guild", "channel"],
    ["play", "guild", "abc", 0, 80],
  ]);
  assert.equal(player.current.title, "Dreams");
});

test("a YouTube link plays that video's audio", async () => {
  const loads = [];
  const found = await resolveTrack("https://www.youtube.com/watch?v=VDKkCFiuPCw", {
    load: async (identifier) => {
      loads.push(identifier);
      return readLoad({ loadType: "track", data: { encoded: "abc", info: { ...track, title: "file", sourceName: "http", length: 600000 } } });
    },
    audioOf: async (page) => {
      loads.push(page);
      return { url: "https://rr1.googlevideo.com/videoplayback?id=aion", title: "AION 2 OPTİMİZASYON REHBERİ" };
    },
    search: async () => {
      throw new Error("search should not run");
    },
  });
  assert.deepEqual(loads, [
    "https://www.youtube.com/watch?v=VDKkCFiuPCw",
    "https://rr1.googlevideo.com/videoplayback?id=aion",
  ]);
  assert.equal(found.title, "AION 2 OPTİMİZASYON REHBERİ");
  assert.equal(found.source, "youtube");
  assert.equal(found.encoded, "abc");
});

test("a Spotify link is played from the matching YouTube audio", async () => {
  const loads = [];
  const found = await resolveTrack("https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8", {
    load: async (identifier) => {
      loads.push(identifier);
      return readLoad({ loadType: "track", data: { encoded: "abc", info: { ...track, sourceName: "http" } } });
    },
    expandSpotify: async () => ({ queries: ["Casiio Hidden"] }),
    search: async (query) => {
      loads.push(query);
      return { url: "https://www.youtube.com/watch?v=hidden", title: "Hidden" };
    },
    audioOf: async (page) => {
      loads.push(page);
      return { url: "https://rr1.googlevideo.com/videoplayback?id=hidden", title: "Hidden" };
    },
  });
  assert.deepEqual(loads, [
    "Casiio Hidden",
    "https://www.youtube.com/watch?v=hidden",
    "https://rr1.googlevideo.com/videoplayback?id=hidden",
  ]);
  assert.equal(found.source, "youtube");
  assert.equal(found.title, "Hidden");
});

test("a live YouTube match is refused instead of replaced", async () => {
  const loads = [];
  await assert.rejects(
    () => resolveTrack("canlı yayın", {
      load: async (identifier) => {
        loads.push(identifier);
        throw new Error("should not load");
      },
      search: async () => ({ url: "https://www.youtube.com/watch?v=livevideo1", title: "Canlı" }),
      audioOf: async () => {
        throw new UserError("Canlı yayınları çalmıyorum.");
      },
    }),
    (error) => error instanceof UserError && error.message === "Canlı yayınları çalmıyorum.",
  );
  assert.deepEqual(loads, []);
});

test("a song name falls back to SoundCloud when YouTube has no result", async () => {
  const loads = [];
  const found = await resolveTrack("never gonna give you up", {
    load: async (identifier) => {
      loads.push(identifier);
      return readLoad({ loadType: "search", data: [{ encoded: "abc", info: track }] });
    },
    search: async () => null,
  });
  assert.deepEqual(loads, ["scsearch:never gonna give you up"]);
  assert.equal(found.source, "soundcloud");
});

test("the playing card shows the song, dj, volume and a source link", () => {
  const message = playingCard({
    title: "Dreams",
    artist: "Joakim Karud - Topic",
    service: "youtube",
    page: "https://www.youtube.com/watch?v=p56gqDhUYbU",
    thumbnail: "https://i.ytimg.com/vi/p56gqDhUYbU/hqdefault.jpg",
    duration: 191,
    requesterId: "1",
  }, { volume: 0.5 });
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.author.name, "Dreams");
  assert.equal(embed.description, "Joakim Karud - Topic");
  assert.equal(embed.footer.text, "Şarkı oynatılıyor.");
  assert.deepEqual(embed.fields.map((field) => field.value), ["<@1>", "%50", "3 dk 11 sn"]);
  assert.equal(message.components[0].components[0].data.label, "YouTube'da aç");

  const hidden = playingCard({
    title: "Hidden",
    service: "spotify",
    page: "https://rr.googlevideo.com/videoplayback?id=1",
    duration: 112,
    requesterId: "1",
  }, { volume: 0.5 }, );
  assert.equal(hidden.components[0].components[0].data.label, "Geç");
  assert.equal(hidden.embeds[0].toJSON().footer.text, "Şarkı oynatılıyor.");
});

test("only a YouTube media host can be handed to the player", () => {
  assert.equal(videoId("https://www.youtube.com/watch?v=VDKkCFiuPCw"), "VDKkCFiuPCw");
  assert.equal(videoId("https://youtu.be/Tk-Mt5oho24"), "Tk-Mt5oho24");
  assert.equal(playlistId("https://www.youtube.com/playlist?list=PLabcdefghijkl"), "PLabcdefghijkl");
  assert.equal(playlistId("https://www.youtube.com/watch?v=VDKkCFiuPCw&list=PLabcdefghijkl"), "");
  assert.equal(usableAudioUrl("https://rr1---sn.googlevideo.com/videoplayback?id=1"), "https://rr1---sn.googlevideo.com/videoplayback?id=1");
  assert.equal(usableAudioUrl("http://rr1.googlevideo.com/videoplayback"), "");
  assert.equal(usableAudioUrl("https://example.com/song.mp3"), "");
  assert.equal(usableAudioUrl("https://invidious.f5.si/latest_version?id=1"), "");
  assert.equal(videoFromRequest("/yt/3PLIa3zFqt4"), "3PLIa3zFqt4");
  assert.equal(videoFromRequest("/yt/3PLIa3zFqt4?x=1"), "3PLIa3zFqt4");
  assert.equal(videoFromRequest("https://example.com/song.mp3"), "");
  assert.equal(videoFromRequest("/yt/short"), "");
  assert.equal(videoFromRequest("/yt/3PLIa3zFqt4/extra"), "");
});

test("an unknown link is rejected", async () => {
  await assert.rejects(
    () => resolveTrack("https://example.com/song.mp3", async () => {
      throw new Error("should not load");
    }),
    UserError,
  );
});

test("a failed track is skipped and the next one plays", async () => {
  const api = fakeApi();
  const player = createGuildPlayer("guild", api);
  player.voiceChannelId = "channel";
  player.textChannel = { send() {} };
  player.enqueue({ title: "İlk", encoded: "one", duration: 10 });
  player.enqueue({ title: "İkinci", encoded: "two", duration: 10 });
  await player.startIfIdle();
  await api.hook("guild").onException();
  assert.equal(player.current.title, "İkinci");
  assert.deepEqual(api.calls.map((call) => call[0]), ["play", "play"]);
});

test("pause, volume and skip stay on the same player", async () => {
  const api = fakeApi();
  const player = createGuildPlayer("guild", api);
  player.voiceChannelId = "channel";
  player.enqueue({ title: "İlk", encoded: "one", duration: 10 });
  player.enqueue({ title: "İkinci", encoded: "two", duration: 10 });
  await player.startIfIdle();
  assert.equal(player.pause(), true);
  player.setVolume(0.5);
  player.skip();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(player.current.title, "İkinci");
  assert.deepEqual(api.calls, [
    ["play", "guild", "one", 0, 80],
    ["pause", "guild", true],
    ["volume", "guild", 50],
    ["stop", "guild"],
    ["play", "guild", "two", 0, 50],
  ]);
});
