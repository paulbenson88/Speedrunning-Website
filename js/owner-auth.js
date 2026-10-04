(function () {
  "use strict";

  const OWNER_EMAILS = (window.FIREBASE_OWNER_EMAILS || [])
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(Boolean);
  const OWNER_UIDS = (window.FIREBASE_OWNER_UIDS || [])
    .map((uid) => String(uid || "").trim())
    .filter(Boolean);
  const OWNER_ACCESS_CACHE_KEY = "speedrun-owner-submit-access";

  const listeners = new Set();
  let auth = null;
  let user = null;
  let isOwner = false;

  function ownerConfigured() {
    return OWNER_EMAILS.length > 0 || OWNER_UIDS.length > 0;
  }

  function computeIsOwner(authUser) {
    if (!authUser || !ownerConfigured()) return false;
    const email = String(authUser.email || "").trim().toLowerCase();
    const uid = String(authUser.uid || "").trim();
    if (uid && OWNER_UIDS.includes(uid)) return true;
    if (email && OWNER_EMAILS.includes(email)) return true;
    return false;
  }

  function updateSubmitTabVisibility(canAccess) {
    const links = document.querySelectorAll('a[href="submit.html"]');
    links.forEach((link) => {
      link.classList.toggle("owner-only-hidden", !canAccess);
      if (!canAccess) {
        link.setAttribute("aria-hidden", "true");
        link.setAttribute("tabindex", "-1");
      } else {
        link.removeAttribute("aria-hidden");
        link.removeAttribute("tabindex");
      }
    });
  }

  function readCachedAccess() {
    try {
      return localStorage.getItem(OWNER_ACCESS_CACHE_KEY) === "true";
    } catch (_) {
      return false;
    }
  }

  function writeCachedAccess(canAccess) {
    try {
      localStorage.setItem(OWNER_ACCESS_CACHE_KEY, canAccess ? "true" : "false");
    } catch (_) {
      // Ignore localStorage write errors.
    }
  }

  function snapshot() {
    return {
      user,
      isOwner,
      ownerConfigured: ownerConfigured(),
      authReady: Boolean(auth)
    };
  }

  function notify() {
    writeCachedAccess(isOwner);
    updateSubmitTabVisibility(isOwner);
    document.body.classList.toggle("is-owner", isOwner);

    const state = snapshot();
    listeners.forEach((cb) => {
      try {
        cb(state);
      } catch (_) {
        // Ignore listener errors so other listeners continue.
      }
    });
  }

  async function signInWithGoogle() {
    if (!auth) throw new Error("Firebase Auth is not available on this page.");
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await auth.signInWithPopup(provider);
  }

  async function signOut() {
    if (!auth) return;
    await auth.signOut();
  }

  const ready = (async function init() {
    const cachedAccess = readCachedAccess();
    updateSubmitTabVisibility(cachedAccess);
    document.body.classList.toggle("is-owner", cachedAccess);

    try {
      if (!window.firebase || !firebase.auth) {
        notify();
        return;
      }

      const cfg = window.FIREBASE_CONFIG || {};
      if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
        notify();
        return;
      }

      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      auth = app.auth();

      await new Promise((resolve) => {
        let resolved = false;
        auth.onAuthStateChanged((nextUser) => {
          user = nextUser || null;
          isOwner = computeIsOwner(user);
          notify();

          if (!resolved) {
            resolved = true;
            resolve();
          }
        });
      });
    } catch (_) {
      notify();
    }
  })();

  window.SpeedrunOwnerAuth = {
    ready,
    getState: snapshot,
    onChange(callback) {
      if (typeof callback !== "function") return function () {};
      listeners.add(callback);
      callback(snapshot());
      return function () {
        listeners.delete(callback);
      };
    },
    signInWithGoogle,
    signOut
  };
})();
