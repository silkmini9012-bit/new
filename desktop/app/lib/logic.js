'use strict';
// 기어 변화로 "출발" / "주차"를 판단하는 상태 기계 (외부 의존성 없음 → 테스트 가능)

function parseJsonish(raw) {
  if (raw == null) return null;
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw !== 'string') return raw;
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// "ShiftStateD", "D", {"shiftStateValue":"ShiftStateD"} 등 → 'P' | 'R' | 'N' | 'D' | null
function normalizeGear(raw) {
  let v = parseJsonish(raw);
  if (v && typeof v === 'object') {
    const first = Object.values(v).find((x) => typeof x === 'string');
    v = first ?? null;
  }
  if (typeof v !== 'string') return null;
  const s = v.replace(/^"+|"+$/g, '').replace(/^shift_?state/i, '').trim().toUpperCase();
  return ['P', 'R', 'N', 'D'].includes(s) ? s : null; // Invalid / SNA / 빈 값은 무시
}

// {"latitude":..,"longitude":..} / {"Latitude":..} / "37.1,127.1" → {lat, lng} | null
function normalizeLocation(raw) {
  const v = parseJsonish(raw);
  let lat;
  let lng;
  if (v && typeof v === 'object') {
    const lower = {};
    for (const [k, val] of Object.entries(v)) lower[k.toLowerCase()] = val;
    lat = Number(lower.latitude ?? lower.lat);
    lng = Number(lower.longitude ?? lower.lng ?? lower.lon);
  } else if (typeof v === 'string' && v.includes(',')) {
    [lat, lng] = v.split(',').map(Number);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

class DriveTracker {
  /**
   * @param {object} o
   * @param {number} o.parkConfirmMs  P로 바뀐 뒤 이 시간 동안 P가 유지되면 "주차"로 확정
   * @param {(e:object)=>void} o.onDepart
   * @param {(e:object)=>void} o.onPark
   * @param {(state:object)=>void} [o.onState]  상태 저장용
   * @param {object} [o.initial]  저장돼 있던 상태
   * @param {()=>number} [o.now]
   * @param {Function} [o.setTimer] / [o.clearTimer]  테스트용
   */
  constructor(o) {
    this.parkConfirmMs = o.parkConfirmMs;
    this.onDepart = o.onDepart;
    this.onPark = o.onPark;
    this.onState = o.onState || (() => {});
    this.now = o.now || Date.now;
    this.setTimer = o.setTimer || setTimeout;
    this.clearTimer = o.clearTimer || clearTimeout;
    const init = o.initial || {};
    this.phase = init.phase || 'unknown'; // 'parked' | 'driving' | 'unknown'
    this.gear = init.gear || null;
    this.location = init.location || null;
    this.departedAt = init.departedAt || null;
    this.departLocation = init.departLocation || null;
    this.pendingPark = null;
  }

  snapshot() {
    return {
      phase: this.phase,
      gear: this.gear,
      location: this.location,
      departedAt: this.departedAt,
      departLocation: this.departLocation,
    };
  }

  handleLocation(raw) {
    const loc = normalizeLocation(raw);
    if (!loc) return;
    this.location = loc;
    this.onState(this.snapshot());
  }

  handleGear(raw) {
    const g = normalizeGear(raw);
    if (!g) return;
    this.gear = g;

    if (g !== 'P') {
      if (this.pendingPark) {
        // P에 잠깐 넣었다가 다시 움직임(주차 자리 조정 등) → 알림 없이 계속 주행
        this.clearTimer(this.pendingPark);
        this.pendingPark = null;
      } else if (this.phase === 'parked') {
        this.phase = 'driving';
        this.departedAt = this.now();
        this.departLocation = this.location;
        this.onDepart({ gear: g, location: this.location, at: this.departedAt });
      } else if (this.phase === 'unknown') {
        this.phase = 'driving'; // 처음 실행 직후에는 알림 없이 상태만 맞춤
      }
    } else if (this.phase === 'driving' && !this.pendingPark) {
      this.pendingPark = this.setTimer(() => {
        this.pendingPark = null;
        this.phase = 'parked';
        const at = this.now();
        const event = {
          location: this.location,
          at,
          departedAt: this.departedAt,
          durationMs: this.departedAt != null ? at - this.departedAt - this.parkConfirmMs : null,
          departLocation: this.departLocation,
        };
        this.departedAt = null;
        this.departLocation = null;
        this.onState(this.snapshot());
        this.onPark(event);
      }, this.parkConfirmMs);
    } else if (this.phase === 'unknown') {
      this.phase = 'parked';
    }
    this.onState(this.snapshot());
  }
}

// 두 좌표 사이 거리(km)
function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

function kakaoMapUrl(loc, label = '주차 위치') {
  if (!loc) return null;
  return `https://map.kakao.com/link/map/${encodeURIComponent(label)},${loc.lat},${loc.lng}`;
}

module.exports = { DriveTracker, normalizeGear, normalizeLocation, parseJsonish, distanceKm, formatDuration, kakaoMapUrl };
