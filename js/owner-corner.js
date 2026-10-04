(function () {
  "use strict";

  const header = document.querySelector("header");
  if (!header || !window.SpeedrunOwnerAuth) return;

  const scriptSrc = document.currentScript && document.currentScript.src;
  const homeUrl = scriptSrc ? new URL("../", scriptSrc).href : "/";
  const isHome = Boolean(document.querySelector("[data-site-layout]"));

  const style = document.createElement("style");
  style.textContent = [
    ".owner-corner{position:absolute;top:6px;right:10px;z-index:5;display:inline-flex;align-items:center;gap:2px;font-size:10px;line-height:1;opacity:.3;transition:opacity .15s}",
    ".owner-corner:hover,.owner-corner:focus-within{opacity:.9}",
    ".owner-corner a,.owner-corner button{all:unset;cursor:pointer;color:#c5cede;padding:3px 4px;border-radius:4px;font:inherit;font-size:10px}",
    ".owner-corner a:hover,.owner-corner button:hover,.owner-corner a:focus-visible,.owner-corner button:focus-visible{color:#7ef2ff}",
    ".owner-corner .owner-corner-sep{color:#c5cede}",
    ".owner-corner .hidden{display:none!important}"
  ].join("\n");
  document.head.appendChild(style);

  if (getComputedStyle(header).position === "static") header.style.position = "relative";

  const corner = document.createElement("div");
  corner.className = "owner-corner";
  const editMarkup = isHome
    ? '<button type="button" id="site-editor-launch" class="owner-corner-edit">Edit site</button>'
    : `<a class="owner-corner-edit" href="${homeUrl}?edit=1">Edit site</a>`;
  corner.innerHTML =
    editMarkup +
    '<span class="owner-corner-sep hidden" aria-hidden="true">·</span>' +
    '<button type="button" id="site-editor-signout" class="owner-corner-out hidden">Sign out</button>';
  header.appendChild(corner);

  const sep = corner.querySelector(".owner-corner-sep");
  const out = corner.querySelector(".owner-corner-out");

  if (!isHome) out.addEventListener("click", async () => {
    try {
      await window.SpeedrunOwnerAuth.signOut();
    } catch (error) {
      window.alert(`Could not sign out. ${error.message}`);
    }
  });

  window.SpeedrunOwnerAuth.onChange((state) => {
    const signedIn = Boolean(state && state.user);
    sep.classList.toggle("hidden", !signedIn);
    out.classList.toggle("hidden", !signedIn);
  });
})();
