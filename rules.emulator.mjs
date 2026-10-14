// Checks firestore.rules against the Firestore emulator. Not part of `npm test` (it needs Java
// and the emulator). To run:
//   npm i --no-save firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10.12.2
//   npx firebase emulators:exec --only firestore --project demo-undertone "node --test test/rules.emulator.mjs"
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, arrayUnion, serverTimestamp } from 'firebase/firestore';

let env;
const db = (uid) => env.authenticatedContext(uid).firestore();

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-undertone', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const a = ctx.firestore();
    await setDoc(doc(a, 'groups/ABC234'), { name: 'Friends', owner: 'alice', members: ['alice', 'bob'] });
    await setDoc(doc(a, 'users/alice'), { groupId: 'ABC234' });
    await setDoc(doc(a, 'users/bob'), { groupId: 'ABC234' });
    await setDoc(doc(a, 'users/eve'), { groupId: null });
    await setDoc(doc(a, 'publicProfiles/alice'), { name: 'Alice', groupId: 'ABC234', streak: 4 });
    await setDoc(doc(a, 'publicProfiles/bob'), { name: 'Bob', groupId: 'ABC234', streak: 2 });
  });
});
after(() => env.cleanup());

const validPost = (uid) => ({ uid, name: 'Bob', b: 18, c: 23, text: 'He leads me beside still waters.', date: '2026-03-10', createdAt: serverTimestamp() });

test('groups can be opened by code but never listed', async () => {
  await assertSucceeds(getDoc(doc(db('eve'), 'groups/ABC234')));
  await assertFails(getDocs(collection(db('eve'), 'groups')));
});

test('private data stays private', async () => {
  await assertSucceeds(getDoc(doc(db('alice'), 'users/alice')));
  await assertFails(getDoc(doc(db('bob'), 'users/alice')));
  await assertFails(setDoc(doc(db('bob'), 'users/alice/days/2026-03-10'), { date: '2026-03-10' }));
});

test('group members can see each other’s cards; outsiders cannot', async () => {
  await assertSucceeds(getDocs(query(collection(db('bob'), 'publicProfiles'), where('groupId', '==', 'ABC234'))));
  await assertFails(getDocs(query(collection(db('eve'), 'publicProfiles'), where('groupId', '==', 'ABC234'))));
});

test('setting your own groupId without being a member does not open the group', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/eve'), { groupId: 'ABC234' }));
  await assertFails(getDocs(query(collection(db('eve'), 'publicProfiles'), where('groupId', '==', 'ABC234'))));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/eve'), { groupId: null }));
});

test('public cards must hold the types the app draws', async () => {
  const ok = { name: 'Bob', groupId: 'ABC234', streak: 3, longest: 9, xp: 120, lastDate: '2026-03-10', weekKey: '2026-03-09', weekChapters: 2, todayReads: { date: '2026-03-10', list: [{ b: 18, c: 23 }] } };
  await assertSucceeds(setDoc(doc(db('bob'), 'publicProfiles/bob'), ok));
  await assertFails(setDoc(doc(db('bob'), 'publicProfiles/bob'), { ...ok, streak: '<img src=x onerror=alert(1)>' }));
  await assertFails(setDoc(doc(db('bob'), 'publicProfiles/bob'), { ...ok, extra: 1 }));
  await assertFails(setDoc(doc(db('bob'), 'publicProfiles/bob'), { ...ok, name: 'x'.repeat(41) }));
  await assertFails(setDoc(doc(db('bob'), 'publicProfiles/alice'), ok));
});

test('feed posts are checked', async () => {
  const feed = (uid) => doc(collection(db(uid), 'groups/ABC234/feed'));
  await assertSucceeds(setDoc(feed('bob'), validPost('bob')));
  await assertFails(setDoc(feed('bob'), { ...validPost('bob'), c: '"><img src=x onerror=alert(1)>' }));
  await assertFails(setDoc(feed('bob'), { ...validPost('bob'), b: 99 }));
  await assertFails(setDoc(feed('bob'), { ...validPost('bob'), text: 'x'.repeat(281) }));
  await assertFails(setDoc(feed('bob'), validPost('alice')));
  await assertFails(setDoc(feed('eve'), validPost('eve')));
});

test('joining adds only yourself, and groups stop at 50', async () => {
  await assertFails(updateDoc(doc(db('eve'), 'groups/ABC234'), { members: arrayUnion('mallory') }));
  await assertSucceeds(updateDoc(doc(db('eve'), 'groups/ABC234'), { members: arrayUnion('eve') }));
  const full = Array.from({ length: 50 }, (_, i) => `m${i}`);
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'groups/FULL22'), { name: 'Full', owner: 'm0', members: full }));
  await assertFails(updateDoc(doc(db('eve'), 'groups/FULL22'), { members: arrayUnion('eve') }));
});
