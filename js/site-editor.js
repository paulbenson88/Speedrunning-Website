(function () {
  "use strict";

  const CONTENT_SELECTOR = "[data-site-content]";
  const LINK_SELECTOR = "[data-site-link]";
  const SECTION_SELECTOR = "[data-site-section]";
  const LAYOUT_SELECTOR = "[data-site-layout]";
  const CONTENT_MAX_LENGTH = 2000;
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
    sizes: {}
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

  function applyState(state) {
    applyContent(state);
    applyLayout(state.layout);
    applySizes(state.sizes);
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

    const onMove = (moveEvent) => {
      const w = Math.min(100, Math.max(20, Math.round(((start.width + moveEvent.clientX - originX) / parentWidth) * 100)));
      const h = Math.min(3000, Math.max(80, Math.round(start.height + moveEvent.clientY - originY)));
      draftState.sizes[id] = { w, h };
      applySizes(draftState.sizes);
      updateStatus();
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function resetSize(event) {
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
  closeButton.addEventListener("click", closeEditor);
  document.addEventListener("pointerdown", startResize);
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
