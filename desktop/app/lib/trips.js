'use strict';
// 주행 기록: 출발~주차 사이의 경로, 거리, 시간, 속도, 배터리를 저장
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { parseJsonish, distanceKm } = require('./logic');

const MI = 1.609344;
const DIR = () => store.p('trips');

function num(raw) {
  let v = parseJsonish(raw);
  if (v && typeof v === 'object') v = Object.values(v).find((x) => typeof x === 'number' || typeof x === 'string');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tripId(ms) {
  const d = new Date(ms + 9 * 3600 * 1000); // KST
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function pathKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const a = { lat: points[i - 1][1], lng: points[i - 1][2] };
    const b = { lat: points[i][1], lng: points[i][2] };
    const d = distanceKm(a, b);
    if (d < 5) km += d; // GPS 튐 방지
  }
  return km;
}

class TripRecorder {
  constructor({ now = Date.now, dir = DIR } = {}) {
    this.now = now;
    this.dir = dir;
    this.latest = { odometerKm: null, battery: null, speedKmh: null, location: null };
    this.current = this._load('current.json');
    this._lastSave = 0;
  }

  _file(name) {
    return path.join(this.dir(), name);
  }
  _load(name) {
    try {
      return JSON.parse(fs.readFileSync(this._file(name), 'utf8'));
    } catch {
      return null;
    }
  }
  _write(name, data) {
    fs.mkdirSync(this.dir(), { recursive: true });
    const f = this._file(name);
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);
  }
  _saveCurrent(force = false) {
    if (!this.current) return;
    const t = this.now();
    if (force || t - this._lastSave > 8000) {
      this._lastSave = t;
      // 실시간 보기용 최신 값도 같이 저장 (PC 안에서만 쓰임, 테슬라 비용과 무관)
      this._write('current.json', { ...this.current, live: { ...this.latest, updatedAt: t } });
    }
  }

  // 텔레메트리 값 업데이트
  odometer(raw) {
    const mi = num(raw);
    if (mi != null && mi > 0) this.latest.odometerKm = mi * MI;
  }
  battery(raw) {
    const b = num(raw);
    if (b != null && b >= 0 && b <= 100) this.latest.battery = b;
  }
  speed(raw) {
    const mph = num(raw);
    if (mph == null || mph < 0) return;
    this.latest.speedKmh = mph * MI;
    if (this.current) {
      this.current.maxSpeedKmh = Math.max(this.current.maxSpeedKmh || 0, this.latest.speedKmh);
      this._saveCurrent();
    }
  }
  location(loc) {
    if (!loc) return;
    this.latest.location = loc;
    if (!this.current) return;
    const pts = this.current.points;
    const last = pts[pts.length - 1];
    if (last && last[1] === loc.lat && last[2] === loc.lng) return;
    const sp = this.latest.speedKmh;
    pts.push([this.now(), loc.lat, loc.lng, sp == null ? null : Math.round(sp)]);
    this._saveCurrent();
  }

  start(at = this.now()) {
    if (this.current) this.finish(this.current.points.at(-1)?.[0] || at); // 이전 기록이 남아 있으면 마무리
    const l = this.latest;
    this.current = {
      id: tripId(at),
      start: at,
      startLoc: l.location,
      startOdoKm: l.odometerKm,
      startBattery: l.battery,
      maxSpeedKmh: 0,
      points: l.location ? [[at, l.location.lat, l.location.lng, 0]] : [],
    };
    this._saveCurrent(true);
    return this.current;
  }

  // 주차 확정 시 호출 → 요약 반환
  finish(at = this.now()) {
    const t = this.current;
    if (!t) return null;
    const l = this.latest;
    t.end = at;
    const lp = t.points[t.points.length - 1];
    t.endLoc = l.location || (lp ? { lat: lp[1], lng: lp[2] } : null);
    t.endOdoKm = l.odometerKm;
    t.endBattery = l.battery;
    const odoKm = t.startOdoKm != null && t.endOdoKm != null ? t.endOdoKm - t.startOdoKm : null;
    t.distanceKm = Math.round(((odoKm != null && odoKm >= 0 && odoKm < 2000 ? odoKm : pathKm(t.points)) || 0) * 10) / 10;
    // 실제 주행 시간 = 마지막 위치 기록까지 (주차 확정 대기 시간 제외)
    const lastMove = t.points.length ? t.points[t.points.length - 1][0] : at;
    t.durationMin = Math.max(1, Math.round((Math.min(at, Math.max(lastMove, t.start + 60000)) - t.start) / 60000));
    t.avgSpeedKmh = t.durationMin ? Math.round((t.distanceKm / t.durationMin) * 60) : 0;
    t.maxSpeedKmh = Math.round(t.maxSpeedKmh || 0);
    t.batteryUsed = t.startBattery != null && t.endBattery != null ? Math.round((t.startBattery - t.endBattery) * 10) / 10 : null;

    const summary = {
      id: t.id,
      start: t.start,
      end: t.end,
      startLoc: t.startLoc,
      endLoc: t.endLoc,
      distanceKm: t.distanceKm,
      durationMin: t.durationMin,
      avgSpeedKmh: t.avgSpeedKmh,
      maxSpeedKmh: t.maxSpeedKmh,
      startBattery: t.startBattery,
      endBattery: t.endBattery,
      batteryUsed: t.batteryUsed,
    };
    this._write(`${t.id}.json`, t);
    const index = this._load('index.json') || [];
    index.unshift(summary);
    this._write('index.json', index);
    try {
      fs.rmSync(this._file('current.json'), { force: true });
    } catch {}
    this.current = null;
    return summary;
  }
}

module.exports = { TripRecorder, tripId, pathKm, num };
