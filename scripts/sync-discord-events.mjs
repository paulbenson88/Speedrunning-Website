import fs from "node:fs/promises";
import path from "node:path";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API = "https://discord.com/api/v10";
const ICS_PATH = path.join(process.cwd(), "calendar.ics");
const MARKER = "sr-sync:";
const MIN_LEAD_MS = 60 * 1000;

function unescapeIcs(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function parseIcsDate(v) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur?.uid && cur.start && cur.end && cur.summary) events.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const key = line.slice(0, i).split(";")[0];
      const val = line.slice(i + 1);
      if (key === "UID") cur.uid = val;
      else if (key === "DTSTART") cur.start = parseIcsDate(val);
      else if (key === "DTEND") cur.end = parseIcsDate(val);
      else if (key === "SUMMARY") cur.summary = unescapeIcs(val);
      else if (key === "DESCRIPTION") cur.description = unescapeIcs(val);
      else if (key === "LOCATION") cur.location = unescapeIcs(val);
      else if (key === "URL") cur.url = unescapeIcs(val);
    }
  }
  return events;
}

async function discord(method, route, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}${route}`, {
      method,
      headers: {
        Authorization: `Bot ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (speedrun-calendar-sync, 1.0)"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, (data.retry_after || 1) * 1000 + 100));
      continue;
    }
    if (!res.ok) {
      throw new Error(`${method} ${route} -> ${res.status} ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }
  throw new Error(`${method} ${route} rate limited too many times`);
}

function buildPayload(ev) {
  const location = (ev.location || ev.url || "https://twitch.tv/pbb8").slice(0, 100);
  const body = (ev.description || "").trim();
  const description = `${body}\n\n[${MARKER}${ev.uid}]`.slice(-1000);
  return {
    name: ev.summary.slice(0, 100),
    description,
    scheduled_start_time: ev.start.toISOString(),
    scheduled_end_time: ev.end.toISOString(),
    privacy_level: 2,
    entity_type: 3,
    entity_metadata: { location }
  };
}

function markerOf(discordEvent) {
  const m = String(discordEvent.description || "").match(/\[sr-sync:([^\]]+)\]/);
  return m ? m[1] : null;
}

function differs(existing, payload) {
  return existing.name !== payload.name
    || (existing.description || "") !== payload.description
    || new Date(existing.scheduled_start_time).getTime() !== new Date(payload.scheduled_start_time).getTime()
    || new Date(existing.scheduled_end_time).getTime() !== new Date(payload.scheduled_end_time).getTime()
    || (existing.entity_metadata?.location || "") !== payload.entity_metadata.location;
}

async function main() {
  if (!TOKEN || !GUILD_ID) {
    console.log("DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set. Skipping Discord sync.");
    return;
  }

  const now = Date.now();
  const wanted = parseIcs(await fs.readFile(ICS_PATH, "utf8"))
    .filter((ev) => ev.start.getTime() > now + MIN_LEAD_MS);
  const wantedByUid = new Map(wanted.map((ev) => [ev.uid, ev]));

  const existing = await discord("GET", `/guilds/${GUILD_ID}/scheduled-events`);
  const managed = new Map();
  for (const de of existing) {
    const uid = markerOf(de);
    // Status 1 = scheduled; never touch active/completed events.
    if (uid && de.status === 1) managed.set(uid, de);
  }

  let created = 0, updated = 0, deleted = 0;

  for (const [uid, ev] of wantedByUid) {
    const payload = buildPayload(ev);
    const de = managed.get(uid);
    if (!de) {
      await discord("POST", `/guilds/${GUILD_ID}/scheduled-events`, payload);
      created++;
    } else if (differs(de, payload)) {
      await discord("PATCH", `/guilds/${GUILD_ID}/scheduled-events/${de.id}`, payload);
      updated++;
    }
  }

  for (const [uid, de] of managed) {
    if (!wantedByUid.has(uid) && new Date(de.scheduled_start_time).getTime() > now) {
      await discord("DELETE", `/guilds/${GUILD_ID}/scheduled-events/${de.id}`);
      deleted++;
    }
  }

  console.log(`Discord sync: ${created} created, ${updated} updated, ${deleted} deleted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
