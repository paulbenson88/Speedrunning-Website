/**
 * calendar.js — Renders a monthly calendar and upcoming-events list.
 * All UTC event times are displayed in the viewer's local timezone.
 */

(function () {
  "use strict";

  /* ── Helpers ──────────────────────────────────────── */

  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /** Format a Date to a human-friendly local string. */
  function fmtDate(date) {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function fmtTime(date) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }

  function fmtShortDate(date) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function ordinalDay(day) {
    const mod10 = day % 10;
    const mod100 = day % 100;
    if (mod10 === 1 && mod100 !== 11) return `${day}st`;
    if (mod10 === 2 && mod100 !== 12) return `${day}nd`;
    if (mod10 === 3 && mod100 !== 13) return `${day}rd`;
    return `${day}th`;
  }

  function fmtDiscordReadable(date) {
    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    const month = date.toLocaleDateString(undefined, { month: "long" });
    const day = ordinalDay(date.getDate());
    const year = date.getFullYear();
    const time = date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${weekday}, ${month} ${day}, ${year} ${time}`;
  }

  function discordTimestampTag(date) {
    return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
  }

  /** Parse an ISO-8601 duration (e.g. PT1H35M) to a human string. */
  function fmtEstimate(iso) {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return iso;
    const parts = [];
    if (m[1]) parts.push(`${m[1]}h`);
    if (m[2]) parts.push(`${m[2]}m`);
    if (m[3]) parts.push(`${m[3]}s`);
    return parts.join(" ") || "0m";
  }

  /** Build a unique key for a run's commentator tracking. */
  function runCommentatorKey(marathonName, run) {
    return `${marathonName} | ${run.game} - ${run.category}`;
  }

  /** Return "YYYY-MM-DD" in local time for a Date. */
  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Check if two local dates are the same calendar day. */
  function sameDay(a, b) {
    return dateKey(a) === dateKey(b);
  }

  /* ── Parse Events ─────────────────────────────────── */

  /** Build a Map<"YYYY-MM-DD", Event[]> keyed by each day the user has a run. */
  function buildEventMap(events) {
    const map = new Map();
    for (const ev of events) {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      const runs = ev.runs || [];
      if (runs.length === 0) continue;
      for (const run of runs) {
        const runDate = new Date(run.date);
        const key = dateKey(runDate);
        if (!map.has(key)) map.set(key, []);
        // Avoid adding the same marathon twice on the same day
        if (!map.get(key).some(e => e.name === ev.name)) {
          map.get(key).push({ ...ev, _start: start, _end: end });
        }
      }
    }
    return map;
  }

  let eventMap = buildEventMap(MARATHON_EVENTS);

  function rebuildEventMap() {
    eventMap = buildEventMap(MARATHON_EVENTS);
  }

  /* ── DOM References ───────────────────────────────── */
  const grid = document.getElementById("calendar-grid");
  const monthTitle = document.getElementById("month-title");
  const prevBtn = document.getElementById("prev-month");
  const nextBtn = document.getElementById("next-month");
  const detailSection = document.getElementById("event-details");
  const detailDate = document.getElementById("detail-date");
  const detailList = document.getElementById("detail-list");
  const upcomingList = document.getElementById("upcoming-list");
  const tzLabel = document.getElementById("tz-label");

  /* ── State ────────────────────────────────────────── */
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-indexed

  /* ── Render Calendar ──────────────────────────────── */

  function renderMonth() {
    // Clear old day cells (keep the 7 header divs)
    const headers = grid.querySelectorAll(".day-header");
    grid.innerHTML = "";
    headers.forEach((h) => grid.appendChild(h));

    const monthNames = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December",
    ];
    monthTitle.textContent = `${monthNames[viewMonth]} ${viewYear}`;

    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // Leading empties
    for (let i = 0; i < firstDay; i++) {
      const cell = document.createElement("div");
      cell.className = "day-cell empty";
      grid.appendChild(cell);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(viewYear, viewMonth, d);
      const key = dateKey(cellDate);
      const events = eventMap.get(key) || [];

      const cell = document.createElement("div");
      cell.className = "day-cell";
      if (sameDay(cellDate, today)) cell.classList.add("today");
      if (events.length) cell.classList.add("has-event");

      const num = document.createElement("span");
      num.className = "day-number";
      num.textContent = d;
      cell.appendChild(num);

      // Show up to 2 event labels
      events.slice(0, 2).forEach((ev) => {
        const lbl = document.createElement("span");
        lbl.className = "event-label";
        lbl.innerHTML = `<span class="event-dot"></span>${ev.name}`;
        cell.appendChild(lbl);
      });
      if (events.length > 2) {
        const more = document.createElement("span");
        more.className = "event-label";
        more.textContent = `+${events.length - 2} more`;
        cell.appendChild(more);
      }

      // Click to show details
      if (events.length) {
        cell.addEventListener("click", () => showDetails(cellDate, events));
      }

      grid.appendChild(cell);
    }
  }

  /* ── Show Detail Panel ────────────────────────────── */

  function showDetails(date, events) {
    detailDate.textContent = fmtDate(date);
    detailList.innerHTML = "";
    for (const ev of events) {
      // Marathon header
      const marathonLi = document.createElement("li");
      marathonLi.className = "marathon-header-item";
      const evIdx = MARATHON_EVENTS.indexOf(ev) !== -1 ? MARATHON_EVENTS.indexOf(ev)
        : MARATHON_EVENTS.findIndex(e => e.name === ev.name);
      marathonLi.className = "marathon-header-item";

      let marathonHTML = `
        <span class="event-name">${ev.name}</span>
        ${ev.twitch ? `<a class="twitch-link" href="https://twitch.tv/${ev.twitch}" target="_blank" rel="noopener"><span class="twitch-icon">&#9656;</span> twitch.tv/${ev.twitch}</a>` : ""}
        ${ev.url ? `<a class="schedule-link" href="${ev.url}" target="_blank" rel="noopener">📋 Full Schedule</a>` : ""}
      `;

      // Show individual runs if they exist
      const runs = ev.runs || [];
      if (runs.length > 0) {
        marathonHTML += `<div class="runs-section">`;
        for (let runIdx = 0; runIdx < runs.length; runIdx++) {
          const run = runs[runIdx];
          const runDate = new Date(run.date);
          const commKey = runCommentatorKey(ev.name, run);
          const comms = CommentatorManager.getForEvent(commKey);
          const confirmedCount = comms.filter(c => c.status === "confirmed").length;
          const declinedCount = comms.filter(c => c.status === "declined").length;
          const totalCount = comms.length;
          const allDeclined = totalCount > 0 && declinedCount === totalCount;
          const badgeText = totalCount > 0
            ? (allDeclined ? "All declined" : `${confirmedCount}/${totalCount} confirmed`)
            : "No commentators";
          const badgeClass = totalCount > 0 && confirmedCount === totalCount
            ? "badge-complete" : totalCount > 0 ? "badge-partial" : "badge-empty";
          const editBtn = `<button class="submission-edit-btn" data-submission-key="${run.submissionKey || ""}" data-local-key="${encodeURIComponent(run.localKey || "")}" data-ev-idx="${evIdx}" data-run-idx="${runIdx}" title="Edit submission">✏️ Edit</button>`;
          const discordTag = discordTimestampTag(runDate);
          const discordCopyText = discordTag;

          marathonHTML += `
            <div class="run-card has-edit">
              ${editBtn}
              <div class="run-info">
                <span class="run-game">${run.game}</span>
                <span class="run-time">${fmtShortDate(runDate)} ${fmtTime(runDate)} <span class="tz-note">(shown in your local timezone)</span></span>
                <div class="discord-time-block">
                  <button class="discord-time-copy-btn" data-copy="${encodeURIComponent(discordCopyText)}" type="button">Copy for Discord (via Hammertime)</button>
                </div>
              </div>
              <div class="run-actions">
                ${calDropdownHTML(evIdx, runIdx)}
                <button class="commentator-btn ${badgeClass}" data-event="${commKey}" data-game="${encodeURIComponent(run.game || "")}">🎙️ Commentators <span class="comm-badge">${badgeText}</span></button>
              </div>
            </div>
          `;
        }
        marathonHTML += `</div>`;
      }

      marathonLi.innerHTML = marathonHTML;
      detailList.appendChild(marathonLi);
    }
    detailSection.classList.remove("hidden");
    detailSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ── Commentator Modal ───────────────────────────── */

  const modal = document.getElementById("commentator-modal");
  const modalTitle = document.getElementById("modal-event-title");
  const modalCloseBtn = document.getElementById("modal-close");
  const commInput = document.getElementById("commentator-name-input");
  const commAddBtn = document.getElementById("commentator-add-btn");
  const commList = document.getElementById("commentator-list");
  const commEmpty = document.getElementById("commentator-empty");
  const commSuggested = document.getElementById("commentator-suggested");
  const commSuggestedEmpty = document.getElementById("commentator-suggested-empty");
  let currentModalEvent = null;
  let currentModalGame = "";

  function decodeGameName(encodedValue) {
    if (!encodedValue) return "";
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return encodedValue;
    }
  }

  function decodeCommentatorName(encodedValue) {
    if (!encodedValue) return "";
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return encodedValue;
    }
  }

  function renderGameSuggestions() {
    if (!commSuggested || !commSuggestedEmpty) return;

    commSuggested.innerHTML = "";

    if (!currentModalGame) {
      commSuggestedEmpty.textContent = "No game selected for this run.";
      commSuggestedEmpty.classList.remove("hidden");
      return;
    }

    const saved = CommentatorManager.getForGame(currentModalGame);
    const existing = new Set(
      CommentatorManager.getForEvent(currentModalEvent).map((c) => c.name.toLowerCase())
    );
    const available = saved.filter((name) => !existing.has(name.toLowerCase()));

    if (available.length > 0) {
      commSuggestedEmpty.textContent = "";
      commSuggestedEmpty.classList.add("hidden");
    } else if (saved.length === 0) {
      commSuggestedEmpty.textContent = "No saved commentators for this game yet.";
      commSuggestedEmpty.classList.remove("hidden");
    } else {
      commSuggestedEmpty.textContent = "All saved commentators are already on this run.";
      commSuggestedEmpty.classList.remove("hidden");
    }

    for (const name of available) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "comm-suggestion-btn";
      btn.dataset.name = name;
      btn.textContent = `+ ${name}`;
      commSuggested.appendChild(btn);
    }
  }

  /** Render the commentator list inside the modal. */
  function renderCommentatorList() {
    const comms = CommentatorManager.getForEvent(currentModalEvent);
    commList.innerHTML = "";
    commEmpty.classList.toggle("hidden", comms.length > 0);

    for (const c of comms) {
      const info = CommentatorManager.STATUSES[c.status];
      const encodedName = encodeURIComponent(c.name);
      const li = document.createElement("li");
      li.className = `commentator-item ${info.className}`;
      li.innerHTML = `
        <span class="comm-icon">${info.icon}</span>
        <span class="comm-name">${c.name}</span>
        <select class="comm-status-select" data-name="${encodedName}">
          ${Object.entries(CommentatorManager.STATUSES).map(([key, val]) =>
            `<option value="${key}"${key === c.status ? " selected" : ""}>${val.label}</option>`
          ).join("")}
        </select>
        <button class="comm-edit-btn" data-name="${encodedName}" title="Edit name">✏️</button>
        <button class="comm-remove-btn" data-name="${encodedName}" title="Remove">🗑️</button>
      `;
      commList.appendChild(li);
    }

    renderGameSuggestions();
  }

  function openCommentatorModal(eventName, gameName) {
    currentModalEvent = eventName;
    currentModalGame = String(gameName || "").trim();
    modalTitle.textContent = eventName;
    commInput.value = "";
    renderCommentatorList();
    modal.classList.remove("hidden");
    commInput.focus();
  }

  function closeCommentatorModal() {
    modal.classList.add("hidden");
    currentModalEvent = null;
    currentModalGame = "";
    // Re-render the detail panel to update badges
    if (!detailSection.classList.contains("hidden")) {
      // Refresh upcoming list too
      renderUpcoming();
    }
  }

  // Event delegation for commentator buttons in detail panel
  detailList.addEventListener("click", (e) => {
    const btn = e.target.closest(".commentator-btn");
    if (btn) openCommentatorModal(btn.dataset.event, decodeGameName(btn.dataset.game));
  });

  // Event delegation for commentator buttons in upcoming list
  upcomingList.addEventListener("click", (e) => {
    const btn = e.target.closest(".commentator-btn");
    if (btn) openCommentatorModal(btn.dataset.event, decodeGameName(btn.dataset.game));
  });

  // Modal close
  modalCloseBtn.addEventListener("click", closeCommentatorModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeCommentatorModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeCommentatorModal();
  });

  // Add commentator
  function addCommentator() {
    const name = commInput.value.trim();
    if (!name) return;
    const added = CommentatorManager.add(currentModalEvent, name, currentModalGame);
    if (!added) {
      commInput.classList.add("input-error");
      setTimeout(() => commInput.classList.remove("input-error"), 600);
      return;
    }
    commInput.value = "";
    renderCommentatorList();
    renderUpcoming();
    commInput.focus();
  }

  commAddBtn.addEventListener("click", addCommentator);
  commInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addCommentator();
  });

  commSuggested?.addEventListener("click", (e) => {
    const btn = e.target.closest(".comm-suggestion-btn");
    if (!btn) return;
    const name = btn.dataset.name;
    const added = CommentatorManager.add(currentModalEvent, name, currentModalGame);
    if (!added) return;
    renderCommentatorList();
    renderUpcoming();
  });

  // Status change & remove via delegation
  commList.addEventListener("change", (e) => {
    if (e.target.classList.contains("comm-status-select")) {
      const commentatorName = decodeCommentatorName(e.target.dataset.name);
      CommentatorManager.setStatus(currentModalEvent, commentatorName, e.target.value);
      renderCommentatorList();
      renderUpcoming();
    }
  });

  commList.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".comm-edit-btn");
    if (editBtn) {
      const currentName = decodeCommentatorName(editBtn.dataset.name);
      const nextName = window.prompt("Edit commentator name:", currentName);
      if (nextName === null) return;

      const renamed = CommentatorManager.rename(
        currentModalEvent,
        currentName,
        nextName,
        currentModalGame
      );

      if (!renamed) {
        window.alert("Could not rename commentator. Names must be unique on this run.");
        return;
      }

      renderCommentatorList();
      renderUpcoming();
      return;
    }

    const btn = e.target.closest(".comm-remove-btn");
    if (btn) {
      const commentatorName = decodeCommentatorName(btn.dataset.name);
      CommentatorManager.remove(currentModalEvent, commentatorName);
      renderCommentatorList();
      renderUpcoming();
    }
  });

  window.addEventListener("commentators-updated", () => {
    if (currentModalEvent) renderCommentatorList();
    renderUpcoming();
  });

  document.addEventListener("click", (e) => {
    const copyBtn = e.target.closest(".discord-time-copy-btn");
    if (!copyBtn) return;

    const text = decodeURIComponent(copyBtn.dataset.copy || "");
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      const oldText = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = oldText;
      }, 1200);
    });
  });

  /* ── Upcoming List ────────────────────────────────── */

  function renderUpcoming() {
    const now = new Date();
    const nowMs = now.getTime();

    function nextUpcomingRunTime(ev) {
      const upcomingRunTimes = (ev.runs || [])
        .map((run) => new Date(run.date).getTime())
        .filter((ts) => ts >= nowMs);
      return upcomingRunTimes.length ? Math.min(...upcomingRunTimes) : null;
    }

    const upcoming = MARATHON_EVENTS
      .filter((ev) => {
        const runs = ev.runs || [];
        if (runs.length === 0) return new Date(ev.end) >= now;
        // Keep marathons only while at least one run is still upcoming.
        return nextUpcomingRunTime(ev) !== null;
      })
      .sort((a, b) => {
        const aNextRun = nextUpcomingRunTime(a);
        const bNextRun = nextUpcomingRunTime(b);
        if (aNextRun !== null && bNextRun !== null) return aNextRun - bNextRun;
        return new Date(a.start) - new Date(b.start);
      })
      .slice(0, 20);

    upcomingList.innerHTML = "";
    if (upcoming.length === 0) {
      upcomingList.innerHTML = "<li>No upcoming marathons — check back later!</li>";
      return;
    }

    for (const ev of upcoming) {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      const li = document.createElement("li");
      li.className = "upcoming-marathon-card";
      const evIdx = MARATHON_EVENTS.indexOf(ev);
      const stats = getMarathonCommentatorStats(ev);
      let marathonStatusClass = "ready";
      let marathonStatusLabel = "Ready";
      if (stats.needAskRuns > 0) {
        marathonStatusClass = "needs-asks";
        marathonStatusLabel = "Needs Asks";
      } else if (stats.declinedRuns > 0 && stats.declinedRuns === stats.totalRuns) {
        marathonStatusClass = "declined";
        marathonStatusLabel = "Declined";
      } else if (stats.waitingRuns > 0) {
        marathonStatusClass = "waiting";
        marathonStatusLabel = "Asked / Waiting";
      }

      const nextTs = nextUpcomingRunTime(ev);
      const nextRunLabel = nextTs ? fmtShortDate(new Date(nextTs)) : fmtShortDate(start);

      let runsHTML = "";
      const runs = ev.runs || [];
      for (let runIdx = 0; runIdx < runs.length; runIdx++) {
        const run = runs[runIdx];
        const runDate = new Date(run.date);
        const estimateMs = run.estimate ? durationMs(run.estimate) : 0;
        const runEnd = new Date(runDate.getTime() + estimateMs);
        if (runEnd < now) continue;
        const commKey = runCommentatorKey(ev.name, run);
        const comms = CommentatorManager.getForEvent(commKey);
        const confirmedCount = comms.filter(c => c.status === "confirmed").length;
        const declinedCount = comms.filter(c => c.status === "declined").length;
        const totalCount = comms.length;
        const allDeclined = totalCount > 0 && declinedCount === totalCount;
        const badgeText = totalCount > 0
          ? (allDeclined ? "All declined" : `${confirmedCount}/${totalCount} confirmed`)
          : "No commentators";
        const badgeClass = totalCount > 0 && confirmedCount === totalCount
          ? "badge-complete" : totalCount > 0 ? "badge-partial" : "badge-empty";
        const runState = getRunCommentatorState(ev, run);
        const editBtn = `<button class="submission-edit-btn" data-submission-key="${run.submissionKey || ""}" data-local-key="${encodeURIComponent(run.localKey || "")}" data-ev-idx="${evIdx}" data-run-idx="${runIdx}" title="Edit submission">✏️ Edit</button>`;
        const discordTag = discordTimestampTag(runDate);
        const discordCopyText = discordTag;

        runsHTML += `
          <div class="run-card has-edit">
            ${editBtn}
            <div class="run-info">
              <span class="run-game">${run.game}</span>
              <span class="run-time">${fmtShortDate(runDate)} ${fmtTime(runDate)} <span class="tz-note">(shown in your local timezone)</span></span>
              <span class="upcoming-run-state ${runState.className}">${runState.label}</span>
              <div class="discord-time-block">
                <button class="discord-time-copy-btn" data-copy="${encodeURIComponent(discordCopyText)}" type="button">Copy for Discord (via Hammertime)</button>
              </div>
            </div>
            <div class="run-actions">
              ${calDropdownHTML(evIdx, runIdx)}
              <button class="commentator-btn ${badgeClass}" data-event="${commKey}" data-game="${encodeURIComponent(run.game || "")}">🎙️ <span class="comm-badge">${badgeText}</span></button>
            </div>
          </div>
        `;
      }

      li.innerHTML = `
        <div class="upcoming-marathon-head">
          <span class="upcoming-marathon-title">${ev.name}</span>
          <span class="upcoming-marathon-status ${marathonStatusClass}">${marathonStatusLabel}</span>
        </div>
        <div class="upcoming-marathon-meta">
          Next run: ${nextRunLabel} · ${stats.confirmedRuns}/${stats.totalRuns} runs confirmed
        </div>
        ${ev.twitch ? `<a class="twitch-link" href="https://twitch.tv/${ev.twitch}" target="_blank" rel="noopener"><span class="twitch-icon">&#9656;</span> twitch.tv/${ev.twitch}</a>` : ""}
        ${ev.url ? `<a class="schedule-link" href="${ev.url}" target="_blank" rel="noopener">📋 Full Schedule</a>` : ""}
        ${runsHTML ? `<div class="runs-section">${runsHTML}</div>` : ""}
      `;
      upcomingList.appendChild(li);
    }
  }

  function getRunCommentatorState(ev, run) {
    const commKey = runCommentatorKey(ev.name, run);
    const comms = CommentatorManager.getForEvent(commKey);
    const confirmedCount = comms.filter((c) => c.status === "confirmed").length;
    const askedCount = comms.filter((c) => c.status === "asked").length;
    const notAskedCount = comms.filter((c) => c.status === "not-asked").length;
    const declinedCount = comms.filter((c) => c.status === "declined").length;
    const totalCount = comms.length;

    const statusSummary = [
      [confirmedCount, "confirmed"],
      [askedCount, "asked"],
      [notAskedCount, "not asked"],
      [declinedCount, "declined"],
    ]
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}`)
      .join(", ");

    if (totalCount === 0) {
      return {
        className: "needs-asks",
        label: "Needs Asks"
      };
    }

    if (confirmedCount === totalCount) {
      return {
        className: "ready",
        label: `Ready (${confirmedCount} confirmed)`
      };
    }

    if (notAskedCount > 0) {
      return {
        className: "needs-asks",
        label: `Needs Asks (${statusSummary})`
      };
    }

    if (declinedCount === totalCount) {
      return {
        className: "declined",
        label: "Declined"
      };
    }

    return {
      className: "waiting",
      label: `Asked / Waiting (${statusSummary})`
    };
  }

  function getMarathonCommentatorStats(ev) {
    const runs = ev.runs || [];
    let needAskRuns = 0;
    let waitingRuns = 0;
    let confirmedRuns = 0;
    let declinedRuns = 0;

    for (const run of runs) {
      const commKey = runCommentatorKey(ev.name, run);
      const comms = CommentatorManager.getForEvent(commKey);
      const hasConfirmed = comms.some((c) => c.status === "confirmed");
      const hasAny = comms.length > 0;
      const allDeclined = hasAny && comms.every((c) => c.status === "declined");
      const hasOutreach = comms.some((c) => c.status !== "not-asked");

      if (hasConfirmed) {
        confirmedRuns++;
      } else if (allDeclined) {
        declinedRuns++;
      } else if (hasOutreach) {
        waitingRuns++;
      } else {
        needAskRuns++;
      }
    }

    return {
      totalRuns: runs.length,
      needAskRuns,
      waitingRuns,
      confirmedRuns,
      declinedRuns,
    };
  }


  function refreshCalendarFromEvents() {
    rebuildEventMap();
    renderNextUp();
    renderMonth();
    renderUpcoming();
  }

  /* ── Navigation ───────────────────────────────────── */

  prevBtn.addEventListener("click", () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    detailSection.classList.add("hidden");
    renderMonth();
  });

  nextBtn.addEventListener("click", () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    detailSection.classList.add("hidden");
    renderMonth();
  });

  /* ── Export .ics ──────────────────────────────────── */

  /** Pad a number to 2 digits. */
  function pad2(n) { return String(n).padStart(2, "0"); }

  /** Format a Date as an iCalendar UTC timestamp (YYYYMMDDTHHMMSSZ). */
  function icsTimestamp(d) {
    return d.getUTCFullYear()
      + pad2(d.getUTCMonth() + 1)
      + pad2(d.getUTCDate()) + "T"
      + pad2(d.getUTCHours())
      + pad2(d.getUTCMinutes())
      + pad2(d.getUTCSeconds()) + "Z";
  }

  /** Parse ISO-8601 duration to milliseconds. */
  function durationMs(iso) {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
  }

  function exportICS() {
    let cal = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SpeedrunCalendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:pbb8's Speedrun Marathon Calendar",
    ];

    for (const ev of MARATHON_EVENTS) {
      const runs = ev.runs || [];
      for (const run of runs) {
        const start = new Date(run.date);
        const end = new Date(start.getTime() + durationMs(run.estimate));
        const uid = `run-${run.runId}@speedruncalendar`;
        cal.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTART:${icsTimestamp(start)}`,
          `DTEND:${icsTimestamp(end)}`,
          `SUMMARY:${run.game} - ${run.category}`,
          `DESCRIPTION:${ev.name}\\n${run.category} (${run.console})\\nEstimate: ${fmtEstimate(run.estimate)}`,
          `LOCATION:${ev.url || ""}`,
          "END:VEVENT",
        );
      }
    }

    cal.push("END:VCALENDAR");

    const blob = new Blob([cal.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "speedrun-runs.ics";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Generate a single-run .ics blob URL and trigger download. */
  function exportSingleRunICS(ev, run) {
    const start = new Date(run.date);
    const end = new Date(start.getTime() + durationMs(run.estimate));
    const uid = `run-${run.runId}@speedruncalendar`;
    const twitchUrl = ev.twitch ? `https://twitch.tv/${ev.twitch}` : "";
    const cal = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SpeedrunCalendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:pbb8's Speedrun Marathon Calendar",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTART:${icsTimestamp(start)}`,
      `DTEND:${icsTimestamp(end)}`,
      `SUMMARY:${run.game} — ${ev.name}`,
      `DESCRIPTION:${ev.name}\\nWatch at: ${twitchUrl}`,
      `URL:${twitchUrl}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    const blob = new Blob([cal.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${run.game.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── Calendar URL generators ───────────────────── */

  function googleCalUrl(ev, run) {
    const start = new Date(run.date);
    const end = new Date(start.getTime() + durationMs(run.estimate));
    const title = `${run.game} — ${ev.name}`;
    const details = ev.twitch ? `Watch at https://twitch.tv/${ev.twitch}` : "";
    const p = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${icsTimestamp(start)}/${icsTimestamp(end)}`,
      details,
    });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  function outlookCalUrl(ev, run) {
    const start = new Date(run.date);
    const end = new Date(start.getTime() + durationMs(run.estimate));
    const title = `${run.game} — ${ev.name}`;
    const body = ev.twitch ? `Watch at https://twitch.tv/${ev.twitch}` : "";
    const p = new URLSearchParams({
      rru: "addevent",
      subject: title,
      startdt: start.toISOString(),
      enddt: end.toISOString(),
      body,
      path: "/calendar/action/compose",
    });
    return `https://outlook.live.com/calendar/0/action/compose?${p}`;
  }

  function yahooCalUrl(ev, run) {
    const start = new Date(run.date);
    const end = new Date(start.getTime() + durationMs(run.estimate));
    const title = `${run.game} — ${ev.name}`;
    const desc = ev.twitch ? `Watch at https://twitch.tv/${ev.twitch}` : "";
    const p = new URLSearchParams({
      v: "60",
      title,
      st: icsTimestamp(start),
      et: icsTimestamp(end),
      desc,
    });
    return `https://calendar.yahoo.com/?${p}`;
  }

  /** Return HTML for the per-run "Add to Calendar" dropdown. */
  function calDropdownHTML(evIdx, runIdx) {
    return `
      <div class="cal-dropdown-wrap">
        <button class="add-to-cal-btn" data-ev-idx="${evIdx}" data-run-idx="${runIdx}">📅 Add to Calendar ▾</button>
        <div class="cal-dropdown">
          <button class="cal-dropdown-item" data-service="google" data-ev-idx="${evIdx}" data-run-idx="${runIdx}">Google Calendar</button>
          <button class="cal-dropdown-item" data-service="outlook" data-ev-idx="${evIdx}" data-run-idx="${runIdx}">Outlook.com</button>
          <button class="cal-dropdown-item" data-service="yahoo" data-ev-idx="${evIdx}" data-run-idx="${runIdx}">Yahoo Calendar</button>
          <button class="cal-dropdown-item" data-service="ics" data-ev-idx="${evIdx}" data-run-idx="${runIdx}">Apple / Other (.ics)</button>
        </div>
      </div>
    `;
  }

  // Delegation: toggle dropdown open/close
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".add-to-cal-btn");
    // Close any open dropdowns when clicking elsewhere
    if (!toggle && !e.target.closest(".cal-dropdown")) {
      document.querySelectorAll(".cal-dropdown-wrap.open").forEach(w => w.classList.remove("open"));
      return;
    }
    if (toggle) {
      const wrap = toggle.closest(".cal-dropdown-wrap");
      const wasOpen = wrap.classList.contains("open");
      // Close all first
      document.querySelectorAll(".cal-dropdown-wrap.open").forEach(w => w.classList.remove("open"));
      if (!wasOpen) wrap.classList.add("open");
      return;
    }
    // Handle item click
    const item = e.target.closest(".cal-dropdown-item");
    if (!item) return;
    const evIdx = +item.dataset.evIdx;
    const runIdx = +item.dataset.runIdx;
    const ev = MARATHON_EVENTS[evIdx];
    const run = ev.runs[runIdx];
    const service = item.dataset.service;
    if (service === "google") window.open(googleCalUrl(ev, run), "_blank");
    else if (service === "outlook") window.open(outlookCalUrl(ev, run), "_blank");
    else if (service === "yahoo") window.open(yahooCalUrl(ev, run), "_blank");
    else if (service === "ics") exportSingleRunICS(ev, run);
    // Close dropdown
    document.querySelectorAll(".cal-dropdown-wrap.open").forEach(w => w.classList.remove("open"));
  });

  document.getElementById("export-ics").addEventListener("click", exportICS);

  /* ── Subscribe Modal ──────────────────────────────── */

  const subscribeModal = document.getElementById("subscribe-modal");
  const subscribeBtn = document.getElementById("subscribe-btn");
  const subscribeOthersBtn = document.getElementById("subscribe-others-btn");
  const subscribeClose = document.getElementById("subscribe-close");
  const subscribeTitle = document.getElementById("subscribe-title");
  const subscribeIntro = document.getElementById("subscribe-intro");

  function getIcsUrl(feedType) {
    // calendar.ics and calendar-others.ics live at the site root
    return `${window.location.origin}/${feedType === "others" ? "calendar-others.ics" : "calendar.ics"}`;
  }

  function openSubscribeModal(feedType) {
    const isOthers = feedType === "others";
    const icsUrl = getIcsUrl(feedType);
    const webcalUrl = icsUrl.replace(/^https?:/, "webcal:");

    if (subscribeTitle) {
      subscribeTitle.textContent = isOthers
        ? "Subscribe to Other Runners"
        : "Subscribe to My Runs";
    }
    if (subscribeIntro) {
      subscribeIntro.textContent = isOthers
        ? "Subscribe to runs by other people in games I run."
        : "Subscribe to pbb8's personal runs. It stays synced automatically when new runs are added!";
    }

    // Set webcal link
    document.getElementById("webcal-link").href = webcalUrl;

    // Populate all URL fields
    document.getElementById("gcal-url").value = icsUrl;
    document.getElementById("outlook-url").value = icsUrl;
    document.getElementById("other-url").value = icsUrl;

    const download = document.getElementById("download-ics-link");
    if (download) {
      download.href = icsUrl;
      download.download = isOthers ? "pbb8-other-runners.ics" : "pbb8-speedruns.ics";
    }

    subscribeModal.classList.remove("hidden");
  }

  subscribeBtn.addEventListener("click", () => openSubscribeModal("my"));
  if (subscribeOthersBtn) {
    subscribeOthersBtn.addEventListener("click", () => openSubscribeModal("others"));
  }
  subscribeClose.addEventListener("click", () => subscribeModal.classList.add("hidden"));
  subscribeModal.addEventListener("click", (e) => {
    if (e.target === subscribeModal) subscribeModal.classList.add("hidden");
  });

  // Copy-to-clipboard buttons
  document.addEventListener("click", (e) => {
    const copyBtn = e.target.closest(".copy-url-btn");
    if (!copyBtn) return;
    const input = document.getElementById(copyBtn.dataset.target);
    navigator.clipboard.writeText(input.value).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = "✅ Copied!";
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    });
  });

  /* ── Admin Auth ───────────────────────────────────── */
  const ADMIN_PASSCODE_KEY = "speedrun-admin-passcode";
  const ADMIN_STORAGE_KEY = "speedrun-admin-auth";

  function isAdmin() {
    return localStorage.getItem(ADMIN_STORAGE_KEY) === "true";
  }

  function getStoredAdminPasscode() {
    return localStorage.getItem(ADMIN_PASSCODE_KEY) || "";
  }

  function ensureAdminPasscode() {
    const existing = getStoredAdminPasscode();
    if (existing) return true;

    const first = prompt("Set a new admin passcode for this browser:");
    if (first === null) return false;
    const trimmedFirst = first.trim();
    if (!trimmedFirst) {
      alert("Passcode cannot be empty.");
      return false;
    }

    const second = prompt("Confirm your new admin passcode:");
    if (second === null) return false;
    const trimmedSecond = second.trim();
    if (trimmedFirst !== trimmedSecond) {
      alert("Passcodes did not match.");
      return false;
    }

    localStorage.setItem(ADMIN_PASSCODE_KEY, trimmedFirst);
    return true;
  }

  function setAdminMode(enabled) {
    const adminBtn = document.getElementById("admin-toggle");
    if (enabled) {
      document.body.classList.add("admin-mode");
      localStorage.setItem(ADMIN_STORAGE_KEY, "true");
      if (adminBtn) {
        adminBtn.textContent = "\uD83D\uDD13";
        adminBtn.title = "Admin mode active \u2014 click to lock";
      }
    } else {
      document.body.classList.remove("admin-mode");
      localStorage.removeItem(ADMIN_STORAGE_KEY);
      if (adminBtn) {
        adminBtn.textContent = "\uD83D\uDD12";
        adminBtn.title = "Unlock admin mode";
      }
    }
  }

  const adminToggleBtn = document.getElementById("admin-toggle");
  if (adminToggleBtn) {
    adminToggleBtn.addEventListener("click", () => {
      if (isAdmin()) {
        setAdminMode(false);
      } else {
        if (!ensureAdminPasscode()) {
          return;
        }
        const pw = prompt("Enter admin passcode:");
        if (pw !== null && pw.trim() === getStoredAdminPasscode()) {
          setAdminMode(true);
        } else if (pw !== null) {
          alert("Incorrect password.");
        }
      }
    });
  }

  // Restore admin state on load
  if (isAdmin()) {
    setAdminMode(true);
  }

  /* ── Next Up Banner ───────────────────────────────── */

  function renderNextUp() {
    const nextUpEl = document.getElementById("next-up");
    const now = new Date();
    let nextRun = null;
    let nextEv = null;

    for (const ev of MARATHON_EVENTS) {
      for (const run of ev.runs || []) {
        const runDate = new Date(run.date);
        if (runDate > now && (!nextRun || runDate < new Date(nextRun.date))) {
          nextRun = run;
          nextEv = ev;
        }
      }
    }

    if (!nextRun) {
      nextUpEl.classList.add("hidden");
      return;
    }

    const runDate = new Date(nextRun.date);
    const diff = runDate - now;
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);

    let countdown = "";
    if (days > 0) countdown += `${days}d `;
    if (hours > 0 || days > 0) countdown += `${hours}h `;
    countdown += `${mins}m`;

    const evIdx = MARATHON_EVENTS.indexOf(nextEv);
    const runIdx = nextEv.runs.indexOf(nextRun);

    nextUpEl.innerHTML = `
      <span class="next-up-label">Next Up</span>
      <span class="next-up-marathon">${nextEv.name}</span>
      <span class="next-up-game">${nextRun.game}</span>
      <span class="next-up-time">${fmtShortDate(runDate)} ${fmtTime(runDate)}</span>
      <span class="next-up-countdown">in ${countdown}</span>
      <div class="next-up-actions">
        ${nextEv.twitch ? `<a class="next-up-watch" href="https://twitch.tv/${nextEv.twitch}" target="_blank" rel="noopener">📺 Watch</a>` : ""}
        ${calDropdownHTML(evIdx, runIdx)}
      </div>
    `;
    nextUpEl.classList.remove("hidden");
  }

  /* ── Init ─────────────────────────────────────────── */
  tzLabel.textContent = userTZ.replace(/_/g, " ");
  renderNextUp();
  // Update countdown every minute
  setInterval(renderNextUp, 60000);
  renderMonth();
  renderUpcoming();

  // Allow external scripts (e.g. Firebase submissions) to inject runs
  // and re-render using the same native formatting and behaviors.
  window.refreshCalendarFromEvents = refreshCalendarFromEvents;
})();
