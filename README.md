# B215 Team Hub

Team website for **B215, 2026 Junior Jazz, 2nd Grade Boys** at the J.L. Sorenson Recreation Center.

- **Front end:** plain HTML, CSS and JS (`index.html`, `styles.css`, `app.js`, `config.js`), served as-is by GitHub Pages. There's no framework or build step.
- **Back end:** a Google Apps Script web app (`apps-script/Code.gs`) bound to a Google Sheet that holds the data.
- **No parent logins and no family form.** A parent taps **Bring treats** and picks their player. Their first claim gives them a 6-character treat code. Their browser remembers it, and they type it in to cancel or change their game from another device.
- **Coach tools** live at `index.html#coach` and need the coach code. That code is stored only in Apps Script's Script Properties, never in this repo.

## What parents can see

The public API (`GET`) returns only these:
- settings
- games
- roster
- who's bringing treats (player name only)
- the allergy list (player name and allergy text, entered by the coach)

The site collects no contact info. Treat codes come back only from the `coachData` action, and only with a valid coach code.

---

## 1. Set up the Google Sheet and Apps Script

1. Go to [sheets.new](https://sheets.new) and create a blank Google Sheet. Name it something like **B215 Team Hub Data**.
2. In the Sheet, open **Extensions → Apps Script**.
3. Delete the starter code in `Code.gs`, paste in the whole contents of [`apps-script/Code.gs`](apps-script/Code.gs), and click **Save** (💾).
   - **Roster:** player names aren't in this repo. If you have `apps-script/Roster.gs` on your computer, click **+ → Script** in Apps Script, name it `Roster`, paste it in, and save. Without that file, `setup()` leaves the Roster tab empty, and you add players in the coach view instead.
4. Set the time zone so "past game" checks use Utah time. Click **Project Settings** (⚙️ on the left) and set **Time zone** to *(GMT-07:00) Mountain Time – Denver*.
5. Add the coach code. Still in **Project Settings**, scroll to **Script Properties**, click **Add script property**, and enter:
   - Property: `COACH_CODE`
   - Value: a passphrase only you know, such as `jazz-b215-` followed by a few random words. Make it long, because anyone who has it can edit the schedule, roster and allergies, and see every family's treat code.

   Click **Save script properties**.
6. Run setup once. Go back to the **Editor** (`<>`), pick **`setup`** in the function dropdown on the toolbar, and click **Run**.
   - Google will ask you to authorize. Choose your account, then **Advanced → Go to (project name) (unsafe) → Allow**. The warning appears because you wrote the script yourself and Google hasn't reviewed it. It only gets access to this one spreadsheet.
   - When it's done, the Sheet has four tabs (**Settings**, **Games**, **Families**, **Roster**) seeded with the team info, all 7 games, both byes and the players from `Roster.gs`. **Families** stays empty until someone claims treats. Running `setup()` again won't overwrite anything. It only fills tabs that are empty.

## 2. Deploy the web app

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to **Select type** and choose **Web app**.
3. Fill in:
   - **Description:** `v1`
   - **Execute as:** **Me** (your account). The script reads and writes the Sheet as you.
   - **Who has access:** **Anyone**. This lets parents use it without a Google login. Anyone can reach the API, but it only gives out the public data listed above.
4. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
5. Optional check: open that URL in a browser. You should see JSON that starts with `{"ok":true,"data":{"settings":...`.

### Updating the script later

If you change `Code.gs`, use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. That keeps the **same URL**. If you choose **New deployment** instead, you get a new URL and will have to update `config.js`.

## 3. Point the site at the API

Open `config.js` and paste in the web app URL:

```js
window.TEAM_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfy.../exec"
};
```

This URL isn't a secret, so it's fine to commit. Commit and push this change.

## 4. Publish on GitHub Pages

1. Create a new repository on GitHub, for example `b215-team-hub`. **Public** is required for Pages on a free account. Nothing private lives in the repo, since all data stays in your Sheet.
2. Push this folder to it:

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/b215-team-hub.git
   ```

   ```bash
   git push -u origin main
   ```

3. On GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, then **Branch** to `main` and folder `/ (root)`. Click **Save**.
5. Wait about a minute and refresh. GitHub shows the site URL, which looks like `https://YOUR-USERNAME.github.io/b215-team-hub/`.

Share that URL with parents. The coach view is the same URL with `#coach` on the end.

## Using it

**Parents**
1. Tap **Bring treats** on a game and pick your player. Each family gets one game by default.
2. Write down the treat code that appears. That phone or computer remembers it, so you can **Cancel** there anytime.
3. On another device, tap **Enter your treat code** above the schedule. A family that already has a code is also asked for it when they tap **Bring treats**.

**Coach** (`…/#coach`)
- **Roster & allergies:** add, rename or remove players and type each player's allergies. Anything you enter shows on the public allergy board. Each family's treat code appears here once they've claimed a game, so you can read it to a parent who lost theirs.
- **Schedule rows:** **Clear treats** frees a slot and **Remove game** deletes a game. Both ask you to tap twice.
- **Add a game** and **Team details:** the welcome message, what to expect, treat limit per family and bye weeks.

The Sheet is the source of truth, and you can edit it directly too. Type dates as `2026-10-24` and times as `15:00` or `3:00 PM`.

## How it fits together

| Piece | Notes |
|---|---|
| `GET /exec` | Public JSON payload. |
| `POST /exec` | Body is JSON sent as `Content-Type: text/plain`, which avoids a CORS preflight. Actions: `claimTreat`, `releaseTreat`, `checkCode`, `coachData`, `saveSettings`, `saveRoster`, `addGame`, `removeGame`. |
| Locking | Every write runs inside `LockService`. `claimTreat` re-reads the game inside the lock, so two families can't claim the same slot at the same time. A treat code is only created once the claim is known to succeed. |
| Validation | All inputs are trimmed, stripped of control characters and length-capped on the server. Every text cell is written with a leading `'` so Sheets never runs it as a formula. |
| Rendering | All user text is rendered with `textContent`, never `innerHTML`. |
| Coach code | Wrong guesses are slowed down, and after 20 misses in 10 minutes the coach login locks for 10 minutes. |

## Local preview

You can open `index.html` directly, but it needs a real `API_URL` in `config.js` to show data. Until then it shows a "not connected" message.
