(function () {
  "use strict";

  const RECENT_PLACEHOLDER_DAYS = 7;
  const LOCAL_RUNS_KEY = "speedrun-local-run-submissions";

  const runForm = document.getElementById("run-submit-form");
  const vodForm = document.getElementById("vod-submit-form");
  const firebaseStatus = document.getElementById("firebase-status");
  const runFeedback = document.getElementById("run-submit-feedback");
  const vodFeedback = document.getElementById("vod-submit-feedback");
  const importUrlInput = document.getElementById("scheduleImportUrl");
  const importButton = document.getElementById("import-schedule-btn");
  const importStatus = document.getElementById("import-status");
  const importedRunsWrap = document.getElementById("imported-runs-wrap");
  const importedRunsList = document.getElementById("imported-runs-list");
  const prefillSelectedRunBtn = document.getElementById("prefill-selected-run-btn");
  const vodPlaceholderSelect = document.getElementById("vodPlaceholderSelect");
  const ownerStatusEl = document.getElementById("owner-auth-status");
  const ownerSignInBtn = document.getElementById("owner-signin-btn");
  const ownerSignOutBtn = document.getElementById("owner-signout-btn");
  const ownerLockout = document.getElementById("owner-lockout");
  const submitGrid = document.querySelector(".submit-grid");

  let importedRuns = [];
  let db = null;
  let ownerState = { isOwner: false, user: null, ownerConfigured: false, authReady: false };

  function applyOwnerUi(nextState) {
    ownerState = nextState || ownerState;

    if (ownerStatusEl) {
      if (ownerState.isOwner) {
        ownerStatusEl.textContent = `Owner access granted: ${ownerState.user?.email || ownerState.user?.uid || "signed in"}`;
      } else if (ownerState.user) {
        ownerStatusEl.textContent = "Signed in, but this account is not owner-approved.";
      } else {
        ownerStatusEl.textContent = "Owner access required. Sign in with the owner account.";
      }
    }

    if (ownerSignInBtn) ownerSignInBtn.classList.toggle("hidden", Boolean(ownerState.user));
    if (ownerSignOutBtn) ownerSignOutBtn.classList.toggle("hidden", !ownerState.user);

    const showForms = Boolean(ownerState.isOwner);
    if (submitGrid) submitGrid.classList.toggle("hidden", !showForms);
    if (ownerLockout) ownerLockout.classList.toggle("hidden", showForms);
  }

  function localInputToUtcIso(value) {
    if (!value) return "";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toISOString();
  }

  function setFeedback(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove("is-success", "is-error");
    if (type === "success") el.classList.add("is-success");
    if (type === "error") el.classList.add("is-error");
  }

  function initializeFirebase() {
    if (!window.firebase) {
      if (firebaseStatus) {
        firebaseStatus.textContent = "Firebase SDK not loaded. Please check your internet connection.";
      }
      return null;
    }

    const cfg = window.FIREBASE_CONFIG || {};
    if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
      if (firebaseStatus) {
        firebaseStatus.textContent = "Firebase is not configured yet. Fill js/firebase-config.js with your project keys.";
      }
      return null;
    }

    try {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      const firestore = app.firestore();
      if (firebaseStatus) {
        firebaseStatus.textContent = `Firebase connected to project: ${cfg.projectId}`;
      }
      return firestore;
    } catch {
      if (firebaseStatus) {
        firebaseStatus.textContent = "Could not initialize Firebase. Check js/firebase-config.js values.";
      }
      return null;
    }
  }

  async function submitToFirebase(collectionName, payload) {
    if (!db) throw new Error("Firebase not configured.");
    return db.collection(collectionName).add({
      ...payload,
      source: "submit-page",
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      submittedAtIso: new Date().toISOString(),
      status: "new"
    });
  }

  function saveLocalRunSubmission(payload) {
    try {
      const existing = JSON.parse(localStorage.getItem(LOCAL_RUNS_KEY) || "[]");
      const arr = Array.isArray(existing) ? existing : [];
      arr.push({
        ...payload,
        status: "new",
        submittedAtIso: new Date().toISOString()
      });
      localStorage.setItem(LOCAL_RUNS_KEY, JSON.stringify(arr));
    } catch {
      // Ignore localStorage errors and continue.
    }
  }

  function createSubmissionKey() {
    return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function parseDurationToMinutes(hms) {
    if (!hms) return "";
    const m = String(hms).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return "";
    const hours = Number(m[1] || 0);
    const minutes = Number(m[2] || 0);
    const seconds = Number(m[3] || 0);
    return String(Math.max(1, Math.round(hours * 60 + minutes + seconds / 60)));
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

  function extractEventSlug(scheduleUrl) {
    try {
      const u = new URL(scheduleUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      if (u.hostname.includes("oengus.io")) {
        const ix = parts.indexOf("marathon");
        if (ix >= 0 && parts[ix + 1]) return parts[ix + 1];
      }
      if ((u.hostname.includes("horaro.net") || u.hostname.includes("horaro.org")) && parts[0]) {
        return parts[0];
      }
    } catch {
      return "";
    }
    return "";
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

  function parseHoraroTableRuns(text, fallbackEvent) {
    const runs = [];
    const rowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>(\d{1,2}:\d{2}\s*(?:AM|PM)?)<\/td>[\s\S]*?<td[^>]*>([^<]{1,80})<\/td>[\s\S]*?<td[^>]*>(\d{2}:\d{2}:\d{2})<\/td>[\s\S]*?<td[^>]*>([^<]{1,140})<\/td>[\s\S]*?<td[^>]*>([^<]{1,140})<\/td>/gi;
    let match;
    while ((match = rowRegex.exec(text)) !== null) {
      runs.push({
        eventName: fallbackEvent,
        game: match[4].trim(),
        category: match[5].trim(),
        dateIso: "",
        estimateText: match[3].trim()
      });
      if (runs.length >= 200) break;
    }
    return runs;
  }

  function renderImportedRunsList(runs) {
    if (!importedRunsWrap || !importedRunsList || !prefillSelectedRunBtn) return;

    importedRunsList.innerHTML = "";
    runs.slice(0, 50).forEach((run, idx) => {
      const row = document.createElement("label");
      row.className = "import-run-item";
      const dtText = run.dateIso ? new Date(run.dateIso).toLocaleString() : "time not parsed";
      row.innerHTML = `
        <input type="radio" name="importedRun" value="${idx}" ${idx === 0 ? "checked" : ""} />
        <span>${run.game} - ${run.category} (${dtText})</span>
      `;
      importedRunsList.appendChild(row);
    });

    importedRunsWrap.classList.remove("hidden");
  }

  function prefillRunFormFromImported(run) {
    const runnerType = document.getElementById("runnerType");
    const runnerName = document.getElementById("runnerName");
    const eventName = document.getElementById("eventName");
    const gameName = document.getElementById("gameName");
    const categoryName = document.getElementById("categoryName");
    const runDateLocal = document.getElementById("runDateLocal");
    const estimateMinutes = document.getElementById("estimateMinutes");
    const streamUrl = document.getElementById("streamUrl");

    if (runnerType) runnerType.value = runnerType.value || "my-run";
    if (runnerName && !runnerName.value) runnerName.value = "pbb8";
    if (eventName && !eventName.value) eventName.value = run.eventName || "";
    if (gameName) gameName.value = run.game || "";
    if (categoryName) categoryName.value = run.category || "";

    if (runDateLocal && run.dateIso) {
      const dt = new Date(run.dateIso);
      if (!Number.isNaN(dt.getTime())) {
        const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        runDateLocal.value = local;
      }
    }

    if (estimateMinutes && run.estimateText) {
      const mins = parseDurationToMinutes(run.estimateText);
      if (mins) estimateMinutes.value = mins;
    }

    if (streamUrl && !streamUrl.value && run.streamUrl) {
      streamUrl.value = run.streamUrl;
    }
  }

  async function loadPlaceholderVods() {
    if (!vodPlaceholderSelect || typeof MARATHON_EVENTS === "undefined") return;

    try {
      const response = await fetch("runs.html");
      if (!response.ok) throw new Error("Unable to read runs page.");
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      const existingIds = new Set(
        Array.from(doc.querySelectorAll(".run-entry[data-run-id]"))
          .map((node) => node.getAttribute("data-run-id"))
          .filter(Boolean)
      );

      const now = new Date();
      const cutoff = new Date(now.getTime() - RECENT_PLACEHOLDER_DAYS * 24 * 60 * 60 * 1000);

      const missing = [];
      for (const ev of MARATHON_EVENTS) {
        for (const run of ev.runs || []) {
          const runId = String(run.runId);
          const dt = new Date(run.date);
          if (existingIds.has(runId)) continue;
          if (dt > now || dt < cutoff) continue;
          missing.push({ ev, run, dt });
        }
      }

      missing.sort((a, b) => b.dt - a.dt).forEach(({ ev, run, dt }, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = `${ev.name} - ${run.game} (${dt.toLocaleDateString()})`;
        opt.dataset.eventName = ev.name;
        opt.dataset.gameName = run.game;
        opt.dataset.runDate = dt.toISOString().slice(0, 10);
        vodPlaceholderSelect.appendChild(opt);
      });

      vodPlaceholderSelect.addEventListener("change", () => {
        const selected = vodPlaceholderSelect.selectedOptions[0];
        if (!selected || !selected.dataset.eventName) return;

        const vodEventName = document.getElementById("vodEventName");
        const vodGameName = document.getElementById("vodGameName");
        const vodRunnerName = document.getElementById("vodRunnerName");
        const vodRunDate = document.getElementById("vodRunDate");

        if (vodEventName) vodEventName.value = selected.dataset.eventName;
        if (vodGameName) vodGameName.value = selected.dataset.gameName;
        if (vodRunDate) vodRunDate.value = selected.dataset.runDate;
        if (vodRunnerName && !vodRunnerName.value) vodRunnerName.value = "pbb8";
      });
    } catch {
      // Keep manual input path available if placeholder auto-detect fails.
    }
  }

  if (importButton && importUrlInput && importStatus) {
    importButton.addEventListener("click", async () => {
      const scheduleUrl = importUrlInput.value.trim();
      if (!scheduleUrl) {
        importStatus.textContent = "Please paste a schedule URL first.";
        return;
      }

      importStatus.textContent = "Fetching schedule and trying to parse runs...";
      if (importedRunsWrap) importedRunsWrap.classList.add("hidden");

      try {
        const text = await fetchTextBestEffort(scheduleUrl);
        const slug = extractEventSlug(scheduleUrl) || "Imported Marathon";
        let marathonStreamUrl = "";
        if (scheduleUrl.includes("oengus.io")) {
          marathonStreamUrl = await fetchOengusMarathonTwitch(scheduleUrl);
        }

        let runs = [];
        if (scheduleUrl.includes("oengus.io")) {
          runs = parseOengusLikeRuns(text, slug);
        } else if (scheduleUrl.includes("horaro.net") || scheduleUrl.includes("horaro.org")) {
          runs = parseHoraroTableRuns(text, slug);
          if (runs.length === 0) {
            runs = parseOengusLikeRuns(text, slug);
          }
        } else {
          runs = parseOengusLikeRuns(text, slug);
          if (runs.length === 0) runs = parseHoraroTableRuns(text, slug);
        }

        importedRuns = runs
          .filter((run) => run.game && run.category)
          .map((run) => ({
            ...run,
            streamUrl: run.streamUrl || marathonStreamUrl || ""
          }));

        if (importedRuns.length === 0) {
          importStatus.textContent = "Could not parse runs from that link. You can still fill the form manually.";
          return;
        }

        importStatus.textContent = `Found ${importedRuns.length} runs. Confirm one below to prefill the form.`;
        renderImportedRunsList(importedRuns);
      } catch {
        importStatus.textContent = "Unable to fetch that schedule link right now. You can still submit manually.";
      }
    });
  }

  if (prefillSelectedRunBtn && importedRunsList) {
    prefillSelectedRunBtn.addEventListener("click", () => {
      const selected = importedRunsList.querySelector("input[name='importedRun']:checked");
      if (!selected) {
        if (importStatus) importStatus.textContent = "Choose a run first.";
        return;
      }

      const idx = Number(selected.value);
      const run = importedRuns[idx];
      if (!run) return;
      prefillRunFormFromImported(run);
      if (importStatus) importStatus.textContent = "Run details copied into the form. Review, then submit to website.";
    });
  }

  if (runForm) {
    const runDateInput = document.getElementById("runDateLocal");
    if (runDateInput && !runDateInput.value) {
      const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
      const local = new Date(defaultTime.getTime() - defaultTime.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      runDateInput.value = local;
    }

    runForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFeedback(runFeedback, "", "");

      if (!ownerState.isOwner) {
        setFeedback(runFeedback, "Only the owner account can submit updates.", "error");
        return;
      }

      const formData = new FormData(runForm);

      const localStart = String(formData.get("runDateLocal") || "");
      const utcStart = localInputToUtcIso(localStart);

      const payload = {
        submissionKey: createSubmissionKey(),
        runnerType: String(formData.get("runnerType") || ""),
        runnerName: String(formData.get("runnerName") || ""),
        eventName: String(formData.get("eventName") || ""),
        gameName: String(formData.get("gameName") || ""),
        categoryName: String(formData.get("categoryName") || ""),
        runDateLocal: localStart,
        runDateUtcIso: utcStart,
        estimateMinutes: Number(formData.get("estimateMinutes") || 0),
        streamUrl: String(formData.get("streamUrl") || ""),
        scheduleUrl: String(formData.get("scheduleUrl") || ""),
        notes: String(formData.get("runNotes") || "")
      };

      // Save locally first so calendar rendering works even if Firestore write/read is restricted.
      saveLocalRunSubmission(payload);

      if (!db) {
        setFeedback(runFeedback, "Saved locally. Firebase is not configured/available yet.", "success");
        setTimeout(() => {
          window.location.href = "calendar.html";
        }, 600);
        return;
      }

      try {
        await submitToFirebase("runSubmissions", payload);
        setFeedback(runFeedback, "Submitted successfully. Thanks!", "success");
        runForm.reset();
        setTimeout(() => {
          window.location.href = "calendar.html";
        }, 600);
      } catch {
        setFeedback(runFeedback, "Saved locally, but Firebase submission failed. Check rules/config and try again.", "error");
        setTimeout(() => {
          window.location.href = "calendar.html";
        }, 900);
      }
    });
  }

  if (vodForm) {
    vodForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFeedback(vodFeedback, "", "");

      if (!ownerState.isOwner) {
        setFeedback(vodFeedback, "Only the owner account can submit updates.", "error");
        return;
      }

      const formData = new FormData(vodForm);

      const payload = {
        eventName: String(formData.get("vodEventName") || ""),
        gameName: String(formData.get("vodGameName") || ""),
        runnerName: String(formData.get("vodRunnerName") || ""),
        runDate: String(formData.get("vodRunDate") || ""),
        vodUrl: String(formData.get("vodUrl") || ""),
        vodStartOffset: String(formData.get("vodStartTime") || ""),
        notes: String(formData.get("vodNotes") || "")
      };

      if (!db) {
        setFeedback(vodFeedback, "Firebase is not configured/available yet. Could not save VOD update.", "error");
        return;
      }

      try {
        await submitToFirebase("vodSubmissions", payload);
        setFeedback(vodFeedback, "Submitted successfully. Thanks!", "success");
        vodForm.reset();
      } catch {
        setFeedback(vodFeedback, "Submission failed. Check Firebase rules/config and try again.", "error");
      }
    });
  }

  db = initializeFirebase();
  loadPlaceholderVods();

  if (ownerSignInBtn && window.SpeedrunOwnerAuth) {
    ownerSignInBtn.addEventListener("click", async () => {
      try {
        await window.SpeedrunOwnerAuth.signInWithGoogle();
      } catch (err) {
        setFeedback(runFeedback, `Sign in failed. ${err && err.message ? err.message : ""}`.trim(), "error");
      }
    });
  }

  if (ownerSignOutBtn && window.SpeedrunOwnerAuth) {
    ownerSignOutBtn.addEventListener("click", async () => {
      try {
        await window.SpeedrunOwnerAuth.signOut();
      } catch (err) {
        setFeedback(runFeedback, `Sign out failed. ${err && err.message ? err.message : ""}`.trim(), "error");
      }
    });
  }

  if (window.SpeedrunOwnerAuth) {
    window.SpeedrunOwnerAuth.onChange((state) => {
      applyOwnerUi(state);
    });
    window.SpeedrunOwnerAuth.ready.then(() => {
      applyOwnerUi(window.SpeedrunOwnerAuth.getState());
    });
  } else {
    applyOwnerUi(ownerState);
  }
})();
