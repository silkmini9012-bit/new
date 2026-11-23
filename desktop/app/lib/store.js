'use strict';
// config/ 폴더 안의 JSON 파일 읽기/쓰기 도우미
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');

function p(name) {
  return path.join(CONFIG_DIR, name);
}

function readJson(name, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(p(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  const file = p(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function updateJson(name, patch) {
  const next = { ...readJson(name), ...patch };
  writeJson(name, next);
  return next;
}

// .env 값 + setup이 만든 config/settings.json 값을 합친 설정
function settings() {
  const s = readJson('settings.json');
  const env = process.env;
  return {
    carName: env.CAR_NAME || '내 테슬라',
    channels: (env.NOTIFY_CHANNEL || 'ntfy').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean),
    ntfyServer: (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, ''),
    ntfyTopic: env.NTFY_TOPIC || s.ntfyTopic || '',
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || s.telegramChatId || '',
    kakaoKey: env.KAKAO_REST_API_KEY || '',
    kakaoSecret: env.KAKAO_CLIENT_SECRET || '',
    parkConfirmSeconds: Number(env.PARK_CONFIRM_SECONDS || 60),
    vin: s.vin || '',
    telemetryExp: s.telemetryExp || 0,
  };
}

module.exports = { CONFIG_DIR, p, readJson, writeJson, updateJson, settings };
