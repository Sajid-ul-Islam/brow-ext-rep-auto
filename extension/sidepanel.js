const SETTINGS_KEY = "repeatflow.shell.settings";
const element = (id) => document.getElementById(id);
const checkbox = element("show-guide");
const guide = element("setup-guide");
const settingsStatus = element("settings-status");
const controls = {
  start: element("start-observing"),
  pause: element("pause-observing"),
  resume: element("resume-observing"),
  stop: element("stop-observing"),
  export: element("review-export"),
  clear: element("clear-data"),
};
const errorMessages = {
  UNAUTHORIZED: "Click the RepeatFlow toolbar icon on the selected page to grant temporary access, then try again.",
  UNSUPPORTED_PAGE: "RepeatFlow cannot observe this page. Choose an ordinary HTTP or HTTPS page.",
  WRONG_TAB: "Return to the original session tab before resuming. You can still stop the session here.",
  NO_SESSION: "This session is no longer available. The displayed sessions will refresh.",
  INVALID_STATE: "The session state changed. Check the current controls and try again.",
  SCOPE_CHANGED: "The page changed. End this session, click the toolbar icon, and start a new session.",
  OBSERVER_MISSING: "The page observer is no longer available. Stop this session and start again from the toolbar.",
  STORAGE_ERROR: "Local data could not be saved or read. Observation may have stopped. Reopen the panel and check the session before continuing.",
  INVALID_MESSAGE: "The extension could not understand this request. Reload the extension and reopen the panel.",
  SESSION_ACTIVE: "A session is already active. Stop it before starting another.",
  INTERNAL_ERROR: "The extension could not complete this action. Reopen the panel and try again.",
};
const endReasons = {
  user: "Stopped by you.",
  navigation: "The page changed. Observation ended.",
  permissionLost: "Page access ended. Observation stopped.",
  tabClosed: "The observed tab closed.",
  restart: "The extension restarted. Start a new session to observe again.",
  storageError: "Local storage was unavailable. Observation stopped.",
  overflow: "The observation limit was reached. Observation stopped.",
  observerMissing: "The page observer was interrupted. Observation stopped.",
};
let snapshot = null;
let windowId = null;
let busy = false;
let unavailable = true;
let snapshotEpoch = 0;
let snapshotRequests = 0;
let errorSource = null;
let settingsReady = false;
let settingsSaving = false;
let deletion = null;
let pendingExport = null;
const sessionRows = new Map();

/** Never render free-form errors received from pages or the worker. */
function showError(code, source = "action") {
  errorSource = source;
  element("operation-error").textContent = errorMessages[code] ?? errorMessages.INTERNAL_ERROR;
  element("operation-error").hidden = false;
}

function clearError(source) {
  if (source && errorSource !== source) return;
  errorSource = null;
  element("operation-error").textContent = "";
  element("operation-error").hidden = true;
}

function announce(message) {
  element("operation-status").textContent = message;
}

function activeSession() {
  return snapshot?.session && snapshot.session.state !== "stopped" ? snapshot.session : null;
}

function renderControls() {
  const active = activeSession();
  const tab = snapshot?.activeTab;
  const disabled = busy || settingsSaving || unavailable;
  controls.start.hidden = Boolean(active);
  controls.pause.hidden = active?.state !== "observing";
  controls.resume.hidden = active?.state !== "paused";
  controls.stop.hidden = !active;
  controls.start.disabled = disabled || Boolean(active) || !tab?.supported || !tab?.authorized;
  controls.pause.disabled = disabled || active?.state !== "observing";
  controls.resume.disabled = disabled || active?.state !== "paused" || !tab?.authorized || !tab?.supported || tab.id !== active.tabId;
  controls.stop.disabled = disabled || !active;
  controls.export.disabled = disabled || !snapshot?.totalSessions;
  controls.clear.disabled = disabled;
  checkbox.disabled = !settingsReady || settingsSaving || busy;
  element("confirm-delete").disabled = disabled || !deletion;
  element("cancel-delete").disabled = busy;
  element("confirm-export").disabled = disabled || !pendingExport;
  element("cancel-export").disabled = busy;
  for (const row of sessionRows.values()) row.button.disabled = disabled;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable";
}

function elapsed(session) {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}

function renderSnapshot() {
  const session = snapshot.session;
  const active = activeSession();
  const tab = snapshot.activeTab;
  const state = active?.state ?? "off";
  element("observation-status").dataset.state = state;
  element("state-label").textContent = state === "observing" ? "Observing this page" : state === "paused" ? "Observation is paused" : "Observation is off";
  element("scope-origin").textContent = active?.origin ?? tab?.origin ?? "No supported page selected";
  let scopeHelp;
  if (active && tab?.id !== active.tabId) {
    scopeHelp = "This session belongs to another tab. Return to that tab to resume; observation does not move between tabs.";
  } else if (!tab?.supported) {
    scopeHelp = "Choose an ordinary HTTP or HTTPS page. Browser settings, extension pages, and other restricted pages are unsupported.";
  } else if (!tab.authorized) {
    scopeHelp = "Click the RepeatFlow toolbar icon on this page to grant temporary access, then return here.";
  } else if (active?.state === "paused") {
    scopeHelp = "New interactions are not recorded. Resume explicitly when you are ready. Navigation ends this session.";
  } else if (active?.state === "observing") {
    scopeHelp = "Only this tab and document are observed. Navigation ends this session; switching tabs pauses it.";
  } else {
    scopeHelp = "Temporary access is ready. Choose Start observing to begin; opening this panel does not record anything.";
  }
  element("scope-help").textContent = scopeHelp;
  const count = session?.eventCount ?? 0;
  element("session-summary").textContent = session
    ? `${count.toLocaleString()} retained interaction${count === 1 ? "" : "s"} · ${elapsed(session)}${session.state === "stopped" ? ` · ${endReasons[session.stopReason] ?? "Session ended."}` : ""}`
    : "No session started.";
  element("data-count").textContent = `${snapshot.eventCount.toLocaleString()} EVENTS`;
  element("retention-help").textContent = `Kept for up to ${snapshot.retention.maxDays} days and ${snapshot.retention.maxEvents.toLocaleString()} events across sessions. Older events expire first.`;
  element("sessions-empty").hidden = snapshot.sessions.length !== 0;
  const ids = new Set(snapshot.sessions.map((item) => item.id));
  for (const [id, row] of sessionRows) {
    if (!ids.has(id)) {
      row.item.remove();
      sessionRows.delete(id);
    }
  }
  // Update existing nodes so polling never steals keyboard focus from Delete.
  for (const item of snapshot.sessions) {
    let row = sessionRows.get(item.id);
    if (!row) {
      const node = document.createElement("li");
      node.className = "session-item";
      const origin = document.createElement("p");
      origin.className = "session-origin";
      const details = document.createElement("div");
      details.className = "session-details";
      const description = document.createElement("p");
      description.className = "caption";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "danger session-delete";
      button.textContent = "Delete";
      button.addEventListener("click", () => reviewDeletion(item.id, button));
      details.append(description, button);
      node.append(origin, details);
      row = { item: node, origin, description, button };
      sessionRows.set(item.id, row);
    }
    row.origin.textContent = item.origin;
    row.description.textContent = `${formatTime(item.startedAt)} · ${item.eventCount.toLocaleString()} event${item.eventCount === 1 ? "" : "s"} · ${item.state}`;
    row.button.setAttribute("aria-label", `Delete session on ${item.origin} started ${formatTime(item.startedAt)}`);
  }
  // Insert only nodes whose position changed; appendChild on every poll blurs focus.
  const list = element("session-list");
  snapshot.sessions.forEach((item, index) => {
    const node = sessionRows.get(item.id).item;
    if (list.children[index] !== node) list.insertBefore(node, list.children[index] ?? null);
  });
  renderControls();
}

async function request(type, payload) {
  const response = await chrome.runtime.sendMessage({
    protocolVersion: 1,
    type,
    requestId: crypto.randomUUID(),
    payload,
  });
  if (!response?.ok) throw new Error(response?.code ?? "INTERNAL_ERROR");
  return response.data;
}

async function refresh(force = false) {
  if (windowId === null || busy || (!force && snapshotRequests > 0)) return;
  const epoch = ++snapshotEpoch;
  snapshotRequests += 1;
  try {
    const data = await request("panel.snapshot", { windowId });
    if (epoch !== snapshotEpoch || busy) return;
    snapshot = data;
    unavailable = false;
    clearError("snapshot");
    renderSnapshot();
  } catch (error) {
    if (epoch !== snapshotEpoch || busy) return;
    unavailable = true;
    showError(error.message, "snapshot");
    element("state-label").textContent = "Session status unavailable";
    element("observation-status").dataset.state = "unknown";
    renderControls();
  } finally {
    snapshotRequests -= 1;
  }
}

function dismissExport() {
  pendingExport = null;
  element("export-review").hidden = true;
}

function dismissDeletion(restoreFocus = false) {
  const trigger = deletion?.trigger;
  deletion = null;
  element("deletion-review").hidden = true;
  if (restoreFocus) (trigger?.isConnected ? trigger : element("data-heading")).focus();
}

async function perform(type, payload, successMessage) {
  if (busy || settingsSaving || unavailable) return false;
  busy = true;
  snapshotEpoch += 1;
  clearError();
  announce("Working…");
  renderControls();
  let succeeded = false;
  try {
    await request(type, payload);
    announce(successMessage);
    succeeded = true;
  } catch (error) {
    announce("");
    showError(error.message);
  } finally {
    busy = false;
    await refresh(true);
    renderControls();
  }
  return succeeded;
}

function reviewDeletion(sessionId, trigger) {
  if (busy || unavailable) return;
  dismissExport();
  deletion = { sessionId, trigger };
  const session = snapshot.sessions.find((item) => item.id === sessionId);
  element("deletion-title").textContent = sessionId ? "Delete this session?" : "Clear all RepeatFlow data?";
  element("deletion-description").textContent = sessionId
    ? `Delete the session on ${session?.origin ?? "this origin"} and its recorded interactions. If active, the session will end. This cannot be undone.`
    : "End any active session and delete all observation sessions, events, and the setup-guide preference in this browser. This cannot be undone.";
  element("confirm-delete").textContent = sessionId ? "Delete session" : "Clear all data";
  element("deletion-review").hidden = false;
  renderControls();
  element("cancel-delete").focus();
}

controls.start.addEventListener("click", async () => {
  if (!snapshot?.activeTab) return;
  dismissDeletion();
  dismissExport();
  if (await perform("session.start", { windowId, tabId: snapshot.activeTab.id }, "Observation started for this document.")) controls.pause.focus();
});
for (const [action, message] of [["pause", "Observation paused. New interactions are not recorded."], ["resume", "Observation resumed for the original document."], ["stop", "Observation stopped."]]) {
  controls[action].addEventListener("click", async () => {
    const session = activeSession();
    if (!session) return;
    dismissDeletion();
    dismissExport();
    if (await perform(`session.${action}`, { sessionId: session.id }, message)) {
      const next = action === "pause" ? controls.resume : action === "resume" ? controls.pause : controls.start;
      if (!next.disabled && !next.hidden) next.focus();
      else element("data-heading").focus();
    }
  });
}
controls.clear.addEventListener("click", () => reviewDeletion(null, controls.clear));
element("cancel-delete").addEventListener("click", () => dismissDeletion(true));
element("confirm-delete").addEventListener("click", async () => {
  if (!deletion) return;
  const { sessionId } = deletion;
  dismissExport();
  const succeeded = await perform(sessionId ? "data.deleteSession" : "data.clear", sessionId ? { sessionId } : {}, sessionId ? "Session and its interactions deleted." : "All local RepeatFlow data cleared. Observation is off.");
  if (succeeded) {
    dismissDeletion();
    element("data-heading").focus();
  }
});
controls.export.addEventListener("click", async () => {
  if (busy || settingsSaving || unavailable) return;
  dismissDeletion();
  dismissExport();
  busy = true;
  snapshotEpoch += 1;
  clearError();
  announce("Preparing export review…");
  renderControls();
  try {
    const data = await request("data.export", {});
    pendingExport = data;
    element("export-summary").textContent = `${data.sessions.length.toLocaleString()} sessions and ${data.events.length.toLocaleString()} events. Snapshot taken ${formatTime(data.exportedAt)}. Interactions after this snapshot are excluded.`;
    element("export-review").hidden = false;
    announce("Review the included categories before downloading.");
  } catch (error) {
    announce("");
    showError(error.message);
  } finally {
    busy = false;
    await refresh(true);
    renderControls();
    if (pendingExport) element("confirm-export").focus();
  }
});
element("cancel-export").addEventListener("click", () => {
  dismissExport();
  controls.export.focus();
});
element("confirm-export").addEventListener("click", () => {
  if (!pendingExport || busy || unavailable) return;
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(pendingExport, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `repeatflow-observations-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dismissExport();
    announce("JSON download requested. Check your browser's downloads.");
    controls.export.focus();
  } catch {
    showError("INTERNAL_ERROR");
  }
});

/** Read only the known preference; other fields never enter the DOM. */
function readPreference(settings) {
  return settings?.schemaVersion === 1 && typeof settings.showGuide === "boolean" ? settings.showGuide : true;
}

function renderGuide(showGuide) {
  checkbox.checked = showGuide;
  guide.hidden = !showGuide;
}

async function initializeSettings() {
  if (!globalThis.chrome?.storage?.local) {
    settingsStatus.textContent = "Preview mode. Load extension/ in Chrome to save this preference.";
    return;
  }
  let knownPreference = true;
  let changedDuringLoad = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, SETTINGS_KEY)) {
      changedDuringLoad = true;
      knownPreference = readPreference(changes[SETTINGS_KEY].newValue);
      renderGuide(knownPreference);
    }
  });
  try {
    const saved = await chrome.storage.local.get(SETTINGS_KEY);
    if (!changedDuringLoad) {
      knownPreference = readPreference(saved[SETTINGS_KEY]);
      renderGuide(knownPreference);
    }
    settingsReady = true;
    settingsStatus.textContent = "This preference is saved only in this browser.";
    renderControls();
  } catch {
    settingsStatus.textContent = "Could not load settings. Reopen the panel to try again.";
    return;
  }
  checkbox.addEventListener("change", async () => {
    const showGuide = checkbox.checked;
    settingsSaving = true;
    renderControls();
    renderGuide(showGuide);
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: { schemaVersion: 1, showGuide } });
      settingsStatus.textContent = "Preference saved in this browser.";
    } catch {
      renderGuide(knownPreference);
      settingsStatus.textContent = "Could not save your preference. Try again.";
    } finally {
      settingsSaving = false;
      renderControls();
    }
  });
}

async function initializeObservation() {
  if (!globalThis.chrome?.runtime?.sendMessage || !chrome.windows?.getCurrent) {
    element("scope-help").textContent = "Preview mode. Load extension/ as an unpacked Chrome extension to authorize a page and use observation controls.";
    return;
  }
  try {
    const currentWindow = await chrome.windows.getCurrent();
    windowId = currentWindow.id;
    await refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  } catch {
    showError("INTERNAL_ERROR");
    element("state-label").textContent = "Session status unavailable";
  }
}

await Promise.all([initializeSettings(), initializeObservation()]);
