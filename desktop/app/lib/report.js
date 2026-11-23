'use strict';
// 월간 리포트: 주행 요약 목록(index.json)으로 한 달 통계를 계산
const KST = 9 * 3600 * 1000;
const kst = (ms) => new Date(ms + KST);
const WD = ['일', '월', '화', '수', '목', '금', '토'];

function monthKey(ms) {
  const d = kst(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 지금(ms) 기준 지난달 키
function previousMonthKey(now = Date.now()) {
  const d = kst(now);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

function summarize(trips, key) {
  const list = trips.filter((t) => monthKey(t.start) === key);
  const sum = (f) => list.reduce((a, t) => a + (Number(t[f]) > 0 ? Number(t[f]) : 0), 0);
  const km = Math.round(sum('distanceKm') * 10) / 10;
  const minutes = Math.round(sum('durationMin'));
  const withEnergy = list.filter((t) => t.energyUsedKwh != null && t.distanceKm > 0);
  const eKwh = withEnergy.reduce((a, t) => a + t.energyUsedKwh, 0);
  const eKm = withEnergy.reduce((a, t) => a + t.distanceKm, 0);
  const byDay = {};
  for (const t of list) {
    const d = kst(t.start);
    const k = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[d.getUTCDay()]})`;
    byDay[k] = (byDay[k] || 0) + (t.distanceKm || 0);
  }
  const topDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
  const longest = [...list].sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))[0] || null;
  return {
    key,
    trips: list.length,
    km,
    minutes,
    batteryPct: Math.round(sum('batteryUsed')),
    energyKwh: Math.round(eKwh * 10) / 10,
    whPerKm: eKm >= 1 ? Math.round((eKwh * 1000) / eKm) : null,
    avgKmPerTrip: list.length ? Math.round((km / list.length) * 10) / 10 : 0,
    topDay: topDay ? { label: topDay[0], km: Math.round(topDay[1] * 10) / 10 } : null,
    longest: longest ? { id: longest.id, km: longest.distanceKm, start: longest.start } : null,
  };
}

function reportText(r, prev) {
  const [y, m] = r.key.split('-').map(Number);
  const dur = r.minutes >= 60 ? `${Math.floor(r.minutes / 60)}시간 ${r.minutes % 60}분` : `${r.minutes}분`;
  const lines = [`${y}년 ${m}월: ${r.trips}번 주행 · ${r.km}km · ${dur}`];
  if (r.energyKwh > 0) lines.push(`에너지 ${r.energyKwh}kWh${r.whPerKm ? ` · 평균 전비 ${r.whPerKm}Wh/km` : ''}`);
  else if (r.batteryPct > 0) lines.push(`배터리 사용 ${r.batteryPct}%`);
  if (r.topDay) lines.push(`가장 많이 달린 날: ${r.topDay.label} ${r.topDay.km}km`);
  if (prev && prev.km > 0) {
    const diff = Math.round(((r.km - prev.km) / prev.km) * 100);
    lines.push(`지난달보다 거리 ${diff >= 0 ? `${diff}% 증가` : `${-diff}% 감소`}`);
  }
  return lines.join('\n');
}

module.exports = { monthKey, previousMonthKey, summarize, reportText };
