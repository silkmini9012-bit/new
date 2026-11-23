'use strict';
// 사용자가 마법사에 붙여 넣은 테슬라 앱 정보 (이 PC에만 저장)
const fs = require('fs');
const { d } = require('./paths');

const FILE = () => d('secrets.json');

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (s.clientId) process.env.TESLA_CLIENT_ID = s.clientId;
    if (s.clientSecret) process.env.TESLA_CLIENT_SECRET = s.clientSecret;
    return s;
  } catch {
    return {};
  }
}

function save(clientId, clientSecret) {
  fs.mkdirSync(require('path').dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify({ clientId, clientSecret }, null, 2), { mode: 0o600 });
  return load();
}

module.exports = { load, save };
