'use strict';
// 카카오: 로그인 토큰 관리, "나에게 보내기", 좌표→주소 변환
const store = require('./store');

const TOKEN_FILE = 'kakao-token.json';
const REDIRECT_URI = 'http://localhost:3000/kakao/callback';

function authorizeUrl(restKey, state) {
  const q = new URLSearchParams({
    client_id: restKey,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'talk_message',
    state,
  });
  return `https://kauth.kakao.com/oauth/authorize?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`카카오 토큰 오류 (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

function saveToken(data, prev = {}) {
  const now = Date.now();
  const next = {
    access_token: data.access_token,
    expires_at: now + (data.expires_in || 21599) * 1000,
    refresh_token: data.refresh_token || prev.refresh_token,
    refresh_expires_at: data.refresh_token
      ? now + (data.refresh_token_expires_in || 5183999) * 1000
      : prev.refresh_expires_at,
  };
  store.writeJson(TOKEN_FILE, next);
  return next;
}

async function exchangeCode(cfg, code) {
  const params = { grant_type: 'authorization_code', client_id: cfg.kakaoKey, redirect_uri: REDIRECT_URI, code };
  if (cfg.kakaoSecret) params.client_secret = cfg.kakaoSecret;
  return saveToken(await tokenRequest(params));
}

async function accessToken(cfg) {
  const tok = store.readJson(TOKEN_FILE, null);
  if (!tok || !tok.refresh_token) throw new Error('카카오 로그인이 안 돼 있어요. setup.cmd를 다시 실행하세요.');
  if (tok.expires_at - Date.now() > 5 * 60 * 1000) return tok.access_token;
  const params = { grant_type: 'refresh_token', client_id: cfg.kakaoKey, refresh_token: tok.refresh_token };
  if (cfg.kakaoSecret) params.client_secret = cfg.kakaoSecret;
  return saveToken(await tokenRequest(params), tok).access_token;
}

async function sendMemo(cfg, text, url) {
  const link = url || 'https://map.kakao.com';
  const template = {
    object_type: 'text',
    text: text.slice(0, 200),
    link: { web_url: link, mobile_web_url: link },
    button_title: url ? '지도 보기' : '열기',
  };
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken(cfg)}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.result_code !== 0) throw new Error(`카카오 발송 오류 (${res.status}): ${JSON.stringify(data)}`);
}

// 좌표 → "경기 남양주시 ..." (REST API 키가 있고 카카오맵 API가 켜져 있을 때만)
async function reverseGeocode(cfg, loc) {
  if (!cfg.kakaoKey || !loc) return null;
  try {
    const q = new URLSearchParams({ x: String(loc.lng), y: String(loc.lat) });
    const res = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2address.json?${q}`, {
      headers: { Authorization: `KakaoAK ${cfg.kakaoKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const doc = (await res.json()).documents?.[0];
    if (!doc) return null;
    const road = doc.road_address;
    if (road?.address_name) return road.building_name ? `${road.address_name} (${road.building_name})` : road.address_name;
    return doc.address?.address_name || null;
  } catch {
    return null;
  }
}

module.exports = { authorizeUrl, exchangeCode, accessToken, sendMemo, reverseGeocode, REDIRECT_URI, TOKEN_FILE };
