'use strict';
// 주행 기록 백업: data/trips → 백업 폴더/trips (바뀐 파일만 복사). 키/토큰은 백업하지 않음.
// 기본 위치: OneDrive\DriveLog 백업 (OneDrive가 있으면 클라우드에도 올라감) → 없으면 문서\DriveLog 백업
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store');

function defaultDir() {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const custom = store.readJson('settings.json').backupDir;
  if (custom) return custom;
  const home = os.homedir();
  const one = process.env.OneDrive || path.join(home, 'OneDrive');
  if (fs.existsSync(one)) return path.join(one, 'DriveLog 백업');
  return path.join(home, 'Documents', 'DriveLog 백업');
}

function backupTrips(target = defaultDir()) {
  const src = store.p('trips');
  if (!fs.existsSync(src)) return { copied: 0, skipped: true };
  const dst = path.join(target, 'trips');
  fs.mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(src)) {
    if (!name.endsWith('.json') || name === 'current.json') continue;
    const a = path.join(src, name);
    const b = path.join(dst, name);
    const sa = fs.statSync(a);
    let same = false;
    try {
      const sb = fs.statSync(b);
      same = sb.size === sa.size && sb.mtimeMs >= sa.mtimeMs;
    } catch {}
    if (!same) {
      fs.copyFileSync(a, b);
      copied++;
    }
  }
  const readme = path.join(target, '읽어주세요.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      'DriveLog 주행 기록 백업이에요.\r\n' +
        '복원하려면 DriveLog를 종료하고 trips 폴더 안의 파일을 %LOCALAPPDATA%\\DriveLog\\data\\trips 로 복사한 뒤 다시 실행하세요.\r\n' +
        '(키와 로그인 정보는 보안을 위해 백업하지 않아요)\r\n'
    );
  }
  fs.writeFileSync(path.join(target, 'last-backup.txt'), new Date().toISOString());
  return { copied, target };
}

module.exports = { backupTrips, defaultDir };
