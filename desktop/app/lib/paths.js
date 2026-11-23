'use strict';
// 설치 위치/데이터 위치 (Windows: %LOCALAPPDATA%\DriveLog)
const path = require('path');
const os = require('os');

const APP_DIR = path.join(__dirname, '..');
const BIN_DIR = process.env.DRIVELOG_BIN || path.join(APP_DIR, '..', 'bin');
const DATA_DIR =
  process.env.DRIVELOG_DATA ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'DriveLog', 'data');

const exe = (name) => path.join(BIN_DIR, process.platform === 'win32' ? `${name}.exe` : name);

module.exports = {
  APP_DIR,
  BIN_DIR,
  DATA_DIR,
  exe,
  d: (...p) => path.join(DATA_DIR, ...p),
  PORTS: { wizard: 3000, keyserver: 4430, telemetry: 4443, proxy: 4444, dashboardLocal: 8090, dashboardPublic: 8091, mqtt: 1883 },
};
