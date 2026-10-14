# Undertone — project context

Handoff from a claude.ai chat where v1 was planned and built. Read this before making changes.

## What it is
A Duolingo-style daily Bible reading app. The core loop is: read a chapter, write a one-line reflection, keep your streak. The name comes from Psalm 1:2 (reading "in an undertone"), and the visual motif is the tree by streams of water from Psalm 1:3.

- **Users:** the owner plus a friends/congregation group (~10 people) for the beta, with plans to expand to wider use later.
- **Primary translation:** New World Translation (NWT). The intended audience is Jehovah's Witnesses.
- **Platforms:** iPhone and Android equally. The owner tests on Android.

## Hard constraints (do not change without the owner's sign-off)
1. **No NWT scripture text in the app or on any server.** jw.org's Terms of Use explicitly prohibit distributing its text with or as part of any software application, including uploading it to a server for an app to use. Watch Tower has also publicly named unofficial apps using its material as a problem. The app links out to the chapter on jw.org instead. No legitimately copyright-free NWT exists. The formal permission route is DeveloperSupport@jw.org, but don't count on it.
2. **Don't imitate JW Library's branding.** The design is calm and clean but distinct, so the app can't be mistaken for an official JW tool, which matters once it spreads beyond friends.
3. **Streak preservation is the top priority.** Accounts are tied to email and all data syncs to the cloud. Never introduce anything that could wipe or reset a streak through a glitch, a device switch, or being offline. In practice that means:
   - Never write a streak-changing value (streak, dewdrops spent, restored days) from data that came from the offline cache. `S.stale` is true when it did; restoring a streak re-reads from the server first.
   - Never overwrite a day record. Day writes use `{ merge: true }` and `arrayUnion`, so a reading made on another device survives.
   - Counters go up with `increment()` and badges with `arrayUnion()`, never by writing a whole number or list from memory.
   - Keep the reading's own batch separate from group writes (public card, feed), so a refused group write can never lose a reading.
   - When the app comes back on a new day (installed apps sit in the background for days), everything is reloaded before anything is recorded (`ensureToday`).
4. **Group features are cooperative, not competitive.** No rank numbers or leaderboard positions. The owner's stated reason is to avoid people rushing chapters for points.

## Decisions made and why
- **Dewdrops (UI term; stored as `graceDays` / `grace`):** a currency, like Duolingo's streak repair. Dew reviving a dry tree fits the Psalm 1:3 motif (also Deut 32:2, Hos 14:5). Earned at every 7-day multiple of a streak (including on a new streak), held up to 5. They are never spent automatically: when a streak breaks, Today shows a "Restore your streak?" card that costs one per missed day. The offer stays open until the new streak is longer than 7 days, and a gap longer than 5 days can't be restored. The owner chose "dewdrops" after rejecting "atonement" (doctrinally loaded: it's tied to the ransom). Avoid any name that implies missing a day needs forgiveness ("mercy", "pardon"). The word lives in `TERM`/`TERMS` in app.js so it can be changed in one place. Dewdrops are drawn as drop icons in the water colour.
- **First-run tour:** four short steps (read then reflect, the tree, dewdrops, groups), shown once per account and replayable from Settings → "How Undertone works". Tapping the dewdrop balance on Today, or "What are dewdrops?" on the restore card, opens a short explainer.
- **Group board shows what people read, not a ranking.** Each member's row lists the chapters they read today (references only, linked to jw.org), from `publicProfiles.todayReads`. Sorted by who has read today, then by name. Never sort by streak.
- **Real-reading check:** The reflection box only unlocks after the reader taps "Read on jw.org." If they submit within 90 seconds of opening, a soft "That was quick" confirmation appears; it never blocks. A minimum of 8 characters is required.
- **Reading structure:** Two plans, "Read in order" (a cursor that advances; the reader can pick any start point) and "Bible in a year" (1,189 chapters spread evenly over 365 days, 3–4 a day). Extra chapters can be added on any day.
- **Stack:** Installable web app (PWA), not a store app, so it works on iPhone and Android from one codebase with nothing to install from a store. Hosting is Netlify (the owner already uses it). Data and auth are Firebase (the owner has used Google tools before): email/password Auth plus Firestore with offline persistence. Reminders go through Firebase Cloud Messaging, sent by a Netlify scheduled function.
- **Considered and skipped for v1:** ASV (1901, public domain, uses "Jehovah" in the Hebrew Scriptures) as an in-app offline fallback. A native app (Expo/React Native) is the planned next step if the beta sticks, mainly for more reliable notifications.

## File map
```
public/                     static app (Netlify publish dir)
  index.html                shell; loads config.js then app.js (ES module)
  config.js                 Firebase web config + VAPID key (owner fills in; public by design)
  app.js                    app state, Firebase calls and rendering (vanilla JS, no build step)
  logic.js                  pure rules: dates, streaks, dewdrops/repair, levels, year-plan catch-up. No Firebase or DOM.
  bible.js                  66 books, chapter counts, flat-index helpers, jw.org URLs, year plan
  tree.js                   SVG streak tree, 6 growth stages
  styles.css                design tokens, light/dark, all styles
  firebase-messaging-sw.js  service worker: offline cache (network-first) + FCM
  manifest.webmanifest, icons/
netlify/functions/reminders.mjs   hourly scheduled function (firebase-admin), 20 readers at a time
test/logic.test.mjs               unit tests for logic.js: `npm test`
test/rules.emulator.mjs           firestore.rules tests against the emulator (needs Java; how to run is at the top of the file)
netlify.toml, package.json        firebase-admin pinned 12.1.0
firestore.rules                   security rules (paste into Firebase console)
SETUP.md                          step-by-step deploy guide written for the owner
```
Firebase client SDK is pinned at 10.12.2 (gstatic ESM imports). There's no bundler. Keep it that way unless there's a strong reason. If you change the version, change it in app.js and in `FIREBASE` in the service worker, which caches those files so the app can start offline.

Whenever `firebase-messaging-sw.js` or the list of app files changes, bump `CACHE` (currently `undertone-v2`) so phones pick up the new version.

For local testing, `config.js` can include `emulators: { auth: '127.0.0.1:9099', firestore: '127.0.0.1:8080' }` to point the app at the Firebase emulators. Never deploy with that set.

## Data model (Firestore)
- `users/{uid}`: name, email, createdAt, xp, streak, longest, lastDate, graceDays (dewdrop balance), introSeen, plan (`order`|`year`), cursor (flat chapter index 0–1188), planStart (null until the year plan is first chosen), groupId, reminderOn, reminderHour, tz, badges[], weekKey, weekChapters, pushTokens[]
- `users/{uid}/days/{YYYY-MM-DD}`: date, chapters[{b, c, r (reflection), at}], grace (true when a dewdrop restored it), xp. A restored day may have only `date` and `grace`. One doc per day, in the reader's local time zone.
- `users/{uid}/meta/progress`: `read: { "bookIndex.chapter": "YYYY-MM-DD" }`. Book index is 0-based, so Genesis = 0 and Psalms = 18.
- `publicProfiles/{uid}`: name, groupId, streak, longest, xp, lastDate, weekKey, weekChapters, todayReads {date, list[{b, c}]}. This is the only data group members can see about each other. The rules check every field's type, because other members' screens draw it; the app also re-checks it (`validChapter`, `safeInt`) before drawing.
- `groups/{CODE}`: name, owner, members[], createdAt. CODE is 6 characters with no ambiguous letters or digits.
- `groups/{CODE}/feed/{id}`: uid, name, b, c, text, date, createdAt. Reflections appear here only if the reader opts in (sharing is checked by default).

## Game rules
- **Streak** is recalculated from the day docs on every load (`streakFrom` in logic.js). Days load in pages until the whole streak and any restorable gap are covered, so long streaks aren't cut off. The cached `streak` field is for display and the reminder function only, and isn't saved when the load came from the offline cache.
- **XP:** 15 per chapter, +5 for the first chapter of the day, and milestone bonuses of 7→50, 30→100, 100→200, 365→500.
- **Levels:** reaching level n+1 takes 25·n·(n+1) XP.
- **Dewdrops:** new users start with 1. One is earned at every 7-day multiple, up to 5. Spent only when the reader taps "Restore my streak" (see Decisions).
- **Badges (12):** first chapter; 7/30/100/365-day streaks; 100 chapters; first book; ten books; all Psalms; Hebrew Scriptures; Christian Greek Scriptures; all 1,189 chapters.
- **Bible in a year:** chapters from earlier plan days that haven't been read since the plan started show in a "Catching up" section (first 3, with a count). Switching back to the year plan asks whether to resume or restart.
- **Tree stages:** 0 days seed, 1 sprout, 3 sapling, 7 young tree, 30 full tree, 100 fruit-bearing.
- **Group weekly goal:** 5 chapters × member count, summed from publicProfiles where weekKey matches. Weeks start Monday.
- **Reminders:** sent at the reader's chosen hour in their own time zone if they haven't read that day, plus a 9 PM nudge if their streak is alive and today is still open. Invalid tokens are pruned automatically; the app re-registers its current token on every load (tokens rotate) and removes it on sign-out.

## Design system
- **Palette (light):** paper #EDF1EE, surface #FFFFFF, ink #1D2A27, water #2F5D6B (primary), leaf #6A8C3F, fruit #C9963B (XP/achievement accent), earth #C7BC9F, bark #6B5640. A dark-mode set is in styles.css.
- **Type:** Literata (serif) for headings, the streak number, reflections, and nudges. Figtree for UI text.
- **The tree is the one bold element.** Keep everything else quiet. Its leaves look faded until the reader reads that day, and a grow animation plays when the first chapter of the day is marked read. The animation respects reduced motion.
- **Copy:** sentence case, plain verbs, and JW-familiar terms ("Hebrew Scriptures," "Christian Greek Scriptures," "Jehovah").

## Status
- v1 is code-complete, plus a review pass (streak-safety fixes, security rules, dewdrops, first-run tour, group board). It hasn't been deployed against live Firebase yet. It has been run in a headless browser against the Firebase Auth and Firestore emulators: sign-up, reading, restoring a streak, groups, the year plan, and junk data from another member.
- Next step: the owner follows SETUP.md to create the Firebase project, deploy to Netlify, and fill in config.js and the environment variables. Expect some first-deploy debugging (authorized domains, VAPID key, private key newlines in the Netlify env var).

## Testing
- `npm test` runs the logic tests (Node 20+, no install needed). Run it after any change to logic.js or bible.js.
- After any change to firestore.rules, run test/rules.emulator.mjs and paste the new rules into the Firebase console.

## Known gaps and backlog
- **Before a public launch:** streak and XP math runs client-side, so a user could edit their own records through Firebase's tools. Move it to a server function or Cloud Function and tighten the rules on `users/`.
- **Remaining multi-device edge:** `longest`, `cursor` and `weekChapters` (when the week changes) are still written as plain values, so a phone working from very old offline data could set them back. Streaks themselves are safe because they come from day records.
- **Account deletion and data export:** needed for privacy and app store compliance.
- **Small gaps:** no UI to delete your own shared reflection (the rules already allow it); each user can be in only one group; the weekly goal isn't editable; there's no owner tooling (remove members, rename the group); the board shows what someone read regardless of the share checkbox (that checkbox only covers the reflection).
- **Possible deep links into JW Library:** right now links open jw.org's study-bible pages (`/en/library/bible/study-bible/books/{slug}/{chapter}/`).
- **Gamification ideas not yet built:** daily quests ("read a Psalm," "read 2 chapters").
- **Later:** a native app (Expo) for stronger notifications; the iPhone PWA only gets pushes once added to the Home Screen (iOS 16.4+).
- **English only** for now.

## Working with the owner
- Be direct, with no filler or preamble.
- Push back when something is a bad idea, explain why once, then go with the owner's final decision.
- The owner isn't a full-time developer. Give exact steps for anything she has to do in the Firebase or Netlify consoles.
