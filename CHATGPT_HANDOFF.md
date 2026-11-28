# ChatGPT Handoff: pbb8 Speedrun Hub

This guide is an operating and maintenance handoff for `https://www.pbb8.tv/`.
It is based on the checked-in site and automation code; it does not grant access
to the owner's accounts, Firebase, GitHub, Discord, or any browser sessions.

## Instructions for a future ChatGPT

Act as a careful site operator and maintainer. First identify whether the
requested work is a live content update, a calendar/run update, or a code change.
Use the existing owner tools for ordinary content changes and the repository for
structural changes. Verify the result in the relevant page or generated feed.

- Never ask for passwords, sign-in codes, Firebase service-account JSON, Discord
  tokens, or other credentials. Ask the owner to sign in through the existing
  Google owner flow when needed.
- Do not claim an update is public until the relevant save or publish succeeds.
  Distinguish Firebase-backed changes from browser-local fallback data.
- Before editing or publishing code, inspect `git status` and preserve existing
  work. Do not overwrite or publish unrelated local changes.
- Confirm with the owner before deleting data, changing access rules, or
  triggering actions that could remove or send Discord events/messages.
- Prefer the website's owner UI for supported edits. Update source files only
  when the UI cannot perform the requested change.
- Never put credentials or private account identifiers in this guide, source
  control, prompts, or messages.

## Site map

- **Home:** `https://www.pbb8.tv/` — profile, social links, game cards, and
  marathon history. Owner-only homepage editor is available from the subtle
  **Edit site** control in the header.
- **Calendar:** `https://www.pbb8.tv/calendar/` — upcoming runs, monthly
  calendar, commentator assignments, and calendar subscriptions/exports.
- **Previous Runs:** `https://www.pbb8.tv/runs/` — VOD cards and game filter.
- **Submit Updates:** `https://www.pbb8.tv/submit/` — owner-only forms for new
  marathon runs and VOD updates.

The site is mostly static HTML/CSS/JavaScript. Firebase Auth and Firestore
provide owner sign-in and shared content; GitHub Actions refresh calendar feeds
and run schedule notifications.

## Sign-in and permissions

The owner tools use Google sign-in. Being signed in is not enough: the account
must be on the owner allowlist in both `js/firebase-config.js` and
`firestore.rules`. Do not change either allowlist to bypass access controls.
Homepage publishing also depends on the deployed Firestore rules. If a valid
owner cannot save, report the exact error and check Firebase configuration,
rules, and deployment rather than claiming success.

Public pages can read several Firestore collections. Writes are owner-restricted
by Firestore rules. The web Firebase config is client-side configuration, not a
service-account credential. Server-side automation secrets belong only in
GitHub Actions secrets or a secure local environment; never copy them into the
repository or this handoff.

## Operating procedures

### Add or update a scheduled run

1. Open `/submit/` and sign in with the approved owner Google account.
2. In **New Marathon Run**, choose **My run** or **Other runner**.
3. Optionally paste an Oengus or Horaro schedule URL and use **Fetch Runs**.
   Review the parsed results, select the correct run, then choose
   **Use Selected Run**. Auto-import is best-effort; verify every field.
4. Enter/confirm runner, event, game, category, scheduled start in the
   browser's local time zone, estimate in minutes, and optional stream/schedule
   URLs and notes.
5. Choose **Submit to Website**. A Firebase success is the shared submission;
   the code also saves a browser-local copy. If the page reports local-only
   save or Firebase failure, it is not confirmed as a shared/public update.
6. Verify the run on `/calendar/`. Check the local-time display and event links.

Submitted runs are stored in Firestore `runSubmissions` and are merged into the
calendar. Other-runner entries appear separately under **Other Runners (Games I
Run)**. Generated calendar feeds read Firestore submissions, not another
browser's local storage.

If the form's success redirect does not work, open `/calendar/` manually. The
current submit script redirects to `calendar.html`, but this checkout contains
the calendar at `calendar/index.html`.

To add/edit a base marathon event that is not an owner submission, edit
`js/events.js`. Preserve the existing schema, keep event/run dates as ISO-8601
UTC strings (the browser renders them in each viewer's local time), and include
the event name, start/end, schedule/stream links where known, and each run's
game, category, estimate, date, and stable `runId`. Avoid adding the same run
through both the base event list and Firestore submission path.

### Add or change a Previous Runs VOD

1. Open `/runs/` and sign in as the owner.
2. Use **Add/Edit VOD** on the relevant run card.
3. Paste a full YouTube or Twitch VOD URL. Leave it blank to restore the
   original VOD card.
4. Verify the embed and fallback link on the card.

VOD overrides are written as `vod-override` records in `runSubmissions`; they
are excluded from calendar run rendering. New historical run cards and their
original embeds are maintained in `runs/index.html`. Do not assume that
submitting the separate VOD form on `/submit/` updates a Previous Runs card:
that form writes to `vodSubmissions`, and this checkout has no reader for that
collection.

The current checkout may contain unpublished work in progress. Inspect `git
status` before relying on any recently added editing control or treating it as
available on the live site.

### Edit homepage content and layout

1. Open `/`, use **Edit site**, and sign in if prompted.
2. Edit supported text inline or through the editor fields; update only valid
   `http`/`https` links.
3. Reorder sections in the layout list (drag/drop or arrows). Resize/position
   controls are also available; section positioning applies on wider viewports.
4. Use **Preview page** to inspect the draft. Return to the editor to continue.
5. Use **Discard draft** to revert unpublished changes, or **Publish changes**
   to write the homepage state to Firestore `siteContent/homepage`.
6. Verify the published homepage after a successful publish.

Text, links, layout, sizing, offsets, and padding are stored in Firestore; this
does not require a GitHub Pages deployment. Do not use the code editor for
ordinary copy/layout changes that the owner UI supports.

### Manage commentators

1. On `/calendar/`, open a run's details and choose **Commentators**.
2. Add a name or select a suggested commentator saved for that game.
3. Set the status to **Not Asked**, **Asked**, **Confirmed**, or **Declined**.
   Rename or remove an entry using its row controls.
4. Verify the run's commentator indicator after the change.

Commentator assignments and reusable per-game suggestions are stored locally
and synchronized to Firestore `commentatorData/global` for the owner. Confirm
that Firebase sync succeeded before assuming another device will see the
change. Names/statuses are not credentials; use only appropriate information.

### Calendar subscriptions and exports

On `/calendar/`, visitors can export all runs as an `.ics` file or subscribe to
**My Runs** and **Other Runners** feeds. The feeds are root files
`calendar.ics` and `calendar-others.ics`. Feed files are generated; do not
hand-edit them. The subscribe modal gives Apple, Google, Outlook, and generic
calendar instructions. Submitted-run times and calendar display are localized
by the browser; stored source times are UTC.

## Code and data sources

| Purpose | Source of truth |
| --- | --- |
| Base marathon and run schedule | `js/events.js` (`MARATHON_EVENTS`) |
| Homepage structure/default content | `index.html` |
| Published homepage copy/layout | Firestore `siteContent/homepage` |
| Historical VOD cards | `runs/index.html` plus Firestore VOD overrides |
| Submitted runs | Firestore `runSubmissions` |
| VOD form submissions | Firestore `vodSubmissions` (no consumer found in this checkout) |
| Previous-run metadata edits | Firestore `runEntryEdits` (verify feature is deployed before using) |
| Commentators | Firestore `commentatorData/global` and owner local storage |
| Calendar feeds | Generated `calendar.ics`, `calendar-others.ics` |
| Firebase web settings/owner allowlist | `js/firebase-config.js` and `firestore.rules` |

Important code locations:

- `js/owner-auth.js` — Google authentication and owner-state checks.
- `js/site-editor.js` — homepage editor and Firestore publishing.
- `js/submit.js` — run/VOD forms, schedule import, and submission storage.
- `js/firebase-calendar.js` — reads shared run submissions into the calendar.
- `js/commentators.js` and `js/calendar.js` — commentator and calendar UI.
- `runs/index.html` — Previous Runs cards, VOD overrides, filtering, and embeds.
- `scripts/generate-ics.mjs` — builds both calendar feed files.
- `scripts/sync-discord-events.mjs` — creates/updates/removes mapped future
  Discord scheduled events based on `calendar.ics`.
- `scripts/track-oengus-schedules.mjs` — detects Oengus schedule changes and
  queues/sends Discord notifications.
- `.github/workflows/update-calendars.yml` — scheduled/push automation.

## Deployment and automation

The custom domain is recorded in `CNAME` as `www.pbb8.tv`. The repository is
served as a static site; verify the repository's GitHub Pages settings and
deployment status for actual publishing configuration. The checked-in workflow
does not build the website; it regenerates feeds and runs Discord/Oengus
automation.

The **Update Calendar Feeds** GitHub Actions workflow runs every 15 minutes,
can be manually dispatched, and also runs on selected `main`-branch changes.
Its feed job reads base events plus Firebase submissions, writes the two `.ics`
files, synchronizes future Discord scheduled events, then commits changed feed
artifacts. Its Oengus job checks relevant Oengus schedules and can notify a
Discord channel when a run is moved or removed. It requires configured GitHub
Actions secrets. Do not run these workflows or edit secrets casually: Discord
sync can delete mapped future scheduled events that are no longer in the feed.

When changing base schedule source, inspect the workflow path filters to see
whether it will refresh automatically. Feed files are artifacts of
`scripts/generate-ics.mjs`, not the canonical event list.

## Development and verification

There is no frontend build step or framework. Use Node.js 20 for repository
scripts; `firebase-admin` is the declared dependency.

```powershell
npm install
npm run generate:ics
npm run sync:discord
npm run track:oengus
node --test scripts/track-oengus-schedules.test.mjs
```

The automation commands that access Firebase or Discord require their
corresponding environment variables. Do not run them against production merely
to test a code change. The Discord sync expects an up-to-date `calendar.ics`;
the GitHub Actions workflow runs feed generation before Discord sync. For
ordinary code edits, inspect the diff and run the focused test above when the
Oengus tracker is changed. Verify relevant HTML routes and browser behavior for
front-end changes.

## Known caveats

- Schedule auto-import is heuristic and may fail because an upstream page or
  cross-origin fetch is unavailable. Manually verify or enter run details.
- A local-only submission is not equivalent to a Firestore-backed submission
  and will not feed to the public site or generated feeds for other visitors.
- `/submit/` VOD entries currently go into `vodSubmissions`; the Previous Runs
  page's **Add/Edit VOD** uses a separate override path.
- The submit page redirects to `calendar.html`, but the checked-in calendar
  route is `/calendar/`.
- Calendar feed contents and Discord scheduled events are automated. Check
  workflow run logs before diagnosing a stale feed or missing Discord event.
- Source code, published Firebase content, and the live site can differ.
  Confirm which environment is being changed and verify the resulting state.
