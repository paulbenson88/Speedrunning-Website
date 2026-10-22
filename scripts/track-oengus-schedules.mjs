import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fetchTextBestEffort, parseOengusLikeRuns } from "./scan-oengus.mjs";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_NOTIFICATION_CHANNEL_ID = process.env.DISCORD_NOTIFICATION_CHANNEL_ID;
const DISCORD_API = "https://discord.com/api/v10";
const INVALID_STATUSES = new Set(["removed", "deleted", "rejected", "cancelled"]);

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalOengusUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "oengus.io" && !hostname.endsWith(".oengus.io")) return "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return "";
  }
}

function submissionTime(raw) {
  for (const value of [raw.updatedAtIso, raw.submittedAtIso]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  for (const value of [raw.updatedAt, raw.submittedAt]) {
    if (value && typeof value.toDate === "function") {
      const parsed = value.toDate().getTime();
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function normalizeSubmission(raw) {
  if (!raw || typeof raw !== "object") return null;
  const scheduleUrl = canonicalOengusUrl(raw.scheduleUrl);
  const gameName = String(raw.gameName || "").trim();
  const categoryName = String(raw.categoryName || "").trim();
  const runnerName = String(raw.runnerName || "").trim() || "Unknown Runner";
  const runnerType = String(raw.runnerType || "my-run").trim() || "my-run";
  const eventName = String(raw.eventName || "").trim();
  const submittedDate = raw.runDateUtcIso || raw.runDateLocal;
  const runDateMs = Date.parse(String(submittedDate || ""));

  if (!scheduleUrl || !gameName || !categoryName || !Number.isFinite(runDateMs)) return null;

  const identity = [
    scheduleUrl,
    normalizeName(gameName),
    normalizeName(categoryName),
    normalizeName(runnerName)
  ].join("|");

  return {
    identity,
    scheduleUrl,
    gameName,
    categoryName,
    runnerName,
    eventName,
    runnerType,
    runDateIso: new Date(runDateMs).toISOString()
  };
}

export function findClosestRun(runs, gameName, categoryName, referenceDate, used = new Set()) {
  const game = normalizeName(gameName);
  const category = normalizeName(categoryName);
  const referenceMs = Date.parse(referenceDate);
  let best = null;

  runs.forEach((run, index) => {
    if (used.has(index)
      || normalizeName(run.game) !== game
      || normalizeName(run.category) !== category) return;

    const runMs = Date.parse(run.dateIso);
    if (!Number.isFinite(runMs)) return;
    const distance = Number.isFinite(referenceMs) ? Math.abs(runMs - referenceMs) : runMs;
    if (!best || distance < best.distance) {
      best = { run: { ...run, dateIso: new Date(runMs).toISOString() }, index, distance };
    }
  });

  return best;
}

function documentId(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadFirebase() {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_JSON are required for Oengus tracking.");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }

  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount), projectId: FIREBASE_PROJECT_ID });
  }
  return getFirestore();
}

async function loadSubmittedRuns(db) {
  const snapshot = await db.collection("runSubmissions").get();
  const latest = new Map();

  snapshot.forEach((doc) => {
    const raw = doc.data() || {};
    const normalized = normalizeSubmission(raw);
    if (!normalized) return;

    const current = latest.get(normalized.identity);
    const rank = submissionTime(raw);
    if (!current || rank > current.rank || (rank === current.rank && doc.id > current.docId)) {
      latest.set(normalized.identity, {
        rank,
        docId: doc.id,
        value: { ...normalized, active: !raw.deleted && !raw.isDeleted
          && !INVALID_STATUSES.has(String(raw.status || "").toLowerCase())
          && normalized.runnerType !== "other-runner" }
      });
    }
  });

  return Array.from(latest.values())
    .map((entry) => entry.value)
    .filter((submission) => submission.active)
    .map(({ active, ...submission }) => submission);
}

async function discordRequest(route, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${DISCORD_API}${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (speedrun-calendar-sync, 1.0)"
      },
      body: JSON.stringify(body)
    });

    if (response.status === 429) {
      const data = await response.json();
      await new Promise((resolve) => setTimeout(resolve, (Number(data.retry_after) || 1) * 1000 + 100));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Discord notification failed: HTTP ${response.status} ${await response.text()}`);
    }
    return;
  }

  throw new Error("Discord notification failed after repeated rate limits.");
}

function formatDate(value) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short"
  });
}

function changeMessage(change) {
  const label = `${change.gameName} - ${change.categoryName}`;
  if (change.changeType === "removed") {
    return `Oengus schedule update: ${label} (${change.runnerName}) is no longer listed.\n${change.scheduleUrl}`;
  }
  if (change.changeType === "restored") {
    return `Oengus schedule update: ${label} (${change.runnerName}) is listed again at ${formatDate(change.newDateIso)}.\n${change.scheduleUrl}`;
  }
  return `Oengus schedule time changed: ${label} (${change.runnerName})\nPrevious: ${formatDate(change.oldDateIso)}\nCurrent: ${formatDate(change.newDateIso)}\n${change.scheduleUrl}`;
}

async function deliverPendingNotifications(db) {
  const pending = await db.collection("oengusScheduleChanges")
    .where("notificationStatus", "==", "pending")
    .get();

  for (const doc of pending.docs) {
    await discordRequest(`/channels/${DISCORD_NOTIFICATION_CHANNEL_ID}/messages`, {
      content: changeMessage(doc.data()),
      allowed_mentions: { parse: [] }
    });
    await doc.ref.update({
      notificationStatus: "sent",
      notifiedAt: new Date().toISOString()
    });
    console.log(`Sent Discord notification for schedule change ${doc.id}.`);
  }
}

async function recordRunObservation(db, record, run) {
  const snapshotRef = db.collection("oengusScheduleSnapshots").doc(documentId(record.identity));
  const changeRef = db.collection("oengusScheduleChanges").doc(randomUUID());

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(snapshotRef);
    const previous = snapshot.exists ? snapshot.data() : null;
    const nextStatus = run ? "active" : "removed";
    let changeType = "";

    if (!previous) {
      if (!run) return "";
    } else if (previous.status === "removed" && run) {
      changeType = "restored";
    } else if (previous.status !== "removed" && !run) {
      changeType = "removed";
    } else if (run && previous.dateIso !== run.dateIso) {
      changeType = "time_changed";
    }

    const dateIso = run ? run.dateIso : previous.dateIso;
    const observedAt = new Date().toISOString();
    transaction.set(snapshotRef, {
      identity: record.identity,
      scheduleUrl: record.scheduleUrl,
      eventName: record.eventName,
      gameName: record.gameName,
      categoryName: record.categoryName,
      runnerName: record.runnerName,
      dateIso,
      status: nextStatus,
      lastObservedAt: observedAt
    });

    if (changeType) {
      transaction.create(changeRef, {
        changeType,
        scheduleUrl: record.scheduleUrl,
        eventName: record.eventName,
        gameName: record.gameName,
        categoryName: record.categoryName,
        runnerName: record.runnerName,
        oldDateIso: previous.dateIso || null,
        newDateIso: run ? run.dateIso : null,
        observedAt,
        notificationStatus: "pending"
      });
    }

    return changeType;
  });
}

async function trackSchedule(db, scheduleUrl, records) {
  const text = await fetchTextBestEffort(scheduleUrl);
  const slug = new URL(scheduleUrl).pathname.split("/").filter(Boolean)[1] || "Oengus marathon";
  const runs = parseOengusLikeRuns(text, slug);
  if (!runs.length) {
    throw new Error(`No runs could be parsed from Oengus schedule: ${scheduleUrl}`);
  }

  const snapshots = await Promise.all(records.map(async (record) => {
    const ref = db.collection("oengusScheduleSnapshots").doc(documentId(record.identity));
    const doc = await ref.get();
    return doc.exists ? doc.data() : null;
  }));
  const used = new Set();

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const previous = snapshots[index];
    const match = findClosestRun(
      runs,
      record.gameName,
      record.categoryName,
      previous?.dateIso || record.runDateIso,
      used
    );

    if (match) used.add(match.index);
    if (!match && !previous) {
      throw new Error(`Could not find submitted run "${record.gameName} - ${record.categoryName}" in ${scheduleUrl}.`);
    }
    const changeType = await recordRunObservation(db, record, match?.run || null);
    if (changeType) {
    if (changeType) {
    }
  }
  }
  console.log(`Checked ${records.length} submitted run(s) in ${scheduleUrl}.`);
  console.log(`Checked ${records.length} submitted run(s) in ${scheduleUrl}.`);
}

async function main() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_NOTIFICATION_CHANNEL_ID) {
    throw new Error("DISCORD_BOT_TOKEN and DISCORD_NOTIFICATION_CHANNEL_ID are required for Oengus change notifications.");
  }

  const db = await loadFirebase();
  const submittedRuns = await loadSubmittedRuns(db);
  const bySchedule = new Map();
  for (const run of submittedRuns) {
    const records = bySchedule.get(run.scheduleUrl) || [];
    records.push(run);
    bySchedule.set(run.scheduleUrl, records);
  }

  for (const [scheduleUrl, records] of bySchedule) {
    await trackSchedule(db, scheduleUrl, records);
  }
  await deliverPendingNotifications(db);

  console.log(`Oengus tracking complete: ${bySchedule.size} schedule(s), ${submittedRuns.length} run(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
