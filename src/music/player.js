const { spawn } = require("child_process");
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require("@discordjs/voice");
const ffmpegPath = require("ffmpeg-static");
const { ensureYtdlp, killTree, spawnAudio } = require("./ytdlp");

const queues = new Map();
const boundConnections = new WeakSet();
const MAX_QUEUE = 25;
const LIST_CAP = 100;
const IDLE_AFTER = 20 * 60 * 1000;
const EMPTY_AFTER = 20_000;

class GuildPlayer {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.backlog = [];
    this.current = null;
    this.volume = 0.8;
    this.connection = null;
    this.textChannel = null;
    this.process = null;
    this.downloader = null;
    this.leaving = false;
    this.manual = false;
    this.generation = 0;
    this.emptyTimer = null;
    this.idleTimer = null;
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.onIdle().catch((error) => console.error("Sıra ilerletilemedi:", error));
    });
    this.player.on("error", (error) => {
      const live = this.player.state.status === AudioPlayerStatus.Idle ? null : this.player.state.resource;
      const stale = Boolean(live && error.resource && error.resource !== live);
      if (this.manual || this.leaving || stale) return;
      console.error("Oynatıcı hatası:", error.message);
      this.killProcess();
      if (this.player.state.status !== AudioPlayerStatus.Idle) this.player.stop(true);
    });
  }

  get channelId() {
    return this.connection?.joinConfig?.channelId || null;
  }

  clearTimer(name) {
    clearTimeout(this[name]);
    this[name] = null;
  }

  bindConnection(connection) {
    if (boundConnections.has(connection)) return;
    boundConnections.add(connection);
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (this.connection === connection) this.stop();
      }
    });
  }

  async connect(voiceChannel) {
    this.leaving = false;
    const alive = this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed;
    if (!alive || this.connection.joinConfig.channelId !== voiceChannel.id) {
      this.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
      });
      this.bindConnection(this.connection);
    }
    this.connection.subscribe(this.player);
  }

  enqueue(track) {
    if (this.queue.length >= MAX_QUEUE) return false;
    this.queue.push(track);
    return true;
  }

  async startIfIdle() {
    const blocked = Boolean(this.current) || this.player.state.status === AudioPlayerStatus.Playing;
    if (blocked) return;
    await this.playNext();
  }

  async onIdle() {
    if (this.leaving || this.advancing || this.manual) return;
    this.advancing = true;
    try {
      this.killProcess();
      await this.playNext();
    } finally {
      this.advancing = false;
    }
  }

  async playNext() {
    await ensureYtdlp();
    this.clearTimer("idleTimer");
    const generation = ++this.generation;
    const track = this.queue.shift();
    if (!track) {
      this.current = null;
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (!this.current && this.queue.length === 0 && !this.leaving) this.disconnect();
      }, IDLE_AFTER);
      return;
    }

    this.current = track;
    if (generation !== this.generation) return;

    this.killProcess();
    let retired = false;
    const retire = () => {
      retired = true;
    };
    const downloader = spawnAudio(track.webpage);
    this.downloader = downloader;
    const child = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1",
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.process = child;
    downloader.stdout.pipe(child.stdin);
    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});

    const fail = (label, detail) => {
      if (retired || this.generation !== generation || this.leaving) return;
      console.error(label, detail);
      this.killProcess();
      if (this.player.state.status !== AudioPlayerStatus.Idle) this.player.stop(true);
    };
    downloader.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.error("yt-dlp:", text.slice(0, 300));
    });
    downloader.on("error", (error) => fail("yt-dlp açılmadı:", error.message));
    downloader.on("close", (code) => {
      if (code) fail("yt-dlp kapandı:", code);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text || /connection reset by peer|broken pipe|error muxing a packet|error writing trailer|error closing file|error submitting a packet|task finished with error code: -104/i.test(text)) return;
      console.error("ffmpeg:", text.slice(0, 300));
    });
    child.on("error", (error) => fail("ffmpeg açılmadı:", error.message));
    child.on("close", (code) => {
      if (code) fail("ffmpeg kapandı:", code);
    });
    this.retireProcess = retire;

    const resource = createAudioResource(child.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(this.volume);
    this.connection?.subscribe(this.player);
    this.player.play(resource);
    const { topUp } = require("./fill");
    topUp(this).catch((error) => console.error("Sıra tamamlanamadı:", error.message));
  }

  skip() {
    this.manual = true;
    try {
      this.killProcess();
      if (this.player.state.status !== AudioPlayerStatus.Idle) this.player.stop(true);
    } finally {
      this.manual = false;
    }
    this.playNext().catch((error) => console.error("Sıra ilerletilemedi:", error));
  }

  pause() {
    return this.player.pause();
  }

  resume() {
    return this.player.unpause();
  }

  setVolume(level) {
    this.volume = level;
    this.player.state.resource?.volume?.setVolume(level);
  }

  stop() {
    this.leaving = true;
    this.loading = false;
    this.loadGeneration = (this.loadGeneration || 0) + 1;
    this.queue = [];
    this.backlog = [];
    this.current = null;
    this.generation += 1;
    this.clearTimer("emptyTimer");
    this.clearTimer("idleTimer");
    this.killProcess();
    this.player.stop(true);
    this.disconnect();
  }

  disconnect() {
    this.connection?.destroy();
    this.connection = null;
  }

  killProcess() {
    this.retireProcess?.();
    this.retireProcess = null;
    const downloader = this.downloader;
    const child = this.process;
    this.downloader = null;
    this.process = null;
    killTree(downloader);
    killTree(child);
  }
}

function getPlayer(guildId) {
  if (!queues.has(guildId)) queues.set(guildId, new GuildPlayer(guildId));
  return queues.get(guildId);
}

function watchVoice(client) {
  client.on("voiceStateUpdate", (oldState) => {
    const player = queues.get(oldState.guild.id);
    if (!player?.channelId) return;
    const channel = oldState.guild.channels.cache.get(player.channelId);
    if (!channel) return;
    const humans = channel.members.filter((member) => !member.user.bot);
    if (humans.size > 0) {
      player.clearTimer("emptyTimer");
      return;
    }
    player.clearTimer("emptyTimer");
    player.emptyTimer = setTimeout(() => {
      player.emptyTimer = null;
      const still = channel.members.filter((member) => !member.user.bot);
      if (still.size === 0 && !player.leaving) player.stop();
    }, EMPTY_AFTER);
  });
}

module.exports = { getPlayer, watchVoice, MAX_QUEUE, LIST_CAP };
