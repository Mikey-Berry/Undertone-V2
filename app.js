import { BOOKS, TOTAL, flatIndex, fromFlat, chapterKey, label, jwUrl, yearPlanDay } from './bible.js';
import { treeSVG, stageCaption } from './tree.js';
import {
  addDays, diffDays, weekKey, toUTC, levelInfo, streakFrom, earnsDewdrop, repairOffer, oldestNeeded, catchUp, yearDay,
  validChapter, safeInt, XP_PER_CHAPTER, XP_FIRST_OF_DAY, MILESTONE_BONUS, MAX_DEWDROPS, DEWDROP_EVERY,
} from './logic.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocFromServer, setDoc, updateDoc,
  collection, query, where, orderBy, limit, startAfter, getDocs, getDocsFromServer, writeBatch, increment, arrayUnion, arrayRemove,
  serverTimestamp, onSnapshot, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getMessaging, getToken, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';

const CFG = self.UNDERTONE_CONFIG || {};
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/* ---------- Dates (all keyed to the reader's own time zone) ---------- */
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const todayKey = () => dayFmt.format(new Date());
function fmtDate(key) { return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function hourLabel(h) { return new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }); }

/* ---------- Words ---------- */
// What the app calls the item that restores a broken streak: dew revives a dry tree.
// Stored in Firestore as `graceDays` (balance) and `grace: true` (on a restored day), so renaming it is copy-only.
const TERM = 'dewdrop';
const TERMS = 'dewdrops';
const DEWDROP_ABOUT = `You start with one ${TERM} and earn another every ${DEWDROP_EVERY} days in a row, up to ${MAX_DEWDROPS}. If you miss a day, you can spend ${TERMS} to restore your streak: one for each day missed.`;
const dropIcon = (on) => `<svg class="drop ${on ? 'on' : ''}" viewBox="0 0 12 16" aria-hidden="true"><path d="M6 1.5C6 1.5 1.5 7 1.5 10.2a4.5 4.5 0 0 0 9 0C10.5 7 6 1.5 6 1.5Z"/></svg>`;

// The short first-run tour. Shown once per account (users.introSeen); replayable from Settings.
const INTRO = [
  { title: 'Read, then reflect', text: 'Tap “Read on jw.org” to read the chapter there. Come back and write one line about what stood out. That marks it read.' },
  { title: 'Grow your tree', text: 'Read at least one chapter a day and your streak grows. The tree grows with it, and its leaves brighten once you’ve read today.' },
  { title: 'Dewdrops', text: DEWDROP_ABOUT, drops: true },
  { title: 'Read together', text: 'In the Group tab you can join friends with a code. You’ll see what each other read today and any reflections people share. It’s not a race.' },
];
const termCount = (n) => `${n} ${n === 1 ? TERM : TERMS}`;

const QUICK_READ_SECONDS = 90;
const DAYS_PAGE = 400;

/* ---------- Badges ---------- */
const BADGES = [
  { id: 'first', name: 'First chapter', desc: 'Read your first chapter.', test: (c) => c.readCount >= 1 },
  { id: 's7', name: 'A week rooted', desc: 'Reach a 7-day streak.', test: (c) => c.longest >= 7 },
  { id: 's30', name: 'Thirty days', desc: 'Reach a 30-day streak.', test: (c) => c.longest >= 30 },
  { id: 's100', name: 'Deep roots', desc: 'Reach a 100-day streak.', test: (c) => c.longest >= 100 },
  { id: 's365', name: 'Every season', desc: 'Reach a 365-day streak.', test: (c) => c.longest >= 365 },
  { id: 'c100', name: '100 chapters', desc: 'Read 100 different chapters.', test: (c) => c.readCount >= 100 },
  { id: 'book1', name: 'First book', desc: 'Finish every chapter of a book.', test: (c) => c.booksDone >= 1 },
  { id: 'book10', name: 'Ten books', desc: 'Finish ten books.', test: (c) => c.booksDone >= 10 },
  { id: 'psalms', name: 'All 150 Psalms', desc: 'Read every psalm.', test: (c) => c.bookDone[18] },
  { id: 'hebrew', name: 'Hebrew Scriptures', desc: 'Finish Genesis through Malachi.', test: (c) => c.bookDone.slice(0, 39).every(Boolean) },
  { id: 'greek', name: 'Christian Greek Scriptures', desc: 'Finish Matthew through Revelation.', test: (c) => c.bookDone.slice(39).every(Boolean) },
  { id: 'all', name: 'Cover to cover', desc: 'Read all 1,189 chapters.', test: (c) => c.readCount >= TOTAL },
];

const NUDGES = [
  'Try reading today’s chapter aloud, quietly. That’s the undertone of Psalm 1:2.',
  'If a verse stops you, stay with it for a minute. The streak will wait.',
  'Read to remember, not just to finish.',
  'Before you write your reflection, look back over the chapter once.',
  'Look for one thing today’s chapter shows about Jehovah.',
  'Short on time? One chapter read well beats three skimmed.',
  'Who in this chapter would you want to ask a question? What would you ask?',
];

/* ---------- State ---------- */
const S = {
  uid: null, email: null, profile: null, progress: { read: {} }, days: new Map(),
  group: null, members: [], feed: [], unsub: [],
  tab: 'today', sheet: null, custom: null, drafts: {}, opened: {},
  authMode: 'signin', authError: '', authBusy: false, loadError: '', justGrew: false, pendingName: '',
  loadedDay: null, stale: false, loading: null, restoring: false, pushToken: null,
};

let fbApp, auth, db;

/* ---------- Boot ---------- */
const configured = CFG.firebase && CFG.firebase.apiKey && !String(CFG.firebase.apiKey).startsWith('PASTE');
if (!configured) {
  $app.innerHTML = `<div class="auth"><div class="auth-card"><h1 class="wordmark">Undertone</h1>
    <p>Firebase isn’t connected yet. Paste your project’s settings into <code>config.js</code>, then reload. SETUP.md walks through it.</p></div></div>`;
} else {
  start();
}

function start() {
  fbApp = initializeApp(CFG.firebase);
  auth = getAuth(fbApp);
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  // For local testing only: config.js can point the app at the Firebase emulators.
  if (CFG.emulators) {
    connectAuthEmulator(auth, `http://${CFG.emulators.auth}`, { disableWarnings: true });
    const [host, port] = CFG.emulators.firestore.split(':');
    connectFirestoreEmulator(db, host, +port);
  }

  const join = new URLSearchParams(location.search).get('join');
  if (join) { sessionStorage.setItem('undertone-join', join.toUpperCase()); history.replaceState(null, '', '/'); }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => {});

  $app.addEventListener('click', onClick);
  $app.addEventListener('submit', onSubmit);
  $app.addEventListener('change', onChange);
  $app.addEventListener('input', (e) => { const k = e.target.dataset.draft; if (k) S.drafts[k] = e.target.value; });

  // An installed app can sit in the background for days. When it comes back on a new day,
  // or back online after starting offline, load everything again before showing anything.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !S.profile) return;
    if (S.loadedDay !== todayKey()) await reload();
    render();
  });
  window.addEventListener('online', async () => { if (S.profile && S.stale) { await reload(); render(); } });

  onAuthStateChanged(auth, async (user) => {
    S.unsub.forEach((u) => u()); S.unsub = [];
    if (user) {
      S.uid = user.uid; S.email = user.email;
      render();
      await loadAll(user);
    } else {
      Object.assign(S, { uid: null, email: null, profile: null, progress: { read: {} }, days: new Map(), group: null, members: [], feed: [], tab: 'today', sheet: null, custom: null, loadError: '', loadedDay: null, stale: false, pushToken: null });
    }
    render();
  });
}

/* ---------- Firestore refs ---------- */
const userRef = () => doc(db, 'users', S.uid);
const progressRef = () => doc(db, 'users', S.uid, 'meta', 'progress');
const dayRef = (k) => doc(db, 'users', S.uid, 'days', k);
const publicRef = () => doc(db, 'publicProfiles', S.uid);

/* ---------- Loading ---------- */
// A day counts toward the streak if it has a reading or a dewdrop restored it.
const countsIn = (days) => (key) => { const d = days.get(key); return !!d && ((d.chapters || []).length > 0 || d.grace === true); };
const counts = (key) => countsIn(S.days)(key);
const readOn = (key) => (S.days.get(key)?.chapters || []).length > 0;

// Loads reading days newest first, a page at a time, until the streak (and any break
// that could still be restored) is fully covered. Long streaks never get cut off.
async function loadDays(fromServer) {
  const get = fromServer ? getDocsFromServer : getDocs;
  const base = collection(db, 'users', S.uid, 'days');
  const map = new Map();
  let fromCache = false;
  let last = null;
  for (;;) {
    const q = last
      ? query(base, orderBy('date', 'desc'), startAfter(last), limit(DAYS_PAGE))
      : query(base, orderBy('date', 'desc'), limit(DAYS_PAGE));
    const snap = await get(q);
    fromCache = fromCache || snap.metadata.fromCache;
    snap.docs.forEach((d) => map.set(d.id, d.data()));
    if (snap.docs.length < DAYS_PAGE) break;
    last = snap.docs[snap.docs.length - 1];
    if (oldestNeeded(countsIn(map), todayKey()) > last.id) break;
  }
  return { map, fromCache };
}

function reload() {
  if (!S.loading) S.loading = loadAll(auth.currentUser).finally(() => { S.loading = null; });
  return S.loading;
}

// Make sure the data in memory is for today before recording anything.
async function ensureToday() {
  if (S.loading) await S.loading;
  if (S.loadedDay !== todayKey()) await reload();
}

async function loadAll(user) {
  if (!user) return;
  try {
    S.loadError = '';
    const today = todayKey();
    const snap = await getDoc(userRef());
    if (!snap.exists()) {
      // Offline on a device that has never synced this account: don't create a blank profile over the real one.
      if (snap.metadata.fromCache) throw new Error('offline before first sync');
      const name = user.displayName || S.pendingName || (user.email || 'Reader').split('@')[0];
      const prof = {
        name, email: user.email, createdAt: serverTimestamp(), xp: 0, streak: 0, longest: 0, lastDate: null,
        graceDays: 1, plan: 'order', cursor: 0, planStart: null, groupId: null,
        reminderOn: false, reminderHour: 8, tz: TZ, badges: [], weekKey: null, weekChapters: 0,
      };
      await setDoc(userRef(), prof, { merge: true });
      S.profile = prof;
    } else {
      S.profile = snap.data();
    }

    const ps = await getDoc(progressRef());
    S.progress = ps.exists() ? ps.data() : { read: {} };
    if (!S.progress.read) S.progress.read = {};

    const days = await loadDays(false);
    S.days = days.map;
    // Data from the phone's offline cache may be out of date (another device may have synced since).
    // Nothing that rewrites the streak is saved from it.
    S.stale = days.fromCache || snap.metadata.fromCache;
    S.loadedDay = today;

    if (S.profile.tz !== TZ) { S.profile.tz = TZ; updateDoc(userRef(), { tz: TZ }).catch(console.warn); }

    loadOpened();
    reconcileStreak();
    if (!S.stale) setDoc(publicRef(), publicSnapshot(), { merge: true }).catch(console.warn);

    const pendingJoin = sessionStorage.getItem('undertone-join');
    if (pendingJoin) {
      sessionStorage.removeItem('undertone-join');
      if (!S.profile.groupId) await joinGroup(pendingJoin);
      else if (pendingJoin !== S.profile.groupId) toast('You’re already in a group. Leave it in Settings first to join another.');
    }

    subscribeGroup();
    refreshPushToken();
    if (!S.profile.introSeen && !S.sheet) S.sheet = { type: 'intro', step: 0 };
  } catch (err) {
    console.error(err);
    S.loadError = 'Couldn’t load your progress. Check your connection and reload. Nothing has been lost.';
  }
}

// The saved `streak` field is only for display elsewhere and for reminders; the day records are the truth.
function reconcileStreak() {
  const s = streakFrom(counts, todayKey());
  if (s === S.profile.streak) return;
  S.profile.streak = s;
  if (S.stale) return;
  updateDoc(userRef(), { streak: s }).catch(console.warn);
  setDoc(publicRef(), { streak: s }, { merge: true }).catch(console.warn);
}

/* "Opened" chapters unlock the reflection box. Kept per day in this browser. */
function loadOpened() {
  try {
    const raw = JSON.parse(localStorage.getItem('undertone-opened') || '{}');
    S.opened = raw.date === todayKey() ? raw.map || {} : {};
  } catch { S.opened = {}; }
}
function saveOpened() {
  try { localStorage.setItem('undertone-opened', JSON.stringify({ date: todayKey(), map: S.opened })); } catch {}
}

/* ---------- Dewdrops: restoring a broken streak ---------- */
function currentOffer() {
  const offer = repairOffer(counts, todayKey());
  if (!offer) return null;
  return { ...offer, balance: S.profile.graceDays || 0 };
}

function offerDismissed(offer) {
  try { return localStorage.getItem('undertone-repair-later') === `${todayKey()}|${offer.missing[0]}`; } catch { return false; }
}
function dismissOffer() {
  const offer = currentOffer();
  if (!offer) return;
  try { localStorage.setItem('undertone-repair-later', `${todayKey()}|${offer.missing[0]}`); } catch {}
  render();
}

// Spends dewdrops to fill the missed days. Always checks the server first,
// so a phone with old data can't spend days or write over readings it hasn't seen.
async function restoreStreak() {
  if (S.restoring) return;
  S.restoring = true; render();
  try {
    await ensureToday();
    const [us, fresh] = await Promise.all([getDocFromServer(userRef()), loadDays(true)]);
    S.profile = us.data();
    S.days = fresh.map;
    S.stale = false;
    const today = todayKey();
    const offer = repairOffer(countsIn(S.days), today);
    const balance = S.profile.graceDays || 0;
    if (!offer || offer.cost > balance) { toast('That streak can’t be restored anymore.'); return; }

    const batch = writeBatch(db);
    for (const k of offer.missing) {
      // merge: never touches a reading that might be on the day
      batch.set(dayRef(k), { date: k, grace: true }, { merge: true });
      S.days.set(k, { chapters: [], xp: 0, ...S.days.get(k), date: k, grace: true });
    }
    const p = S.profile;
    const streak = streakFrom(counts, today);
    const lastMissed = offer.missing[offer.missing.length - 1];
    const lastDate = p.lastDate && p.lastDate > lastMissed ? p.lastDate : lastMissed;
    const longest = Math.max(p.longest || 0, streak);
    batch.update(userRef(), { graceDays: increment(-offer.cost), streak, lastDate, longest });
    await batch.commit();
    setDoc(publicRef(), { streak, longest, lastDate }, { merge: true }).catch(console.warn);
    Object.assign(p, { graceDays: balance - offer.cost, streak, lastDate, longest });
    S.justGrew = true;
    toast(`Streak restored: ${streak} ${streak === 1 ? 'day' : 'days'} in a row. ${termCount(p.graceDays)} left.`);
  } catch (err) {
    console.error(err);
    toast('Restoring a streak needs a connection. Try again once you’re online.');
  } finally {
    S.restoring = false;
    render();
  }
}

/* ---------- Group ---------- */
function subscribeGroup() {
  S.unsub.forEach((u) => u()); S.unsub = [];
  S.group = null; S.members = []; S.feed = [];
  const gid = S.profile?.groupId;
  if (!gid) return;
  const warn = (e) => console.warn(e);
  S.unsub.push(onSnapshot(doc(db, 'groups', gid), (s) => { S.group = s.exists() ? { id: s.id, ...s.data() } : null; softRender(); }, warn));
  S.unsub.push(onSnapshot(query(collection(db, 'publicProfiles'), where('groupId', '==', gid)), (s) => { S.members = s.docs.map((d) => ({ uid: d.id, ...d.data() })); softRender(); }, warn));
  S.unsub.push(onSnapshot(query(collection(db, 'groups', gid, 'feed'), orderBy('createdAt', 'desc'), limit(40)), (s) => { S.feed = s.docs.map((d) => ({ id: d.id, ...d.data() })); softRender(); }, warn));
}

async function joinGroup(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return;
  try {
    const gref = doc(db, 'groups', code);
    const g = await getDoc(gref);
    if (!g.exists()) { toast('No group uses that code. Check it and try again.'); return; }
    if ((g.data().members || []).length >= 50) { toast('That group is full.'); return; }
    await updateDoc(gref, { members: arrayUnion(S.uid) });
    await updateDoc(userRef(), { groupId: code });
    S.profile.groupId = code;
    await setDoc(publicRef(), publicSnapshot(), { merge: true });
    subscribeGroup();
    toast(`You joined ${g.data().name}.`);
    render();
  } catch (err) { console.error(err); toast('Couldn’t join the group. Check your connection and try again.'); }
}

async function createGroup(name) {
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  try {
    let code, exists = true;
    while (exists) {
      code = Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
      exists = (await getDoc(doc(db, 'groups', code))).exists();
    }
    await setDoc(doc(db, 'groups', code), { name: name.trim(), owner: S.uid, members: [S.uid], createdAt: serverTimestamp() });
    await updateDoc(userRef(), { groupId: code });
    S.profile.groupId = code;
    await setDoc(publicRef(), publicSnapshot(), { merge: true });
    subscribeGroup();
    toast('Group created. Share the code to invite people.');
    render();
  } catch (err) { console.error(err); toast('Couldn’t create the group. Check your connection and try again.'); }
}

async function leaveGroup() {
  const gid = S.profile.groupId;
  if (!gid || !confirm('Leave this group? Your own streak and progress stay with you.')) return;
  try {
    await updateDoc(doc(db, 'groups', gid), { members: arrayRemove(S.uid) });
    await updateDoc(userRef(), { groupId: null });
    S.profile.groupId = null;
    await setDoc(publicRef(), { groupId: null }, { merge: true });
    subscribeGroup();
    toast('You left the group.');
    render();
  } catch (err) { console.error(err); toast('Couldn’t leave the group. Try again.'); }
}

// What today's readings look like on the group board: chapter references only, never reflections.
function todayReads() {
  const today = todayKey();
  const list = (S.days.get(today)?.chapters || []).map(({ b, c }) => ({ b, c })).slice(0, 20);
  return { date: today, list };
}

const shortName = (n) => String(n || 'Reader').slice(0, 40);

function publicSnapshot() {
  const p = S.profile;
  return {
    name: shortName(p.name), groupId: p.groupId || null, streak: p.streak || 0, longest: p.longest || 0, xp: p.xp || 0,
    lastDate: p.lastDate || null, weekKey: p.weekKey || null, weekChapters: p.weekChapters || 0, todayReads: todayReads(),
  };
}

async function invite() {
  const code = S.profile.groupId;
  const url = `${location.origin}/?join=${code}`;
  const text = `Read the Bible with us on Undertone. Join with code ${code}: ${url}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Undertone', text });
    else { await navigator.clipboard.writeText(text); toast('Invite link copied.'); }
  } catch { /* share sheet dismissed */ }
}

/* ---------- Reading ---------- */
function badgeContext() {
  const read = S.progress.read || {};
  const bookDone = BOOKS.map((bk) => { for (let c = 1; c <= bk.chapters; c++) if (!read[chapterKey(bk.i, c)]) return false; return true; });
  return {
    readCount: Object.keys(read).length,
    longest: Math.max(S.profile.longest || 0, S.profile.streak || 0),
    bookDone, booksDone: bookDone.filter(Boolean).length,
  };
}

async function completeChapter(b, c, text, share) {
  await ensureToday();
  if (S.loadError) { render(); return; }
  const today = todayKey();
  const key = chapterKey(b, c);
  const p = S.profile;
  const existing = S.days.get(today);
  const first = !(existing && existing.chapters?.length);
  const entry = { b, c, r: text, at: Date.now() };

  const day = existing ? { ...existing, chapters: [...(existing.chapters || []), entry] } : { date: today, chapters: [entry], grace: false, xp: 0 };
  S.days.set(today, day);
  const streak = streakFrom(counts, today);

  let gain = XP_PER_CHAPTER + (first ? XP_FIRST_OF_DAY : 0);
  const bonus = first ? MILESTONE_BONUS[streak] || 0 : 0;
  gain += bonus;
  day.xp = (day.xp || 0) + gain;

  const dewdropEarned = first && earnsDewdrop(streak) && (p.graceDays || 0) < MAX_DEWDROPS;

  const wasNew = !S.progress.read[key];
  S.progress.read = { ...S.progress.read, [key]: today };

  let cursor = p.cursor || 0;
  if (p.plan !== 'year' && flatIndex(b, c) === cursor) cursor = (cursor + 1) % TOTAL;

  const wk = weekKey(today);
  const sameWeek = p.weekKey === wk;
  const before = new Set(p.badges || []);
  const levelBefore = levelInfo(p.xp || 0).lvl;
  const newRecord = streak > (p.longest || 0);

  Object.assign(p, {
    xp: (p.xp || 0) + gain, streak, longest: Math.max(p.longest || 0, streak), lastDate: today,
    graceDays: (p.graceDays || 0) + (dewdropEarned ? 1 : 0), cursor, weekKey: wk, weekChapters: (sameWeek ? p.weekChapters || 0 : 0) + 1,
  });
  const ctx = badgeContext();
  const earned = BADGES.filter((bd) => !before.has(bd.id) && bd.test(ctx));
  p.badges = [...before, ...earned.map((bd) => bd.id)];

  if (S.custom && S.custom.b === b && S.custom.c === c) S.custom = null;
  delete S.opened[key]; delete S.drafts[key]; saveOpened();
  S.justGrew = first;

  // Counters go up with increment() and badges with arrayUnion(), so a phone with
  // out-of-date numbers can't write over progress made on another device.
  const upd = { xp: increment(gain), streak, lastDate: today, cursor, weekKey: wk, weekChapters: sameWeek ? increment(1) : 1 };
  if (newRecord) upd.longest = streak;
  if (dewdropEarned) upd.graceDays = increment(1);
  if (earned.length) upd.badges = arrayUnion(...earned.map((bd) => bd.id));

  const batch = writeBatch(db);
  batch.set(dayRef(today), { date: today, chapters: arrayUnion(entry), xp: increment(gain) }, { merge: true });
  batch.set(progressRef(), { read: { [key]: today } }, { merge: true });
  batch.update(userRef(), upd);
  batch.commit().catch((err) => { console.error(err); toast(`That reading didn’t sync (${err.code || 'error'}). Reload and mark it again.`); });
  // Group writes go separately: if one is ever refused, the reading itself is still saved.
  setDoc(publicRef(), publicSnapshot(), { merge: true }).catch(console.warn);
  if (share && p.groupId) {
    setDoc(doc(collection(db, 'groups', p.groupId, 'feed')), { uid: S.uid, name: shortName(p.name), b, c, text, date: today, createdAt: serverTimestamp() }).catch(console.warn);
  }

  const notes = [`${label(b, c)} marked as read. +${gain} XP.`];
  if (bonus) notes.push(`${streak}-day streak bonus.`);
  if (dewdropEarned) notes.push(`You earned a ${TERM}. Save it to restore your streak if you ever miss a day.`);
  if (levelInfo(p.xp).lvl > levelBefore) notes.push(`Level ${levelInfo(p.xp).lvl} reached.`);
  earned.forEach((bd) => notes.push(`Badge earned: ${bd.name}.`));
  if (!wasNew) notes.push('Read again.');
  toast(notes.join(' '));
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function chooseChapter(b, c) {
  S.sheet = null;
  if (S.profile.plan === 'year') {
    S.custom = { b, c };
    toast(`${label(b, c)} added to today.`);
  } else {
    S.profile.cursor = flatIndex(b, c);
    S.custom = null;
    updateDoc(userRef(), { cursor: S.profile.cursor }).catch(console.warn);
    toast(`You’ll continue from ${label(b, c)}.`);
  }
  S.tab = 'today';
  render();
}

function readTodaySet() {
  return new Set((S.days.get(todayKey())?.chapters || []).map((e) => chapterKey(e.b, e.c)));
}

function todaysList() {
  const p = S.profile;
  const today = todayKey();
  const readToday = readTodaySet();
  const out = [];
  const push = (x) => { const k = chapterKey(x.b, x.c); if (!readToday.has(k) && !out.some((o) => chapterKey(o.b, o.c) === k)) out.push(x); };
  if (S.custom) push(S.custom);
  if (p.plan === 'year') { const d = yearDay(p.planStart || today, today); if (d <= 364) yearPlanDay(d).forEach(push); }
  else push(fromFlat(p.cursor || 0));
  return out;
}

// Bible in a year: chapters from earlier plan days that still need reading.
function catchUpList() {
  const p = S.profile;
  if (p.plan !== 'year' || !p.planStart) return [];
  const readToday = readTodaySet();
  return catchUp(p.planStart, todayKey(), S.progress.read || {}).filter((x) => !readToday.has(chapterKey(x.b, x.c)));
}

/* ---------- Reminders ---------- */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function currentToken() {
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  return getToken(getMessaging(fbApp), { vapidKey: CFG.vapidKey, serviceWorkerRegistration: reg });
}

async function enableReminders(hour) {
  try {
    if (isIOS && !isStandalone()) { toast('On iPhone, add Undertone to your Home Screen first, then turn on reminders from there.'); return false; }
    if (!('Notification' in window) || !(await isSupported())) { toast('This browser can’t receive reminders. Try Chrome on Android or Safari on iPhone.'); return false; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications are blocked. Allow them for this site in your browser settings.'); return false; }
    const token = await currentToken();
    S.pushToken = token;
    await updateDoc(userRef(), { reminderOn: true, reminderHour: hour, tz: TZ, pushTokens: arrayUnion(token) });
    Object.assign(S.profile, { reminderOn: true, reminderHour: hour, pushTokens: [...new Set([...(S.profile.pushTokens || []), token])] });
    toast(`Reminders on. You’ll hear from us around ${hourLabel(hour)} on days you haven’t read yet.`);
    return true;
  } catch (err) {
    console.error(err);
    toast('Couldn’t turn on reminders. Reload and try again.');
    return false;
  }
}

// Push tokens change from time to time, and the server drops dead ones.
// Re-register this device's current token on every load so reminders don't quietly stop.
async function refreshPushToken() {
  try {
    if (!S.profile?.reminderOn || !('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted' || !(await isSupported())) return;
    const token = await currentToken();
    S.pushToken = token;
    if (token && !(S.profile.pushTokens || []).includes(token)) {
      await updateDoc(userRef(), { pushTokens: arrayUnion(token) });
      S.profile.pushTokens = [...(S.profile.pushTokens || []), token];
    }
  } catch (err) { console.warn(err); }
}

async function doSignOut() {
  if (!confirm('Sign out of Undertone on this device?')) return;
  // Stop this device getting the account's reminders once someone else uses it.
  if (S.pushToken) await updateDoc(userRef(), { pushTokens: arrayRemove(S.pushToken) }).catch(console.warn);
  signOut(auth);
}

/* ---------- Events ---------- */
async function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  switch (a) {
    case 'tab': S.tab = t.dataset.tab; S.sheet = null; render(); window.scrollTo(0, 0); break;
    case 'open': // Let the link open jw.org; unlock the reflection box behind it.
      if (!S.opened[t.dataset.key]) { S.opened[t.dataset.key] = Date.now(); saveOpened(); }
      setTimeout(render, 300);
      break;
    case 'pick': S.sheet = { type: 'books' }; render(); break;
    case 'book': S.sheet = { type: 'chapters', b: +t.dataset.b }; render(); break;
    case 'chapter': chooseChapter(+t.dataset.b, +t.dataset.c); break;
    case 'back-books': S.sheet = { type: 'books' }; render(); break;
    case 'close-sheet': if (S.sheet?.type === 'intro') markIntroSeen(); S.sheet = null; render(); break;
    case 'about-dewdrops': S.sheet = { type: 'dewdrops' }; render(); break;
    case 'intro-next': S.sheet = { type: 'intro', step: S.sheet.step + 1 }; render(); break;
    case 'intro-done': markIntroSeen(); S.sheet = null; render(); break;
    case 'show-intro': S.sheet = { type: 'intro', step: 0 }; render(); break;
    case 'confirm-read': { const s = S.sheet; S.sheet = null; completeChapter(s.b, s.c, s.text, s.share); break; }
    case 'restore': restoreStreak(); break;
    case 'restore-later': dismissOffer(); break;
    case 'auth-mode': S.authMode = t.dataset.mode; S.authError = ''; render(); break;
    case 'signout': doSignOut(); break;
    case 'invite': invite(); break;
    case 'leave-group': leaveGroup(); break;
    case 'restart-plan':
      if (confirm('Restart Bible in a year from today? Chapters you’ve read stay marked.')) {
        S.profile.planStart = todayKey();
        updateDoc(userRef(), { planStart: S.profile.planStart }).catch(console.warn);
        toast('Plan restarted. Day 1 is today.');
        render();
      }
      break;
    case 'reload': location.reload(); break;
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const v = (n) => (f.elements[n]?.value || '').trim();
  switch (f.dataset.form) {
    case 'signin':
    case 'signup':
    case 'reset': return handleAuth(f.dataset.form, v);
    case 'reflect': {
      const b = +f.dataset.b, c = +f.dataset.c, key = chapterKey(b, c);
      const text = v('reflection');
      const share = !!f.elements.share?.checked;
      if (text.length < 8) { toast('Write at least a few words about the chapter.'); return; }
      const secs = (Date.now() - (S.opened[key] || 0)) / 1000;
      if (secs < QUICK_READ_SECONDS) { S.sheet = { type: 'quick', b, c, text, share, secs }; render(); return; }
      completeChapter(b, c, text, share);
      return;
    }
    case 'join': return joinGroup(v('code'));
    case 'create': if (v('name')) return createGroup(v('name')); return;
    case 'name': {
      const name = v('name');
      if (!name) return;
      S.profile.name = name;
      try {
        await updateDoc(userRef(), { name });
        await setDoc(publicRef(), { name: shortName(name) }, { merge: true });
        updateProfile(auth.currentUser, { displayName: name }).catch(() => {});
        toast('Name saved.');
      } catch { toast('Couldn’t save your name. Try again.'); }
      render();
    }
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.name === 'plan') {
    const plan = t.value;
    const p = S.profile;
    const today = todayKey();
    const upd = { plan };
    let msg = 'You’re reading in order now.';
    if (plan === 'year') {
      // Switching back to the year plan shouldn't silently throw away progress on it.
      const d = p.planStart ? yearDay(p.planStart, today) : -1;
      const resume = d >= 0 && d < 365 && confirm(`Pick up Bible in a year where you left off (day ${d + 1})? Choose Cancel to start over from today.`);
      if (!resume) upd.planStart = today;
      msg = resume ? `Back to Bible in a year, day ${d + 1}.` : 'Bible in a year starts today.';
    }
    Object.assign(p, upd);
    S.custom = null;
    updateDoc(userRef(), upd).catch(console.warn);
    toast(msg);
    render();
  } else if (t.id === 'reminder-toggle') {
    const hour = +document.getElementById('reminder-hour').value;
    if (t.checked) { const ok = await enableReminders(hour); if (!ok) t.checked = false; }
    else { S.profile.reminderOn = false; updateDoc(userRef(), { reminderOn: false }).catch(console.warn); toast('Reminders off.'); }
    render();
  } else if (t.id === 'reminder-hour') {
    S.profile.reminderHour = +t.value;
    updateDoc(userRef(), { reminderHour: +t.value }).catch(console.warn);
    if (S.profile.reminderOn) toast(`Reminders moved to ${hourLabel(+t.value)}.`);
  }
}

async function handleAuth(mode, v) {
  S.authBusy = true; S.authError = ''; render();
  try {
    if (mode === 'signin') {
      await signInWithEmailAndPassword(auth, v('email'), v('password'));
    } else if (mode === 'signup') {
      if (!v('name')) throw { code: 'name' };
      S.pendingName = v('name');
      const cred = await createUserWithEmailAndPassword(auth, v('email'), v('password'));
      await updateProfile(cred.user, { displayName: v('name') });
    } else {
      await sendPasswordResetEmail(auth, v('email'));
      S.authMode = 'signin';
      toast('Check your email for a link to reset your password.');
    }
  } catch (err) {
    const msg = {
      name: 'Enter your name.',
      'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
      'auth/invalid-credential': 'That email and password don’t match.',
      'auth/wrong-password': 'That email and password don’t match.',
      'auth/user-not-found': 'No account uses that email.',
      'auth/weak-password': 'Use a password with at least 6 characters.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No connection. Check your internet and try again.',
    }[err.code];
    S.authError = msg || 'Something went wrong. Try again.';
  }
  S.authBusy = false;
  render();
}

/* ---------- Rendering ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function softRender() {
  const el = document.activeElement;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return; // don't interrupt typing
  render();
}

function render() {
  if (!S.uid) { $app.innerHTML = viewAuth(); return; }
  if (S.loadError) { $app.innerHTML = `<div class="auth"><div class="auth-card"><h1 class="wordmark">Undertone</h1><p>${S.loadError}</p><button class="btn primary" data-action="reload">Reload</button></div></div>`; return; }
  if (!S.profile) { $app.innerHTML = '<div class="loading">Loading your progress…</div>'; return; }
  const views = { today: viewToday, progress: viewProgress, group: viewGroup, settings: viewSettings };
  $app.innerHTML = `<main class="view">${views[S.tab]()}</main>${tabbar()}${viewSheet()}`;
  if (S.justGrew) setTimeout(() => { S.justGrew = false; }, 1200);
}

function tabbar() {
  const tabs = [
    ['today', 'Today', '<path d="M12 21v-7"/><path d="M12 14c-4 0-6-3-6-6 3 0 6 2 6 6Z"/><path d="M12 12c0-4 2-7 7-7 0 4-3 7-7 7Z"/>'],
    ['progress', 'Progress', '<path d="M4 19V5"/><path d="M9 19V8"/><path d="M14 19v-5"/><path d="M19 19V10"/>'],
    ['group', 'Group', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M15 14.5c3 0 6 1.5 6 4.5"/>'],
    ['settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'],
  ];
  return `<nav class="tabbar" aria-label="Main">${tabs.map(([id, name, icon]) => `
    <button data-action="tab" data-tab="${id}" class="${S.tab === id ? 'on' : ''}" aria-current="${S.tab === id ? 'page' : 'false'}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${name}</span></button>`).join('')}</nav>`;
}

function viewAuth() {
  const m = S.authMode;
  const err = S.authError ? `<p class="form-error" role="alert">${esc(S.authError)}</p>` : '';
  const busy = S.authBusy ? 'disabled' : '';
  let form;
  if (m === 'signup') {
    form = `<form data-form="signup" class="stack">
      <label>Your name<input name="name" autocomplete="name" maxlength="40" required></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password<input name="password" type="password" autocomplete="new-password" minlength="6" required></label>
      ${err}<button class="btn primary" ${busy}>Create account</button></form>
      <p class="switch">Already have an account? <button class="link" data-action="auth-mode" data-mode="signin">Sign in</button></p>`;
  } else if (m === 'reset') {
    form = `<form data-form="reset" class="stack">
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      ${err}<button class="btn primary" ${busy}>Send reset link</button></form>
      <p class="switch"><button class="link" data-action="auth-mode" data-mode="signin">Back to sign in</button></p>`;
  } else {
    form = `<form data-form="signin" class="stack">
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      ${err}<button class="btn primary" ${busy}>Sign in</button></form>
      <p class="switch"><button class="link" data-action="auth-mode" data-mode="reset">Forgot password?</button></p>
      <p class="switch">New here? <button class="link" data-action="auth-mode" data-mode="signup">Create an account</button></p>`;
  }
  return `<div class="auth"><div class="auth-card">
    ${treeSVG(7, true, false)}
    <h1 class="wordmark">Undertone</h1>
    <p class="tagline">A daily Bible reading habit, one chapter at a time.</p>
    ${form}</div></div>`;
}

function viewToday() {
  const p = S.profile;
  const today = todayKey();
  const done = readOn(today);
  const streak = streakFrom(counts, today);
  const lv = levelInfo(p.xp || 0);
  const readToday = S.days.get(today)?.chapters || [];
  const list = todaysList();
  const behind = catchUpList();
  const balance = p.graceDays || 0;
  const nudge = NUDGES[Math.floor(toUTC(today) / 864e5) % NUDGES.length];

  const status = done
    ? 'Today’s reading is done. Your streak is safe.'
    : streak > 0 ? 'Read one chapter today to keep your streak.' : 'Read one chapter today to start a streak.';

  let heading = 'Up next';
  if (p.plan === 'year') {
    const d = yearDay(p.planStart || today, today);
    heading = d > 364 ? 'Bible in a year: complete' : `Bible in a year, day ${d + 1} of 365`;
  }
  if (done && p.plan !== 'year') heading = 'Keep going';

  const rows = list.length
    ? list.map(({ b, c }) => chapterRow(b, c)).join('')
    : `<p class="empty">That’s everything planned for today. Want to read more?</p>`;

  const catchUpSection = behind.length ? `
    <section class="reading catch-up">
      <h2>Catching up</h2>
      <p class="hint">${behind.length} ${behind.length === 1 ? 'chapter' : 'chapters'} from earlier days of your plan. Read them whenever you can.</p>
      ${behind.slice(0, 3).map(({ b, c }) => chapterRow(b, c)).join('')}
    </section>` : '';

  const doneRows = readToday.map((e) => `
    <li><span class="done-ref">${esc(label(e.b, e.c))}</span><span class="done-text">${esc(e.r)}</span></li>`).join('');

  return `
    <section class="hero">
      ${treeSVG(streak, done, S.justGrew)}
      <p class="streak"><span class="streak-num">${streak}</span> <span class="streak-unit">${streak === 1 ? 'day' : 'days'} in a row</span></p>
      <p class="stage">${stageCaption(streak)}</p>
    </section>
    <p class="status ${done ? 'is-done' : ''}">${status}</p>
    ${repairCard()}
    <div class="meta-row">
      <div class="level"><span>Level ${lv.lvl}</span><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${lv.span}" aria-valuenow="${lv.into}"><span style="width:${(lv.into / lv.span) * 100}%"></span></div><small>${lv.span - lv.into} XP to level ${lv.lvl + 1}</small></div>
      <button class="grace" data-action="about-dewdrops" aria-label="${termCount(balance)}. What are ${TERMS}?">
        <span class="grace-dots">${Array.from({ length: MAX_DEWDROPS }, (_, i) => dropIcon(i < balance)).join('')}</span>
        <small>${termCount(balance)}</small>
      </button>
    </div>
    <section class="reading">
      <h2>${heading}</h2>
      ${rows}
      <button class="link" data-action="pick">Choose a different chapter</button>
    </section>
    ${catchUpSection}
    ${readToday.length ? `<section class="read-today"><h2>Read today</h2><ul>${doneRows}</ul></section>` : ''}
    <aside class="nudge">${esc(nudge)}</aside>`;
}

// Offer to spend dewdrops on the most recent break in the streak.
function repairCard() {
  const offer = currentOffer();
  if (!offer || offerDismissed(offer)) return '';
  const missed = offer.missing.length === 1 ? fmtDate(offer.missing[0]) : `${fmtDate(offer.missing[0])} to ${fmtDate(offer.missing[offer.missing.length - 1])}`;
  if (offer.cost > offer.balance) {
    return `<p class="repair-note">Restoring your ${offer.before}-day streak takes ${termCount(offer.cost)}. You have ${offer.balance}.</p>`;
  }
  const busy = S.restoring ? 'disabled' : '';
  return `
    <section class="repair card">
      <h2>Restore your streak?</h2>
      <p>Your ${offer.before}-day streak broke when you missed ${esc(missed)}. Spend ${termCount(offer.cost)} to fill ${offer.cost === 1 ? 'that day' : 'those days'}, and your streak becomes ${offer.after} ${offer.after === 1 ? 'day' : 'days'}.</p>
      <p class="hint">You have ${termCount(offer.balance)}. <button class="link" data-action="about-dewdrops">What are ${TERMS}?</button></p>
      <div class="row">
        <button class="btn ghost" data-action="restore-later">Not now</button>
        <button class="btn primary" data-action="restore" ${busy}>${S.restoring ? 'Restoring…' : 'Restore my streak'}</button>
      </div>
    </section>`;
}

function chapterRow(b, c) {
  const key = chapterKey(b, c);
  const opened = !!S.opened[key];
  const earlier = S.progress.read?.[key];
  const groupName = S.group?.name;
  const form = opened ? `
    <form class="reflect" data-form="reflect" data-b="${b}" data-c="${c}">
      <label for="r-${key}">What stood out to you?</label>
      <textarea id="r-${key}" name="reflection" rows="2" maxlength="280" data-draft="${key}" placeholder="One line is enough.">${esc(S.drafts[key] || '')}</textarea>
      ${S.profile.groupId ? `<label class="check"><input type="checkbox" name="share" checked> Share with ${esc(groupName || 'my group')}</label>` : ''}
      <button class="btn primary" type="submit">Mark as read</button>
    </form>` : `<p class="hint">Your reflection opens once you start reading.</p>`;
  return `
    <article class="chapter ${opened ? 'is-open' : ''}">
      <header><h3>${esc(label(b, c))}</h3>${earlier ? `<span class="tag">Read ${fmtDate(earlier)}</span>` : ''}</header>
      <a class="btn ${opened ? 'ghost' : 'primary'}" href="${jwUrl(b, c)}" target="_blank" rel="noopener" data-action="open" data-key="${key}">${opened ? 'Open on jw.org again' : 'Read on jw.org'}</a>
      ${form}
    </article>`;
}

function heatmap() {
  const today = todayKey();
  const start = addDays(weekKey(today), -7 * 15);
  const cells = [];
  for (let i = 0; i < 16 * 7; i++) {
    const k = addDays(start, i);
    if (diffDays(today, k) > 0) { cells.push('<i class="future"></i>'); continue; }
    const d = S.days.get(k);
    const n = d?.chapters?.length || 0;
    const restored = n === 0 && d?.grace === true;
    const cls = restored ? 'grace' : n >= 3 ? 'l3' : n === 2 ? 'l2' : n === 1 ? 'l1' : '';
    const desc = restored ? `restored with a ${TERM}` : `${n} ${n === 1 ? 'chapter' : 'chapters'}`;
    cells.push(`<i class="${cls}" title="${fmtDate(k)}: ${desc}"></i>`);
  }
  return `<div class="heatmap" role="img" aria-label="Reading days over the last 16 weeks">${cells.join('')}</div>
    <p class="legend"><i></i> none <i class="l1"></i> 1 <i class="l2"></i> 2 <i class="l3"></i> 3+ <i class="grace"></i> restored with a ${TERM}</p>`;
}

function shelf(section) {
  const read = S.progress.read || {};
  return `<div class="shelf">${BOOKS.filter((bk) => bk.section === section).map((bk) => {
    let n = 0;
    for (let c = 1; c <= bk.chapters; c++) if (read[chapterKey(bk.i, c)]) n++;
    const pct = Math.round((n / bk.chapters) * 100);
    return `<button class="spine ${pct === 100 ? 'done' : ''}" style="--fill:${pct}%" data-action="book" data-b="${bk.i}" aria-label="${esc(bk.name)}, ${n} of ${bk.chapters} chapters read"><span>${esc(bk.abbr)}</span></button>`;
  }).join('')}</div>`;
}

function viewProgress() {
  const p = S.profile;
  const ctx = badgeContext();
  const lv = levelInfo(p.xp || 0);
  const owned = new Set(p.badges || []);
  return `
    <h1>Progress</h1>
    <div class="stats">
      <div><strong>${ctx.readCount}</strong><span>of 1,189 chapters</span></div>
      <div><strong>${ctx.longest}</strong><span>longest streak</span></div>
      <div><strong>${lv.lvl}</strong><span>level, ${p.xp || 0} XP</span></div>
    </div>
    <section><h2>Last 16 weeks</h2>${heatmap()}</section>
    <section>
      <h2>Your bookshelf</h2>
      <p class="hint">Each book fills as you read its chapters. Tap one to see which you’ve read.</p>
      <h3>Hebrew Scriptures</h3>${shelf('hebrew')}
      <h3>Christian Greek Scriptures</h3>${shelf('greek')}
    </section>
    <section>
      <h2>Badges</h2>
      <ul class="badges">${BADGES.map((bd) => `
        <li class="${owned.has(bd.id) ? 'earned' : ''}">
          <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"/><path d="M20 30v-9M20 21c-5 0-8-3-8-8 4 0 8 3 8 8ZM20 19c0-5 3-8 8-8 0 5-3 8-8 8Z"/></svg>
          <div><strong>${esc(bd.name)}</strong><span>${esc(bd.desc)}</span></div>
        </li>`).join('')}</ul>
    </section>`;
}

function viewGroup() {
  const p = S.profile;
  if (!p.groupId) {
    return `
      <h1>Group</h1>
      <p class="lede">Read alongside friends. See each other’s streaks, share reflections, and work toward a weekly goal together.</p>
      <form data-form="join" class="card stack">
        <h2>Join a group</h2>
        <label>Group code<input name="code" maxlength="6" autocapitalize="characters" autocomplete="off" required></label>
        <button class="btn primary">Join group</button>
      </form>
      <form data-form="create" class="card stack">
        <h2>Start a group</h2>
        <label>Group name<input name="name" maxlength="40" required></label>
        <button class="btn ghost">Create group</button>
      </form>`;
  }
  const g = S.group;
  if (!g) return '<h1>Group</h1><p class="hint">Loading your group…</p>';

  const today = todayKey();
  const yesterday = addDays(today, -1);
  const wk = weekKey(today);
  // Everything here was written by other readers, so numbers are forced to numbers and
  // chapters are checked against the book list before anything is drawn.
  // Sorted by who has read today, then by name. Never by streak: this isn't a ranking.
  const members = [...S.members].map((m) => {
    const tr = m.todayReads;
    const reads = tr && tr.date === today && Array.isArray(tr.list) ? tr.list.filter((x) => validChapter(x?.b, x?.c)).slice(0, 6) : [];
    return {
      uid: m.uid,
      name: String(m.name || 'Reader'),
      alive: m.lastDate === today || m.lastDate === yesterday ? safeInt(m.streak) : 0,
      readToday: m.lastDate === today || reads.length > 0,
      reads,
    };
  }).sort((a, b) => Number(b.readToday) - Number(a.readToday) || a.name.localeCompare(b.name));
  const weekTotal = S.members.reduce((s, m) => s + (m.weekKey === wk ? safeInt(m.weekChapters) : 0), 0);
  const goal = Math.max(5, (g.members || []).length * 5);
  const readersToday = members.filter((m) => m.readToday).length;

  const board = members.map((m) => `
    <li class="${m.readToday ? 'read' : ''}">
      <span class="who">${esc(m.name)}${m.uid === S.uid ? ' (you)' : ''}</span>
      <span class="when">${m.reads.length
        ? `Read ${m.reads.map(({ b, c }) => `<a href="${jwUrl(b, c)}" target="_blank" rel="noopener">${esc(label(b, c))}</a>`).join(', ')}`
        : m.readToday ? 'Read today' : 'Not yet today'}</span>
      <span class="num" aria-label="${m.alive} day streak">${m.alive}</span>
    </li>`).join('');

  const posts = S.feed.filter((f) => validChapter(f.b, f.c));
  const feed = posts.length ? posts.map((f) => `
    <article class="post">
      <p class="post-ref">${esc(f.name)} on <a href="${jwUrl(f.b, f.c)}" target="_blank" rel="noopener">${esc(label(f.b, f.c))}</a></p>
      <p class="post-text">${esc(f.text)}</p>
      <time>${typeof f.date === 'string' ? esc(fmtDate(f.date)) : ''}</time>
    </article>`).join('') : '<p class="empty">No reflections yet. Shared reflections from your group appear here.</p>';

  return `
    <header class="group-head">
      <div><h1>${esc(g.name)}</h1><p class="hint">Code ${esc(g.id)}. ${readersToday} of ${members.length} read today.</p></div>
      <button class="btn ghost small" data-action="invite">Invite</button>
    </header>
    <section class="goal">
      <h2>This week together</h2>
      <div class="bar big"><span style="width:${Math.min(100, (weekTotal / goal) * 100)}%"></span></div>
      <p>${weekTotal} of ${goal} chapters${weekTotal >= goal ? '. Goal reached.' : ''}</p>
    </section>
    <section><h2>Today</h2><ul class="board">${board}</ul></section>
    <section><h2>Reflections</h2>${feed}</section>`;
}

function viewSettings() {
  const p = S.profile;
  const hours = Array.from({ length: 19 }, (_, i) => i + 5);
  const planNote = p.plan === 'year'
    ? `<p class="hint">Started ${fmtDate(p.planStart)}. <button class="link" data-action="restart-plan">Restart from today</button></p>`
    : `<p class="hint">You’ll continue from ${esc(label(fromFlat(p.cursor || 0).b, fromFlat(p.cursor || 0).c))}. <button class="link" data-action="pick">Change</button></p>`;
  const iosNote = isIOS && !isStandalone()
    ? '<p class="hint">On iPhone, reminders work after you add Undertone to your Home Screen: tap Share, then Add to Home Screen.</p>' : '';
  return `
    <h1>Settings</h1>
    <section class="card">
      <h2>Reading plan</h2>
      <label class="radio"><input type="radio" name="plan" value="order" ${p.plan !== 'year' ? 'checked' : ''}>
        <span><strong>Read in order</strong>Chapter by chapter from wherever you choose to start.</span></label>
      <label class="radio"><input type="radio" name="plan" value="year" ${p.plan === 'year' ? 'checked' : ''}>
        <span><strong>Bible in a year</strong>Three or four chapters a day for 365 days.</span></label>
      ${planNote}
    </section>
    <section class="card">
      <h2>Daily reminder</h2>
      <label class="switch-row"><span>Remind me if I haven’t read yet</span><input id="reminder-toggle" type="checkbox" role="switch" ${p.reminderOn ? 'checked' : ''}></label>
      <label class="inline">Time<select id="reminder-hour">${hours.map((h) => `<option value="${h}" ${h === (p.reminderHour ?? 8) ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
      <p class="hint">If your streak is still open at 9 PM, you’ll get one more nudge.</p>
      ${iosNote}
    </section>
    <section class="card">
      <h2>Account</h2>
      <p><button class="link" data-action="show-intro">How Undertone works</button></p>
      <form data-form="name" class="inline-form"><label>Name<input name="name" value="${esc(p.name)}" maxlength="40" required></label><button class="btn ghost small">Save</button></form>
      <p class="hint">Signed in as ${esc(S.email)}. Your streak and progress sync to any device you sign in on.</p>
      ${p.groupId ? '<button class="btn ghost" data-action="leave-group">Leave group</button>' : ''}
      <button class="btn ghost" data-action="signout">Sign out</button>
    </section>
    <p class="about">Undertone takes its name from Psalm 1:2. Scripture opens on jw.org.</p>`;
}

function markIntroSeen() {
  if (S.profile.introSeen) return;
  S.profile.introSeen = true;
  updateDoc(userRef(), { introSeen: true }).catch(console.warn);
}

function viewSheet() {
  const s = S.sheet;
  if (!s) return '';
  let body = '';
  if (s.type === 'books') {
    const list = (section) => BOOKS.filter((b) => b.section === section).map((b) => `<button data-action="book" data-b="${b.i}">${esc(b.name)}</button>`).join('');
    body = `<h2>Choose a book</h2><h3>Hebrew Scriptures</h3><div class="book-list">${list('hebrew')}</div><h3>Christian Greek Scriptures</h3><div class="book-list">${list('greek')}</div>`;
  } else if (s.type === 'chapters') {
    const bk = BOOKS[s.b];
    const read = S.progress.read || {};
    const note = S.profile.plan === 'year' ? 'Pick a chapter to add to today.' : 'Pick where to continue reading.';
    body = `<button class="link" data-action="back-books">All books</button><h2>${esc(bk.name)}</h2><p class="hint">${note} Filled chapters are ones you’ve read.</p>
      <div class="ch-grid">${Array.from({ length: bk.chapters }, (_, i) => i + 1).map((c) => {
        const r = read[chapterKey(s.b, c)];
        return `<button class="${r ? 'read' : ''}" data-action="chapter" data-b="${s.b}" data-c="${c}" ${r ? `title="Read ${fmtDate(r)}"` : ''}>${c}</button>`;
      }).join('')}</div>`;
  } else if (s.type === 'intro') {
    const step = INTRO[s.step];
    const last = s.step === INTRO.length - 1;
    body = `<p class="intro-step">${s.step + 1} of ${INTRO.length}</p>
      ${step.drops ? `<p class="intro-drops">${dropIcon(true)}${dropIcon(true)}${dropIcon(false)}</p>` : ''}
      <h2>${step.title}</h2><p>${esc(step.text)}</p>
      <div class="row">${last ? '' : '<button class="btn ghost" data-action="intro-done">Skip</button>'}
        <button class="btn primary" data-action="${last ? 'intro-done' : 'intro-next'}">${last ? 'Start reading' : 'Next'}</button></div>`;
  } else if (s.type === 'dewdrops') {
    const balance = S.profile.graceDays || 0;
    body = `<p class="intro-drops">${Array.from({ length: MAX_DEWDROPS }, (_, i) => dropIcon(i < balance)).join('')}</p>
      <h2>Dewdrops</h2><p>${esc(DEWDROP_ABOUT)}</p><p class="hint">You have ${termCount(balance)}.</p>
      <div class="row"><button class="btn primary" data-action="close-sheet">Got it</button></div>`;
  } else if (s.type === 'quick') {
    body = `<h2>That was quick</h2>
      <p>You opened ${esc(label(s.b, s.c))} ${s.secs < 60 ? 'less than a minute' : 'about a minute'} ago. Did you read the whole chapter?</p>
      <div class="row"><button class="btn ghost" data-action="close-sheet">Keep reading</button><button class="btn primary" data-action="confirm-read">Yes, mark as read</button></div>`;
  }
  return `<div class="scrim" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${body}</div>`;
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 4200);
}
