const { UserError } = require("../errors");
const node = require("./node");

const queues = new Map();
const MAX_QUEUE = 25;
const LIST_CAP = 100;
const IDLE_AFTER = 20 * 60 * 1000;
const EMPTY_AFTER = 20_000;

class GuildPlayer {
  constructor(guildId, api = node) {
    this.guildId = guildId;
    this.api = api;
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
    this.emptyTimer = null;
    this.idleTimer = null;
    this.status = "idle";
    this.anchorMs = 0;
    this.anchorAt = null;
    api.registerGuild(guildId, {
      onEnd: () => Promise.resolve(this.onIdle()).catch((error) => console.error("Sıra ilerletilemedi:", error.message)),
      onException: () => Promise.resolve(this.fail()).catch((error) => console.error("Sıra ilerletilemedi:", error.message)),
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
    try {
      await this.api.join(voiceChannel.guild.id, voiceChannel.id);
    } catch (error) {
      console.error("Ses kanalına girilemedi:", error.message);
      throw new UserError("Ses kanalına girilemedi. Biraz sonra yeniden dene.");
    }
  }

  enqueue(track) {
    if (this.queue.length >= MAX_QUEUE) return false;
    this.queue.push(track);
    return true;
  }

  async startIfIdle() {
    if (this.current || this.status === "playing" || this.status === "paused") return;
    await this.playNext();
  }

  async onIdle() {
    if (this.leaving || this.advancing || this.manual) return;
    this.advancing = true;
    this.status = "idle";
    try {
      if (this.repeat && this.current) await this.playTrack(this.current);
      else await this.playNext();
    } finally {
      this.advancing = false;
    }
  }

  async playNext() {
    this.clearTimer("idleTimer");
    const track = this.queue.shift();
    if (!track) {
      if (!this.leaving && this.backlog?.length && !this.topping && !this.loading) {
        const { topUp } = require("./fill");
        await topUp(this);
      }
      if (this.status === "playing" || this.status === "paused") return;
      if (this.queue.length) {
        this.current = null;
        return this.playNext();
      }
      if (this.topping) {
        this.current = null;
        return;
      }
      if (this.current && this.repeat) return;
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
      if (this.leaving) return;
      if (this.current === track) this.current = null;
      await this.playNext();
    }
  }

  async fail() {
    if (this.leaving || this.manual) return;
    this.status = "idle";
    const sent = this.textChannel?.send("Bu şarkı açılmadı, sıradakine geçiyorum.");
    if (typeof sent?.catch === "function") sent.catch(() => {});
    await this.playNext();
  }

  async playTrack(track, offsetMs = 0) {
    this.clearTimer("idleTimer");
    const generation = ++this.generation;
    this.current = track;
    if (!this.voiceChannelId) throw new UserError("Ses kanalı yok.");
    const start = Math.max(0, Number(offsetMs) || 0);
    await this.api.play(this.guildId, track.encoded, start, Math.round(this.volume * 100));
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
    this.api.stopTrack(this.guildId)
      .catch((error) => console.error("Parça durdurulamadı:", error.message))
      .finally(() => {
        this.manual = false;
        this.playNext().catch((error) => console.error("Sıra ilerletilemedi:", error.message));
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

  shuffle() {
    const list = this.queue;
    for (let index = list.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [list[index], list[swap]] = [list[swap], list[index]];
    }
    return list.length;
  }

  seek(seconds) {
    if (!this.current) return null;
    if (this.status !== "playing" && this.status !== "paused") return null;
    const wanted = Math.max(0, Math.floor(Number(seconds) || 0));
    const limit = Math.max(0, Math.floor(Number(this.current.duration) || 0));
    const at = limit > 0 ? Math.min(wanted, limit) : wanted;
    this.anchorMs = at * 1000;
    if (this.status === "playing") this.anchorAt = Date.now();
    this.api.seek?.(this.guildId, at * 1000);
    return at;
  }

  applyFilter(name) {
    const { filterPreset } = require("./filters");
    const body = filterPreset(name);
    if (!body) return false;
    this.filter = name;
    this.api.setFilters?.(this.guildId, body);
    return true;
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
    this.api.setPaused(this.guildId, true);
    return true;
  }

  resume() {
    if (this.status !== "paused") return false;
    this.anchorAt = Date.now();
    this.status = "playing";
    this.api.setPaused(this.guildId, false);
    return true;
  }

  positionMs() {
    if (this.status === "playing" && this.anchorAt != null) {
      return this.anchorMs + Math.max(0, Date.now() - this.anchorAt);
    }
    return this.anchorMs || 0;
  }

  setVolume(level) {
    this.volume = Math.max(0, Math.min(1, Number(level) || 0));
    if (this.status === "idle") return;
    this.api.setVolume(this.guildId, Math.round(this.volume * 100));
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
    this.voiceChannelId = null;
    this.api.destroy(this.guildId).catch(() => {});
  }
}

function createGuildPlayer(guildId, api) {
  return new GuildPlayer(guildId, api);
}

function getPlayer(guildId) {
  if (!queues.has(guildId)) queues.set(guildId, new GuildPlayer(guildId));
  return queues.get(guildId);
}

function stopAll() {
  for (const player of queues.values()) player.stop();
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

module.exports = { getPlayer, createGuildPlayer, stopAll, watchVoice, MAX_QUEUE, LIST_CAP };
