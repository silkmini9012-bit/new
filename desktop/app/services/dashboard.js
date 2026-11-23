'use strict';
// 주행 기록 대시보드
//  - 이 PC:  http://localhost:8090 (토큰 없이)
//  - 휴대폰: https://<주소>:10000 → 8091 (토큰 필요, Tailscale Funnel 경유)
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const store = require('../lib/store');
const { APP_DIR, PORTS } = require('../lib/paths');

const PUBLIC = path.join(APP_DIR, 'public');
const STATIC = {
  '/manifest.webmanifest': 'application/manifest+json',
  '/sw.js': 'text/javascript; charset=utf-8',
  '/icon-192.png': 'image/png',
  '/icon-512.png': 'image/png',
};

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
const trips = (name, fallback) => {
  try {
    return fs.readFileSync(path.join(store.p('trips'), name), 'utf8');
  } catch {
    return fallback;
  }
};

function token() {
  let s = store.readJson('settings.json');
  if (!s.dashToken) s = store.updateJson('settings.json', { dashToken: crypto.randomBytes(24).toString('hex') });
  return s.dashToken;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function handler(requireToken) {
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const extra = {};
    if (requireToken) {
      const t = token();
      const cookie = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('dl_token='))?.slice(9);
      const q = url.searchParams.get('k');
      if (q && safeEqual(q, t)) {
        extra['Set-Cookie'] = `dl_token=${t}; Path=/; Max-Age=315360000; HttpOnly; Secure; SameSite=Lax`;
      } else if (!safeEqual(cookie, t)) {
        return send(res, 401, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#111214;color:#eee;padding:40px;text-align:center"><h2>접속 권한이 없어요</h2><p>PC의 DriveLog 설정 화면에 있는 QR 코드로 접속해 주세요.</p></body>', 'text/html; charset=utf-8');
      }
    }
    if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8', extra);
    if (STATIC[p]) return send(res, 200, fs.readFileSync(path.join(PUBLIC, p.slice(1))), STATIC[p], extra);
    if (p === '/api/trips') return send(res, 200, trips('index.json', '[]'), undefined, extra);
    if (p === '/api/current') return send(res, 200, trips('current.json', 'null'), undefined, extra);
    if (p === '/api/settings') {
      const s = store.readJson('settings.json');
      return send(res, 200, JSON.stringify({ carName: s.carName || '내 테슬라', vin: s.vin ? `…${s.vin.slice(-6)}` : '', kakaoJsKey: s.kakaoJsKey || '' }), undefined, extra);
    }
    const m = p.match(/^\/api\/trips\/(\d{8}-\d{6})$/);
    if (m) {
      const t = trips(`${m[1]}.json`, null);
      return t ? send(res, 200, t, undefined, extra) : send(res, 404, '{"error":"not found"}');
    }
    send(res, 404, 'not found', 'text/plain');
  };
}

function start() {
  token();
  http.createServer(handler(false)).listen(PORTS.dashboardLocal, '127.0.0.1');
  http.createServer(handler(true)).listen(PORTS.dashboardPublic, '127.0.0.1');
}

module.exports = { start, token };
