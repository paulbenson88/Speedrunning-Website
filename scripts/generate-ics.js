#!/usr/bin/env node
/**
 * generate-ics.js
 *
 * Reads MARATHON_EVENTS from js/events.js and writes calendar.ics
 * (and an empty-but-valid calendar-others.ics) to the repo root.
 *
 * Run manually:   node scripts/generate-ics.js
 * Run in CI:      triggered automatically by .github/workflows/update-ics.yml
 *                 whenever js/events.js is changed on the main branch.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

/* ── Load MARATHON_EVENTS from events.js ─────────────────────────────── */

const eventsFile = path.join(ROOT, "js", "events.js");
const src = fs
  .readFileSync(eventsFile, "utf8")
  // Replace `const MARATHON_EVENTS` with `var MARATHON_EVENTS` so that
  // vm.runInNewContext exposes it on the sandbox context object.
  .replace(/const\s+MARATHON_EVENTS/, "var MARATHON_EVENTS");

const sandbox = {};
vm.runInNewContext(src, sandbox);

const MARATHON_EVENTS = sandbox.MARATHON_EVENTS;

if (!Array.isArray(MARATHON_EVENTS)) {
  console.error("ERROR: Could not parse MARATHON_EVENTS from js/events.js");
  process.exit(1);
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Format a Date as an iCalendar UTC timestamp (YYYYMMDDTHHMMSSZ). */
function icsTimestamp(d) {
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

/** Parse ISO-8601 duration string to milliseconds. */
function durationMs(iso) {
  const m = String(iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
}

/**
 * Escape special characters for iCalendar property values.
 * Per RFC 5545 §3.3.11, backslash, semicolon, comma, and newline must be escaped.
 */
function escapeIcs(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a single iCalendar content line so that no line exceeds 75 octets
 * (RFC 5545 §3.1).  Folded lines use CRLF + a single space as the fold mark.
 *
 * Splitting is done character-by-character (Unicode code points) so that
 * multi-byte UTF-8 sequences are never broken mid-character.
 */
function foldLine(line) {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const parts = [];
  let chunk = "";
  let chunkBytes = 0;

  for (const char of line) {
    const charBytes = Buffer.byteLength(char, "utf8");
    // First segment: 75 octets; continuation segments: 74 octets (+ 1 leading space)
    const limit = parts.length === 0 ? 75 : 74;
    if (chunkBytes + charBytes > limit) {
      parts.push(chunk);
      chunk = char;
      chunkBytes = charBytes;
    } else {
      chunk += char;
      chunkBytes += charBytes;
    }
  }
  if (chunk) parts.push(chunk);

  return parts.join("\r\n ");
}

/* ── ICS generation ──────────────────────────────────────────────────── */

/**
 * Build an iCalendar (.ics) string for the given events array.
 *
 * @param {Array}  events   - Array in MARATHON_EVENTS format.
 * @param {string} calName  - X-WR-CALNAME value.
 * @param {string} calDesc  - X-WR-CALDESC value.
 * @returns {string} CRLF-terminated iCalendar text.
 */
function generateIcs(events, calName, calDesc) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//pbb8 Speedrun Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calName)}`,
    `X-WR-CALDESC:${escapeIcs(calDesc)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const ev of events) {
    const twitchUrl = ev.twitch
      ? `https://twitch.tv/${ev.twitch}`
      : ev.url || "";

    for (const run of ev.runs || []) {
      const start = new Date(run.date);
      const end = new Date(start.getTime() + durationMs(run.estimate));
      const uid = `run-${run.runId}@speedruncalendar`;
      const summary = escapeIcs(`${run.game} - ${ev.name}`);
      const description = escapeIcs(
        twitchUrl ? `Watch at: ${twitchUrl}` : ev.name
      );

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTART:${icsTimestamp(start)}`,
        `DTEND:${icsTimestamp(end)}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        `URL:${twitchUrl}`,
        "END:VEVENT"
      );
    }
  }

  lines.push("END:VCALENDAR");

  // Join with CRLF as required by RFC 5545, then fold long lines
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/* ── Write output files ──────────────────────────────────────────────── */

// calendar.ics — all events defined in events.js (pbb8's runs)
const myIcs = generateIcs(
  MARATHON_EVENTS,
  "pbb8's Speedrun Marathon Calendar",
  "Upcoming speedrun marathon runs by pbb8"
);
fs.writeFileSync(path.join(ROOT, "calendar.ics"), myIcs, "utf8");
console.log("✅  Written: calendar.ics");

// calendar-others.ics — other-runner submissions live in Firebase and
// cannot be included in a static file, so we emit a valid but empty feed.
// The feed structure and headers remain so that existing subscribers stay
// enrolled and will automatically receive entries once a server-side
// generation step (e.g. a Firebase Function) is added in the future.
const othersIcs = generateIcs(
  [],
  "pbb8 Games - Other Runners",
  "Other runners for games pbb8 runs"
);
fs.writeFileSync(path.join(ROOT, "calendar-others.ics"), othersIcs, "utf8");
console.log("✅  Written: calendar-others.ics");

console.log(
  `\nGenerated ${MARATHON_EVENTS.length} marathon(s) from js/events.js.`
);
