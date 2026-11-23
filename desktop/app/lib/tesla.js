'use strict';
// Tesla Fleet API 도우미 (한국 = 북미/아시아태평양 리전)
const https = require('https');
const store = require('./store');

const AUTH_URL = 'https://auth.tesla.com/oauth2/v3/authorize';
const TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token';
const API_BASE = process.env.TESLA_API_BASE || 'https://fleet-api.prd.na.vn.cloud.tesla.com';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = 'openid offline_access vehicle_device_data vehicle_location';
const TOKEN_FILE = 'tesla-token.json';

function env(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`.env 파일에 ${name} 값이 비어 있어요`);
  return v;
}

function authorizeUrl(state) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: env('TESLA_CLIENT_ID'),
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    locale: 'ko-KR',
    prompt_missing_scopes: 'true',
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`테슬라 토큰 오류 (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function partnerToken() {
  const data = await tokenRequest({
    grant_type: 'client_credentials',
    client_id: env('TESLA_CLIENT_ID'),
    client_secret: env('TESLA_CLIENT_SECRET'),
    scope: 'openid vehicle_device_data vehicle_location',
    audience: API_BASE,
  });
  return data.access_token;
}

function saveUserToken(data, prev = {}) {
  const tok = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (data.expires_in || 28800) * 1000,
  };
  store.writeJson(TOKEN_FILE, tok);
  return tok;
}

async function exchangeCode(code) {
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: env('TESLA_CLIENT_ID'),
    client_secret: env('TESLA_CLIENT_SECRET'),
    code,
    audience: API_BASE,
    redirect_uri: REDIRECT_URI,
  });
  return saveUserToken(data);
}

async function userToken() {
  const tok = store.readJson(TOKEN_FILE, null);
  if (!tok || !tok.refresh_token) throw new Error('테슬라 로그인이 필요해요');
  if (tok.expires_at - Date.now() > 5 * 60 * 1000) return tok.access_token;
  const data = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: env('TESLA_CLIENT_ID'),
    refresh_token: tok.refresh_token,
  });
  return saveUserToken(data, tok).access_token;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token || (await userToken())}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Tesla API ${method} ${path} 실패 (${res.status}): ${text.slice(0, 500)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// vehicle-command 프록시(서명 담당)를 통해 요청. 프록시는 자체 서명 인증서를 씀
function viaProxy(method, path, body, { host = 'proxy', port = 4443, ca, servername }) {
  return new Promise(async (resolve, reject) => {
    let token;
    try {
      token = await userToken();
    } catch (e) {
      return reject(e);
    }
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request(
      {
        host,
        port,
        method,
        path,
        ca,
        servername: servername || host,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 60000,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }
          if (res.statusCode >= 400) {
            const err = new Error(`프록시 요청 실패 (${res.statusCode}): ${text.slice(0, 500)}`);
            err.data = data;
            return reject(err);
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('프록시 응답 시간 초과')));
    req.on('error', reject);
    req.end(payload);
  });
}

module.exports = {
  API_BASE,
  REDIRECT_URI,
  SCOPES,
  authorizeUrl,
  partnerToken,
  exchangeCode,
  userToken,
  api,
  viaProxy,
};
