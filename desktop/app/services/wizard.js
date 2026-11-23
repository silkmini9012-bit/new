'use strict';
// 설정 마법사 (브라우저 화면): http://localhost:3000
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');

const store = require('../lib/store');
const tesla = require('../lib/tesla');
const secrets = require('../lib/secrets');
const { notify } = require('../lib/notify');
const sup = require('../lib/supervisor');
const { APP_DIR, PORTS, d, exe } = require('../lib/paths');
const { KEY_PATH } = require('./keyserver');

const EXP_DAYS = 300;
const RELEASES = 'https://github.com/silkmini9012-bit/new/releases/latest';
const settings = () => store.readJson('settings.json');
const save = (p) => store.updateJson('settings.json', p);
const ts = () => store.readJson('tailscale-status.json');
const domain = () => ts().CertDomains?.[0] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastError = '';
let pairedCache = null;
let keyCheck = { ok: false, at: 0 };
let oauthState = null;

// ───────── 키 / 인증서 / 설정 파일 ─────────
function ensureKeys() {
  const priv = d('proxy', 'private-key.pem');
  fs.mkdirSync(path.dirname(priv), { recursive: true });
  if (!fs.existsSync(priv)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    fs.writeFileSync(priv, privateKey.export({ type: 'sec1', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(d('proxy', 'public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  }
  if (!fs.existsSync(d('proxy', 'tls-cert.pem'))) {
    const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      keySize: 2048,
      days: 3650,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }],
    });
    fs.writeFileSync(d('proxy', 'tls-key.pem'), pems.private, { mode: 0o600 });
    fs.writeFileSync(d('proxy', 'tls-cert.pem'), pems.cert);
  }
  const s = settings();
  if (!s.ntfyTopic) save({ ntfyTopic: `drivelog-${crypto.randomBytes(6).toString('hex')}` });
}

function writeTelemetryConfig() {
  const conf = {
    host: '127.0.0.1',
    port: PORTS.telemetry,
    log_level: 'info',
    json_log_enable: true,
    namespace: 'tesla_telemetry',
    reliable_ack: false,
    records: { V: ['mqtt'], connectivity: ['mqtt'], alerts: ['logger'], errors: ['logger'] },
    mqtt: { broker: `127.0.0.1:${PORTS.mqtt}`, client_id: 'fleet-telemetry', topic_base: 'tesla', qos: 1, retained: false },
    tls: { server_cert: d('telemetry', 'server-chain.crt'), server_key: d('telemetry', 'server.key') },
  };
  fs.mkdirSync(d('telemetry'), { recursive: true });
  fs.writeFileSync(d('telemetry', 'config.json'), JSON.stringify(conf, null, 2));
}

function telemetryCa() {
  const chain = fs.readFileSync(d('telemetry', 'server-chain.crt'), 'utf8');
  const pems = chain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  const roots = ['isrg-root-x1.pem', 'isrg-root-x2.pem'].map((f) => fs.readFileSync(path.join(APP_DIR, 'lib', f), 'utf8').trim());
  return [...pems.slice(1), ...roots].join('\n') + '\n';
}

async function checkPublicKey() {
  const dom = domain();
  if (!dom) return false;
  if (Date.now() - keyCheck.at < 20000) return keyCheck.ok;
  try {
    const want = fs.readFileSync(d('proxy', 'public-key.pem'), 'utf8').replace(/\s+/g, '');
    const res = await fetch(`https://${dom}${KEY_PATH}`, { signal: AbortSignal.timeout(10000) });
    keyCheck = { ok: res.ok && (await res.text()).replace(/\s+/g, '') === want, at: Date.now() };
  } catch {
    keyCheck = { ok: false, at: Date.now() };
  }
  return keyCheck.ok;
}

// ───────── 상태 ─────────
async function state() {
  const t = ts();
  const s = settings();
  const sec = secrets.load();
  const dom = domain();
  let loggedIn = false;
  try {
    loggedIn = !!store.readJson('tesla-token.json', null)?.refresh_token;
  } catch {}
  const dash = s.dashToken && dom ? `https://${dom}:10000/?k=${s.dashToken}` : null;
  return {
    tailscale: {
      state: t.BackendState || 'Starting',
      authUrl: t.AuthURL || '',
      domain: dom,
      funnel: !!t.Funnel,
      funnelUrl: t.NodeID ? `https://login.tailscale.com/f/funnel?node=${encodeURIComponent(t.NodeID)}` : 'https://login.tailscale.com/admin/acls/file',
      certOK: !!t.CertOK,
      serveApplied: !!t.ServeApplied,
      error: t.Error || '',
    },
    app: { hasClient: !!(sec.clientId && sec.clientSecret), clientId: sec.clientId || '', suggestName: s.appName || (save({ appName: `DriveLog ${crypto.randomBytes(2).toString('hex').toUpperCase()}` }).appName) },
    publicKey: dom ? await checkPublicKey() : false,
    partner: !!dom && s.partnerRegistered === dom,
    loggedIn,
    vin: s.vin || '',
    vehicleName: s.vehicleName || '',
    paired: pairedCache,
    notify: { topic: s.ntfyTopic, ok: !!s.notifyOk },
    telemetry: { exp: s.telemetryExp || 0, synced: !!s.telemetrySynced, running: sup.running('telemetry') },
    carName: s.carName || '내 테슬라',
    dashboardLocal: `http://localhost:${PORTS.dashboardLocal}`,
    dashboardPhone: dash,
    releases: RELEASES,
    lastError,
  };
}

// ───────── 동작 ─────────
const actions = {
  async app({ clientId, clientSecret }) {
    if (!clientId || !clientSecret) throw new Error('Client ID와 Client Secret을 모두 입력해 주세요');
    secrets.save(String(clientId).trim(), String(clientSecret).trim());
    await tesla.partnerToken(); // 값이 맞는지 바로 확인
    return { ok: true };
  },
  async partner() {
    const dom = domain();
    if (!dom) throw new Error('Tailscale 연결이 먼저 필요해요');
    keyCheck.at = 0;
    if (!(await checkPublicKey())) throw new Error('공개키가 아직 인터넷에서 보이지 않아요. Funnel 허용 후 1~2분 기다렸다가 다시 눌러 주세요.');
    const token = await tesla.partnerToken();
    try {
      await tesla.api('POST', '/api/1/partner_accounts', { token, body: { domain: dom } });
    } catch (e) {
      if (/origin|domain/i.test(e.message)) throw new Error(`테슬라 앱의 "허용되는 출처 URL"에 https://${dom} 이 있는지 확인해 주세요. (${e.message})`);
      throw e;
    }
    save({ partnerRegistered: dom });
    return { ok: true };
  },
  async vehicles() {
    const list = (await tesla.api('GET', '/api/1/vehicles')).response || [];
    return list.map((v) => ({ vin: v.vin, name: v.display_name || '' }));
  },
  async vehicle({ vin, name }) {
    save({ vin, vehicleName: name || '' });
    pairedCache = null;
    return { ok: true };
  },
  async paired() {
    const { vin } = settings();
    const r = await tesla.api('POST', '/api/1/vehicles/fleet_status', { body: { vins: [vin] } });
    pairedCache = (r.response?.key_paired_vins || []).includes(vin);
    return { paired: pairedCache };
  },
  async notifyTest() {
    const ok = await notify(store.settings(), '✅ DriveLog 알림 테스트', '이 알림이 보이면 알림 설정이 끝난 거예요.');
    if (!ok) throw new Error('알림을 보내지 못했어요. 인터넷 연결을 확인해 주세요.');
    return { ok };
  },
  async notifyOk() {
    save({ notifyOk: true });
    return { ok: true };
  },
  async carName({ name }) {
    save({ carName: String(name || '').slice(0, 20) || '내 테슬라' });
    return { ok: true };
  },
  async configure() {
    const { vin } = settings();
    const dom = domain();
    if (!vin || !dom) throw new Error('차량 선택과 Tailscale 연결이 먼저 필요해요');
    writeTelemetryConfig();
    // 테슬라 공식 서명 프록시를 잠깐 띄워서 설정에 서명
    sup.start('proxy', exe('tesla-http-proxy'), [], {
      restart: false,
      env: {
        TESLA_HTTP_PROXY_TLS_CERT: d('proxy', 'tls-cert.pem'),
        TESLA_HTTP_PROXY_TLS_KEY: d('proxy', 'tls-key.pem'),
        TESLA_HTTP_PROXY_HOST: '127.0.0.1',
        TESLA_HTTP_PROXY_PORT: String(PORTS.proxy),
        TESLA_HTTP_PROXY_TIMEOUT: '30s',
        TESLA_KEY_FILE: d('proxy', 'private-key.pem'),
      },
    });
    try {
      const exp = Math.floor(Date.now() / 1000) + EXP_DAYS * 86400;
      const body = {
        vins: [vin],
        config: {
          hostname: dom,
          port: 8443,
          ca: telemetryCa(),
          exp,
          fields: {
            Gear: { interval_seconds: 1 },
            Location: { interval_seconds: 10 },
            VehicleSpeed: { interval_seconds: 10 },
            Odometer: { interval_seconds: 30 },
            BatteryLevel: { interval_seconds: 60 },
          },
        },
      };
      const ca = fs.readFileSync(d('proxy', 'tls-cert.pem'));
      let res;
      for (let i = 0; ; i++) {
        try {
          res = await tesla.viaProxy('POST', '/api/1/vehicles/fleet_telemetry_config', body, { host: '127.0.0.1', port: PORTS.proxy, ca, servername: 'localhost' });
          break;
        } catch (e) {
          if (i < 15 && /ECONNREFUSED|socket hang up|ECONNRESET/i.test(e.message)) {
            await sleep(1000);
            continue;
          }
          throw e;
        }
      }
      const r = res.response || res;
      const why = Object.entries(r.skipped_vehicles || {}).find(([, l]) => Array.isArray(l) && l.includes(vin));
      if (why) {
        const hints = {
          missing_key: '가상 키가 차에 등록되지 않았어요.',
          unsupported_firmware: '차 소프트웨어를 2024.26 이상으로 업데이트해 주세요.',
          unsupported_hardware: '이 차량은 실시간 스트리밍을 지원하지 않아요.',
          max_configs: '다른 앱의 스트리밍 설정이 너무 많아요.',
        };
        throw new Error(`차량이 설정을 거부했어요 (${why[0]}). ${hints[why[0]] || ''}`);
      }
      save({ telemetryExp: exp, telemetrySynced: false });
      require('../main').startTelemetry();
      return { ok: true };
    } finally {
      sup.stop('proxy');
    }
  },
  async synced() {
    const { vin } = settings();
    const g = await tesla.api('GET', `/api/1/vehicles/${vin}/fleet_telemetry_config`);
    const synced = !!g.response?.synced;
    save({ telemetrySynced: synced });
    return { synced };
  },
  async noSleep() {
    await new Promise((resolve) => exec('powercfg /change standby-timeout-ac 0', () => resolve()));
    return { ok: true };
  },
};

// ───────── HTTP ─────────
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  // 다른 사이트가 이 화면의 API를 호출하지 못하게 (로컬 전용)
  const host = String(req.headers.host || '');
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res, 403, { error: 'local only' });
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(APP_DIR, 'public', 'setup.html')));
    }
    if (p === '/api/state') return json(res, 200, await state());
    if (p === '/api/qr') {
      const svg = await QRCode.toString(url.searchParams.get('t') || '', { type: 'svg', margin: 1, width: 220 });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end(svg);
    }
    if (p === '/login') {
      oauthState = crypto.randomBytes(12).toString('hex');
      res.writeHead(302, { Location: tesla.authorizeUrl(oauthState) });
      return res.end();
    }
    if (p === '/callback') {
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.get('state') !== oauthState) throw new Error(`로그인 실패: ${url.searchParams.get('error_description') || url.searchParams.get('error') || 'state 불일치'}`);
      await tesla.exchangeCode(code);
      oauthState = null;
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    const m = p.match(/^\/api\/do\/(\w+)$/);
    if (m && req.method === 'POST' && actions[m[1]]) {
      const out = await actions[m[1]](await readBody(req));
      lastError = '';
      return json(res, 200, out);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    lastError = e.message;
    console.error('[wizard]', e.message);
    if (p === '/callback') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<meta charset="utf-8"><p style="font-family:sans-serif">${e.message}</p><a href="/">돌아가기</a>`);
    }
    json(res, 400, { error: e.message });
  }
}

function start() {
  ensureKeys();
  http.createServer(handler).listen(PORTS.wizard, '127.0.0.1', () => console.log(`[wizard] http://localhost:${PORTS.wizard}`));
}

function isSetupDone() {
  const s = settings();
  return !!(s.partnerRegistered && s.vin && s.telemetryExp && s.notifyOk);
}

module.exports = { start, isSetupDone, ensureKeys };
