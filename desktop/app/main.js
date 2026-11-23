'use strict';
// DriveLog 데스크톱: 모든 기능을 프로그램 하나로 실행
const fs = require('fs');
const net = require('net');
const path = require('path');
const { exec } = require('child_process');
const paths = require('./lib/paths');

process.env.CONFIG_DIR = paths.DATA_DIR;
fs.mkdirSync(paths.DATA_DIR, { recursive: true });

// 로그를 data\logs\drivelog.log 에도 남김
{
  const file = paths.d('logs', 'drivelog.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = (lvl, args) => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.old');
      const line = args.map((a) => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      fs.appendFileSync(file, `${new Date().toISOString()} ${lvl} ${line}\n`);
    } catch {}
  };
  const ol = console.log.bind(console);
  const oe = console.error.bind(console);
  console.log = (...a) => (ol(...a), write('INFO', a));
  console.error = (...a) => (oe(...a), write('ERROR', a));
}
process.on('uncaughtException', (e) => console.error('uncaught', e));
process.on('unhandledRejection', (e) => console.error('unhandled', e));

require('./lib/secrets').load();
const sup = require('./lib/supervisor');
const notifier = require('./services/notifier');

// 이미 실행 중이면 설정 화면만 열고 종료
function alreadyRunning() {
  return new Promise((resolve) => {
    const s = net.connect(paths.PORTS.wizard, '127.0.0.1');
    s.on('connect', () => (s.destroy(), resolve(true)));
    s.on('error', () => resolve(false));
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') exec(`start "" "${url}"`);
  else if (process.platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

// 내장 MQTT 브로커: fleet-telemetry → 여기 → 알림/기록
function startBroker() {
  const aedes = require('aedes')();
  aedes.on('publish', (packet, client) => {
    if (!client) return; // 브로커 내부 메시지 무시
    try {
      notifier.handle(packet.topic, packet.payload);
    } catch (e) {
      console.error('메시지 처리 오류', e);
    }
  });
  net.createServer(aedes.handle).listen(paths.PORTS.mqtt, '127.0.0.1');
}

function startTunnel() {
  sup.start('tunnel', paths.exe('drivelog-tunnel'), ['-dir', paths.d('tailscale-state'), '-out', paths.DATA_DIR, '-hostname', 'drivelog']);
}

let telemetryCertMtime = 0;
function startTelemetry() {
  const conf = paths.d('telemetry', 'config.json');
  if (!fs.existsSync(conf) || !fs.existsSync(paths.d('telemetry', 'server-chain.crt'))) return false;
  telemetryCertMtime = fs.statSync(paths.d('telemetry', 'server-chain.crt')).mtimeMs;
  sup.start('telemetry', paths.exe('fleet-telemetry'), ['-config', conf]);
  return true;
}

// 인증서가 갱신되면(약 60일마다) 텔레메트리 서버를 다시 시작
setInterval(() => {
  try {
    const m = fs.statSync(paths.d('telemetry', 'server-chain.crt')).mtimeMs;
    if (telemetryCertMtime && m !== telemetryCertMtime) {
      console.log('인증서 갱신 → 텔레메트리 서버 재시작');
      startTelemetry();
    }
  } catch {}
}, 60000).unref();

async function main() {
  if (await alreadyRunning()) {
    openBrowser(`http://localhost:${paths.PORTS.wizard}`);
    return;
  }
  console.log(`DriveLog 시작 · 데이터 폴더: ${paths.DATA_DIR}`);
  const wizard = require('./services/wizard');
  wizard.start();
  require('./services/keyserver').start();
  require('./services/dashboard').start();
  startBroker();
  startTunnel();
  startTelemetry();
  if (!wizard.isSetupDone() || process.argv.includes('--open')) openBrowser(`http://localhost:${paths.PORTS.wizard}`);
}

module.exports = { startTelemetry };
if (require.main === module) main();
