'use strict';
// 텔레메트리 메시지 → 출발/주차 판단 → 알림 + 주행 기록
const store = require('../lib/store');
const { notify } = require('../lib/notify');
const { reverseGeocode } = require('../lib/kakao');
const { DriveTracker, distanceKm, formatDuration, kakaoMapUrl, parseJsonish, normalizeLocation } = require('../lib/logic');
const { TripRecorder } = require('../lib/trips');

const STATE_FILE = 'state.json';
const trackers = new Map();
const recorders = new Map();
let savedState = null;

const cfg = () => ({ ...store.settings(), carName: store.readJson('settings.json').carName || '내 테슬라' });
const timeStr = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });

function dashboardUrl(id) {
  const s = store.readJson('settings.json');
  const st = store.readJson('tailscale-status.json');
  const host = st.CertDomains?.[0];
  if (!host || !s.dashToken) return null;
  return `https://${host}:10000/?k=${s.dashToken}${id ? `#trip=${id}` : ''}`;
}

function recorderFor(vin) {
  if (!recorders.has(vin)) recorders.set(vin, new TripRecorder());
  return recorders.get(vin);
}

function trackerFor(vin) {
  if (trackers.has(vin)) return trackers.get(vin);
  savedState ??= store.readJson(STATE_FILE);
  const t = new DriveTracker({
    parkConfirmMs: Math.max(0, Number(store.readJson('settings.json').parkConfirmSeconds || process.env.PARK_CONFIRM_SECONDS || 60)) * 1000,
    initial: savedState[vin],
    onState: (s) => {
      savedState[vin] = s;
      store.writeJson(STATE_FILE, savedState);
    },
    onDepart: async (e) => {
      console.log(`[${vin}] 출발 (기어 ${e.gear})`);
      try {
        recorderFor(vin).start(e.at);
      } catch (err) {
        console.error('주행 기록 시작 실패', err);
      }
      const c = cfg();
      const where = (await reverseGeocode(c, e.location)) || '';
      await notify(c, `🚗 ${c.carName} 출발`, `${timeStr(e.at)} 출발했어요${where ? `\n출발지: ${where}` : ''}`, kakaoMapUrl(e.location, '출발 위치'));
    },
    onPark: async (e) => {
      console.log(`[${vin}] 주차`, e.location || '(위치 없음)');
      const c = cfg();
      const where = (await reverseGeocode(c, e.location)) || '';
      const lines = [`${timeStr(e.at)} 주차했어요`];
      if (where) lines.push(`위치: ${where}`);
      let trip = null;
      try {
        trip = recorderFor(vin).finish(e.at);
      } catch (err) {
        console.error('주행 기록 저장 실패', err);
      }
      if (trip) {
        const bat = trip.batteryUsed != null ? ` · 배터리 ${trip.batteryUsed}%` : '';
        lines.push(`이번 주행: ${trip.distanceKm}km · ${formatDuration(trip.durationMin * 60000)}${bat}`);
      } else {
        const dur = formatDuration(e.durationMs);
        const dist = distanceKm(e.departLocation, e.location);
        if (dur) lines.push(`주행 시간: ${dur}${dist != null ? ` · 직선거리 ${dist.toFixed(1)}km` : ''}`);
      }
      const dash = trip && dashboardUrl(trip.id);
      await notify(c, `🅿️ ${c.carName} 주차`, lines.join('\n'), kakaoMapUrl(e.location, '주차 위치'), dash ? [{ label: '주행 기록', url: dash }] : []);
    },
  });
  trackers.set(vin, t);
  return t;
}

// topic: tesla/<VIN>/v/<Field> | tesla/<VIN>/connectivity
function handle(topic, payload) {
  const parts = topic.split('/');
  if (parts[0] !== 'tesla' || !parts[1]) return;
  const vin = parts[1];
  const s = store.readJson('settings.json');
  if (s.vin && vin !== s.vin) return;
  if (parts[2] === 'connectivity') {
    const c = parseJsonish(payload);
    console.log(`[${vin}] 연결 상태: ${c?.Status || c?.status || JSON.stringify(c)}`);
    return;
  }
  if (parts[2] !== 'v') return;
  const field = parts[3];
  const t = trackerFor(vin);
  const rec = recorderFor(vin);
  if (field === 'Location') {
    t.handleLocation(payload);
    rec.location(normalizeLocation(payload));
  } else if (field === 'VehicleSpeed') rec.speed(payload);
  else if (field === 'Odometer') rec.odometer(payload);
  else if (field === 'BatteryLevel') rec.battery(payload);
  else if (field === 'Gear') {
    console.log(`[${vin}] Gear = ${payload.toString()}`);
    t.handleGear(payload);
  }
}

// 텔레메트리 설정 만료 2주 전부터 하루 한 번 알림
let lastExpWarn = 0;
async function checkExpiry() {
  const exp = store.readJson('settings.json').telemetryExp;
  if (!exp) return;
  const daysLeft = Math.floor((exp * 1000 - Date.now()) / 86400000);
  if (daysLeft <= 14 && Date.now() - lastExpWarn > 23 * 3600 * 1000) {
    lastExpWarn = Date.now();
    await notify(cfg(), '⚠️ DriveLog 설정 갱신 필요', `차량 스트리밍 설정이 ${Math.max(daysLeft, 0)}일 뒤 만료돼요. PC의 DriveLog 설정 화면에서 [차량 설정 다시 보내기]를 눌러 주세요.`);
  }
}
setInterval(() => checkExpiry().catch(() => {}), 3600 * 1000).unref();

module.exports = { handle, dashboardUrl };
