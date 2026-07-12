/**
 * commentators.js — Manages commentator assignments for speedrun events.
 *
 * Stores data in localStorage so it persists across sessions.
 * Each event (keyed by name) has an array of commentator objects:
 *   { name: string, status: "not-asked"|"asked"|"confirmed"|"declined" }
 */

// eslint-disable-next-line no-unused-vars
const CommentatorManager = (function () {
  "use strict";

  const STORAGE_KEY = "speedrun-commentators";
  const GAME_STORAGE_KEY = "speedrun-commentators-by-game";
  const FIRESTORE_COLLECTION = "commentatorData";
  const FIRESTORE_DOC = "global";
  const UPDATE_EVENT = "commentators-updated";

  const STATUSES = {
    "not-asked": { label: "Not Asked", icon: "⬜", className: "status-not-asked" },
    asked:       { label: "Asked",     icon: "📨", className: "status-asked" },
    confirmed:   { label: "Confirmed", icon: "✅", className: "status-confirmed" },
    declined:    { label: "Declined",  icon: "❌", className: "status-declined" },
  };

  let firebaseInitStarted = false;
  let firebaseReady = false;
  let firestoreDb = null;
  let syncTimer = null;

  function emitUpdate() {
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  }

  function getFirebaseConfig() {
    return window.FIREBASE_CONFIG || {};
  }

  function hasFirebaseConfig() {
    const cfg = getFirebaseConfig();
    return Boolean(cfg.apiKey && cfg.projectId && cfg.appId);
  }

  function canUseFirebase() {
    return Boolean(window.firebase && firebase.firestore && hasFirebaseConfig());
  }

  function getOwnerState() {
    if (!window.SpeedrunOwnerAuth || !window.SpeedrunOwnerAuth.getState) {
      return { isOwner: false, user: null };
    }
    return window.SpeedrunOwnerAuth.getState() || { isOwner: false, user: null };
  }

  /** Load all commentator data from localStorage. */
  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  /** Load per-game commentator pools from localStorage. */
  function loadGamePools() {
    try {
      return JSON.parse(localStorage.getItem(GAME_STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  /** Save per-game commentator pools to localStorage. */
  function saveGamePools(data) {
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(data));
    scheduleFirebaseSync();
  }

  function normalizeGameName(gameName) {
    return String(gameName || "").trim().toLowerCase();
  }

  function normalizeCommentatorName(commentatorName) {
    return String(commentatorName || "").trim().toLowerCase();
  }

  /** Save all commentator data to localStorage. */
  function saveAll(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    scheduleFirebaseSync();
  }

  function mergeRemoteEventData(remoteEventData) {
    if (!remoteEventData || typeof remoteEventData !== "object") return;
    const local = loadAll();

    for (const [eventName, commenters] of Object.entries(remoteEventData)) {
      if (!Array.isArray(commenters)) continue;
      if (!local[eventName]) local[eventName] = [];

      const localByName = new Map(
        local[eventName].map((c) => [normalizeCommentatorName(c.name), c])
      );

      const remoteList = commenters
        .filter((c) => c && typeof c.name === "string")
        .map((c) => ({
          name: String(c.name).trim(),
          status: STATUSES[c.status] ? c.status : "not-asked",
        }));

      for (const remoteC of remoteList) {
        const key = normalizeCommentatorName(remoteC.name);
        if (!key) continue;
        if (!localByName.has(key)) {
          localByName.set(key, remoteC);
        }
      }

      local[eventName] = Array.from(localByName.values());
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
  }

  function mergeRemoteGamePools(remoteGamePools) {
    if (!remoteGamePools || typeof remoteGamePools !== "object") return;
    const local = loadGamePools();

    for (const [gameKey, names] of Object.entries(remoteGamePools)) {
      if (!Array.isArray(names)) continue;
      const existing = new Map(
        (local[gameKey] || []).map((name) => [normalizeCommentatorName(name), String(name).trim()])
      );

      const remoteNames = names
        .filter((name) => typeof name === "string")
        .map((name) => String(name).trim())
        .filter(Boolean);

      for (const name of remoteNames) {
        const key = normalizeCommentatorName(name);
        if (!existing.has(key)) existing.set(key, name);
      }

      local[gameKey] = Array.from(existing.values());
    }

    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(local));
  }

  async function ensureFirebaseReady() {
    if (firebaseReady) return true;
    if (!canUseFirebase()) return false;

    if (!firebaseInitStarted) {
      firebaseInitStarted = true;
      try {
        if (window.SpeedrunOwnerAuth && window.SpeedrunOwnerAuth.ready) {
          await window.SpeedrunOwnerAuth.ready;
        }

        const cfg = getFirebaseConfig();
        const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
        firestoreDb = app.firestore();

        const snap = await firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC).get();
        if (snap.exists) {
          const remote = snap.data() || {};
          mergeRemoteEventData(remote.events || {});
          mergeRemoteGamePools(remote.games || {});
          emitUpdate();
        }

        firebaseReady = true;
      } catch {
        firebaseReady = false;
      }
    }

    return firebaseReady;
  }

  async function syncToFirebaseNow() {
    const ready = await ensureFirebaseReady();
    if (!ready || !firestoreDb) return;

    const ownerState = getOwnerState();
    if (!ownerState.isOwner) return;

    try {
      await firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC).set(
        {
          events: loadAll(),
          games: loadGamePools(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: ownerState.user?.uid || "owner",
        },
        { merge: true }
      );
    } catch {
      // Keep local data if cloud sync fails.
    }
  }

  function scheduleFirebaseSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncToFirebaseNow();
    }, 400);
  }

  /** Get commentators for a specific event. */
  function getForEvent(eventName) {
    const data = loadAll();
    return data[eventName] || [];
  }

  /** Get saved commentator names for a specific game. */
  function getForGame(gameName) {
    const gameKey = normalizeGameName(gameName);
    if (!gameKey) return [];
    const pools = loadGamePools();
    return pools[gameKey] || [];
  }

  /** Save one commentator into a game's reusable pool. */
  function rememberForGame(gameName, commentatorName) {
    const gameKey = normalizeGameName(gameName);
    const trimmedName = String(commentatorName || "").trim();
    if (!gameKey || !trimmedName) return;

    const pools = loadGamePools();
    if (!pools[gameKey]) pools[gameKey] = [];

    const exists = pools[gameKey].some(
      (name) => normalizeCommentatorName(name) === normalizeCommentatorName(trimmedName)
    );
    if (!exists) {
      pools[gameKey].push(trimmedName);
      saveGamePools(pools);
    }
  }

  /** Add a commentator to an event. */
  function add(eventName, commentatorName, gameName, options) {
    const data = loadAll();
    const trimmedName = String(commentatorName || "").trim();
    const opts = options || {};
    const status = STATUSES[opts.status] ? opts.status : "not-asked";
    if (!trimmedName) return false;
    if (!data[eventName]) data[eventName] = [];
    // Avoid duplicates (case-insensitive)
    const existing = data[eventName].find(
      (c) => c.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (existing) {
      if (opts.overwriteStatus && existing.status !== status) {
        existing.status = status;
        saveAll(data);
        emitUpdate();
      }
      rememberForGame(gameName, trimmedName);
      return false;
    }

    data[eventName].push({ name: trimmedName, status });
    saveAll(data);
    rememberForGame(gameName, trimmedName);
    emitUpdate();
    return true;
  }

  /**
   * For a run/event in a known game, auto-assume outreach is done and mark
   * saved names as confirmed on this event (including previously declined).
   */
  function applyGamePoolAsConfirmed(eventName, gameName) {
    const names = getForGame(gameName);
    let changed = 0;
    for (const name of names) {
      const added = add(eventName, name, gameName, {
        status: "confirmed",
        overwriteStatus: false,
      });
      if (added) changed++;
    }
    return changed;
  }

  /** Remove a commentator from an event. */
  function remove(eventName, commentatorName) {
    const data = loadAll();
    if (!data[eventName]) return;
    data[eventName] = data[eventName].filter(
      (c) => c.name.toLowerCase() !== commentatorName.toLowerCase()
    );
    saveAll(data);
    emitUpdate();
  }

  /** Update a commentator's status for an event. */
  function setStatus(eventName, commentatorName, newStatus) {
    if (!STATUSES[newStatus]) return;
    const data = loadAll();
    if (!data[eventName]) return;
    const entry = data[eventName].find(
      (c) => c.name.toLowerCase() === commentatorName.toLowerCase()
    );
    if (entry) {
      entry.status = newStatus;
      saveAll(data);
      emitUpdate();
    }
  }

  /** Rename a commentator for a single event (with duplicate protection). */
  function rename(eventName, oldName, newName, gameName) {
    const trimmedNewName = String(newName || "").trim();
    if (!trimmedNewName) return false;

    const oldKey = normalizeCommentatorName(oldName);
    const newKey = normalizeCommentatorName(trimmedNewName);
    if (!oldKey || !newKey) return false;

    const data = loadAll();
    if (!Array.isArray(data[eventName])) return false;

    const eventCommentators = data[eventName];
    const targetIndex = eventCommentators.findIndex(
      (c) => normalizeCommentatorName(c.name) === oldKey
    );
    if (targetIndex === -1) return false;

    const duplicateIndex = eventCommentators.findIndex(
      (c, idx) => idx !== targetIndex && normalizeCommentatorName(c.name) === newKey
    );
    if (duplicateIndex !== -1) return false;

    eventCommentators[targetIndex].name = trimmedNewName;
    saveAll(data);

    const gameKey = normalizeGameName(gameName);
    if (gameKey) {
      const pools = loadGamePools();
      const existingPool = Array.isArray(pools[gameKey]) ? pools[gameKey] : [];
      const updated = [];
      let insertedNewName = false;

      for (const savedName of existingPool) {
        const savedKey = normalizeCommentatorName(savedName);
        if (!savedKey) continue;

        if (savedKey === oldKey) {
          if (!updated.some((n) => normalizeCommentatorName(n) === newKey)) {
            updated.push(trimmedNewName);
          }
          insertedNewName = true;
          continue;
        }

        if (!updated.some((n) => normalizeCommentatorName(n) === savedKey)) {
          updated.push(savedName);
        }
      }

      if (!insertedNewName && !updated.some((n) => normalizeCommentatorName(n) === newKey)) {
        updated.push(trimmedNewName);
      }

      pools[gameKey] = updated;
      saveGamePools(pools);
    }

    emitUpdate();
    return true;
  }

  /** Get a summary across all events for reporting. */
  function getSummary() {
    const data = loadAll();
    const summary = [];
    for (const [eventName, commentators] of Object.entries(data)) {
      if (commentators.length === 0) continue;
      summary.push({
        event: eventName,
        total: commentators.length,
        confirmed: commentators.filter((c) => c.status === "confirmed").length,
        asked: commentators.filter((c) => c.status === "asked").length,
        declined: commentators.filter((c) => c.status === "declined").length,
        notAsked: commentators.filter((c) => c.status === "not-asked").length,
      });
    }
    return summary;
  }

  // Start background cloud load when Firebase is available.
  ensureFirebaseReady();

  return {
    STATUSES,
    getForEvent,
    getForGame,
    rememberForGame,
    applyGamePoolAsConfirmed,
    add,
    remove,
    setStatus,
    rename,
    getSummary,
  };
})();
