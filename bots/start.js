const path = require("path");
const { spawn } = require("child_process");
const {
  agentBanToken,
  agentKaynakToken,
  agentRehberToken,
  agentStackToken,
} = require("../src/config");
const { startHub } = require("../src/agents/bus");

const missing = [
  ["AGENT_STACK_TOKEN", agentStackToken],
  ["AGENT_KAYNAK_TOKEN", agentKaynakToken],
  ["AGENT_REHBER_TOKEN", agentRehberToken],
].filter(([, value]) => !value).map(([key]) => key);

if (missing.length) {
  console.error("Arcade, Codex ve Portico ayrı Discord botu. Developer Portal'da üç uygulama açıp tokenlarını .env dosyasına yaz:");
  for (const key of missing) console.error(`${key}=`);
  console.error("Her uygulamada Server Members Intent ve Message Content Intent açık olsun. Botları sunucuya davet ettikten sonra rollerini dil rollerinin üstüne al.");
  process.exit(1);
}

async function main() {
  await startHub();
  const files = ["stack.js", "kaynak.js", "rehber.js"];
  if (agentBanToken) files.push("ban.js");
  const children = files.map((file) => spawn(
    process.execPath,
    [path.join(__dirname, file)],
    { stdio: "inherit", env: process.env },
  ));
  const stop = () => {
    for (const child of children) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
