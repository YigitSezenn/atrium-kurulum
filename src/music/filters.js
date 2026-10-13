const PRESETS = {
  bas: {
    equalizer: [
      { band: 0, gain: 0.35 },
      { band: 1, gain: 0.25 },
      { band: 2, gain: 0.12 },
    ],
  },
  nightcore: { timescale: { speed: 1.15, pitch: 1.2, rate: 1 } },
  yavas: { timescale: { speed: 0.85, pitch: 0.95, rate: 1 } },
  karaoke: { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } },
  kapat: {},
};

function filterPreset(name) {
  if (!Object.prototype.hasOwnProperty.call(PRESETS, name)) return null;
  return PRESETS[name];
}

module.exports = { filterPreset };
