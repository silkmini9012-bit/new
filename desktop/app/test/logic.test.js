'use strict';
const assert = require('assert');
const { DriveTracker, normalizeGear, normalizeLocation, formatDuration, kakaoMapUrl, distanceKm } = require('../lib/logic');

// normalizeGear
assert.strictEqual(normalizeGear('"ShiftStateD"'), 'D');
assert.strictEqual(normalizeGear(Buffer.from('"ShiftStateP"')), 'P');
assert.strictEqual(normalizeGear('R'), 'R');
assert.strictEqual(normalizeGear('{"shiftStateValue":"ShiftStateN"}'), 'N');
assert.strictEqual(normalizeGear('"ShiftStateSNA"'), null);
assert.strictEqual(normalizeGear('"ShiftStateInvalid"'), null);
assert.strictEqual(normalizeGear('null'), null);
// normalizeLocation
assert.deepStrictEqual(normalizeLocation('{"latitude":37.6,"longitude":127.2}'), { lat: 37.6, lng: 127.2 });
assert.deepStrictEqual(normalizeLocation('{"Latitude":37.6,"Longitude":127.2}'), { lat: 37.6, lng: 127.2 });
assert.deepStrictEqual(normalizeLocation('"37.6,127.2"'), { lat: 37.6, lng: 127.2 });
assert.strictEqual(normalizeLocation('{"latitude":0,"longitude":0}'), null);

// fake timers
function harness(initial) {
  let t = 0; const timers = new Map(); let id = 0;
  const events = [];
  const tr = new DriveTracker({
    parkConfirmMs: 60000, initial, now: () => t,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimer: (i) => timers.delete(i),
    onDepart: (e) => events.push(['depart', e]),
    onPark: (e) => events.push(['park', e]),
  });
  const advance = (ms) => { t += ms; for (const [i, tm] of [...timers]) if (tm.at <= t) { timers.delete(i); tm.fn(); } };
  return { tr, events, advance };
}

// 1) unknown start, first P → parked, no events; then D → depart; then P + 60s → park
{
  const { tr, events, advance } = harness();
  tr.handleGear('"ShiftStateP"');
  assert.strictEqual(tr.phase, 'parked'); assert.strictEqual(events.length, 0);
  tr.handleLocation('{"latitude":37.6,"longitude":127.2}');
  tr.handleGear('"ShiftStateR"');
  assert.strictEqual(events.length, 1); assert.strictEqual(events[0][0], 'depart');
  tr.handleGear('"ShiftStateD"'); // R→D: no new event
  assert.strictEqual(events.length, 1);
  advance(20 * 60000);
  tr.handleLocation('{"latitude":37.7,"longitude":127.3}');
  tr.handleGear('"ShiftStateP"');
  assert.strictEqual(events.length, 1); // not yet
  advance(59000); assert.strictEqual(events.length, 1);
  advance(1000);
  assert.strictEqual(events.length, 2); assert.strictEqual(events[1][0], 'park');
  assert.deepStrictEqual(events[1][1].location, { lat: 37.7, lng: 127.3 });
  assert.strictEqual(formatDuration(events[1][1].durationMs), '20분');
  assert.strictEqual(tr.phase, 'parked');
}
// 2) re-park maneuver: D→P→R within 60s → no park event, no 2nd depart
{
  const { tr, events, advance } = harness({ phase: 'parked' });
  tr.handleGear('D'); assert.strictEqual(events.length, 1);
  tr.handleGear('P'); advance(10000);
  tr.handleGear('R'); advance(10000);
  tr.handleGear('P'); advance(60000);
  assert.deepStrictEqual(events.map((e) => e[0]), ['depart', 'park']);
}
// 3) unknown start while driving → no depart; later park → park event
{
  const { tr, events, advance } = harness();
  tr.handleGear('D'); assert.strictEqual(events.length, 0); assert.strictEqual(tr.phase, 'driving');
  tr.handleGear('P'); advance(60000);
  assert.deepStrictEqual(events.map((e) => e[0]), ['park']);
}
// 4) SNA ignored, repeated P ignored
{
  const { tr, events, advance } = harness({ phase: 'parked' });
  tr.handleGear('"ShiftStateSNA"'); tr.handleGear('P'); tr.handleGear('P'); advance(120000);
  assert.strictEqual(events.length, 0);
}
// 5) persisted driving state + P after restart → park
{
  const { tr, events, advance } = harness({ phase: 'driving', departedAt: 0 });
  tr.handleGear('P'); advance(60000);
  assert.deepStrictEqual(events.map((e) => e[0]), ['park']);
}
assert.ok(kakaoMapUrl({ lat: 1, lng: 2 }).startsWith('https://map.kakao.com/link/map/'));
assert.ok(Math.abs(distanceKm({ lat: 37.5665, lng: 126.978 }, { lat: 37.6360, lng: 127.2165 }) - 22.3) < 1.5);
console.log('logic tests passed');
