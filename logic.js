// Pure game logic: dates, streaks, dewdrops, levels, plans.
// No Firebase or DOM here, so it can be tested with `npm test`.
import { BOOKS, TOTAL, chapterKey, yearPlanDay } from './bible.js';

/* ---------- Dates (YYYY-MM-DD keys in the reader's own time zone) ---------- */
export function toUTC(key) { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); }
export function addDays(key, n) { return new Date(toUTC(key) + n * 864e5).toISOString().slice(0, 10); }
export function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 864e5); }
export function weekKey(key) { const dow = new Date(toUTC(key)).getUTCDay(); return addDays(key, -((dow + 6) % 7)); }

/* ---------- Rules ---------- */
export const XP_PER_CHAPTER = 15;       // includes the reflection
export const XP_FIRST_OF_DAY = 5;
export const MILESTONE_BONUS = { 7: 50, 30: 100, 100: 200, 365: 500 };
export const MAX_DEWDROPS = 5;          // most dewdrops a reader can hold
export const DEWDROP_EVERY = 7;         // one earned at every multiple of this streak length
export const REPAIR_WINDOW = 7;         // a broken streak can be restored for this many days after the reader starts again

export function levelInfo(xp) {
  let lvl = 1;
  while (xp >= 25 * lvl * (lvl + 1)) lvl++;
  const base = 25 * (lvl - 1) * lvl;
  const next = 25 * lvl * (lvl + 1);
  return { lvl, into: xp - base, span: next - base };
}

/* ---------- Streaks ----------
   `has(key)` says whether a day counts: it has a reading, or a dewdrop restored it.
   The streak runs back from today, or from yesterday if today isn't read yet. */
export function streakFrom(has, today) {
  let d = has(today) ? today : addDays(today, -1);
  let n = 0;
  while (has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export const earnsDewdrop = (streak) => streak > 0 && streak % DEWDROP_EVERY === 0;

/* The most recent break in the streak, if it can still be restored.
   Returns { missing: [keys oldest first], cost, before, after } or null.
   `before` is the streak that broke; `after` is the streak once restored. */
export function repairOffer(has, today, maxGap = MAX_DEWDROPS) {
  const start = has(today) ? today : addDays(today, -1);
  let d = start;
  let current = 0;
  while (has(d)) { current++; d = addDays(d, -1); }
  if (current > REPAIR_WINDOW) return null;
  const missing = [];
  while (!has(d)) {
    missing.push(d);
    if (missing.length > maxGap) return null;
    d = addDays(d, -1);
  }
  if (!missing.length) return null;
  const before = streakFrom(has, d);
  return { missing: missing.reverse(), cost: missing.length, before, after: before + missing.length + current };
}

/* Oldest day the streak and repair checks look at. If the loaded days stop
   before this, more need to be loaded to get the streak right. */
export function oldestNeeded(has, today, maxGap = MAX_DEWDROPS) {
  let d = has(today) ? today : addDays(today, -1);
  while (has(d)) d = addDays(d, -1);
  for (let i = 0; i < maxGap && !has(d); i++) d = addDays(d, -1);
  while (has(d)) d = addDays(d, -1);
  return d;
}

/* ---------- Bible in a year ---------- */
export const yearDay = (planStart, today) => diffDays(planStart, today);

// Chapters from earlier plan days that haven't been read since the plan started.
export function catchUp(planStart, today, read) {
  const days = Math.min(yearDay(planStart, today), 365);
  const out = [];
  for (let i = 0; i < days; i++) {
    for (const ch of yearPlanDay(i)) {
      const when = read[chapterKey(ch.b, ch.c)];
      if (!when || when < planStart) out.push(ch);
    }
  }
  return out;
}

/* ---------- Checking data from other readers ---------- */
export const validChapter = (b, c) => Number.isInteger(b) && b >= 0 && b < BOOKS.length && Number.isInteger(c) && c >= 1 && c <= BOOKS[b].chapters;
export const safeInt = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0);

export { TOTAL };
