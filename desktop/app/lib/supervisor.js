'use strict';
// 보조 프로그램(tunnel, fleet-telemetry, proxy)을 실행하고, 꺼지면 다시 켠다.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { d } = require('./paths');

const procs = new Map();

function logStream(name) {
  const dir = d('logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.log`);
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.old');
  } catch {}
  return fs.createWriteStream(file, { flags: 'a' });
}

function start(name, cmd, args = [], { env = {}, restart = true, onLine } = {}) {
  stop(name);
  const entry = { name, stopped: false, child: null, restarts: 0 };
  procs.set(name, entry);
  const run = () => {
    if (entry.stopped) return;
    if (!fs.existsSync(cmd)) {
      console.error(`[${name}] 실행 파일이 없어요: ${cmd}`);
      return;
    }
    const out = logStream(name);
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...env }, cwd: d() });
    entry.child = child;
    const pipe = (buf) => {
      out.write(buf);
      if (onLine) String(buf).split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
    };
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('exit', (code) => {
      out.end(`\n[${new Date().toISOString()}] exited code=${code}\n`);
      entry.child = null;
      if (restart && !entry.stopped) {
        entry.restarts++;
        setTimeout(run, Math.min(5000 * entry.restarts, 60000));
      }
    });
    child.on('error', (e) => console.error(`[${name}]`, e.message));
  };
  run();
  return entry;
}

function stop(name) {
  const e = procs.get(name);
  if (!e) return;
  e.stopped = true;
  try {
    e.child?.kill();
  } catch {}
  procs.delete(name);
}

function running(name) {
  return !!procs.get(name)?.child;
}

function stopAll() {
  for (const n of [...procs.keys()]) stop(n);
}

process.on('exit', stopAll);
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => (stopAll(), process.exit(0))));

module.exports = { start, stop, running, stopAll };
