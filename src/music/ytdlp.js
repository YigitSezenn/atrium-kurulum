const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ytdlpCookies } = require("../config");

const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const downloadName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp_linux";
const binary = path.join(__dirname, "..", "..", "bin", binaryName);
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${downloadName}`;

let pending = null;

function ensureYtdlp() {
  if (fs.existsSync(binary)) return Promise.resolve(binary);
  if (!pending) {
    pending = downloadYtdlp().finally(() => {
      pending = null;
    });
  }
  return pending;
}

async function downloadYtdlp() {
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`yt-dlp indirilemedi (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const part = `${binary}.part`;
  await fs.promises.writeFile(part, bytes);
  if (process.platform !== "win32") await fs.promises.chmod(part, 0o755);
  await fs.promises.rename(part, binary);
  return binary;
}

function withCookies(args) {
  if (ytdlpCookies) args.push("--cookies", ytdlpCookies);
  return args;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill();
}

function parseProbe(text) {
  const info = {};
  for (const line of text.split(/\r?\n/)) {
    const split = line.indexOf(":");
    if (split < 1) continue;
    const key = line.slice(0, split);
    if (!["title", "url", "duration", "live"].includes(key)) continue;
    const raw = line.slice(split + 1);
    try {
      info[key] = JSON.parse(raw);
    } catch {
      info[key] = raw;
    }
  }
  const duration = Number(info.duration);
  return {
    title: typeof info.title === "string" ? info.title : "",
    webpage_url: typeof info.url === "string" ? info.url : "",
    duration: Number.isFinite(duration) ? duration : 0,
    is_live: info.live === true,
  };
}

async function runYtdlp(target) {
  await ensureYtdlp();
  const args = withCookies([
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--print", "title:%(title)j",
    "--print", "url:%(webpage_url)j",
    "--print", "duration:%(duration)j",
    "--print", "live:%(is_live)j",
    target,
  ]);

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error("yt-dlp zaman aşımı"));
    }, 45_000);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8");
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").slice(0, 500) || `yt-dlp ${code}`));
        return;
      }
      const info = parseProbe(text);
      if (!info.title) {
        reject(new Error("yt-dlp yanıtı okunamadı"));
        return;
      }
      resolve(info);
    });
  });
}

function spawnAudio(webpage) {
  const args = withCookies([
    "-f",
    "bestaudio/best",
    "-o",
    "-",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    webpage,
  ]);
  return spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

module.exports = { ensureYtdlp, runYtdlp, spawnAudio, killTree, binary };
