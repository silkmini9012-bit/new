'use strict';
// 공개키 서버: https://<주소>/.well-known/appspecific/com.tesla.3p.public-key.pem (Funnel 443 → 4430)
const fs = require('fs');
const https = require('https');
const store = require('../lib/store');
const { PORTS } = require('../lib/paths');

const KEY_PATH = '/.well-known/appspecific/com.tesla.3p.public-key.pem';
const CERT = () => store.p('telemetry/server-chain.crt');
const KEY = () => store.p('telemetry/server.key');
const PUB = () => store.p('proxy/public-key.pem');
const mtime = (f) => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};

function handler(req, res) {
  if (req.url.split('?')[0] === KEY_PATH && fs.existsSync(PUB())) {
    res.writeHead(200, { 'Content-Type': 'application/x-pem-file', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(PUB()));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('DriveLog');
}

function start() {
  let server = null;
  let seen = 0;
  const tick = () => {
    const m = mtime(CERT());
    if (!m || !fs.existsSync(KEY())) return;
    try {
      const opts = { cert: fs.readFileSync(CERT()), key: fs.readFileSync(KEY()) };
      if (!server) {
        server = https.createServer(opts, handler);
        server.listen(PORTS.keyserver, '127.0.0.1', () => console.log('[keyserver] 공개키 제공 시작'));
      } else if (m !== seen) server.setSecureContext(opts);
      seen = m;
    } catch (e) {
      console.error('[keyserver]', e.message);
    }
  };
  tick();
  setInterval(tick, 15000).unref();
}

module.exports = { start, KEY_PATH };
