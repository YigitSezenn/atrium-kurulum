const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");
const ROOT = path.join(DATA, "backups");
const KEEP = 7;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
}

function backupNow() {
  const target = path.join(ROOT, today());
  if (fs.existsSync(target)) return false;
  const files = fs.readdirSync(DATA).filter((name) => name.endsWith(".json"));
  if (!files.length) return false;
  const staging = `${target}.part`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of files) fs.copyFileSync(path.join(DATA, name), path.join(staging, name));
  fs.renameSync(staging, target);
  return true;
}

function prune() {
  const days = fs.readdirSync(ROOT)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .reverse();
  for (const name of days.slice(KEEP)) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
}

function run() {
  try {
    if (backupNow()) console.log(`Veri yedeği alındı (${today()}).`);
    prune();
  } catch (error) {
    console.error("Veri yedeği alınamadı:", error.message);
  }
}

function startBackups() {
  run();
  setInterval(run, CHECK_EVERY).unref();
}

module.exports = { startBackups };
