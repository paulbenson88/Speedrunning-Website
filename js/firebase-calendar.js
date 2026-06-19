(function () {
  "use strict";

  const LOCAL_RUNS_KEY = "speedrun-local-run-submissions";
  const submissionLookup = new Map();

  function toIsoDuration(minutes) {
    const mins = Math.max(1, Number(minutes) || 35);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `PT${h}H${m}M`;
    if (h) return `PT${h}H`;
    return `PT${m}M`;
  }

  function parseTwitchChannel(streamUrl) {
    if (!streamUrl) return "";
    try {
      const u = new URL(streamUrl);
      if (!u.hostname.includes("twitch.tv")) return "";
      const seg = u.pathname.split("/").filter(Boolean)[0] || "";
      if (!seg || seg.toLowerCase() === "videos") return "";
      return seg;
    } catch {
      return "";
    }
  }

  function durationMs(iso) {
    const m = String(iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 35 * 60 * 1000;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
  }

  function normalizeRun(raw, source) {
    if (!raw) return null;
    if (String(raw.submissionType || "").toLowerCase() === "vod-override") return null;

    const eventName = String(raw.eventName || "Submitted Marathon").trim();
    const gameName = String(raw.gameName || "Unknown Game").trim();
    const categoryName = String(raw.categoryName || "Any%").trim();
    const runnerName = String(raw.runnerName || "Unknown Runner").trim();

    const runDateIso = raw.runDateUtcIso
      ? String(raw.runDateUtcIso)
      : (raw.runDateLocal ? new Date(String(raw.runDateLocal)).toISOString() : "");

    if (!runDateIso) return null;

    const estimateMinutes = Number(raw.estimateMinutes || 35);
    const estimateIso = toIsoDuration(estimateMinutes);

    return {
      source,
      runnerType: String(raw.runnerType || "my-run"),
      submissionKey: String(raw.submissionKey || ""),
      eventName,
      gameName,
      categoryName,
      runnerName,
      runDateIso,
      estimateIso,
      scheduleUrl: String(raw.scheduleUrl || "").trim(),
      streamUrl: String(raw.streamUrl || "").trim(),
      key: `${eventName}|${gameName}|${categoryName}|${runnerName}|${runDateIso}`
    };
  }

  function createSubmissionKey() {
    return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function getLocalSubmissionsRaw() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_RUNS_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveLocalSubmissionsRaw(list) {
    try {
      localStorage.setItem(LOCAL_RUNS_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  function updateLocalSubmission(submissionKey, localKey, updates) {
    const list = getLocalSubmissionsRaw();
    let idx = -1;
    if (submissionKey) {
      idx = list.findIndex((item) => String(item.submissionKey || "") === String(submissionKey));
    }
    if (idx < 0 && localKey) {
      idx = list.findIndex((item) => {
        const n = normalizeRun(item, "local");
        return n && n.key === localKey;
      });
    }
    if (idx < 0) return false;
    const existing = list[idx] || {};
    list[idx] = {
      ...existing,
      ...updates,
      submissionKey: String(existing.submissionKey || submissionKey || createSubmissionKey())
    };
    saveLocalSubmissionsRaw(list);
    return true;
  }

  function estimateMinutesFromIso(iso) {
    const m = String(iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 35;
    return Math.max(1, Math.round((+m[1] || 0) * 60 + (+m[2] || 0) + (+m[3] || 0) / 60));
  }

  function toLocalInputValue(dateLike) {
    const dt = new Date(dateLike);
    if (Number.isNaN(dt.getTime())) return "";
    return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function buildSeedFromEventRun(evIdx, runIdx) {
    const ev = (window.MARATHON_EVENTS || [])[Number(evIdx)];
    if (!ev) return null;
    const run = (ev.runs || [])[Number(runIdx)];
    if (!run) return null;

    return {
      runnerType: "my-run",
      runnerName: String(run.runner || "pbb8"),
      eventName: String(ev.name || ""),
      gameName: String(run.game || ""),
      categoryName: String(run.category || ""),
      runDateLocal: toLocalInputValue(run.date),
      runDateUtcIso: new Date(run.date).toISOString(),
      estimateMinutes: estimateMinutesFromIso(run.estimate),
      streamUrl: ev.twitch ? `https://twitch.tv/${ev.twitch}` : "",
      scheduleUrl: String(ev.url || ""),
      notes: "",
      submissionKey: ""
    };
  }

  function upsertLocalSubmission(submissionKey, localKey, baseItem, updates) {
    const list = getLocalSubmissionsRaw();
    let idx = -1;

    if (submissionKey) {
      idx = list.findIndex((item) => String(item.submissionKey || "") === String(submissionKey));
    }
    if (idx < 0 && localKey) {
      idx = list.findIndex((item) => {
        const n = normalizeRun(item, "local");
        return n && n.key === localKey;
      });
    }

    if (idx >= 0) {
      const existing = list[idx] || {};
      list[idx] = {
        ...existing,
        ...updates,
        submissionKey: String(existing.submissionKey || submissionKey || createSubmissionKey())
      };
    } else {
      list.push({
        ...baseItem,
        ...updates,
        submissionKey: String(submissionKey || createSubmissionKey()),
        status: "new",
        submittedAtIso: new Date().toISOString()
      });
    }

    saveLocalSubmissionsRaw(list);
    return true;
  }

  function loadLocalSubmissions() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_RUNS_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.map((item) => normalizeRun(item, "local")).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function loadFirestoreSubmissions() {
    try {
      if (!window.firebase) return [];
      const cfg = window.FIREBASE_CONFIG || {};
      if (!cfg.apiKey || !cfg.projectId || !cfg.appId) return [];

      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      const db = app.firestore();
      const snap = await db.collection("runSubmissions").get();

      return snap.docs
        .map((doc) => normalizeRun(doc.data(), "firebase"))
        .filter(Boolean);
    } catch (err) {
      console.warn("Could not load Firestore submissions.", err);
      return [];
    }
  }

  function existingRunKeys() {
    const keys = new Set();
    for (const ev of (window.MARATHON_EVENTS || [])) {
      for (const run of (ev.runs || [])) {
        const k = `${ev.name}|${run.game}|${run.category}|${String(run.runner || "")}|${new Date(run.date).toISOString()}`;
        keys.add(k);
      }
    }
    return keys;
  }

  function injectSubmissionsIntoMarathons(submissions) {
    if (!Array.isArray(window.MARATHON_EVENTS)) return;

    const keySet = existingRunKeys();

    submissions.forEach((s) => {
      const dedupeKey = `${s.eventName}|${s.gameName}|${s.categoryName}|${s.runnerName}|${new Date(s.runDateIso).toISOString()}`;
      if (keySet.has(dedupeKey)) {
        // Backfill missing twitch/url on the existing marathon entry from the submission.
        const existing = window.MARATHON_EVENTS.find((ev) => ev.name === s.eventName);
        if (existing) {
          if (!existing.twitch && s.streamUrl) existing.twitch = parseTwitchChannel(s.streamUrl);
          if (!existing.url && s.scheduleUrl) existing.url = s.scheduleUrl;
        }
        return;
      }

      const runId = `submitted-${btoa(unescape(encodeURIComponent(dedupeKey))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;

      const start = new Date(s.runDateIso);
      const end = new Date(start.getTime() + durationMs(s.estimateIso));

      const ev = {
        name: s.eventName,
        start: start.toISOString(),
        end: end.toISOString(),
        twitch: parseTwitchChannel(s.streamUrl),
        _submissionKey: s.submissionKey,
        url: s.scheduleUrl || "",
        runs: [
          {
            game: s.gameName,
            category: s.categoryName,
            console: "TBD",
            estimate: s.estimateIso,
            date: start.toISOString(),
            runId,
            runner: s.runnerName,
            submissionKey: s.submissionKey,
            localKey: s.key
          }
        ]
      };

      window.MARATHON_EVENTS.push(ev);
      keySet.add(dedupeKey);
    });
  }

  function fmtShortDate(date) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function fmtTime(date) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    });
  }

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

  function escapeIcs(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function googleCalUrlForSubmission(s) {
    const start = new Date(s.runDateIso);
    const end = new Date(start.getTime() + durationMs(s.estimateIso));
    const dates = `${icsTimestamp(start)}/${icsTimestamp(end)}`;
    const text = `${s.gameName} (${s.categoryName}) - ${s.eventName}`;
    const details = `Runner: ${s.runnerName}`;
    const location = s.streamUrl || "";
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(text)}&dates=${dates}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
  }

  function outlookCalUrlForSubmission(s) {
    const start = new Date(s.runDateIso);
    const end = new Date(start.getTime() + durationMs(s.estimateIso));
    const subject = `${s.gameName} (${s.categoryName}) - ${s.eventName}`;
    const body = `Runner: ${s.runnerName}`;
    return `https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=${encodeURIComponent(subject)}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&body=${encodeURIComponent(body)}&location=${encodeURIComponent(s.streamUrl || "")}`;
  }

  function yahooCalUrlForSubmission(s) {
    const start = new Date(s.runDateIso);
    const durMin = Math.max(1, Math.round(durationMs(s.estimateIso) / 60000));
    const durHours = Math.floor(durMin / 60);
    const durMins = durMin % 60;
    const dur = `${pad2(durHours)}${pad2(durMins)}`;
    const title = `${s.gameName} (${s.categoryName}) - ${s.eventName}`;
    return `https://calendar.yahoo.com/?v=60&view=d&type=20&title=${encodeURIComponent(title)}&st=${icsTimestamp(start)}&dur=${dur}&desc=${encodeURIComponent(`Runner: ${s.runnerName}`)}&in_loc=${encodeURIComponent(s.streamUrl || "")}`;
  }

  function exportSubmissionICS(s) {
    const start = new Date(s.runDateIso);
    const end = new Date(start.getTime() + durationMs(s.estimateIso));
    const uid = `run-${btoa(unescape(encodeURIComponent(s.key))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}@pbb8`;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//pbb8//Speedrun Calendar//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${icsTimestamp(new Date())}`,
      `DTSTART:${icsTimestamp(start)}`,
      `DTEND:${icsTimestamp(end)}`,
      `SUMMARY:${escapeIcs(`${s.gameName} (${s.categoryName}) - ${s.eventName}`)}`,
      `DESCRIPTION:${escapeIcs(`Runner: ${s.runnerName}`)}`,
      `LOCATION:${escapeIcs(s.streamUrl || "")}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ];

    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${s.gameName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "run"}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function submissionCalDropdownHTML(s) {
    const key = encodeURIComponent(s.key);
    return `
      <div class="submission-cal-wrap">
        <button class="submission-add-to-cal-btn" type="button" aria-haspopup="menu" aria-expanded="false">📅 Add to Calendar ▾</button>
        <div class="submission-cal-dropdown" role="menu">
          <button class="submission-cal-item" data-service="google" data-local-key="${key}">Google</button>
          <button class="submission-cal-item" data-service="outlook" data-local-key="${key}">Outlook</button>
          <button class="submission-cal-item" data-service="yahoo" data-local-key="${key}">Yahoo</button>
          <button class="submission-cal-item" data-service="ics" data-local-key="${key}">Apple / Other (.ics)</button>
        </div>
      </div>
    `;
  }

  function renderFallbackUpcoming(submissions) {
    const list = document.getElementById("upcoming-list");
    if (!list || !submissions.length) return;

    const now = new Date();
    const existingText = list.textContent || "";
    const missing = submissions.filter((s) => {
      if (existingText.includes(s.eventName)) return false;
      // Don't show runs whose estimated end time has already passed.
      const start = new Date(s.runDateIso);
      const end = new Date(start.getTime() + durationMs(s.estimateIso));
      return end >= now;
    });
    if (!missing.length) return;

    missing
      .sort((a, b) => new Date(a.runDateIso) - new Date(b.runDateIso))
      .forEach((s) => {
        submissionLookup.set(s.key, s);
        const li = document.createElement("li");
        const start = new Date(s.runDateIso);
        const end = new Date(start.getTime() + durationMs(s.estimateIso));
        const twitch = parseTwitchChannel(s.streamUrl);
        const twitchHtml = twitch
          ? `<a class="twitch-link" href="https://twitch.tv/${twitch}" target="_blank" rel="noopener"><span class="twitch-icon">&#9656;</span> twitch.tv/${twitch}</a>`
          : "";
        const scheduleHtml = s.scheduleUrl
          ? `<a class="schedule-link" href="${s.scheduleUrl}" target="_blank" rel="noopener">📋 Full Schedule</a>`
          : "";

        li.innerHTML = `
          <span class="event-name">${s.eventName}</span>
          ${twitchHtml}
          ${scheduleHtml}
          <div class="runs-section">
            <div class="run-card has-edit">
              <button class="submission-edit-btn" data-submission-key="${s.submissionKey || ""}" data-local-key="${encodeURIComponent(s.key)}" title="Edit submission">✏️ Edit</button>
              <div class="run-info">
                <span class="run-game">${s.gameName}</span>
                <span class="run-time">${fmtShortDate(start)} ${fmtTime(start)} <span class="tz-note">(shown in your local timezone)</span></span>
              </div>
              <div class="run-actions">
                ${submissionCalDropdownHTML(s)}
              </div>
            </div>
          </div>
        `;
        list.appendChild(li);
      });
  }

  function renderOtherRunners(submissions) {
    const list = document.getElementById("other-runners-list");
    if (!list) return;

    const now = new Date();
    const upcoming = submissions.filter((s) => {
      const start = new Date(s.runDateIso);
      if (Number.isNaN(start.getTime())) return false;
      const end = new Date(start.getTime() + durationMs(s.estimateIso));
      return end >= now;
    });

    if (!upcoming.length) {
      list.innerHTML = "<li>No other-runner submissions yet.</li>";
      return;
    }

    list.innerHTML = "";

    upcoming
      .sort((a, b) => new Date(a.runDateIso) - new Date(b.runDateIso))
      .slice(0, 20)
      .forEach((s) => {
        submissionLookup.set(s.key, s);
        const li = document.createElement("li");
        const start = new Date(s.runDateIso);
        const twitch = parseTwitchChannel(s.streamUrl);
        const twitchHtml = twitch
          ? `<a class="twitch-link" href="https://twitch.tv/${twitch}" target="_blank" rel="noopener"><span class="twitch-icon">&#9656;</span> twitch.tv/${twitch}</a>`
          : "";
        const scheduleHtml = s.scheduleUrl
          ? `<a class="schedule-link" href="${s.scheduleUrl}" target="_blank" rel="noopener">📋 Full Schedule</a>`
          : "";

        li.innerHTML = `
          <span class="event-name">${s.eventName}</span>
          ${twitchHtml}
          ${scheduleHtml}
          <div class="runs-section">
            <div class="run-card has-edit">
              <button class="submission-edit-btn" data-submission-key="${s.submissionKey || ""}" data-local-key="${encodeURIComponent(s.key)}" title="Edit submission">✏️ Edit</button>
              <div class="run-info">
                <span class="run-game">${s.gameName} — ${s.categoryName}</span>
                <span class="run-category">Runner: ${s.runnerName}</span>
                <span class="run-time">${fmtShortDate(start)} ${fmtTime(start)} <span class="tz-note">(shown in your local timezone)</span></span>
              </div>
              <div class="run-actions">
                ${submissionCalDropdownHTML(s)}
              </div>
            </div>
          </div>
        `;
        list.appendChild(li);
      });
  }

  function ensureEditModal() {
    let modal = document.getElementById("submission-edit-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "submission-edit-modal";
    modal.className = "modal-overlay hidden";
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Edit Submission</h3>
          <button id="submission-edit-close" class="modal-close-btn" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="submission-edit-form" class="submission-edit-form">
            <label>Runner name</label>
            <input id="edit-runner-name" type="text" required />

            <label>Game</label>
            <input id="edit-game-name" type="text" required />

            <label>Category</label>
            <input id="edit-category-name" type="text" required />

            <label>Run time (local)</label>
            <input id="edit-run-date-local" type="datetime-local" required />

            <label>Schedule URL</label>
            <input id="edit-schedule-url" type="url" />

            <label>Stream URL</label>
            <input id="edit-stream-url" type="url" />

            <div class="submission-edit-actions">
              <button type="button" id="submission-edit-cancel" class="submission-edit-btn">Cancel</button>
              <button type="submit" class="submit-issue-btn">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector("#submission-edit-close");
    const cancelBtn = modal.querySelector("#submission-edit-cancel");
    closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    return modal;
  }

  function startEditFlow(submissionKey, localKeyEncoded, evIdx, runIdx) {
    const localKey = localKeyEncoded ? decodeURIComponent(localKeyEncoded) : "";
    const list = getLocalSubmissionsRaw();

    let item = null;
    if (submissionKey) {
      item = list.find((x) => String(x.submissionKey || "") === String(submissionKey));
    }
    if (!item && localKey) {
      item = list.find((x) => {
        const n = normalizeRun(x, "local");
        return n && n.key === localKey;
      });
    }

    const seed = item || buildSeedFromEventRun(evIdx, runIdx);
    if (!seed) {
      alert("Could not find editable data for this run.");
      return;
    }

    const modal = ensureEditModal();
    const form = modal.querySelector("#submission-edit-form");
    const runnerEl = modal.querySelector("#edit-runner-name");
    const gameEl = modal.querySelector("#edit-game-name");
    const categoryEl = modal.querySelector("#edit-category-name");
    const dateEl = modal.querySelector("#edit-run-date-local");
    const scheduleEl = modal.querySelector("#edit-schedule-url");
    const streamEl = modal.querySelector("#edit-stream-url");

    runnerEl.value = String(seed.runnerName || "");
    gameEl.value = String(seed.gameName || "");
    categoryEl.value = String(seed.categoryName || "");
    dateEl.value = String(seed.runDateLocal || toLocalInputValue(seed.runDateUtcIso || seed.runDateIso || ""));
    scheduleEl.value = String(seed.scheduleUrl || "");
    streamEl.value = String(seed.streamUrl || "");

    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    const runnerEl2 = modal.querySelector("#edit-runner-name");
    const gameEl2 = modal.querySelector("#edit-game-name");
    const categoryEl2 = modal.querySelector("#edit-category-name");
    const dateEl2 = modal.querySelector("#edit-run-date-local");
    const scheduleEl2 = modal.querySelector("#edit-schedule-url");
    const streamEl2 = modal.querySelector("#edit-stream-url");

    runnerEl2.value = runnerEl.value;
    gameEl2.value = gameEl.value;
    categoryEl2.value = categoryEl.value;
    dateEl2.value = dateEl.value;
    scheduleEl2.value = scheduleEl.value;
    streamEl2.value = streamEl.value;

    newForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const localRunTime = String(dateEl2.value || "").trim();
      const localDate = new Date(localRunTime);
      const utcIso = Number.isNaN(localDate.getTime())
        ? String(seed.runDateUtcIso || seed.runDateIso || "")
        : localDate.toISOString();

      upsertLocalSubmission(submissionKey, localKey, seed, {
        runnerName: String(runnerEl2.value || "").trim(),
        gameName: String(gameEl2.value || "").trim(),
        categoryName: String(categoryEl2.value || "").trim(),
        runDateLocal: localRunTime,
        runDateUtcIso: utcIso,
        scheduleUrl: String(scheduleEl2.value || "").trim(),
        streamUrl: String(streamEl2.value || "").trim()
      });

      modal.classList.add("hidden");
      window.location.reload();
    });

    modal.classList.remove("hidden");
  }

  async function init() {
    const local = loadLocalSubmissions();
    const remote = await loadFirestoreSubmissions();

    const merged = new Map();
    [...local, ...remote].forEach((item) => {
      if (!merged.has(item.key) || item.source === "firebase") {
        merged.set(item.key, item);
      }
    });

    const allSubmissions = Array.from(merged.values());
    const myRuns = allSubmissions.filter((s) => s.runnerType !== "other-runner");
    const otherRuns = allSubmissions.filter((s) => s.runnerType === "other-runner");

    injectSubmissionsIntoMarathons(myRuns);

    if (typeof window.refreshCalendarFromEvents === "function") {
      window.refreshCalendarFromEvents();
    }

    // Hard fallback: if cached/old calendar script didn't re-render,
    // append submitted runs directly to Upcoming Marathons.
    renderFallbackUpcoming(myRuns);
    renderOtherRunners(otherRuns);

    document.addEventListener("click", (event) => {
      const toggle = event.target.closest(".submission-add-to-cal-btn");
      if (!toggle && !event.target.closest(".submission-cal-wrap")) {
        document.querySelectorAll(".submission-cal-wrap.open").forEach((el) => el.classList.remove("open"));
      }
      if (toggle) {
        const wrap = toggle.closest(".submission-cal-wrap");
        const wasOpen = wrap.classList.contains("open");
        document.querySelectorAll(".submission-cal-wrap.open").forEach((el) => el.classList.remove("open"));
        if (!wasOpen) wrap.classList.add("open");
        return;
      }

      const calItem = event.target.closest(".submission-cal-item");
      if (calItem) {
        const localKey = decodeURIComponent(calItem.dataset.localKey || "");
        const s = submissionLookup.get(localKey);
        if (s) {
          if (calItem.dataset.service === "google") window.open(googleCalUrlForSubmission(s), "_blank", "noopener");
          else if (calItem.dataset.service === "outlook") window.open(outlookCalUrlForSubmission(s), "_blank", "noopener");
          else if (calItem.dataset.service === "yahoo") window.open(yahooCalUrlForSubmission(s), "_blank", "noopener");
          else if (calItem.dataset.service === "ics") exportSubmissionICS(s);
        }
        document.querySelectorAll(".submission-cal-wrap.open").forEach((el) => el.classList.remove("open"));
        return;
      }

      const btn = event.target.closest(".submission-edit-btn");
      if (!btn) return;
      startEditFlow(
        btn.dataset.submissionKey || "",
        btn.dataset.localKey || "",
        btn.dataset.evIdx || "",
        btn.dataset.runIdx || ""
      );
    });
  }

  init();
})();
