const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDelay, quakeLines, commands } = require("../src/source/fun");
const { command: sor } = require("../src/source/ask");

test("reminder delays stay inside thirty days", () => {
  assert.equal(parseDelay("10dk"), 600_000);
  assert.equal(parseDelay("2sa"), 7_200_000);
  assert.equal(parseDelay("1g"), 86_400_000);
  assert.equal(parseDelay("30sn"), 30_000);
  assert.equal(parseDelay("40g"), 0);
  assert.equal(parseDelay("yarın"), 0);
});

test("quake lines keep the first ten", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ title: `Yer ${index}`, mag: index, date: "2026.10.13" }));
  const lines = quakeLines(rows);
  assert.equal(lines.length, 10);
  assert.match(lines[0], /Yer 0/);
});

test("source commands stay on the fun bot", () => {
  const names = [sor, ...commands].map((item) => item.data.name);
  assert.ok(names.includes("sor"));
  assert.ok(names.includes("kedi"));
  assert.equal(names.includes("oynat"), false);
  for (const item of [sor, ...commands]) {
    assert.ok(item.data.toJSON().description.length <= 100, item.data.name);
  }
});
