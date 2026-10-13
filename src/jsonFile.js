const fs = require("fs");
const path = require("path");

function jsonFile(file, empty) {
  let cache = null;
  let stamp = null;
  let chain = Promise.resolve();

  const stampOf = () => {
    try {
      const stat = fs.statSync(file);
      return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return "";
    }
  };

  const quarantine = (error) => {
    const target = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, target);
      console.error(`${path.basename(file)} okunamadı (${error.message}). Bozuk dosya ${path.basename(target)} adıyla saklandı.`);
    } catch {
      console.error(`${path.basename(file)} okunamadı:`, error.message);
    }
  };

  function read() {
    const current = stampOf();
    if (cache && current === stamp) return cache;
    if (!current) {
      cache = empty();
      stamp = current;
      return cache;
    }
    try {
      cache = JSON.parse(fs.readFileSync(file, "utf8"));
      stamp = current;
    } catch (error) {
      if (error.code === "ENOENT") {
        cache = empty();
        stamp = "";
      } else {
        quarantine(error);
        cache = empty();
        stamp = stampOf();
      }
    }
    return cache;
  }

  function write(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.copyFileSync(tmp, file);
      fs.rmSync(tmp, { force: true });
    }
    cache = data;
    stamp = stampOf();
  }

  function update(mutator) {
    const run = chain.then(() => {
      const data = structuredClone(read());
      const result = mutator(data);
      write(data);
      return result;
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return { read, write, update };
}

module.exports = { jsonFile };
