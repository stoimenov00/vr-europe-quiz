# VR Journey Through Europe — Live Quiz (Kahoot-style)

A self-hosted live quiz: one **host screen** (projector) and students on their **phones**.
17 questions in Macedonian, speed-based scoring (500–1000 points per correct answer),
live scoreboard after every question, and a 🥇🥈🥉 podium at the end.

## How it works at the event

1. Open the site on the projector laptop → **Јас сум водител** → **Создади игра**.
2. Students scan the QR code (or open the site and type the 6-digit PIN), enter a name.
3. Press **Старт** (it stays grey until at least one student has joined, then shows the player count). Each question: timer (default 20 s) → results → scoreboard → next.
4. After the last question press **Победници** for the podium with the top 3.

Tips:
- Students answer on their phone by tapping the colour/shape (▲ red, ◆ blue, ● yellow, ■ green) that matches the answer on the big screen.
- If the host browser is refreshed or closed, just open the same link again — the game continues.
- If a student's phone reloads, they are automatically put back into the game with their score.
- Click a name in the lobby to remove a player (e.g. rude nickname).
- Only the host laptop should have the host page open.

**Live site:** https://vr-europe-quiz.netlify.app/ (also mirrored at https://stoimenov00.github.io/vr-europe-quiz/)

## Firebase (already connected)

The live sync uses the Firebase project `vr-europe-quiz` (Realtime Database, Belgium) in the stoimenov00 Google account.
The steps below are only needed if you ever want to recreate it in another account.

1. Go to https://console.firebase.google.com and click **Add project** (name it e.g. `vr-quiz`). Google Analytics can be turned off.
2. In the project, open **Build → Realtime Database → Create database**. Choose the Belgium (europe-west1) location and **Start in test mode**.
3. Open **Rules** and paste the rules below, then **Publish**:

```
{
  "rules": {
    "games": {
      "$pin": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

4. Click the gear → **Project settings** → scroll to **Your apps** → click the web icon `</>` → register the app (any nickname, no hosting) → copy the `firebaseConfig` values.
5. Put those values into `firebase-config.js` (apiKey, authDomain, databaseURL, projectId, appId) and redeploy. `databaseURL` must be present — it looks like `https://vr-quiz-xxxx-default-rtdb.europe-west1.firebasedatabase.app`.

## Local testing without Firebase

Open the site with `?local=1` (or on localhost). Everything then works inside one browser
(host and players in different tabs), which is enough to rehearse the flow.

## Files

- `index.html`, `style.css`, `app.js` — the app (no build step, plain static files)
- `questions.js` — the questions; edit the text or the `correct` indices here
- `firebase-config.js` — Firebase settings
- `store.js` — data layer (Firebase or local test mode)

## Hosting

Netlify project `vr-europe-quiz`, connected to this GitHub repo: every push to `main` redeploys automatically.
`netlify.toml` sets no build step and no-cache headers. GitHub Pages also serves the same files.
