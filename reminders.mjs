// Runs every hour. Sends each reader a reminder at their chosen hour (in their own time zone)
// if they haven't read yet today, plus a 9 PM nudge if a streak is about to lapse.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

export const config = { schedule: '@hourly' };

const DAILY = [
  'Today’s chapter is ready. A few quiet minutes is all it takes.',
  'Your tree could use some water. Today’s reading is waiting.',
  'One chapter, one line of reflection. That’s the whole ask today.',
  'Read it slowly today. What stays with you matters more than the streak.',
  'Before you mark today as read, ask yourself what the chapter actually said.',
  'Your group is reading today too. Join them.',
  'A chapter now, and the rest of the day is yours.',
];
const EVENING = [
  'Your {n}-day streak ends at midnight. There’s still time for a chapter.',
  'Still open: today’s reading. Keep your {n}-day streak going.',
  '{n} days in a row so far. One chapter keeps it that way.',
];
const BAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

function adminApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

function localNow(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
function yesterdayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// Works out whether one reader is due a reminder, and sends it. Returns how many devices got it.
async function remind(snap, fcm, site) {
  const u = snap.data();
  const tokens = u.pushTokens || [];
  if (!tokens.length) return 0;

  let now;
  try { now = localNow(u.tz || 'UTC'); } catch { now = localNow('UTC'); }
  const hour = u.reminderHour ?? 8;
  const daily = now.hour === hour;
  const evening = now.hour === 21 && hour !== 21 && (u.streak || 0) > 0 && u.lastDate === yesterdayOf(now.date);
  if (!daily && !evening) return 0;

  const day = await snap.ref.collection('days').doc(now.date).get();
  if (day.exists && (day.data().chapters || []).length) return 0;

  const seed = Number(now.date.replace(/-/g, ''));
  const body = daily ? DAILY[seed % DAILY.length] : EVENING[seed % EVENING.length].replace('{n}', u.streak);

  const res = await fcm.sendEachForMulticast({
    tokens,
    webpush: {
      notification: { title: 'Undertone', body, icon: '/icons/icon-192.png', tag: 'undertone-daily' },
      ...(site ? { fcmOptions: { link: site } } : {}),
    },
  });

  const bad = res.responses.map((r, i) => (!r.success && BAD_TOKEN.has(r.error?.code) ? tokens[i] : null)).filter(Boolean);
  if (bad.length) await snap.ref.update({ pushTokens: FieldValue.arrayRemove(...bad) });
  return res.successCount;
}

const CONCURRENCY = 20;

export default async () => {
  const app = adminApp();
  const db = getFirestore(app);
  const fcm = getMessaging(app);
  const site = process.env.URL || '';
  const users = await db.collection('users').where('reminderOn', '==', true).get();
  let sent = 0;
  let failed = 0;

  // A few readers at a time, so the run stays well inside Netlify's time limit as the group grows,
  // and one reader's error never stops the others from getting their reminder.
  for (let i = 0; i < users.docs.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(users.docs.slice(i, i + CONCURRENCY).map((snap) => remind(snap, fcm, site)));
    for (const r of results) {
      if (r.status === 'fulfilled') sent += r.value;
      else { failed++; console.error(r.reason); }
    }
  }

  return new Response(JSON.stringify({ checked: users.size, sent, failed }), { headers: { 'content-type': 'application/json' } });
};
