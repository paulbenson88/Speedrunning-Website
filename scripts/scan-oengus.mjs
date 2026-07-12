import fs from "node:fs/promises";

function extractEventSlug(scheduleUrl) {
  try {
    const u = new URL(scheduleUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname.includes("oengus.io")) {
      const ix = parts.indexOf("marathon");
      if (ix >= 0 && parts[ix + 1]) return parts[ix + 1];
    }
  } catch {
    return "";
  }
  return "";
}

async function fetchTextBestEffort(url) {
  const sources = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`
  ];

  let lastErr = null;
  for (const source of sources) {
    try {
      const response = await fetch(source, { method: "GET" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text && text.length > 10) return text;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("Unable to fetch schedule URL.");
}

function extractOengusMarathonUrl(scheduleUrl) {
  try {
    const u = new URL(scheduleUrl);
    if (!u.hostname.includes("oengus.io")) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    const ix = parts.indexOf("marathon");
    if (ix >= 0 && parts[ix + 1]) {
      return `${u.origin}/marathon/${parts[ix + 1]}`;
    }
  } catch {
    return "";
  }
  return "";
}

function extractFirstTwitchUrl(text) {
  const m = String(text || "").match(/https?:\/\/(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+(?:\?[^\s"'<)]*)?/i);
  return m ? m[0] : "";
}

async function fetchOengusMarathonTwitch(scheduleUrl) {
  const marathonUrl = extractOengusMarathonUrl(scheduleUrl);
  if (!marathonUrl) return "";
  try {
    const text = await fetchTextBestEffort(marathonUrl);
    return extractFirstTwitchUrl(text);
  } catch {
    return "";
  }
}

function parseOengusLikeRuns(text, fallbackEvent) {
  const runs = [];
  const src = String(text || "");
  const dateRegex = /"date"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;

  function unescapeJsonString(v) {
    return String(v || "")
      .replaceAll('\\"', '"')
      .replaceAll('\\/', '/')
      .replaceAll('\\n', ' ')
      .replaceAll('\\t', ' ')
      .trim();
  }

  function pickNearest(windowText, patterns) {
    for (const re of patterns) {
      const m = windowText.match(re);
      if (m && m[1]) return unescapeJsonString(m[1]);
    }
    return "";
  }

  const seen = new Set();
  let dateMatch;
  while ((dateMatch = dateRegex.exec(src)) !== null) {
    const dateIso = unescapeJsonString(dateMatch[1]);
    const index = dateMatch.index;
    const from = Math.max(0, index - 2200);
    const to = Math.min(src.length, index + 2200);
    const win = src.slice(from, to);

    const game = pickNearest(win, [
      /"game"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
      /"gameName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
      /"name"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"(?:category|categoryName)"/
    ]);

    const category = pickNearest(win, [
      /"category"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
      /"categoryName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/
    ]);

    const estimateText = pickNearest(win, [
      /"estimate"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
      /"estimateText"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/
    ]);

    if (!game || !category || !dateIso) continue;

    const key = `${game}|${category}|${dateIso}`;
    if (seen.has(key)) continue;
    seen.add(key);

    runs.push({
      eventName: fallbackEvent,
      game,
      category,
      dateIso,
      estimateText: estimateText || "00:35:00"
    });

    if (runs.length >= 250) break;
  }

  return runs;
}

async function main() {
  const scheduleUrl = process.argv[2];
  const gameFilter = process.argv[3] || "";

  if (!scheduleUrl) {
    console.error("Usage: node scripts/scan-oengus.mjs <scheduleUrl> [gameFilter]");
    process.exit(1);
  }

  const slug = extractEventSlug(scheduleUrl) || "Imported Marathon";
  const text = await fetchTextBestEffort(scheduleUrl);
  const twitch = await fetchOengusMarathonTwitch(scheduleUrl);
  let runs = parseOengusLikeRuns(text, slug);

  if (gameFilter) {
    const q = gameFilter.toLowerCase();
    runs = runs.filter((r) => String(r.game || "").toLowerCase().includes(q));
  }

  const out = {
    marathon: slug,
    scheduleUrl,
    twitch,
    count: runs.length,
    runs,
  };

  const outputPath = "scripts/.last-oengus-scan.json";
  await fs.writeFile(outputPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${runs.length} runs to ${outputPath}`);

  if (runs.length) {
    console.log("Sample:");
    runs.slice(0, 5).forEach((r, i) => {
      console.log(`${i + 1}. ${r.game} | ${r.category} | ${r.dateIso} | ${r.estimateText}`);
    });
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
