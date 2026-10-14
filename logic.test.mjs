import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, diffDays, weekKey, streakFrom, repairOffer, oldestNeeded, earnsDewdrop, catchUp, levelInfo, validChapter, safeInt,
  MAX_DEWDROPS, REPAIR_WINDOW,
} from '../public/logic.js';
import { TOTAL, yearPlanDay, chapterKey } from '../public/bible.js';

const TODAY = '2026-03-10';
// Builds a has() from day offsets relative to TODAY (0 = today, 1 = yesterday...).
const daysAgo = (...offsets) => { const set = new Set(offsets.map((n) => addDays(TODAY, -n))); return (k) => set.has(k); };
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('dates cross month, year and leap-day boundaries', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(diffDays('2026-03-01', '2026-03-10'), 9);
  assert.equal(weekKey('2026-03-15'), '2026-03-09'); // Sunday belongs to the week starting Monday
  assert.equal(weekKey('2026-03-09'), '2026-03-09');
});

test('streak counts from today, or from yesterday while today is still open', () => {
  assert.equal(streakFrom(daysAgo(0, 1, 2), TODAY), 3);
  assert.equal(streakFrom(daysAgo(1, 2), TODAY), 2);
  assert.equal(streakFrom(daysAgo(2, 3), TODAY), 0);
  assert.equal(streakFrom(daysAgo(), TODAY), 0);
});

test('long streaks are not capped', () => {
  assert.equal(streakFrom(daysAgo(...range(0, 999)), TODAY), 1000);
});

test('no repair offer when nothing is broken', () => {
  assert.equal(repairOffer(daysAgo(0, 1, 2), TODAY), null);
  assert.equal(repairOffer(daysAgo(1, 2), TODAY), null); // today still open
  assert.equal(repairOffer(daysAgo(), TODAY), null);     // brand new reader
});

test('repair offer after missing yesterday, before reading today', () => {
  const o = repairOffer(daysAgo(...range(2, 11)), TODAY); // 10-day streak, missed yesterday
  assert.deepEqual(o.missing, [addDays(TODAY, -1)]);
  assert.equal(o.cost, 1);
  assert.equal(o.before, 10);
  assert.equal(o.after, 11);
});

test('repair offer still stands after reading again today', () => {
  const o = repairOffer(daysAgo(0, ...range(3, 7)), TODAY); // read today, missed 2 days, 5-day streak before
  assert.deepEqual(o.missing, [addDays(TODAY, -2), addDays(TODAY, -1)]);
  assert.equal(o.cost, 2);
  assert.equal(o.before, 5);
  assert.equal(o.after, 8);
});

test('repair offer ends once the new streak is longer than the window', () => {
  const restarted = range(0, REPAIR_WINDOW - 1);
  assert.ok(repairOffer(daysAgo(...restarted, ...range(REPAIR_WINDOW + 1, REPAIR_WINDOW + 5)), TODAY));
  const longer = range(0, REPAIR_WINDOW);
  assert.equal(repairOffer(daysAgo(...longer, ...range(REPAIR_WINDOW + 2, REPAIR_WINDOW + 6)), TODAY), null);
});

test('gaps longer than the most anyone can hold are not offered', () => {
  const gap = MAX_DEWDROPS + 1;
  assert.equal(repairOffer(daysAgo(...range(gap + 1, gap + 10)), TODAY), null);
  assert.ok(repairOffer(daysAgo(...range(MAX_DEWDROPS + 1, MAX_DEWDROPS + 10)), TODAY));
});

test('restoring fills exactly the missed days and joins the two streaks', () => {
  const set = new Set([0, ...range(3, 7)].map((n) => addDays(TODAY, -n)));
  const has = (k) => set.has(k);
  const o = repairOffer(has, TODAY);
  o.missing.forEach((k) => set.add(k));
  assert.equal(streakFrom(has, TODAY), o.after);
});

test('oldestNeeded reaches past the streak and a restorable gap', () => {
  // streak of 3 ending yesterday, gap of 2, older run of 4
  const has = daysAgo(1, 2, 3, 6, 7, 8, 9);
  assert.equal(oldestNeeded(has, TODAY), addDays(TODAY, -10));
});

test('a dewdrop is earned at every 7-day multiple, including on a new streak', () => {
  assert.equal(earnsDewdrop(7), true);
  assert.equal(earnsDewdrop(14), true);
  assert.equal(earnsDewdrop(8), false);
  assert.equal(earnsDewdrop(0), false);
});

test('levels', () => {
  assert.equal(levelInfo(0).lvl, 1);
  assert.equal(levelInfo(49).lvl, 1);
  assert.equal(levelInfo(50).lvl, 2);
  assert.equal(levelInfo(150).lvl, 3);
});

test('year plan covers every chapter once', () => {
  const all = [];
  for (let d = 0; d < 365; d++) all.push(...yearPlanDay(d));
  assert.equal(all.length, TOTAL);
  assert.equal(new Set(all.map((x) => chapterKey(x.b, x.c))).size, TOTAL);
});

test('catch-up lists unread chapters from earlier plan days only', () => {
  const start = '2026-03-01';
  const today = '2026-03-04'; // day 4: days 1-3 are behind
  const expected = [0, 1, 2].flatMap((d) => yearPlanDay(d));
  assert.deepEqual(catchUp(start, today, {}), expected);

  const read = {};
  yearPlanDay(0).forEach((x) => { read[chapterKey(x.b, x.c)] = '2026-03-01'; });
  const before = yearPlanDay(1)[0];
  read[chapterKey(before.b, before.c)] = '2025-06-01'; // read before this plan started: still owed
  const out = catchUp(start, today, read);
  assert.equal(out.length, expected.length - yearPlanDay(0).length);
  assert.ok(out.some((x) => x.b === before.b && x.c === before.c));
  assert.deepEqual(catchUp(start, start, {}), []);
});

test('data from other readers is checked before use', () => {
  assert.equal(validChapter(0, 1), true);
  assert.equal(validChapter(18, 150), true);
  assert.equal(validChapter(18, 151), false);
  assert.equal(validChapter(66, 1), false);
  assert.equal(validChapter('0', 1), false);
  assert.equal(validChapter(0, '"><img src=x>'), false);
  assert.equal(safeInt('<img src=x onerror=alert(1)>'), 0);
  assert.equal(safeInt(12.7), 12);
  assert.equal(safeInt(-3), 0);
});
