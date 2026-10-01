const path = require("path");
const { spawn } = require("child_process");
const { startHub } = require("../src/agents/bus");
const { agentBanToken } = require("../src/config");
const { agentsEnabled } = require("../src/agents/mode");

function launch(file) {
  const child = spawn(process.execPath, [file], { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (signal) return;
    console.error(`${path.basename(file)} kapandı (${code}). Yeniden açılıyor.`);
    setTimeout(() => {
      const next = launch(file);
      children.set(file, next);
    }, 2000);
  });
  return child;
}

const children = new Map();

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
  for (const file of files) children.set(file, launch(file));

  const stop = () => {
    for (const child of children.values()) child.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
