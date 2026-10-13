const path = require("path");
const { spawn } = require("child_process");
const { startHub } = require("../src/agents/bus");
const { agentBanToken, agentValorantToken } = require("../src/config");
const { agentsEnabled } = require("../src/agents/mode");

const STABLE_AFTER = 60_000;
const MAX_DELAY = 60_000;
const NODE_FLAGS = ["--max-old-space-size=192", "--max-semi-space-size=2"];
const children = new Map();
const failures = new Map();
let stopping = false;

function launch(file) {
  const started = Date.now();
  const child = spawn(process.execPath, [...NODE_FLAGS, file], { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    const streak = Date.now() - started > STABLE_AFTER ? 1 : (failures.get(file) || 0) + 1;
    failures.set(file, streak);
    const delay = Math.min(MAX_DELAY, 2000 * 2 ** (streak - 1));
    console.error(`${path.basename(file)} kapandı (${signal || code}). ${Math.round(delay / 1000)} sn sonra yeniden açılıyor.`);
    setTimeout(() => {
      if (!stopping) children.set(file, launch(file));
    }, delay);
  });
  return child;
}

async function main() {
  await startHub();
  const files = [path.join(__dirname, "..", "src", "index.js")];
  if (agentsEnabled()) {
    files.push(
      path.join(__dirname, "stack.js"),
      path.join(__dirname, "kaynak.js"),
      path.join(__dirname, "rehber.js"),
    );
  } else {
    console.error("Ajan tokenları yok. Yalnız Atrium kalkıyor.");
  }
  if (agentBanToken) files.push(path.join(__dirname, "ban.js"));
  if (agentValorantToken) files.push(path.join(__dirname, "radiant.js"));
  for (const file of files) children.set(file, launch(file));

  const stop = () => {
    if (stopping) return;
    stopping = true;
    const alive = [...children.values()].filter((child) => child.exitCode === null && !child.signalCode);
    if (!alive.length) process.exit(0);
    let left = alive.length;
    for (const child of alive) {
      child.once("exit", () => {
        left -= 1;
        if (!left) process.exit(0);
      });
      child.kill("SIGTERM");
    }
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
