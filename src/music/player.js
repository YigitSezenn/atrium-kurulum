const { registerGuild, join, play, stopTrack, setPaused, setVolume, destroy, loadTrack } = require("./lavalink");

const queues = new Map();
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
    this.voiceChannelId = null;
    this.textChannel = null;
    this.leaving = false;
    this.manual = false;
    this.repeat = false;
    this.generation = 0;
    this.mediaRetries = 0;
    this.emptyTimer = null;
    this.idleTimer = null;
    this.status = "idle";
    this.anchorMs = 0;
    this.anchorAt = null;
    registerGuild(guildId, {
      onEnd: (reason) => {
        if (reason !== "finished") return;
        this.onIdle().catch((error) => console.error("Sıra ilerletilemedi:", error));
      },
      onException: (message) => {
        this.recover(message).catch((error) => console.error("Sıra ilerletilemedi:", error));
      },
      onPosition: (position) => {
        if (this.status !== "playing") return;
        this.anchorMs = Number(position) || 0;
        this.anchorAt = Date.now();
      },
      onChannel: (channelId) => {
        this.voiceChannelId = channelId;
      },
    });
  }

  get channelId() {
    return this.voiceChannelId;
  }

  clearTimer(name) {
    clearTimeout(this[name]);
    this[name] = null;
  }

  async connect(voiceChannel) {
    this.leaving = false;
    this.voiceChannelId = voiceChannel.id;
    await join(voiceChannel.guild.id, voiceChannel.id);
  }

  enqueue(track) {
    if (this.queue.length >= MAX_QUEUE) return false;
    this.queue.push(track);
    return true;
  }

  async startIfIdle() {
    const busy = Boolean(this.current) || this.status === "playing" || this.status === "paused";
    if (busy) return;
    await this.playNext();
  }

  async onIdle() {
    if (this.leaving || this.advancing || this.manual) return;
    this.advancing = true;
    this.status = "idle";
    try {
      const replay = this.repeat && this.current && !this.broken;
      this.broken = false;
      this.mediaRetries = 0;
      if (replay) await this.playTrack(this.current);
      else await this.playNext();
    } finally {
      this.advancing = false;
    }
  }

  async playNext() {
    this.clearTimer("idleTimer");
    const track = this.queue.shift();
    if (!track) {
      if (this.status === "idle" && !this.topping) this.current = null;
      if (!this.leaving && this.backlog?.length && !this.topping) {
        const { topUp } = require("./fill");
        await topUp(this);
      }
      if (this.current || this.queue.length || this.topping) return;
      this.current = null;
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (!this.current && this.queue.length === 0 && !this.leaving) this.disconnect();
      }, IDLE_AFTER);
      return;
    }
    try {
      await this.playTrack(track);
    } catch (error) {
      console.error("Parça başlatılamadı:", error.message);
      if (this.leaving || this.status !== "idle") return;
      if (this.current === track) this.current = null;
      await this.playNext();
    }
  }

  positionMs() {
    if (this.status === "playing" && this.anchorAt != null) {
      return this.anchorMs + Math.max(0, Date.now() - this.anchorAt);
    }
    return this.anchorMs || 0;
  }

  async recover(message) {
    if (this.leaving) return;
    const text = String(message || "Parça çalınamadı.").replace(/\s+/g, " ").trim();
    console.error("Parça çalınamadı:", text.slice(0, 500));
    const track = this.current;
    if (track && track.source !== "soundcloud" && !track.swapped && track.title) {
      try {
        const found = await loadTrack(`scsearch:${track.title}`);
        track.encoded = found.encoded;
        track.webpage = found.uri;
        track.source = found.source || "soundcloud";
        track.title = found.title.slice(0, 120);
        track.duration = found.duration;
        track.swapped = true;
        this.textChannel?.send(`YouTube bu parçayı vermedi. SoundCloud'dan çalınıyor: **${track.title}**`).catch(() => {});
        await this.playTrack(track, 0);
        return;
      } catch (error) {
        console.error("SoundCloud yedeği açılmadı:", error.message);
      }
    }
    this.broken = true;
    this.status = "idle";
    this.textChannel?.send("Bu parça çalınamadı, sıradakine geçiyorum.").catch(() => {});
    await this.playNext();
  }

  async playTrack(track, offsetMs = 0) {
    this.clearTimer("idleTimer");
    const generation = ++this.generation;
    this.current = track;
    if (!this.voiceChannelId) throw new Error("Ses kanalı yok.");
    const start = Math.max(0, Number(offsetMs) || 0);
    await play(this.guildId, track.encoded, start, this.volume * 100);
    if (generation !== this.generation || this.leaving) return;
    this.status = "playing";
    this.anchorMs = start;
    this.anchorAt = Date.now();
    if (start < 800) {
      const scheduled = generation;
      setTimeout(() => {
        if (this.generation !== scheduled || this.leaving || this.current !== track) return;
        const { topUp } = require("./fill");
        topUp(this).catch((error) => console.error("Sıra tamamlanamadı:", error.message));
      }, 2_000);
    }
  }

  skip() {
    this.manual = true;
    this.status = "idle";
    stopTrack(this.guildId)
      .catch((error) => console.error("Parça durdurulamadı:", error.message))
      .finally(() => {
        this.manual = false;
        this.playNext().catch((error) => console.error("Sıra ilerletilemedi:", error));
      });
  }

  playFrom(track, offsetMs) {
    this.manual = true;
    this.playTrack(track, offsetMs)
      .catch((error) => console.error("Parça başlatılamadı:", error.message))
      .finally(() => {
        this.manual = false;
      });
  }

  restart() {
    if (!this.current) return;
    this.playFrom(this.current, 0);
  }

  toggleRepeat() {
    this.repeat = !this.repeat;
    return this.repeat;
  }

  pause() {
    if (this.status !== "playing" && this.status !== "paused") return false;
    if (this.status === "paused") return true;
    this.anchorMs = this.positionMs();
    this.anchorAt = null;
    this.status = "paused";
    setPaused(this.guildId, true);
    return true;
  }

  resume() {
    if (this.status !== "paused") return false;
    this.anchorAt = Date.now();
    this.status = "playing";
    setPaused(this.guildId, false);
    return true;
  }

  setVolume(level) {
    this.volume = level;
    if (this.status === "idle") return;
    setVolume(this.guildId, level * 100);
  }

  stop() {
    this.leaving = true;
    this.loading = false;
    this.loadGeneration = (this.loadGeneration || 0) + 1;
    this.queue = [];
    this.backlog = [];
    this.current = null;
    this.repeat = false;
    this.generation += 1;
    this.status = "idle";
    this.clearTimer("emptyTimer");
    this.clearTimer("idleTimer");
    this.disconnect();
  }

  disconnect() {
    const guildId = this.guildId;
    this.voiceChannelId = null;
    destroy(guildId).catch(() => {});
  }
}

function stopAll() {
  for (const player of queues.values()) player.stop();
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

module.exports = { getPlayer, stopAll, watchVoice, MAX_QUEUE, LIST_CAP };
