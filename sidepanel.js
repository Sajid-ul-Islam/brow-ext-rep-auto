const SETTINGS_KEY = "repeatflow.shell.settings";
const el = (id) => document.getElementById(id);

const errorMessages = {
  UNAUTHORIZED: "Click the RepeatFlow toolbar icon on the selected page to grant temporary access, then try again.",
  UNSUPPORTED_PAGE: "RepeatFlow cannot observe this page. Choose an ordinary HTTP or HTTPS page.",
  WRONG_TAB: "Return to the original session tab before resuming. You can still stop the session here.",
  NO_SESSION: "This session is no longer available. The displayed sessions will refresh.",
  NO_WORKFLOW: "This workflow could not be found.",
  NO_RUN: "Active run not found.",
  INVALID_STATE: "The session or run state changed. Check the current controls and try again.",
  SCOPE_CHANGED: "The page changed. End this session, click the toolbar icon, and start again.",
  OBSERVER_MISSING: "The page observer is no longer available. Stop this session and start again from the toolbar.",
  EXECUTOR_MISSING: "Could not connect to the page executor. Make sure you are on the target page.",
  STORAGE_ERROR: "Local data could not be saved or read. Reopen the panel and check before continuing.",
  INVALID_MESSAGE: "The extension could not understand this request. Reload the extension and reopen the panel.",
  SESSION_ACTIVE: "A session is already active. Stop it before starting another.",
  RUN_ACTIVE: "A run is already active. Stop it before starting another.",
  UNREVIEWED_WORKFLOW: "This workflow has unreviewed edits. Save and approve it in the editor before running.",
  INVALID_WORKFLOW: "The workflow format or step structure is invalid.",
  TARGET_NOT_FOUND: "Target element could not be found on the page.",
  TARGET_AMBIGUOUS: "Multiple matching elements were found for this step target.",
  TARGET_DISABLED: "Target element is disabled.",
  TARGET_HIDDEN: "Target element is hidden.",
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
  contextLost: "The page observer was interrupted. Observation stopped.",
};

let snapshot = null;
let windowId = null;
let busy = false;
let unavailable = false;
let snapshotEpoch = 0;
let snapshotRequests = 0;
let activeTabName = "observe";
let editingWorkflow = null;
let editingUndoStep = null;
let selectedRunWorkflowId = null;
let runInputsValues = {};
let deletion = null;
let pendingExport = null;
let settingsReady = false;
let settingsSaving = false;

function showError(code) {
  const msg = errorMessages[code] ?? errorMessages.INTERNAL_ERROR;
  el("global-error").textContent = msg;
  el("global-error").hidden = false;
}

function clearError() {
  el("global-error").textContent = "";
  el("global-error").hidden = true;
}

function announce(message) {
  el("global-status").textContent = message;
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

async function perform(type, payload, successMessage) {
  if (busy || settingsSaving || (unavailable && type !== "data.clear")) return false;
  busy = true;
  snapshotEpoch += 1;
  clearError();
  announce("Working…");
  let succeeded = false;
  try {
    const res = await request(type, payload);
    if (successMessage) announce(successMessage);
    succeeded = true;
    return res ?? true;
  } catch (error) {
    announce("");
    showError(error.message);
  } finally {
    busy = false;
    await refresh(true);
  }
  return succeeded;
}

// --- TAB SWITCHING ---
function switchTab(name) {
  activeTabName = name;
  const tabs = ["observe", "suggestions", "workflows", "run", "settings"];
  for (const t of tabs) {
    const btn = el(`tab-${t}`);
    const panel = el(`view-${t}`);
    const isActive = t === name;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
    panel.hidden = !isActive;
  }
  clearError();
}

for (const t of ["observe", "suggestions", "workflows", "run", "settings"]) {
  el(`tab-${t}`).addEventListener("click", () => switchTab(t));
}

// --- RENDER OBSERVE VIEW ---
function renderObserve() {
  const session = snapshot?.session;
  const active = session && session.state !== "stopped" ? session : null;
  const tab = snapshot?.activeTab;
  const state = active?.state ?? "off";

  el("observation-status").dataset.state = state;
  el("state-label").textContent = state === "observing" ? "Observing this page" : state === "paused" ? "Observation is paused" : "Observation is off";
  el("scope-origin").textContent = active?.origin ?? tab?.origin ?? "No supported page selected";

  let scopeHelp = "";
  if (active && tab?.id !== active.tabId) {
    scopeHelp = "This session belongs to another tab. Return to that tab to resume.";
  } else if (!tab?.supported) {
    scopeHelp = "Choose an ordinary HTTP or HTTPS page. Restricted browser pages are unsupported.";
  } else if (!tab.authorized) {
    scopeHelp = "Click the RepeatFlow toolbar icon on this page to grant temporary access, then return here.";
  } else if (active?.state === "paused") {
    scopeHelp = "New interactions are not recorded. Resume explicitly when you are ready.";
  } else if (active?.state === "observing") {
    scopeHelp = "Only this tab and document are observed. Navigation ends this session.";
  } else {
    scopeHelp = "Temporary access is ready. Choose Start observing to begin.";
  }
  el("scope-help").textContent = scopeHelp;

  const count = session?.eventCount ?? 0;
  el("session-summary").textContent = session
    ? `${count.toLocaleString()} retained interaction${count === 1 ? "" : "s"} · ${elapsed(session)}${session.state === "stopped" ? ` · ${endReasons[session.stopReason] ?? "Session ended."}` : ""}`
    : "No session started.";

  const startBtn = el("start-observing");
  const pauseBtn = el("pause-observing");
  const resumeBtn = el("resume-observing");
  const stopBtn = el("stop-observing");

  startBtn.hidden = Boolean(active);
  pauseBtn.hidden = active?.state !== "observing";
  resumeBtn.hidden = active?.state !== "paused";
  stopBtn.hidden = !active;

  const disabled = busy || settingsSaving || unavailable;
  startBtn.disabled = disabled || Boolean(active) || !tab?.supported || !tab?.authorized;
  pauseBtn.disabled = disabled || active?.state !== "observing";
  resumeBtn.disabled = disabled || active?.state !== "paused" || !tab?.authorized || !tab?.supported || tab.id !== active.tabId;
  stopBtn.disabled = disabled || !active;
}

// --- RENDER SUGGESTIONS VIEW (M2) ---
function renderSuggestions() {
  const candidates = snapshot?.candidates || [];
  const badge = el("badge-suggestions");
  if (candidates.length > 0) {
    badge.textContent = String(candidates.length);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  const empty = el("suggestions-empty");
  const list = el("suggestions-list");
  list.innerHTML = "";

  if (candidates.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const cand of candidates) {
    const card = document.createElement("div");
    card.className = "item-card";

    const title = document.createElement("h4");
    title.textContent = `Repeated ${cand.occurrences.length} times · ${cand.symbols.length} steps`;

    const sub = document.createElement("p");
    sub.className = "caption";
    sub.textContent = `Discovered ${formatTime(cand.createdAt)}`;

    const tags = document.createElement("div");
    tags.className = "step-tags";
    for (const sym of cand.symbols) {
      const chip = document.createElement("span");
      chip.className = "step-chip";
      chip.textContent = `${sym.action} (${sym.fieldKind})`;
      tags.appendChild(chip);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const convertBtn = document.createElement("button");
    convertBtn.type = "button";
    convertBtn.className = "primary small";
    convertBtn.textContent = "Convert to workflow";
    convertBtn.addEventListener("click", async () => {
      const res = await perform("candidate.convert", { candidateId: cand.id }, "Workflow created from suggestion.");
      if (res?.workflow) {
        openEditor(res.workflow);
        switchTab("workflows");
      }
    });

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "small";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", async () => {
      await perform("candidate.dismiss", { candidateId: cand.id }, "Suggestion dismissed.");
    });

    actions.append(convertBtn, dismissBtn);
    card.append(title, sub, tags, actions);
    list.appendChild(card);
  }
}

// --- RENDER WORKFLOWS VIEW & EDITOR (M3) ---
function renderWorkflows() {
  const workflows = snapshot?.workflows || [];
  const empty = el("workflows-empty");
  const list = el("workflows-list");
  list.innerHTML = "";

  if (workflows.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    for (const wf of workflows) {
      const card = document.createElement("div");
      card.className = "item-card";

      const header = document.createElement("div");
      header.className = "section-heading";
      const title = document.createElement("h4");
      title.textContent = wf.name;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = wf.reviewedRevision === wf.revision ? "APPROVED" : "DRAFT";
      header.append(title, tag);

      const details = document.createElement("p");
      details.className = "caption";
      details.textContent = `${wf.origin} · ${wf.steps.length} step${wf.steps.length === 1 ? "" : "s"} · Rev ${wf.revision}`;

      const actions = document.createElement("div");
      actions.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openEditor(wf));

      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "primary small";
      runBtn.textContent = "Run";
      runBtn.addEventListener("click", () => {
        selectedRunWorkflowId = wf.id;
        switchTab("run");
      });

      const duplicateBtn = document.createElement("button");
      duplicateBtn.type = "button";
      duplicateBtn.className = "small";
      duplicateBtn.textContent = "Duplicate";
      duplicateBtn.addEventListener("click", async () => {
        await perform("workflow.duplicate", { workflowId: wf.id }, "Workflow duplicated.");
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "danger small";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        await perform("workflow.delete", { workflowId: wf.id }, "Workflow deleted.");
      });

      actions.append(editBtn, runBtn, duplicateBtn, deleteBtn);
      card.append(header, details, actions);
      list.appendChild(card);
    }
  }

  // Also update Run selector dropdown
  const runSelect = el("run-workflow-select");
  runSelect.innerHTML = "";
  for (const wf of workflows) {
    const opt = document.createElement("option");
    opt.value = wf.id;
    opt.textContent = `${wf.name} (${wf.origin})`;
    if (wf.id === selectedRunWorkflowId) opt.selected = true;
    runSelect.appendChild(opt);
  }
  if (!selectedRunWorkflowId && workflows[0]) {
    selectedRunWorkflowId = workflows[0].id;
  }
  renderRun();
}

function openEditor(workflow) {
  editingWorkflow = structuredClone(workflow);
  el("workflows-index").hidden = true;
  el("workflow-editor").hidden = false;
  el("editor-title").textContent = `Edit: ${editingWorkflow.name}`;
  el("wf-name").value = editingWorkflow.name;
  el("wf-origin").value = editingWorkflow.origin;
  renderEditorSteps();
  renderEditorParams();
}

function closeEditor() {
  editingWorkflow = null;
  el("workflow-editor").hidden = true;
  el("workflows-index").hidden = false;
}

el("editor-close-btn").addEventListener("click", closeEditor);
el("cancel-workflow-btn").addEventListener("click", closeEditor);

el("create-workflow-btn").addEventListener("click", () => {
  const origin = snapshot?.activeTab?.origin || "https://example.com";
  openEditor({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    revision: 1,
    name: "New Workflow",
    origin,
    reviewedPath: null,
    steps: [
      {
        id: crypto.randomUUID(),
        type: "click",
        effect: "unknown",
        timeoutMs: 5000,
        label: "Step 1: Click control",
        target: {
          reviewedAt: new Date().toISOString(),
          locators: [{ type: "css", value: "button" }],
        },
        postcondition: { condition: "visible", expected: true },
      },
    ],
    parameters: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewedRevision: null,
    reviewedAt: null,
  });
});

el("import-workflow-btn").addEventListener("click", async () => {
  const json = prompt("Paste workflow JSON:");
  if (json) {
    await perform("workflow.import", { json }, "Workflow imported.");
  }
});

function renderEditorSteps() {
  if (!editingWorkflow) return;
  const list = el("wf-steps-list");
  list.innerHTML = "";
  el("wf-steps-count").textContent = String(editingWorkflow.steps.length);

  editingWorkflow.steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = "step-editor-item";

    const header = document.createElement("div");
    header.className = "step-editor-header";
    header.innerHTML = `<strong>Step ${index + 1}</strong>`;

    const actions = document.createElement("div");
    actions.className = "step-editor-actions";

    if (index > 0) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "small";
      up.textContent = "↑";
      up.addEventListener("click", () => {
        const temp = editingWorkflow.steps[index - 1];
        editingWorkflow.steps[index - 1] = step;
        editingWorkflow.steps[index] = temp;
        renderEditorSteps();
      });
      actions.appendChild(up);
    }

    if (index < editingWorkflow.steps.length - 1) {
      const down = document.createElement("button");
      down.type = "button";
      down.className = "small";
      down.textContent = "↓";
      down.addEventListener("click", () => {
        const temp = editingWorkflow.steps[index + 1];
        editingWorkflow.steps[index + 1] = step;
        editingWorkflow.steps[index] = temp;
        renderEditorSteps();
      });
      actions.appendChild(down);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger small";
    del.textContent = "×";
    del.addEventListener("click", () => {
      editingUndoStep = { step, index };
      editingWorkflow.steps.splice(index, 1);
      renderEditorSteps();
    });
    actions.appendChild(del);

    header.appendChild(actions);

    // Step type & effect row
    const row1 = document.createElement("div");
    row1.className = "row-2";

    const typeGroup = document.createElement("div");
    typeGroup.className = "form-group";
    typeGroup.innerHTML = `<label>Type</label>`;
    const typeSelect = document.createElement("select");
    for (const t of ["click", "fill", "select", "setChecked", "waitFor"]) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (step.type === t) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener("change", () => {
      step.type = typeSelect.value;
      renderEditorSteps();
    });
    typeGroup.appendChild(typeSelect);

    const effectGroup = document.createElement("div");
    effectGroup.className = "form-group";
    effectGroup.innerHTML = `<label>Effect</label>`;
    const effectSelect = document.createElement("select");
    for (const eff of ["local", "external", "unknown"]) {
      const opt = document.createElement("option");
      opt.value = eff;
      opt.textContent = eff;
      if (step.effect === eff) opt.selected = true;
      effectSelect.appendChild(opt);
    }
    effectSelect.addEventListener("change", () => {
      step.effect = effectSelect.value;
    });
    effectGroup.appendChild(effectSelect);

    row1.append(typeGroup, effectGroup);

    // Target locator row or wait condition
    if (step.type !== "waitFor") {
      const currentLoc = step.target?.locators?.[0] || { type: "css", value: "" };
      const locType = currentLoc.type || "css";

      const locRow = document.createElement("div");
      locRow.className = "row-2";

      const locTypeGroup = document.createElement("div");
      locTypeGroup.className = "form-group";
      locTypeGroup.innerHTML = `<label>Locator Type</label>`;
      const locTypeSelect = document.createElement("select");
      for (const lt of [
        { val: "css", label: "CSS Selector" },
        { val: "id", label: "Element ID" },
        { val: "testAttribute", label: "Test Attribute" },
        { val: "roleAndName", label: "Role & Name / Text" },
      ]) {
        const opt = document.createElement("option");
        opt.value = lt.val;
        opt.textContent = lt.label;
        if (locType === lt.val) opt.selected = true;
        locTypeSelect.appendChild(opt);
      }
      locTypeGroup.appendChild(locTypeSelect);

      const targetGroup = document.createElement("div");
      targetGroup.className = "form-group";
      const targetLabel = document.createElement("label");
      targetLabel.textContent = locType === "id" ? "Element ID" : locType === "roleAndName" ? "Button/Link Text" : "Locator Value";
      const targetInput = document.createElement("input");
      targetInput.type = "text";
      targetInput.value = currentLoc.value || "";
      targetGroup.append(targetLabel, targetInput);

      locRow.append(locTypeGroup, targetGroup);
      item.append(header, row1, locRow);

      let attrGroup = null;
      if (locType === "testAttribute") {
        attrGroup = document.createElement("div");
        attrGroup.className = "form-group";
        attrGroup.innerHTML = `<label>Attribute Name</label>`;
        const attrInput = document.createElement("input");
        attrInput.type = "text";
        attrInput.value = currentLoc.attributeName || "data-testid";
        attrInput.addEventListener("input", () => updateLocator());
        attrGroup.appendChild(attrInput);
        item.appendChild(attrGroup);
      }

      function updateLocator() {
        const t = locTypeSelect.value;
        const val = targetInput.value.trim();
        step.target = step.target || { reviewedAt: new Date().toISOString(), locators: [] };
        const loc = { type: t, value: val || (t === "css" ? "button" : "action") };
        if (t === "testAttribute") {
          const attrVal = attrGroup?.querySelector("input")?.value?.trim() || "data-testid";
          loc.attributeName = attrVal;
        }
        step.target.locators = [loc];
        step.target.reviewedAt = new Date().toISOString();
      }

      locTypeSelect.addEventListener("change", () => {
        updateLocator();
        renderEditorSteps();
      });

      targetInput.addEventListener("input", () => {
        updateLocator();
      });
    } else {
      const waitGroup = document.createElement("div");
      waitGroup.className = "row-2";
      waitGroup.innerHTML = `
        <div class="form-group">
          <label>Condition</label>
          <select class="wait-cond">
            <option value="visible"${step.postcondition?.condition === "visible" ? " selected" : ""}>Visible</option>
            <option value="hidden"${step.postcondition?.condition === "hidden" ? " selected" : ""}>Hidden</option>
            <option value="enabled"${step.postcondition?.condition === "enabled" ? " selected" : ""}>Enabled</option>
            <option value="checked"${step.postcondition?.condition === "checked" ? " selected" : ""}>Checked</option>
          </select>
        </div>
        <div class="form-group">
          <label>Timeout (ms)</label>
          <input type="number" class="wait-timeout" min="100" max="30000" value="${step.timeoutMs || 5000}">
        </div>
      `;
      waitGroup.querySelector(".wait-cond").addEventListener("change", (e) => {
        step.postcondition = step.postcondition || { expected: true };
        step.postcondition.condition = e.target.value;
      });
      waitGroup.querySelector(".wait-timeout").addEventListener("input", (e) => {
        step.timeoutMs = Math.max(100, Math.min(30000, Number(e.target.value) || 5000));
      });
      item.append(header, row1, waitGroup);
    }

    // Value or Parameter binding for input steps (fill, select, setChecked)
    if (["fill", "select", "setChecked"].includes(step.type)) {
      const valRow = document.createElement("div");
      valRow.className = "row-2";

      if (editingWorkflow.parameters.length > 0) {
        const paramGroup = document.createElement("div");
        paramGroup.className = "form-group";
        paramGroup.innerHTML = `<label>Parameter</label>`;
        const paramSelect = document.createElement("select");
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "-- Static value --";
        paramSelect.appendChild(emptyOpt);
        for (const p of editingWorkflow.parameters) {
          const opt = document.createElement("option");
          opt.value = p.name;
          opt.textContent = `${p.label} (${p.name})`;
          if (step.parameter === p.name) opt.selected = true;
          paramSelect.appendChild(opt);
        }
        paramSelect.addEventListener("change", () => {
          step.parameter = paramSelect.value || undefined;
          renderEditorSteps();
        });
        paramGroup.appendChild(paramSelect);
        valRow.appendChild(paramGroup);
      }

      if (!step.parameter) {
        const staticGroup = document.createElement("div");
        staticGroup.className = "form-group";
        staticGroup.innerHTML = `<label>${step.type === "setChecked" ? "State (true/false)" : "Static Value"}</label>`;
        const staticInput = document.createElement("input");
        staticInput.type = step.type === "setChecked" ? "checkbox" : "text";
        if (step.type === "setChecked") {
          staticInput.checked = Boolean(step.value ?? true);
          staticInput.addEventListener("change", () => {
            step.value = staticInput.checked;
          });
        } else {
          staticInput.value = step.value ?? "";
          staticInput.addEventListener("input", () => {
            step.value = staticInput.value;
          });
        }
        staticGroup.appendChild(staticInput);
        valRow.appendChild(staticGroup);
      }

      item.appendChild(valRow);
    }

    list.appendChild(item);
  });
}

el("add-step-btn").addEventListener("click", () => {
  if (!editingWorkflow || editingWorkflow.steps.length >= 30) return;
  editingWorkflow.steps.push({
    id: crypto.randomUUID(),
    type: "click",
    effect: "unknown",
    timeoutMs: 5000,
    label: `Step ${editingWorkflow.steps.length + 1}`,
    target: {
      reviewedAt: new Date().toISOString(),
      locators: [{ type: "css", value: "button" }],
    },
    postcondition: { condition: "visible", expected: true },
  });
  renderEditorSteps();
});

function renderEditorParams() {
  if (!editingWorkflow) return;
  const list = el("wf-params-list");
  list.innerHTML = "";
  editingWorkflow.parameters.forEach((param, index) => {
    const item = document.createElement("div");
    item.className = "param-editor-item";

    const header = document.createElement("div");
    header.className = "param-editor-header";
    header.innerHTML = `<strong>${param.label || param.name}</strong>`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger small";
    del.textContent = "×";
    del.addEventListener("click", () => {
      editingWorkflow.parameters.splice(index, 1);
      renderEditorParams();
      renderEditorSteps();
    });
    header.appendChild(del);

    const row = document.createElement("div");
    row.className = "row-2";
    row.innerHTML = `
      <div class="form-group"><label>Variable Name</label><input type="text" class="p-name" value="${param.name}"></div>
      <div class="form-group"><label>Label</label><input type="text" class="p-label" value="${param.label}"></div>
    `;

    row.querySelector(".p-name").addEventListener("input", (e) => {
      param.name = e.target.value;
    });
    row.querySelector(".p-label").addEventListener("input", (e) => {
      param.label = e.target.value;
    });

    item.append(header, row);
    list.appendChild(item);
  });
}

el("add-param-btn").addEventListener("click", () => {
  if (!editingWorkflow || editingWorkflow.parameters.length >= 30) return;
  const num = editingWorkflow.parameters.length + 1;
  editingWorkflow.parameters.push({
    name: `param_${num}`,
    label: `Parameter ${num}`,
    type: "text",
    required: true,
    defaultValue: "",
  });
  renderEditorParams();
  renderEditorSteps();
});

el("save-workflow-btn").addEventListener("click", async () => {
  if (!editingWorkflow) return;
  editingWorkflow.name = el("wf-name").value.trim() || "Untitled Workflow";
  editingWorkflow.origin = el("wf-origin").value.trim();
  editingWorkflow.updatedAt = new Date().toISOString();
  // Review approval
  editingWorkflow.reviewedRevision = editingWorkflow.revision;
  editingWorkflow.reviewedAt = new Date().toISOString();

  const res = await perform("workflow.save", { workflow: editingWorkflow }, "Workflow approved and saved.");
  if (res) closeEditor();
});

// --- RENDER RUN VIEW (M4) ---
function renderRun() {
  const workflows = snapshot?.workflows || [];
  const wf = workflows.find((w) => w.id === selectedRunWorkflowId);
  const activeRun = snapshot?.activeRun;

  const setupCard = el("run-setup-card");
  const activeCard = el("active-run-card");

  if (activeRun) {
    setupCard.hidden = true;
    activeCard.hidden = false;
    renderActiveRun(activeRun);
    return;
  }

  activeCard.hidden = true;
  setupCard.hidden = false;

  const startBtn = el("start-run-btn");
  const previewBtn = el("preview-run-btn");
  const paramsContainer = el("run-params-container");
  const inputsForm = el("run-inputs-form");

  if (!wf) {
    startBtn.disabled = true;
    previewBtn.disabled = true;
    paramsContainer.hidden = true;
    return;
  }

  const isApproved = wf.reviewedRevision === wf.revision;
  startBtn.disabled = !isApproved || busy;
  previewBtn.disabled = busy;

  if (wf.parameters.length > 0) {
    paramsContainer.hidden = false;
    inputsForm.innerHTML = "";
    for (const p of wf.parameters) {
      const group = document.createElement("div");
      group.className = "form-group";
      group.innerHTML = `<label for="input-${p.name}">${p.label}</label>`;
      const inp = document.createElement("input");
      inp.id = `input-${p.name}`;
      inp.type = p.type === "number" ? "number" : "text";
      inp.value = runInputsValues[p.name] ?? p.defaultValue ?? "";
      inp.addEventListener("input", () => {
        runInputsValues[p.name] = inp.value;
      });
      group.appendChild(inp);
      inputsForm.appendChild(group);
    }
  } else {
    paramsContainer.hidden = true;
  }
}

el("run-workflow-select").addEventListener("change", (e) => {
  selectedRunWorkflowId = e.target.value;
  el("run-preview-container").hidden = true;
  renderRun();
});

el("preview-run-btn").addEventListener("click", async () => {
  if (!selectedRunWorkflowId) return;
  const res = await perform("run.preview", { windowId, workflowId: selectedRunWorkflowId }, "Page preview updated.");
  if (res?.targetPreviews) {
    const container = el("run-preview-container");
    const summary = el("run-preview-summary");
    const list = el("run-preview-steps");
    container.hidden = false;
    list.innerHTML = "";

    let matchedCount = 0;
    res.targetPreviews.forEach((tp, i) => {
      if (tp.matched) matchedCount += 1;
      const li = document.createElement("li");
      li.className = "caption";
      li.textContent = `Step ${i + 1}: ${tp.matched ? "✓ Target matched" : `✗ Target issue: ${tp.status}`}`;
      list.appendChild(li);
    });
    summary.textContent = `${matchedCount} of ${res.targetPreviews.length} targets resolved on this page.`;
  }
});

el("start-run-btn").addEventListener("click", async () => {
  if (!selectedRunWorkflowId) return;
  const wf = snapshot?.workflows?.find((w) => w.id === selectedRunWorkflowId);
  if (!wf) return;
  await perform("run.start", {
    windowId,
    workflowId: selectedRunWorkflowId,
    workflowRevision: wf.revision,
    inputs: runInputsValues,
  }, "Supervised run started.");
});

function renderActiveRun(run) {
  const wf = snapshot?.workflows?.find((w) => w.id === run.workflowId);
  el("active-run-title").textContent = `Running: ${wf?.name || "Workflow"}`;
  el("active-run-state-badge").textContent = run.state.toUpperCase();
  el("active-run-step-indicator").textContent = `Step ${run.nextStepIndex + 1} of ${wf?.steps.length || 0}`;

  const list = el("active-run-steps");
  list.innerHTML = "";

  wf?.steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = "progress-step-item";

    let state = "pending";
    if (index < run.nextStepIndex) state = "completed";
    else if (index === run.nextStepIndex) state = run.state;

    item.dataset.state = state;

    const icon = document.createElement("span");
    icon.className = "step-status-icon";
    icon.textContent = state === "completed" ? "✓" : state === "running" ? "→" : state === "awaitingConfirmation" ? "!" : state === "failed" ? "×" : "○";

    const label = document.createElement("span");
    label.textContent = step.label || `Step ${index + 1}: ${step.type}`;

    item.append(icon, label);
    list.appendChild(item);
  });

  const checkpointPrompt = el("checkpoint-prompt");
  if (run.state === "awaitingConfirmation") {
    checkpointPrompt.hidden = false;
    const curStep = wf?.steps[run.nextStepIndex];
    el("checkpoint-desc").textContent = `Step ${run.nextStepIndex + 1} (${curStep?.type}) has effect '${curStep?.effect}'. Confirm to execute.`;
  } else {
    checkpointPrompt.hidden = true;
  }

  el("pause-run-btn").hidden = run.state !== "running" && run.state !== "awaitingConfirmation";
  el("resume-run-btn").hidden = run.state !== "paused";
}

el("confirm-step-btn").addEventListener("click", async () => {
  const run = snapshot?.activeRun;
  const wf = snapshot?.workflows?.find((w) => w.id === run?.workflowId);
  const step = wf?.steps[run?.nextStepIndex];
  if (run && step) {
    await perform("run.confirmStep", { runId: run.id, stepId: step.id }, "Step confirmed.");
  }
});

el("pause-run-btn").addEventListener("click", async () => {
  const run = snapshot?.activeRun;
  if (run) await perform("run.pause", { runId: run.id }, "Run paused.");
});

el("resume-run-btn").addEventListener("click", async () => {
  const run = snapshot?.activeRun;
  if (run) await perform("run.resume", { runId: run.id }, "Run resumed.");
});

el("cancel-run-btn").addEventListener("click", async () => {
  const run = snapshot?.activeRun;
  if (run) await perform("run.stop", { runId: run.id }, "Run stopped.");
});

el("stop-run-btn").addEventListener("click", async () => {
  const run = snapshot?.activeRun;
  if (run) await perform("run.stop", { runId: run.id }, "Run stopped.");
});

// --- RENDER SETTINGS & DATA VIEW ---
function renderSettings() {
  el("data-count").textContent = `${snapshot?.eventCount?.toLocaleString() ?? 0} EVENTS`;
  el("retention-help").textContent = `Kept for up to ${snapshot?.retention?.maxDays ?? 7} days and ${snapshot?.retention?.maxEvents?.toLocaleString() ?? 10000} events across sessions.`;

  const sessions = snapshot?.sessions || [];
  const emptySessions = el("sessions-empty");
  const list = el("session-list");
  list.innerHTML = "";

  if (sessions.length === 0) {
    emptySessions.hidden = false;
  } else {
    emptySessions.hidden = true;
    for (const item of sessions) {
      const node = document.createElement("li");
      node.className = "session-item";
      node.innerHTML = `
        <p class="session-origin">${item.origin}</p>
        <div class="session-details">
          <p class="caption">${formatTime(item.startedAt)} · ${item.eventCount} events · ${item.state}</p>
          <button type="button" class="danger session-delete">Delete</button>
        </div>
      `;
      node.querySelector(".session-delete").addEventListener("click", () => reviewDeletion(item.id));
      list.appendChild(node);
    }
  }

  const summaries = snapshot?.summaries || [];
  const emptySumm = el("summaries-empty");
  const summList = el("summaries-list");
  summList.innerHTML = "";

  if (summaries.length === 0) {
    emptySumm.hidden = false;
  } else {
    emptySumm.hidden = true;
    for (const summ of summaries) {
      const node = document.createElement("li");
      node.className = "session-item";
      node.innerHTML = `
        <p class="session-origin">${summ.origin}</p>
        <div class="session-details">
          <p class="caption">${formatTime(summ.startedAt)} · ${summ.state.toUpperCase()} · ${summ.completedStepCount} steps done</p>
        </div>
      `;
      summList.appendChild(node);
    }
  }

  el("review-export").disabled = busy || (!sessions.length && !snapshot?.workflows?.length);
  el("clear-data").disabled = busy || windowId === null;
}

function reviewDeletion(sessionId) {
  deletion = { sessionId };
  el("deletion-title").textContent = sessionId ? "Delete this session?" : "Clear all RepeatFlow data?";
  el("deletion-description").textContent = sessionId
    ? "Delete this session and its recorded interactions. This cannot be undone."
    : "End any active session and delete all observation sessions, events, workflows, candidates, runs, and settings. This cannot be undone.";
  el("deletion-review").hidden = false;
}

el("cancel-delete").addEventListener("click", () => {
  deletion = null;
  el("deletion-review").hidden = true;
});

el("confirm-delete").addEventListener("click", async () => {
  if (!deletion) return;
  const { sessionId } = deletion;
  deletion = null;
  el("deletion-review").hidden = true;
  await perform(sessionId ? "data.deleteSession" : "data.clear", sessionId ? { sessionId } : {}, sessionId ? "Session deleted." : "All local data cleared.");
});

el("review-export").addEventListener("click", async () => {
  try {
    const data = await request("data.export", {});
    pendingExport = data;
    el("export-summary").textContent = `${data.sessions.length} sessions, ${data.events.length} events, ${data.workflows.length} workflows, ${data.summaries.length} run summaries. Snapshot taken ${formatTime(data.exportedAt)}.`;
    el("export-review").hidden = false;
  } catch (err) {
    showError(err.message);
  }
});

el("cancel-export").addEventListener("click", () => {
  pendingExport = null;
  el("export-review").hidden = true;
});

el("confirm-export").addEventListener("click", () => {
  if (!pendingExport) return;
  const blob = new Blob([JSON.stringify(pendingExport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `repeatflow-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  pendingExport = null;
  el("export-review").hidden = true;
  announce("Download initiated.");
});

// Observe session actions
el("start-observing").addEventListener("click", async () => {
  if (!snapshot?.activeTab) return;
  await perform("session.start", { windowId, tabId: snapshot.activeTab.id }, "Observation started for this document.");
});
el("pause-observing").addEventListener("click", async () => {
  const session = snapshot?.session;
  if (session) await perform("session.pause", { sessionId: session.id }, "Observation paused.");
});
el("resume-observing").addEventListener("click", async () => {
  const session = snapshot?.session;
  if (session) await perform("session.resume", { sessionId: session.id }, "Observation resumed.");
});
el("stop-observing").addEventListener("click", async () => {
  const session = snapshot?.session;
  if (session) await perform("session.stop", { sessionId: session.id }, "Observation stopped.");
});
el("clear-data").addEventListener("click", () => reviewDeletion(null));

// --- REFRESH SNAPSHOT ---
async function refresh(force = false) {
  if (windowId === null || busy || (!force && snapshotRequests > 0)) return;
  const epoch = ++snapshotEpoch;
  snapshotRequests += 1;
  try {
    const data = await request("panel.snapshot", { windowId });
    if (epoch !== snapshotEpoch || busy) return;
    snapshot = data;
    unavailable = false;
    renderObserve();
    renderSuggestions();
    renderWorkflows();
    renderRun();
    renderSettings();
  } catch (error) {
    if (epoch !== snapshotEpoch || busy) return;
    unavailable = true;
    showError(error.message);
  } finally {
    snapshotRequests -= 1;
  }
}

// --- INITIALIZE SETTINGS & OBSERVATION ---
async function initializeSettings() {
  const checkbox = el("show-guide");
  const guide = el("setup-guide");
  const status = el("settings-status");

  if (!globalThis.chrome?.storage?.local) {
    status.textContent = "Preview mode. Load extension/ in Chrome to save this preference.";
    return;
  }

  const saved = await chrome.storage.local.get(SETTINGS_KEY);
  const showGuide = saved[SETTINGS_KEY]?.showGuide ?? true;
  checkbox.checked = showGuide;
  guide.hidden = !showGuide;
  checkbox.disabled = false;
  status.textContent = "This preference is saved only in this browser.";

  checkbox.addEventListener("change", async () => {
    const val = checkbox.checked;
    guide.hidden = !val;
    await chrome.storage.local.set({ [SETTINGS_KEY]: { schemaVersion: 1, showGuide: val } });
  });
}

async function initialize() {
  await initializeSettings();
  if (!globalThis.chrome?.runtime?.sendMessage || !chrome.windows?.getCurrent) return;
  try {
    const currentWindow = await chrome.windows.getCurrent();
    windowId = currentWindow.id;
    await refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  } catch {
    showError("INTERNAL_ERROR");
  }
}

await initialize();
