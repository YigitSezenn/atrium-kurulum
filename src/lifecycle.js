const tasks = [];
let installed = false;
let closing = false;
let current = null;

function onShutdown(task) {
  tasks.push(task);
}

async function shutdown(code) {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(code), 5000).unref();
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      console.error("Kapanış adımı olmadı:", error.message);
    }
  }
  await Promise.resolve(current?.destroy()).catch(() => {});
  process.exit(code);
}

function guardProcess(client) {
  current = client;
  client.on("error", (error) => console.error("Discord istemci hatası:", error.message));
  client.on("shardError", (error) => console.error("Discord bağlantı hatası:", error.message));
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    console.error("Yakalanmamış söz hatası:", reason instanceof Error ? reason : String(reason));
  });
  process.on("uncaughtException", (error) => {
    console.error("Yakalanmamış hata:", error);
    shutdown(1);
  });
  process.once("SIGTERM", () => shutdown(0));
  process.once("SIGINT", () => shutdown(0));
}

module.exports = { guardProcess, onShutdown };
