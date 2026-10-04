(function () {
  "use strict";

  const CONTENT_SELECTOR = "[data-site-content]";
  const LINK_SELECTOR = "[data-site-link]";
  const SECTION_SELECTOR = "[data-site-section]";
  const LAYOUT_SELECTOR = "[data-site-layout]";
  const CONTENT_MAX_LENGTH = 2000;
  const SNAP_DISTANCE = 8;
  const OFFSET_MIN_VIEWPORT = 900;
  const GROUP_LABELS = {
    "hero-left": "Introduction and history",
    "hero-side": "About, stream, and socials",
    "game-cards": "Game cards"
  };

  const launchButton = document.getElementById("site-editor-launch");
  const signOutButton = document.getElementById("site-editor-signout");
  const panel = document.getElementById("site-editor-panel");
  const closeButton = document.getElementById("site-editor-close");
  const publishButton = document.getElementById("site-editor-publish");
  const previewButton = document.getElementById("site-editor-preview");
  const discardButton = document.getElementById("site-editor-discard");
  const returnButton = document.getElementById("site-editor-return");
  const previewBar = document.getElementById("site-editor-preview-bar");
  const status = document.getElementById("site-editor-status");
  const layoutContainer = document.getElementById("site-editor-layout");
  const fieldsForm = document.getElementById("site-editor-fields");

  if (!launchButton || !panel || !window.SpeedrunOwnerAuth) return;

  const contentNodes = [...document.querySelectorAll(CONTENT_SELECTOR)];
  const linkNodes = [...document.querySelectorAll(LINK_SELECTOR)];
  const layoutGroups = [...document.querySelectorAll(LAYOUT_SELECTOR)];
  const defaultState = {
    content: Object.fromEntries(contentNodes.map((node) => [
      node.dataset.siteContent,
      node.textContent.trim()
    ])),
    links: Object.fromEntries(linkNodes.map((node) => [
      node.dataset.siteLink,
      node.getAttribute("href") || ""
    ])),
    layout: Object.fromEntries(layoutGroups.map((group) => [
      group.dataset.siteLayout,
      [...group.querySelectorAll(`:scope > ${SECTION_SELECTOR}`)].map((section) => section.dataset.siteSection)
    ])),
    sizes: {},
    offsets: {},
    padding: {}
  };
  const sectionNodes = [...document.querySelectorAll(SECTION_SELECTOR)];

  let publishedState = clone(defaultState);
  let draftState = clone(defaultState);
  let ownerState = window.SpeedrunOwnerAuth.getState();
  let firestore = null;
  let loadError = null;
  let draggedSection = null;
  let previewing = false;
  let publishing = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setEditingHighlights(enabled) {
    contentNodes.concat(linkNodes).forEach((node) => {
      node.classList.toggle("site-editor-highlight", enabled);
    });
  }

  function stateSignature(value) {
    return JSON.stringify(value);
  }

  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }

  function isDirty() {
    return stateSignature(draftState) !== stateSignature(publishedState);
  }

  function updateStatus() {
    publishButton.disabled = publishing || Boolean(loadError) || !ownerState?.isOwner;
    if (publishing) return;
    if (loadError) {
      showStatus(`Could not load the saved homepage. Publishing is disabled until this is resolved. ${loadError.message}`, true);
      return;
    }
    showStatus(isDirty() ? "Unpublished changes are previewing on this page." : "All changes are published.", false);
  }

  function applyContent(state) {
    for (const node of contentNodes) {
      const value = state.content[node.dataset.siteContent];
      if (typeof value === "string") node.textContent = value;
    }
    document.title = state.content.pageTitle || document.title;
    for (const node of linkNodes) {
      const value = state.links[node.dataset.siteLink];
      if (typeof value === "string") node.href = value;
    }
  }

  function applyLayout(layout) {
    for (const group of layoutGroups) {
      const sections = [...group.querySelectorAll(`:scope > ${SECTION_SELECTOR}`)];
      const byId = new Map(sections.map((section) => [section.dataset.siteSection, section]));
      const configuredOrder = layout[group.dataset.siteLayout] || [];
      const ordered = [
        ...configuredOrder.map((id) => byId.get(id)).filter(Boolean),
        ...sections.filter((section) => !configuredOrder.includes(section.dataset.siteSection))
      ];
      ordered.forEach((section) => group.appendChild(section));
    }
  }

  function applySizes(sizes) {
    for (const section of sectionNodes) {
      const size = sizes[section.dataset.siteSection] || {};
      section.style.width = size.w ? `${size.w}%` : "";
      section.style.height = size.h ? `${size.h}px` : "";
      section.style.overflow = size.h ? "auto" : "";
      section.style.justifySelf = size.w ? "start" : "";
    }
  }

  function applyOffsets(state) {
    const enabled = window.innerWidth >= OFFSET_MIN_VIEWPORT;
    for (const section of sectionNodes) {
      const id = section.dataset.siteSection;
      const offset = (enabled && state.offsets[id]) || {};
      section.style.marginTop = offset.y ? `${offset.y}px` : "";
      section.style.left = offset.x ? `${offset.x}px` : "";
      if (offset.x) section.style.position = "relative";
      else if (!section.classList.contains("site-editor-resizable")) section.style.position = "";
      const pad = state.padding[id];
      section.style.padding = Number.isFinite(pad) ? `${pad}px` : "";
    }
  }

  function applyState(state) {
    applyContent(state);
    applyLayout(state.layout);
    applySizes(state.sizes);
    applyOffsets(state);
  }

  window.addEventListener("resize", () => applyOffsets(draftState));

  function startMove(event) {
    const grip = event.target.closest(".site-editor-move-handle");
    if (!grip || window.innerWidth < OFFSET_MIN_VIEWPORT) return;
    const section = grip.parentElement;
    const id = section.dataset.siteSection;
    const start = section.getBoundingClientRect();
    const base = draftState.offsets[id] || { x: 0, y: 0 };
    const originX = event.clientX;
    const originY = event.clientY;
    const others = sectionNodes
      .filter((node) => node !== section && node.offsetParent !== null)
      .map((node) => ({ rect: node.getBoundingClientRect(), label: node.dataset.editorSectionLabel || node.dataset.siteSection }));
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const guideV = document.createElement("div");
    const guideH = document.createElement("div");
    const readout = document.createElement("div");
    guideV.className = "site-editor-guide is-vertical";
    guideH.className = "site-editor-guide is-horizontal";
    readout.className = "site-editor-readout";
    document.body.append(guideV, guideH, readout);

    const bestSnap = (candidates) => {
      let best = null;
      for (const c of candidates) {
        const d = Math.abs(c.delta);
        if (d <= SNAP_DISTANCE && (!best || d < Math.abs(best.delta))) best = c;
      }
      return best;
    };

    const onMove = (e) => {
      let dx = e.clientX - originX;
      let dy = e.clientY - originY;
      const notes = [];
      guideV.style.display = "none";
      guideH.style.display = "none";
      if (!e.altKey) {
        const xs = [start.left, start.left + start.width / 2, start.right];
        const ys = [start.top, start.top + start.height / 2, start.bottom];
        const xSnap = bestSnap(others.flatMap((o) => {
          const targets = [[o.rect.left, "left edge"], [o.rect.left + o.rect.width / 2, "center"], [o.rect.right, "right edge"]];
          return xs.flatMap((x, i) => targets.map(([target, name]) => ({ delta: target - (x + dx), line: target, note: `Aligned with ${name} of ${o.label}` })));
        }));
        const ySnap = bestSnap(others.flatMap((o) => {
          const targets = [[o.rect.top, "top"], [o.rect.top + o.rect.height / 2, "middle"], [o.rect.bottom, "bottom"]];
          return ys.flatMap((y) => targets.map(([target, name]) => ({ delta: target - (y + dy), line: target, note: `Aligned with ${name} of ${o.label}` })));
        }));
        if (xSnap) { dx += xSnap.delta; notes.push(xSnap.note); guideV.style.cssText = `display:block;left:${xSnap.line}px`; }
        if (ySnap) { dy += ySnap.delta; notes.push(ySnap.note); guideH.style.cssText = `display:block;top:${ySnap.line}px`; }
        if (!ySnap && Math.abs(base.y + dy) <= SNAP_DISTANCE) { dy = -base.y; notes.push("Default spacing"); }
        if (!xSnap && Math.abs(base.x + dx) <= SNAP_DISTANCE) { dx = -base.x; notes.push("Default position"); }
      }
      const x = Math.max(-1200, Math.min(1200, Math.round(base.x + dx)));
      const y = Math.max(-1200, Math.min(1200, Math.round(base.y + dy)));
      if (x || y) draftState.offsets[id] = { x, y };
      else delete draftState.offsets[id];
      applyOffsets(draftState);
      readout.textContent = [`x ${x}px, y ${y}px`, ...notes].join(" · ");
      readout.style.left = `${Math.min(window.innerWidth - 300, e.clientX + 14)}px`;
      readout.style.top = `${e.clientY + 14}px`;
      updateStatus();
    };
    const onUp = () => {
      guideV.remove();
      guideH.remove();
      readout.remove();
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  }

  function setResizeHandles(enabled) {
    for (const section of sectionNodes) {
      section.classList.toggle("site-editor-resizable", enabled);
      let handle = section.querySelector(":scope > .site-editor-resize-handle");
      if (enabled && !handle) {
        handle = document.createElement("button");
        handle.type = "button";
        handle.className = "site-editor-resize-handle";
        handle.title = "Drag to resize (double-click to reset)";
        handle.setAttribute("aria-label", `Resize ${section.dataset.editorSectionLabel || section.dataset.siteSection}`);
        section.appendChild(handle);
      } else if (!enabled && handle) {
        handle.remove();
      }
      let grip = section.querySelector(":scope > .site-editor-move-handle");
      if (enabled && !grip) {
        grip = document.createElement("button");
        grip.type = "button";
        grip.className = "site-editor-move-handle";
        grip.textContent = "✥ Move";
        grip.title = "Drag to move this box (double-click to reset position)";
        grip.setAttribute("aria-label", `Move ${section.dataset.editorSectionLabel || section.dataset.siteSection}`);
        section.appendChild(grip);
      } else if (!enabled && grip) {
        grip.remove();
      }
    }
  }

  function startResize(event) {
    const handle = event.target.closest(".site-editor-resize-handle");
    if (!handle) return;
    const section = handle.parentElement;
    const id = section.dataset.siteSection;
    const parentWidth = section.parentElement.getBoundingClientRect().width;
    const start = section.getBoundingClientRect();
    const originX = event.clientX;
    const originY = event.clientY;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);

    const others = sectionNodes
      .filter((node) => node !== section && node.offsetParent !== null)
      .map((node) => ({ rect: node.getBoundingClientRect(), label: node.dataset.editorSectionLabel || node.dataset.siteSection }));
    const parentRect = section.parentElement.getBoundingClientRect();
    const guideV = document.createElement("div");
    const guideH = document.createElement("div");
    const readout = document.createElement("div");
    guideV.className = "site-editor-guide is-vertical";
    guideH.className = "site-editor-guide is-horizontal";
    readout.className = "site-editor-readout";
    document.body.append(guideV, guideH, readout);

    const snap = (value, candidates) => {
      let best = null;
      for (const candidate of candidates) {
        const distance = Math.abs(candidate.value - value);
        if (distance <= SNAP_DISTANCE && (!best || distance < best.distance)) best = { ...candidate, distance };
      }
      return best;
    };

    const onMove = (moveEvent) => {
      let width = Math.max(40, start.width + moveEvent.clientX - originX);
      let height = Math.max(80, start.height + moveEvent.clientY - originY);
      const notes = [];
      guideV.style.display = "none";
      guideH.style.display = "none";

      if (!moveEvent.altKey) {
        const widthSnap = snap(width, [
          { value: parentRect.width, label: "full width" },
          ...others.flatMap((o) => [
            { value: o.rect.width, label: `width of ${o.label}` },
            { value: o.rect.right - start.left, label: `right edge of ${o.label}`, line: o.rect.right }
          ])
        ]);
        const heightSnap = snap(height, others.flatMap((o) => [
          { value: o.rect.height, label: `height of ${o.label}` },
          { value: o.rect.bottom - start.top, label: `bottom of ${o.label}`, line: o.rect.bottom }
        ]));
        if (widthSnap) {
          width = widthSnap.value;
          notes.push(`Matches ${widthSnap.label}`);
          guideV.style.cssText = `display:block;left:${start.left + width}px`;
        }
        if (heightSnap) {
          height = heightSnap.value;
          notes.push(`Matches ${heightSnap.label}`);
          guideH.style.cssText = `display:block;top:${start.top + height}px`;
        }
      }

      const w = Math.min(100, Math.max(20, Math.round((width / parentRect.width) * 1000) / 10));
      const h = Math.min(3000, Math.max(80, Math.round(height)));
      draftState.sizes[id] = { w, h };
      applySizes(draftState.sizes);
      readout.textContent = [`${Math.round(width)} × ${h}px`, ...notes].join(" · ");
      readout.style.left = `${Math.min(window.innerWidth - 260, moveEvent.clientX + 14)}px`;
      readout.style.top = `${moveEvent.clientY + 14}px`;
      updateStatus();
    };
    const onUp = () => {
      guideV.remove();
      guideH.remove();
      readout.remove();
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function resetSize(event) {
    const grip = event.target.closest(".site-editor-move-handle");
    if (grip) {
      delete draftState.offsets[grip.parentElement.dataset.siteSection];
      applyOffsets(draftState);
      updateStatus();
      return;
    }
    const handle = event.target.closest(".site-editor-resize-handle");
    if (!handle) return;
    delete draftState.sizes[handle.parentElement.dataset.siteSection];
    applySizes(draftState.sizes);
    updateStatus();
  }

  function normalizeRemoteState(data) {
    const next = clone(defaultState);
    if (data.content && typeof data.content === "object") {
      for (const key of Object.keys(next.content)) {
        if (typeof data.content[key] === "string" && data.content[key].length <= CONTENT_MAX_LENGTH) {
          next.content[key] = data.content[key];
        }
      }
    }
    if (data.links && typeof data.links === "object") {
      for (const key of Object.keys(next.links)) {
        if (typeof data.links[key] === "string" && isAllowedUrl(data.links[key])) {
          next.links[key] = data.links[key];
        }
      }
    }
    if (data.layout && typeof data.layout === "object") {
      for (const group of layoutGroups) {
        const groupId = group.dataset.siteLayout;
        const knownIds = new Set(defaultState.layout[groupId]);
        const requested = Array.isArray(data.layout[groupId]) ? data.layout[groupId] : [];
        next.layout[groupId] = [
          ...new Set(requested.filter((id) => typeof id === "string" && knownIds.has(id))),
          ...defaultState.layout[groupId].filter((id) => !requested.includes(id))
        ];
      }
    }
    if (data.sizes && typeof data.sizes === "object") {
      for (const section of sectionNodes) {
        const id = section.dataset.siteSection;
        const size = data.sizes[id];
        if (!size || typeof size !== "object") continue;
        const w = Number(size.w);
        const h = Number(size.h);
        const clean = {};
        if (Number.isFinite(w) && w >= 20 && w <= 100) clean.w = w;
        if (Number.isFinite(h) && h >= 80 && h <= 3000) clean.h = h;
        if (clean.w || clean.h) next.sizes[id] = clean;
      }
    }
    for (const section of sectionNodes) {
      const id = section.dataset.siteSection;
      const o = data.offsets && data.offsets[id];
      if (o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y)) && Math.abs(o.x) <= 1200 && Math.abs(o.y) <= 1200 && (o.x || o.y)) {
        next.offsets[id] = { x: Number(o.x), y: Number(o.y) };
      }
      const p = data.padding && Number(data.padding[id]);
      if (data.padding && data.padding[id] !== undefined && Number.isFinite(p) && p >= 0 && p <= 120) next.padding[id] = p;
    }
    return next;
  }

  function isAllowedUrl(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
      const url = new URL(value.trim(), window.location.href);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  function renderLayoutEditor() {
    layoutContainer.replaceChildren();
    for (const group of layoutGroups) {
      const groupId = group.dataset.siteLayout;
      const groupEditor = document.createElement("section");
      groupEditor.className = "site-editor-layout-group";
      const heading = document.createElement("h3");
      heading.textContent = GROUP_LABELS[groupId] || groupId;
      const list = document.createElement("ol");
      list.className = "site-editor-layout-list";
      list.dataset.layoutGroup = groupId;

      for (const [index, sectionId] of draftState.layout[groupId].entries()) {
        const section = group.querySelector(`:scope > [data-site-section="${sectionId}"]`);
        if (!section) continue;
        const item = document.createElement("li");
        item.className = "site-editor-layout-item";
        item.draggable = true;
        item.dataset.sectionId = sectionId;
        item.dataset.layoutGroup = groupId;

        const label = document.createElement("span");
        label.className = "site-editor-layout-label";
        label.textContent = section.dataset.editorSectionLabel || sectionId;
        item.appendChild(label);

        const controls = document.createElement("span");
        controls.className = "site-editor-layout-controls";
        for (const [direction, text, labelText] of [
          ["up", "↑", "Move up"],
          ["down", "↓", "Move down"]
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.moveDirection = direction;
          button.dataset.sectionId = sectionId;
          button.dataset.layoutGroup = groupId;
          button.textContent = text;
          button.setAttribute("aria-label", `${labelText}: ${label.textContent}`);
          button.disabled = direction === "up" ? index === 0 : index === draftState.layout[groupId].length - 1;
          controls.appendChild(button);
        }
        item.appendChild(controls);
        list.appendChild(item);
      }

      groupEditor.append(heading, list);
      layoutContainer.appendChild(groupEditor);
    }
  }

  function addEditorField(labelText, key, value, isLink) {
    const label = document.createElement("label");
    label.className = "site-editor-field";
    label.textContent = labelText;

    const field = document.createElement(isLink || value.length <= 90 ? "input" : "textarea");
    field.dataset.editorKey = key;
    field.dataset.editorType = isLink ? "link" : "content";
    field.value = value;
    field.maxLength = isLink ? 2048 : CONTENT_MAX_LENGTH;
    if (isLink) {
      field.type = "url";
      field.required = true;
      field.placeholder = "https://…";
    }
    label.appendChild(field);
    fieldsForm.appendChild(label);
  }

  function renderFields() {
    fieldsForm.replaceChildren();
    for (const node of contentNodes) {
      const key = node.dataset.siteContent;
      addEditorField(node.dataset.editorLabel || key, key, draftState.content[key], false);
    }
    for (const node of linkNodes) {
      const key = node.dataset.siteLink;
      addEditorField(node.dataset.editorLabel || key, key, draftState.links[key], true);
    }
    const spacing = document.createElement("h3");
    spacing.textContent = "Box padding (px, blank = default)";
    fieldsForm.appendChild(spacing);
    for (const section of sectionNodes) {
      const id = section.dataset.siteSection;
      const label = document.createElement("label");
      label.className = "site-editor-field";
      label.textContent = section.dataset.editorSectionLabel || id;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "120";
      input.step = "4";
      input.dataset.paddingFor = id;
      input.value = Number.isFinite(draftState.padding[id]) ? draftState.padding[id] : "";
      label.appendChild(input);
      fieldsForm.appendChild(label);
    }
  }

  function renderEditor() {
    renderLayoutEditor();
    renderFields();
    updateStatus();
  }

  function changeOrder(groupId, sectionId, direction) {
    const current = [...draftState.layout[groupId]];
    const index = current.indexOf(sectionId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
    draftState.layout[groupId] = current;
    applyLayout(draftState.layout);
    renderLayoutEditor();
    updateStatus();
  }

  async function loadPublishedState() {
    try {
      const config = window.FIREBASE_CONFIG || {};
      if (!window.firebase || !firebase.firestore || !config.apiKey || !config.projectId || !config.appId) {
        throw new Error("Firebase Firestore is not configured on this page.");
      }
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
      firestore = app.firestore();
      const snapshot = await firestore.collection("siteContent").doc("homepage").get();
      if (snapshot.exists) {
        publishedState = normalizeRemoteState(snapshot.data() || {});
        draftState = clone(publishedState);
        applyState(publishedState);
      }
      loadError = null;
    } catch (error) {
      loadError = error;
      console.error("Could not load published homepage content.", error);
    }
    updateStatus();
  }

  function openEditor() {
    if (!ownerState?.isOwner) return;
    previewing = false;
    previewBar.classList.add("hidden");
    setEditingHighlights(true);
    setResizeHandles(true);
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    renderEditor();
    closeButton.focus();
  }

  function closeEditor() {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    setEditingHighlights(false);
    setResizeHandles(false);
    previewing = false;
    previewBar.classList.add("hidden");
    launchButton.focus();
  }

  async function onLaunch() {
    try {
      if (!ownerState?.isOwner) {
        if (ownerState?.user) {
          window.alert("This account is not listed as a site owner. Add its email or UID to the owner allowlist in js/firebase-config.js and firestore.rules.");
          return;
        }
        await window.SpeedrunOwnerAuth.signInWithGoogle();
        ownerState = window.SpeedrunOwnerAuth.getState();
        if (!ownerState?.isOwner) {
          window.alert("Sign-in completed, but this account is not listed as a site owner. Add its email or UID to the owner allowlist in js/firebase-config.js and firestore.rules.");
          return;
        }
      }
      await loadPromise;
      openEditor();
    } catch (error) {
      console.error("Could not open the homepage editor.", error);
      showStatus(`Could not open the editor. ${error.message}`, true);
      window.alert(`Could not open the editor. ${error.message}`);
    }
  }

  async function publishChanges() {
    if (!ownerState?.isOwner || !firestore || loadError) return;
    const invalidLink = Object.entries(draftState.links).find(([, value]) => !isAllowedUrl(value));
    if (invalidLink) {
      showStatus(`Enter a valid http or https URL for ${linkNodes.find((node) => node.dataset.siteLink === invalidLink[0])?.dataset.editorLabel || invalidLink[0]}.`, true);
      fieldsForm.querySelector(`[data-editor-key="${invalidLink[0]}"]`)?.focus();
      return;
    }

    publishing = true;
    showStatus("Publishing homepage changes…", false);
    publishButton.disabled = true;
    try {
      await firestore.collection("siteContent").doc("homepage").set({
        schemaVersion: 1,
        content: draftState.content,
        links: draftState.links,
        layout: draftState.layout,
        sizes: draftState.sizes,
        offsets: draftState.offsets,
        padding: draftState.padding,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: ownerState.user?.uid || "owner"
      });
      publishedState = clone(draftState);
      showStatus("Published. The homepage is updated for everyone.", false);
    } catch (error) {
      console.error("Could not publish homepage changes.", error);
      showStatus(`Publish failed. ${error.message}`, true);
    } finally {
      publishing = false;
      updateStatus();
    }
  }

  launchButton.addEventListener("click", onLaunch);
  signOutButton.addEventListener("click", async () => {
    try {
      await window.SpeedrunOwnerAuth.signOut();
    } catch (error) {
      console.error("Could not sign out from the homepage editor.", error);
      window.alert(`Could not sign out. ${error.message}`);
    }
  });
  const PANEL_POSITION_KEY = "siteEditorPanelPosition";
  const panelHeader = panel.querySelector(".site-editor-header");
  const canMovePanel = () => window.innerWidth > 700;

  function placePanel(left, top) {
    const rect = panel.getBoundingClientRect();
    const x = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - Math.min(rect.width, 120)));
    const y = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - 48));
    panel.style.inset = `${y}px auto auto ${x}px`;
    panel.style.maxHeight = `${Math.max(200, window.innerHeight - y - 8)}px`;
    return { x, y };
  }

  function resetPanelPosition() {
    panel.style.inset = "";
    panel.style.maxHeight = "";
    try { localStorage.removeItem(PANEL_POSITION_KEY); } catch {}
  }

  function restorePanelPosition() {
    if (!canMovePanel()) return resetPanelPosition();
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) placePanel(saved.x, saved.y);
    } catch {}
  }

  panelHeader.classList.add("site-editor-draggable");
  panelHeader.title = "Drag to move this panel (double-click to reset)";
  panelHeader.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button") || !canMovePanel()) return;
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    event.preventDefault();
    panelHeader.setPointerCapture(event.pointerId);
    let last = { x: rect.left, y: rect.top };
    const onMove = (e) => { last = placePanel(e.clientX - offsetX, e.clientY - offsetY); };
    const onUp = () => {
      panelHeader.removeEventListener("pointermove", onMove);
      panelHeader.removeEventListener("pointerup", onUp);
      panelHeader.removeEventListener("pointercancel", onUp);
      try { localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(last)); } catch {}
    };
    panelHeader.addEventListener("pointermove", onMove);
    panelHeader.addEventListener("pointerup", onUp);
    panelHeader.addEventListener("pointercancel", onUp);
  });
  panelHeader.addEventListener("dblclick", (event) => {
    if (!event.target.closest("button")) resetPanelPosition();
  });
  window.addEventListener("resize", restorePanelPosition);
  restorePanelPosition();
  closeButton.addEventListener("click", closeEditor);
  document.addEventListener("pointerdown", startResize);
  document.addEventListener("pointerdown", startMove);
  document.addEventListener("dblclick", resetSize);
  publishButton.addEventListener("click", publishChanges);

  previewButton.addEventListener("click", () => {
    previewing = true;
    setEditingHighlights(false);
    setResizeHandles(false);
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    previewBar.classList.remove("hidden");
    returnButton.focus();
  });

  returnButton.addEventListener("click", () => {
    if (!previewing) return;
    previewing = false;
    setEditingHighlights(true);
    setResizeHandles(true);
    previewBar.classList.add("hidden");
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    closeButton.focus();
  });

  discardButton.addEventListener("click", () => {
    if (isDirty() && !window.confirm("Discard all unpublished homepage changes?")) return;
    draftState = clone(publishedState);
    applyState(draftState);
    renderEditor();
  });

  fieldsForm.addEventListener("input", (event) => {
    const paddingField = event.target.closest("[data-padding-for]");
    if (paddingField) {
      const value = paddingField.value === "" ? NaN : Math.max(0, Math.min(120, Number(paddingField.value)));
      if (Number.isFinite(value)) draftState.padding[paddingField.dataset.paddingFor] = value;
      else delete draftState.padding[paddingField.dataset.paddingFor];
      applyOffsets(draftState);
      updateStatus();
      return;
    }
    const field = event.target.closest("[data-editor-key]");
    if (!field) return;
    const key = field.dataset.editorKey;
    if (field.dataset.editorType === "link") {
      draftState.links[key] = field.value.trim();
    } else {
      draftState.content[key] = field.value;
    }
    applyContent(draftState);
    updateStatus();
  });

  layoutContainer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-move-direction]");
    if (!button) return;
    changeOrder(button.dataset.layoutGroup, button.dataset.sectionId, button.dataset.moveDirection === "up" ? -1 : 1);
  });

  layoutContainer.addEventListener("dragstart", (event) => {
    const item = event.target.closest(".site-editor-layout-item");
    if (!item) return;
    draggedSection = { id: item.dataset.sectionId, group: item.dataset.layoutGroup };
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  layoutContainer.addEventListener("dragend", (event) => {
    event.target.closest(".site-editor-layout-item")?.classList.remove("is-dragging");
    draggedSection = null;
  });

  layoutContainer.addEventListener("dragover", (event) => {
    if (event.target.closest(".site-editor-layout-item")) event.preventDefault();
  });

  layoutContainer.addEventListener("drop", (event) => {
    const target = event.target.closest(".site-editor-layout-item");
    if (!target || !draggedSection || target.dataset.layoutGroup !== draggedSection.group) return;
    event.preventDefault();
    const order = [...draftState.layout[draggedSection.group]];
    const sourceIndex = order.indexOf(draggedSection.id);
    let targetIndex = order.indexOf(target.dataset.sectionId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    order.splice(sourceIndex, 1);
    if (sourceIndex < targetIndex) targetIndex -= 1;
    order.splice(targetIndex, 0, draggedSection.id);
    draftState.layout[draggedSection.group] = order;
    applyLayout(draftState.layout);
    renderLayoutEditor();
    updateStatus();
  });

  window.SpeedrunOwnerAuth.onChange((state) => {
    ownerState = state;
    launchButton.classList.toggle("hidden", !state?.isOwner && Boolean(state?.user));
    signOutButton.classList.toggle("hidden", !state?.user);
    if (!state?.isOwner && panel.classList.contains("is-open")) closeEditor();
    if (panel.classList.contains("is-open")) updateStatus();
  });

  const loadPromise = loadPublishedState();
})();
