/* Packaged classic script, injected into the authorized top frame only. */
(() => {
  "use strict";

  if (window.top !== window.self || globalThis.__repeatflowObserver) return;
  Object.defineProperty(globalThis, "__repeatflowObserver", { value: Object.freeze({ installed: true }) });

  const PROTOCOL = 1;
  const MAX_PENDING = 200;
  const MAX_BATCH = 50;
  const TICK_MS = 250;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SENSITIVE = /pass(?:word|code)?|(?:^|[^a-z])pin(?:[^a-z]|$)|otp|one.?time|auth|token|secret|credit|debit|card|cvc|cvv|cc-|payment|billing|bank|account|routing|iban|swift|security|ssn|social.?security|national.?id|passport|identity|credential|private|wallet|recovery|backup.?code|verification/i;
  const ATTRIBUTES = ["autocomplete", "name", "id", "aria-label", "placeholder"];
  const ROLES = new Set(["button", "link", "checkbox", "radio", "combobox", "listbox", "option"]);
  const TAGS = new Set(["html", "body", "main", "section", "article", "aside", "nav", "header", "footer", "div", "span", "form", "fieldset", "legend", "label", "button", "a", "select", "option", "optgroup", "input", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "p"]);
  let state = "idle";
  let sessionId = null;
  let epoch = null;
  let salt = null;
  let route = null;
  let sequence = 0;
  let generation = 0;
  let jobs = [];
  let events = [];
  let digesting = false;
  let sending = false;
  let inFlightCount = 0;
  let timer = null;

  const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const identifier = value => typeof value === "string" && UUID.test(value);
  const snapshot = () => ({ sessionId, state, origin: location.origin });
  const ok = () => ({ ok: true, data: snapshot() });
  const fail = code => ({ ok: false, code });
  const envelope = (type, payload) => ({ protocolVersion: PROTOCOL, type, requestId: crypto.randomUUID(), payload });

  function clearPending() {
    generation += 1;
    jobs = [];
    events = [];
    digesting = false;
    sending = false;
    inFlightCount = 0;
  }

  function notifyEnd(reason) {
    try {
      // Lifecycle delivery is best effort; worker scope checks remain authoritative.
      Promise.resolve(chrome.runtime.sendMessage(envelope("observer.end", { sessionId, reason }))).catch(() => {});
    } catch { /* Extension context may already have been removed. */ }
  }

  function pause(reason = null) {
    if (state !== "observing") return;
    state = "paused";
    clearPending();
    if (reason) notifyEnd(reason);
  }

  function stop(reason = null) {
    if (state !== "observing" && state !== "paused") return;
    state = "stopped";
    clearPending();
    salt = null;
    epoch = null;
    route = null;
    clearInterval(timer);
    timer = null;
    if (reason) notifyEnd(reason);
  }

  function checkScope() {
    if (state !== "observing" && state !== "paused") return false;
    if (location.href !== route) {
      stop("navigation");
      return false;
    }
    if (document.visibilityState !== "visible") {
      pause("tabHidden");
      return false;
    }
    return state === "observing";
  }

  function contextLost() {
    pause("contextLost");
  }

  function sensitiveOrUnsupported(element) {
    // Attribute values are inspected only to exclude controls; they never enter a key or message.
    for (let cursor = element, depth = 0; cursor; cursor = cursor.parentElement, depth += 1) {
      if (depth > 64 || cursor.getRootNode() !== document || cursor.isContentEditable
        || cursor.hasAttribute("contenteditable") || cursor.hasAttribute("data-repeatflow-ui")) return true;
      for (const name of ATTRIBUTES) {
        const value = cursor.getAttribute(name);
        if (value !== null && (value.length > 256 || SENSITIVE.test(value))) return true;
      }
    }
    return false;
  }

  function supportedTarget(event) {
    if (!event.isTrusted || !event.target || event.target.nodeType !== 1) return null;
    if (typeof event.composedPath !== "function") return null;
    for (const node of event.composedPath()) {
      if (node?.nodeType === 1 && node.getRootNode() !== document) return null;
      if (node?.nodeType === 11) return null;
    }
    if (sensitiveOrUnsupported(event.target)) return null;
    let element = event.target;
    for (let depth = 0; element && depth < 16; depth += 1, element = element.parentElement) {
      const tag = element.localName;
      if (!["button", "a", "select", "input"].includes(tag)) continue;
      if (element.disabled || element.getAttribute("aria-disabled") === "true") return null;
      if (tag === "input") {
        // Free text/number fields can contain unmarked secrets. M1 excludes them entirely.
        const kind = element.type.toLowerCase();
        return kind === "checkbox" || kind === "radio" ? { element, fieldKind: kind } : null;
      }
      if (tag === "select") return { element, fieldKind: "select" };
      return event.type === "click" ? { element, fieldKind: "none" } : null;
    }
    return null;
  }

  function structuralTuple(element, fieldKind) {
    const path = [];
    for (let cursor = element, depth = 0; cursor; cursor = cursor.parentElement, depth += 1) {
      if (depth >= 32) return null;
      let index = 0;
      for (let sibling = cursor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        index += 1;
        if (index > 4096) return null;
      }
      const tag = TAGS.has(cursor.localName) ? cursor.localName : "other";
      const rawRole = cursor.getAttribute("role");
      path.push([tag, index, ROLES.has(rawRole) ? rawRole : "none"]);
    }
    return JSON.stringify([fieldKind, path]);
  }

  async function digestJobs(token) {
    digesting = true;
    try {
      while (token === generation && state === "observing" && jobs.length) {
        const job = jobs.shift();
        const bytes = new TextEncoder().encode(`${salt}:${job.tuple}`);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        if (token !== generation || !checkScope()) return;
        const targetKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        events.push({ sequence: job.sequence, action: job.action, targetKey, fieldKind: job.fieldKind });
      }
    } catch {
      if (token === generation) contextLost();
    } finally {
      if (token === generation) digesting = false;
    }
  }

  function capture(event) {
    if (!checkScope()) return;
    const target = supportedTarget(event);
    if (!target) return;
    const tuple = structuralTuple(target.element, target.fieldKind);
    if (!tuple) return;
    if (jobs.length + events.length + inFlightCount + Number(digesting) >= MAX_PENDING) {
      stop("overflow");
      return;
    }
    sequence += 1;
    jobs.push({ tuple, sequence, action: event.type, fieldKind: target.fieldKind });
    if (!digesting) void digestJobs(generation);
  }

  async function flush() {
    if (!checkScope() || sending || !events.length) return;
    const token = generation;
    const batch = events.splice(0, MAX_BATCH);
    sending = true;
    inFlightCount = batch.length;
    try {
      const response = await chrome.runtime.sendMessage(envelope("events.append", { sessionId, epoch, events: batch }));
      if (token !== generation) return;
      if (!exact(response, ["ok", "data"]) || response.ok !== true
        || !exact(response.data, ["accepted", "lastSequence"])
        || !Number.isSafeInteger(response.data.accepted) || response.data.accepted < 0 || response.data.accepted > batch.length
        || !Number.isSafeInteger(response.data.lastSequence) || response.data.lastSequence !== batch.at(-1).sequence) {
        contextLost();
      }
    } catch {
      if (token === generation) contextLost();
    } finally {
      if (token === generation) {
        sending = false;
        inFlightCount = 0;
      }
    }
  }

  function onMessage(message, sender, respond) {
    if (sender?.id !== chrome.runtime.id || sender.tab !== undefined) {
      respond(fail("UNAUTHORIZED"));
      return false;
    }
    if (!exact(message, ["protocolVersion", "type", "requestId", "payload"])
      || message.protocolVersion !== PROTOCOL || !identifier(message.requestId)) {
      respond(fail("INVALID_MESSAGE"));
      return false;
    }
    const payload = message.payload;
    if (message.type === "observer.probe" && exact(payload, [])) {
      checkScope();
      respond(ok());
      return false;
    }
    if ((message.type === "observer.start" || message.type === "observer.resume")
      && exact(payload, ["sessionId", "epoch"]) && identifier(payload.sessionId) && identifier(payload.epoch)) {
      if (!/^https?:$/.test(location.protocol) || document.visibilityState !== "visible") {
        respond(fail("SCOPE_UNAVAILABLE"));
        return false;
      }
      if (message.type === "observer.start") {
        if (state === "observing" || state === "paused" || payload.sessionId === sessionId) {
          respond(fail("INVALID_STATE"));
          return false;
        }
        clearPending();
        sessionId = payload.sessionId;
        sequence = 0;
        salt = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
        route = location.href;
        timer = setInterval(() => { void flush(); }, TICK_MS);
      } else {
        checkScope();
        if (state !== "paused" || payload.sessionId !== sessionId || !salt || payload.epoch === epoch) {
          respond(fail("INVALID_STATE"));
          return false;
        }
        clearPending();
      }
      epoch = payload.epoch;
      state = "observing";
      respond(ok());
      return false;
    }
    if ((message.type === "observer.pause" || message.type === "observer.stop")
      && exact(payload, ["sessionId"]) && identifier(payload.sessionId)) {
      if (payload.sessionId !== sessionId) respond(fail("INVALID_SESSION"));
      else {
        if (message.type === "observer.pause") pause();
        else stop();
        respond(ok());
      }
      return false;
    }
    respond(fail("INVALID_MESSAGE"));
    return false;
  }

  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener("click", capture, true);
  document.addEventListener("change", capture, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") pause("tabHidden");
  });
  window.addEventListener("pagehide", () => stop("navigation"));
  window.addEventListener("hashchange", () => stop("navigation"));
  window.addEventListener("popstate", () => stop("navigation"));
})();
