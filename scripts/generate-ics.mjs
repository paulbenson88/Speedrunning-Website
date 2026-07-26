import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const EVENTS_PATH = path.join(ROOT, "js", "events.js");
const MY_ICS_PATH = path.join(ROOT, "calendar.ics");
const OTHERS_ICS_PATH = path.join(ROOT, "calendar-others.ics");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function icsTimestamp(date) {
  return date.getUTCFullYear()
    + pad2(date.getUTCMonth() + 1)
    + pad2(date.getUTCDate()) + "T"
    + pad2(date.getUTCHours())
    + pad2(date.getUTCMinutes())
    + pad2(date.getUTCSeconds()) + "Z";
}

function durationMs(iso) {
  const m = String(iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 35 * 60 * 1000;
  return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function stableUid(rawUid) {
  return String(rawUid || "")
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 128);
}

async function loadBaseEvents() {
  const code = await fs.readFile(EVENTS_PATH, "utf8");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.__EVENTS__ = MARATHON_EVENTS;`, context, {
    filename: "events.js"
  });
  const events = context.__EVENTS__;
  if (!Array.isArray(events)) {
    throw new Error("Could not read MARATHON_EVENTS from js/events.js");
  }
  return events;
}

function normalizeSubmission(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (String(raw.submissionType || "").toLowerCase() === "vod-override") return null;

  if (raw.deleted === true || raw.isDeleted === true) return null;
  const status = String(raw.status || "").toLowerCase();
  if (["removed", "deleted", "rejected", "cancelled"].includes(status)) return null;

  const eventName = String(raw.eventName || "").trim();
  const gameName = String(raw.gameName || "").trim();
  const categoryName = String(raw.categoryName || "").trim();
  const runnerName = String(raw.runnerName || "").trim() || "Unknown Runner";

  const runDateIso = raw.runDateUtcIso
    ? String(raw.runDateUtcIso)
    : (raw.runDateLocal ? new Date(String(raw.runDateLocal)).toISOString() : "");

  if (!eventName || !gameName || !categoryName || !runDateIso) return null;

  const estimateMinutes = Math.max(1, Number(raw.estimateMinutes) || 35);
  const runnerType = String(raw.runnerType || "my-run").trim() || "my-run";
  const streamUrl = String(raw.streamUrl || "").trim();
  const scheduleUrl = String(raw.scheduleUrl || "").trim();
  const submissionKey = String(raw.submissionKey || "").trim();

  return {
    eventName,
    gameName,
    categoryName,
    runnerName,
    runDateIso,
    estimateMinutes,
    runnerType,
    streamUrl,
    scheduleUrl,
    submissionKey
  };
}

async function maybeLoadFirebaseSubmissions() {
  const serviceJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!serviceJson || !projectId) {
    return [];
  }

  let appMod;
  try {
    appMod = await import("firebase-admin/app");
  } catch {
    console.warn("firebase-admin is not available. Continuing without Firestore submissions.");
    return [];
  }

  const { initializeApp, cert, getApps } = appMod;
  const firestoreMod = await import("firebase-admin/firestore");
  const getFirestore = firestoreMod.getFirestore;

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceJson);
  } catch {
    console.warn("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Continuing without Firestore submissions.");
    return [];
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId
    });
  }

  const db = getFirestore();
  const snap = await db.collection("runSubmissions").get();

  const latestByStableKey = new Map();

  snap.forEach((doc) => {
    const raw = doc.data() || {};
    const normalized = normalizeSubmission(raw);
    if (!normalized) return;

    const stableKey = normalized.submissionKey
      ? `submission:${normalized.submissionKey}`
      : `run:${normalized.eventName}|${normalized.gameName}|${normalized.categoryName}|${normalized.runnerName}|${new Date(normalized.runDateIso).toISOString()}`;

    const updatedAtIso = String(raw.updatedAtIso || raw.submittedAtIso || "");
    const rank = Number.isFinite(Date.parse(updatedAtIso)) ? Date.parse(updatedAtIso) : 0;

    const prev = latestByStableKey.get(stableKey);
    if (!prev || rank >= prev.rank) {
      latestByStableKey.set(stableKey, { rank, value: normalized });
    }
  });

  return Array.from(latestByStableKey.values()).map((x) => x.value);
}

function baseRunsToFeedEvents(events) {
  const out = [];

  for (const ev of events) {
    for (const run of (ev.runs || [])) {
      const start = new Date(run.date);
      const end = new Date(start.getTime() + durationMs(run.estimate));
      const twitchUrl = ev.twitch ? `https://twitch.tv/${ev.twitch}` : "";
      out.push({
        uid: `run-${run.runId}@speedruncalendar`,
        start,
        end,
        summary: `${run.game} - ${ev.name}`,
        description: twitchUrl ? `Watch at: ${twitchUrl}` : ev.name,
        url: twitchUrl,
        location: twitchUrl,
        runnerType: "my-run"
      });
    }
  }

  return out;
}

function submissionToFeedEvent(s) {
  const start = new Date(s.runDateIso);
  const end = new Date(start.getTime() + s.estimateMinutes * 60 * 1000);
  const base = `${s.eventName}|${s.gameName}|${s.categoryName}|${s.runnerName}|${new Date(s.runDateIso).toISOString()}`;

  return {
    uid: `submission-${stableUid(s.submissionKey || base)}@speedruncalendar`,
    start,
    end,
    summary: `${s.gameName} - ${s.eventName}`,
    description: [
      `Category: ${s.categoryName}`,
      `Runner: ${s.runnerName}`,
      s.streamUrl ? `Watch at: ${s.streamUrl}` : "",
      s.scheduleUrl ? `Schedule: ${s.scheduleUrl}` : ""
    ].filter(Boolean).join("\\n"),
    url: s.streamUrl || s.scheduleUrl || "",
    location: s.streamUrl || "",
    runnerType: s.runnerType === "other-runner" ? "other-runner" : "my-run"
  };
}

function dedupeFeedEvents(events) {
  const byUid = new Map();
  events.forEach((ev) => {
    const dedupeKey = [
      ev.summary,
      ev.start.toISOString(),
      ev.runnerType
    ].join("|");

    const prev = byUid.get(dedupeKey);
    if (!prev) {
      byUid.set(dedupeKey, ev);
      return;
    }

    const prevScore = (prev.url ? 2 : 0) + (String(prev.description || "").length > 30 ? 1 : 0);
    const nextScore = (ev.url ? 2 : 0) + (String(ev.description || "").length > 30 ? 1 : 0);
    if (nextScore >= prevScore) {
      byUid.set(dedupeKey, ev);
    }
  });
  return Array.from(byUid.values()).sort((a, b) => a.start - b.start);
}

function keepUpcomingByEnd(events, now = new Date()) {
  const nowMs = now.getTime();
  return events.filter((ev) => {
    const endMs = ev?.end instanceof Date ? ev.end.getTime() : NaN;
    return Number.isFinite(endMs) && endMs >= nowMs;
  });
}

function buildCalendarText({ calendarName, description, events, now = new Date() }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//pbb8 Speedrun Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    `X-WR-CALDESC:${escapeIcs(description)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M"
  ];

  const dtstamp = icsTimestamp(now);

  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsTimestamp(ev.start)}`,
      `DTEND:${icsTimestamp(ev.end)}`,
      `SUMMARY:${escapeIcs(ev.summary)}`,
      `DESCRIPTION:${escapeIcs(ev.description)}`
    );

    if (ev.url) lines.push(`URL:${escapeIcs(ev.url)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcs(ev.location)}`);

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

async function main() {
  const baseEvents = await loadBaseEvents();
  const firebaseSubmissions = await maybeLoadFirebaseSubmissions();

  const feedBase = baseRunsToFeedEvents(baseEvents);
  const feedSubmitted = firebaseSubmissions.map(submissionToFeedEvent);

  const myRuns = dedupeFeedEvents([
    ...feedBase,
    ...feedSubmitted.filter((s) => s.runnerType !== "other-runner")
  ]);

  const otherRuns = keepUpcomingByEnd(
    dedupeFeedEvents(
      feedSubmitted.filter((s) => s.runnerType === "other-runner")
    )
  );

  const myIcs = buildCalendarText({
    calendarName: "pbb8's Speedrun Marathon Calendar",
    description: "Upcoming speedrun marathon runs by pbb8",
    events: myRuns
  });

  const otherIcs = buildCalendarText({
    calendarName: "pbb8 Games - Other Runners",
    description: "Other runners for games pbb8 runs",
    events: otherRuns
  });

  await fs.writeFile(MY_ICS_PATH, myIcs, "utf8");
  await fs.writeFile(OTHERS_ICS_PATH, otherIcs, "utf8");

  console.log(`Updated ${path.basename(MY_ICS_PATH)} with ${myRuns.length} event(s).`);
  console.log(`Updated ${path.basename(OTHERS_ICS_PATH)} with ${otherRuns.length} event(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
