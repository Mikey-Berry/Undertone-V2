# Undertone setup

About 30 minutes, start to finish. You'll connect three things: Firebase (accounts and data), GitHub (holds the code), and Netlify (hosts the app and sends reminders). Everything here fits in the free tiers for a beta group.

## 1. Create the Firebase project
1. Go to console.firebase.google.com and click **Create a project**. Name it `undertone`. Google Analytics is optional; you can turn it off.
2. On the project home page, click the web icon (`</>`) to add a web app. Name it `Undertone`. Skip Firebase Hosting (Netlify does that).
3. Firebase shows a `firebaseConfig` block. Copy those six values into `public/config.js`, replacing each `PASTE_...` placeholder.

## 2. Turn on email sign-in
1. **Build → Authentication → Get started**.
2. **Sign-in method → Email/Password → Enable → Save.**
3. Later, after step 6, come back to **Settings → Authorized domains** and add your Netlify domain (for example `undertone.netlify.app`) and any custom domain.

## 3. Create the database
1. **Build → Firestore Database → Create database.**
2. Location: pick `asia-northeast1 (Tokyo)` if most of your group is in Japan, or the region closest to most readers. This can't be changed later.
3. Start in **production mode**.
4. Open the **Rules** tab, delete what's there, paste the full contents of `firestore.rules`, and click **Publish**.

## 4. Get the push-notification key
1. **Project settings (gear icon) → Cloud Messaging.**
2. Under **Web configuration → Web Push certificates**, click **Generate key pair**.
3. Copy the key into `vapidKey` in `public/config.js`.

## 5. Get the server key for reminders
1. **Project settings → Service accounts → Generate new private key.** A JSON file downloads.
2. Keep this file private. Never put it in GitHub or in the `public` folder.
3. You'll need three values from it in step 6: `project_id`, `client_email`, and `private_key`.

## 6. Deploy on Netlify
1. Create a new GitHub repository and upload the whole `undertone` folder (with your filled-in `config.js`).
2. In Netlify: **Add new site → Import an existing project → GitHub** and pick the repo. The build settings come from `netlify.toml`, so leave them as they are. Click **Deploy**.
3. **Site configuration → Environment variables**, add:
   - `FIREBASE_PROJECT_ID` = `project_id` from the JSON
   - `FIREBASE_CLIENT_EMAIL` = `client_email`
   - `FIREBASE_PRIVATE_KEY` = `private_key`, pasted exactly as it appears, including `-----BEGIN PRIVATE KEY-----` and the `\n` characters
4. **Deploys → Trigger deploy** so the function picks up the variables.
5. Check **Functions** (or **Logs → Functions**): you should see `reminders` listed as scheduled, running hourly.
6. Go back to step 2.3 and add the Netlify domain to Firebase's authorized domains.

## 7. Test it
1. Open the site on your phone and create an account.
2. Install it:
   - **Android (Chrome):** menu (⋮) → **Add to Home screen** or **Install app**.
   - **iPhone (Safari):** Share → **Add to Home Screen**. Reminders on iPhone only work from the installed app (iOS 16.4 or later).
3. Open the installed app → Settings → turn on the daily reminder.
4. To test a reminder right away, set the time to the next hour and wait, or open the function in Netlify and click **Run now** once its hour matches.
5. Group: create a group under the Group tab and tap **Invite**. The link includes the code, so friends join automatically after signing up.

## How the pieces fit
- `public/` is the app itself. `config.js` is the only file you edit.
- `firestore.rules` keeps each person's data private. Group members see only each other's name, streak, and the reflections they chose to share.
- `netlify/functions/reminders.mjs` runs every hour, checks each reader's local time, and sends a reminder only to people who haven't read yet that day. If someone's streak is still open at 9 PM their time, it sends one more.

## Updating the app
Push changes to GitHub and Netlify redeploys automatically. If you change `firebase-messaging-sw.js`, bump the number in `CACHE = 'undertone-v2'` (to `v3`, and so on) so phones pick up the new version.

If `firestore.rules` changes, it doesn't deploy by itself: open **Firestore Database → Rules** in the Firebase console, replace everything with the new file's contents, and click **Publish**.

## Things to know for the beta
- **Streak safety:** every reading day is saved as its own record, and the streak is recalculated from those records each time the app opens. Readings made offline save on the phone and sync when it reconnects.
- **Dewdrops:** everyone starts with one, earns another every 7 days in a row, and can hold up to 5. If someone misses days, the Today screen offers to spend one per missed day to restore the streak. It's their choice, and it needs an internet connection. A short tour explains this the first time someone signs in.
- **Day boundaries** follow each reader's own time zone, so a reading at 11:50 PM counts for that day.
- **Honor system limits:** someone could technically edit their own records through Firebase's tools. That's fine for a group of friends; for a public launch, the next step would be moving streak math to a server function.
