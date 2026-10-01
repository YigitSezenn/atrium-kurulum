const net = require("net");
const { agentBusPort } = require("../config");

const PORT = agentBusPort || 47831;
let current = null;
let linked = false;

function startHub() {
  const agents = new Map();
  const methods = new Map();
  const pending = new Map();

  const server = net.createServer((socket) => {
    let name = "";
    let buffer = "";

    const send = (target, message) => {
      if (!target || target.destroyed) return;
      target.write(`${JSON.stringify(message)}\n`);
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "hello") {
          name = String(message.name || "").slice(0, 32);
          if (name) agents.set(name, socket);
          continue;
        }
        if (message.type === "register") {
          for (const method of message.methods || []) {
            if (typeof method === "string") methods.set(method, name);
          }
          continue;
        }
        if (message.type === "event") {
          const packet = { type: "event", event: message.event, data: message.data, from: name };
          for (const [agentName, target] of agents) {
            if (agentName !== name) send(target, packet);
          }
          continue;
        }
        if (message.type === "call") {
          const owner = methods.get(message.method);
          const target = owner && agents.get(owner);
          if (!target) {
            send(socket, { type: "result", id: message.id, ok: false, error: "ajan yok" });
            continue;
          }
          pending.set(message.id, socket);
          send(target, message);
          continue;
        }
        if (message.type === "result") {
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          send(waiter, message);
        }
      }
    });

    socket.on("close", () => {
      if (name && agents.get(name) === socket) agents.delete(name);
      for (const [id, waiter] of pending) {
        if (waiter !== socket) continue;
        pending.delete(id);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`Ajan hattı 127.0.0.1:${PORT} üzerinde.`);
      resolve(server);
    });
  });
}

function connectBus(name, handlers = {}) {
  const methods = handlers.methods || {};
  const onEvent = handlers.onEvent || (() => {});
  const pending = new Map();
  let socket = null;
  let buffer = "";
  let stopped = false;

  const send = (message) => {
    if (!socket || socket.destroyed) return false;
    socket.write(`${JSON.stringify(message)}\n`);
    return true;
  };

  const api = {
    emit(event, data) {
      return send({ type: "event", event, data });
    },
    call(method, data, timeout = 5000) {
      const id = `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("ajan cevap vermedi"));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        if (!send({ type: "call", id, method, data })) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error("ajan hattı yok"));
        }
      });
    },
    stop() {
      stopped = true;
      socket?.destroy();
    },
  };

  const open = () => {
    if (stopped) return;
    buffer = "";
    socket = net.connect(PORT, "127.0.0.1");
    socket.on("connect", () => {
      linked = true;
      send({ type: "hello", name });
      send({ type: "register", methods: Object.keys(methods) });
      console.log(`${name} ajan hattına bağlandı.`);
      handlers.onConnect?.();
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "event") {
          Promise.resolve(onEvent(message)).catch((error) => {
            console.error(`${name} olayı işleyemedi:`, error.message);
          });
          continue;
        }
        if (message.type === "call" && methods[message.method]) {
          Promise.resolve(methods[message.method](message.data || {}))
            .then((data) => send({ type: "result", id: message.id, ok: true, data }))
            .catch((error) => send({ type: "result", id: message.id, ok: false, error: error.message }));
          continue;
        }
        if (message.type === "result") {
          const waiter = pending.get(message.id);
          if (!waiter) continue;
          clearTimeout(waiter.timer);
          pending.delete(message.id);
          if (message.ok) waiter.resolve(message.data);
          else waiter.reject(new Error(message.error || "çağrı olmadı"));
        }
      }
    });
    socket.on("close", () => {
      linked = false;
      socket = null;
      if (!stopped) setTimeout(open, 2000);
    });
    socket.on("error", () => {});
  };

  current = api;
  open();
  return api;
}

function emit(event, data) {
  return current ? current.emit(event, data) : false;
}

function call(method, data, timeout) {
  if (!current) return Promise.reject(new Error("ajan hattı yok"));
  return current.call(method, data, timeout);
}

function busReady() {
  return linked;
}

module.exports = { startHub, connectBus, emit, call, busReady, PORT };
