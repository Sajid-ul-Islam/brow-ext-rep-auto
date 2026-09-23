import assert from "node:assert/strict";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/observer.js", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function createHarness({ send, digestGate } = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const messageListeners = [];
  const intervals = new Map();
  const sent = [];
  let timerId = 0;
  const add = (map, name, fn) => map.set(name, [...(map.get(name) ?? []), fn]);
  const document = {
    nodeType: 9,
    visibilityState: "visible",
    addEventListener: (name, fn) => add(documentListeners, name, fn),
  };
  const location = { href: "https://fixture.example/private?token=DO_NOT_STORE#secret", origin: "https://fixture.example", protocol: "https:" };
  const window = { addEventListener: (name, fn) => add(windowListeners, name, fn) };
  window.self = window;
  window.top = window;
  const chrome = {
    runtime: {
      id: "fixture-extension",
      onMessage: { addListener: listener => messageListeners.push(listener) },
      sendMessage: async message => {
        sent.push(plain(message));
        if (send) return send(message);
        if (message.type === "events.append") return { ok: true, data: { accepted: message.payload.events.length, lastSequence: message.payload.events.at(-1).sequence } };
        return { ok: true, data: {} };
      },
    },
  };
  const context = vm.createContext({
    window, document, location, chrome, TextEncoder, Uint8Array,
    crypto: {
      randomUUID,
      getRandomValues: values => webcrypto.getRandomValues(values),
      subtle: {
        digest: async (_algorithm, bytes) => {
          if (digestGate) await digestGate();
          const hashed = createHash("sha256").update(bytes).digest();
          return hashed.buffer.slice(hashed.byteOffset, hashed.byteOffset + hashed.byteLength);
        },
      },
    },
    setInterval: callback => { intervals.set(++timerId, callback); return timerId; },
    clearInterval: id => intervals.delete(id),
  });
  vm.runInContext(source, context);
  const node = (tag, { parent = null, attrs = {}, type = "text", root = document, editable = false } = {}) => {
    const result = {
      nodeType: 1, localName: tag, parentElement: parent, previousElementSibling: null,
      disabled: false, isContentEditable: editable, type,
      getRootNode: () => root,
      getAttribute: name => Object.hasOwn(attrs, name) ? attrs[name] : null,
      hasAttribute: name => Object.hasOwn(attrs, name),
    };
    for (const property of ["value", "checked", "selectedOptions", "innerHTML", "outerHTML", "textContent", "innerText", "href", "id", "className"]) {
      Object.defineProperty(result, property, { get() { throw new Error(`Excluded data read: ${property}`); } });
    }
    return result;
  };
  const command = (type, payload = {}, sender = { id: chrome.runtime.id }, extra = {}) => {
    let response;
    const message = { protocolVersion: 1, type, requestId: randomUUID(), payload, ...extra };
    messageListeners[0](message, sender, result => { response = plain(result); });
    return response;
  };
  const fire = (type, target, { trusted = true, path } = {}) => {
    const event = { type, target, isTrusted: trusted, composedPath: () => path ?? [target, document, window] };
    for (const listener of documentListeners.get(type) ?? []) listener(event);
  };
  const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
  const tick = async () => {
    await settle();
    for (const callback of intervals.values()) callback();
    await settle();
  };
  const start = (sessionId = randomUUID()) => {
    const epoch = randomUUID();
    assert.equal(command("observer.start", { sessionId, epoch }).ok, true);
    return { sessionId, epoch };
  };
  const lifecycle = (name) => { for (const listener of windowListeners.get(name) ?? []) listener(); };
  return { command, fire, tick, settle, node, start, sent, location, document, lifecycle, context, messageListeners,
    state: () => command("observer.probe").data,
    batches: () => sent.filter(message => message.type === "events.append"),
    recorded: () => sent.filter(message => message.type === "events.append").flatMap(message => message.payload.events),
  };
}

test("injection and probing do not record; only exact authorized commands start capture", async () => {
  const h = createHarness();
  const button = h.node("button");
  h.fire("click", button);
  await h.tick();
  assert.deepEqual(h.state(), { sessionId: null, state: "idle", origin: "https://fixture.example" });
  assert.equal(h.sent.length, 0);
  const payload = { sessionId: randomUUID(), epoch: randomUUID() };
  assert.equal(h.command("observer.start", payload, { id: "different" }).code, "UNAUTHORIZED");
  assert.equal(h.command("observer.start", payload, { id: "fixture-extension", tab: { id: 2 } }).code, "UNAUTHORIZED");
  assert.equal(h.command("observer.start", { ...payload, rawValue: "private" }).code, "INVALID_MESSAGE");
  assert.equal(h.command("observer.start", payload, undefined, { pageText: "private" }).code, "INVALID_MESSAGE");
  assert.equal(h.command("observer.start", payload, undefined, { protocolVersion: 2 }).code, "INVALID_MESSAGE");
  assert.equal(h.command("observer.start", { ...payload, epoch: 2 }).code, "INVALID_MESSAGE");
  assert.equal(h.state().state, "idle");
  h.start();
  h.fire("click", button);
  await h.tick();
  assert.equal(h.recorded().length, 1);
});

test("reinjection installs one listener and does not reset existing consent", () => {
  const h = createHarness();
  const scope = h.start();
  vm.runInContext(source, h.context);
  assert.equal(h.messageListeners.length, 1);
  assert.equal(h.state().sessionId, scope.sessionId);
  assert.equal(h.state().state, "observing");
});

test("supported interactions contain opaque session keys and never page content or values", async () => {
  const h = createHarness();
  const page = h.node("body");
  const button = h.node("button", { parent: page, attrs: { id: "customer-123", "aria-label": "Apply filters", class: "DO_NOT_STORE" } });
  const span = h.node("span", { parent: button });
  const checkbox = h.node("input", { parent: page, type: "checkbox", attrs: { name: "active-filter" } });
  checkbox.previousElementSibling = button;
  const select = h.node("select", { parent: page });
  select.previousElementSibling = checkbox;
  const scope = h.start();
  h.fire("click", span);
  h.fire("click", button);
  h.fire("change", checkbox);
  h.fire("change", select);
  await h.tick();
  const events = h.recorded();
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4]);
  assert.equal(events[0].targetKey, events[1].targetKey);
  assert.notEqual(events[1].targetKey, events[2].targetKey);
  assert.deepEqual(events.map(event => event.fieldKind), ["none", "none", "checkbox", "select"]);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ["action", "fieldKind", "sequence", "targetKey"]);
    assert.match(event.targetKey, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(Object.keys(h.batches()[0].payload).sort(), ["epoch", "events", "sessionId"]);
  assert.deepEqual(Object.keys(h.batches()[0]).sort(), ["payload", "protocolVersion", "requestId", "type"]);
  assert.equal(h.batches()[0].payload.epoch, scope.epoch);
  assert.doesNotMatch(JSON.stringify(h.sent), /DO_NOT_STORE|customer-123|Apply filters|active-filter|fixture\.example|private|token/);
  h.command("observer.stop", { sessionId: scope.sessionId });
  h.start();
  h.fire("click", button);
  await h.tick();
  assert.notEqual(h.recorded().at(-1).targetKey, events[0].targetKey);
});

test("synthetic, sensitive, free-entry, iframe, shadow, and editable interactions are excluded", async () => {
  const h = createHarness();
  h.start();
  h.fire("click", h.node("button"), { trusted: false });
  for (const type of ["password", "text", "number", "email", "tel", "file", "hidden", "date", "submit"]) {
    h.fire("click", h.node("input", { type }));
    h.fire("change", h.node("input", { type }));
  }
  for (const [attribute, value] of [["autocomplete", "one-time-code"], ["name", "creditCard"], ["id", "otpChoice"], ["aria-label", "Account verification"], ["placeholder", "PIN"], ["name", "x".repeat(257)]]) {
    h.fire("change", h.node("input", { type: "checkbox", attrs: { [attribute]: value } }));
  }
  const sensitiveForm = h.node("form", { attrs: { id: "payment" } });
  h.fire("click", h.node("button", { parent: sensitiveForm }));
  const editable = h.node("div", { attrs: { contenteditable: "true" } });
  h.fire("click", h.node("button", { parent: editable }));
  h.fire("click", h.node("button", { editable: true }));
  h.fire("click", h.node("button", { root: { nodeType: 9 } }));
  const shadowRoot = { nodeType: 11 };
  const shadow = h.node("button", { root: shadowRoot });
  h.fire("click", h.node("button"), { path: [shadow, shadowRoot] });
  h.fire("click", h.node("div"));
  h.fire("change", h.node("button"));
  h.fire("click", h.node("button", { attrs: { "data-repeatflow-ui": "" } }));
  await h.tick();
  assert.equal(h.recorded().length, 0);
  assert.equal(h.state().state, "observing");
});

test("Pause invalidates pending digest and Resume preserves a sequence gap with a fresh epoch", async () => {
  let release;
  let gate = new Promise(resolve => { release = resolve; });
  const h = createHarness({ digestGate: () => gate });
  const scope = h.start();
  const button = h.node("button");
  h.fire("click", button);
  assert.equal(h.command("observer.pause", { sessionId: scope.sessionId }).data.state, "paused");
  release();
  gate = Promise.resolve();
  await h.tick();
  h.fire("click", button);
  await h.tick();
  assert.equal(h.recorded().length, 0);
  assert.equal(h.command("observer.resume", scope).code, "INVALID_STATE");
  const epoch = randomUUID();
  assert.equal(h.command("observer.resume", { sessionId: scope.sessionId, epoch }).data.state, "observing");
  h.fire("click", button);
  await h.tick();
  assert.equal(h.recorded().length, 1);
  assert.equal(h.recorded()[0].sequence, 2);
  assert.equal(h.batches()[0].payload.epoch, epoch);
});

test("a stale failed batch cannot pause a subsequently resumed epoch", async () => {
  let reject;
  const h = createHarness({ send: message => message.type === "events.append" ? new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }) : { ok: true, data: {} } });
  const scope = h.start();
  h.fire("click", h.node("button"));
  await h.tick();
  h.command("observer.pause", { sessionId: scope.sessionId });
  h.command("observer.resume", { sessionId: scope.sessionId, epoch: randomUUID() });
  reject(new Error("previous worker request failed"));
  await h.settle();
  assert.equal(h.state().state, "observing");
});

test("batch rejection and send failures immediately pause collection and drop queued work", async () => {
  for (const send of [() => ({ ok: false, code: "SESSION_PAUSED" }), () => { throw new Error("Extension context invalidated"); }, () => ({ ok: true, data: { accepted: 1, lastSequence: 99 } })]) {
    const h = createHarness({ send });
    h.start();
    const button = h.node("button");
    h.fire("click", button);
    await h.tick();
    assert.equal(h.state().state, "paused");
    h.fire("click", button);
    await h.tick();
    assert.equal(h.batches().length, 1);
    assert.equal(h.sent.at(-1).payload.reason, "contextLost");
  }
});

test("capture and the heartbeat stop on route changes before a queued event can escape", async () => {
  for (const viaEvent of [true, false]) {
    const h = createHarness();
    const scope = h.start();
    h.fire("click", h.node("button"));
    h.location.href = "https://fixture.example/different?credential=private";
    if (viaEvent) h.fire("click", h.node("button"));
    await h.tick();
    assert.equal(h.state().state, "stopped");
    assert.equal(h.recorded().length, 0);
    assert.deepEqual(h.sent.at(-1).payload, { sessionId: scope.sessionId, reason: "navigation" });
  }
});

test("page lifecycle boundaries stop; hiding pauses and requires explicit visible Resume", async () => {
  for (const name of ["pagehide", "hashchange", "popstate"]) {
    const h = createHarness();
    h.start();
    h.lifecycle(name);
    assert.equal(h.state().state, "stopped");
    assert.equal(h.sent.at(-1).payload.reason, "navigation");
  }
  const h = createHarness();
  const scope = h.start();
  h.document.visibilityState = "hidden";
  h.fire("visibilitychange");
  assert.equal(h.state().state, "paused");
  assert.equal(h.sent.at(-1).payload.reason, "tabHidden");
  assert.equal(h.command("observer.resume", { sessionId: scope.sessionId, epoch: randomUUID() }).code, "SCOPE_UNAVAILABLE");
  h.document.visibilityState = "visible";
  h.fire("visibilitychange");
  h.fire("click", h.node("button"));
  await h.tick();
  assert.equal(h.recorded().length, 0);
  assert.equal(h.state().state, "paused");
});

test("batches are capped at fifty and queue overflow terminates even while hashing stalls", async () => {
  const h = createHarness();
  h.start();
  const button = h.node("button");
  for (let i = 0; i < 75; i += 1) {
    h.fire("click", button);
    await h.settle();
  }
  await h.tick();
  assert.equal(h.batches()[0].payload.events.length, 50);
  await h.tick();
  assert.equal(h.batches()[1].payload.events.length, 25);
  assert.deepEqual(h.recorded().map(event => event.sequence), Array.from({ length: 75 }, (_, i) => i + 1));

  let release;
  const stalled = createHarness({ digestGate: () => new Promise(resolve => { release = resolve; }) });
  stalled.start();
  for (let i = 0; i < 205; i += 1) stalled.fire("click", stalled.node("button"));
  assert.equal(stalled.state().state, "stopped");
  assert.equal(stalled.sent.at(-1).payload.reason, "overflow");
  release();
  await stalled.tick();
  assert.equal(stalled.recorded().length, 0);
});

test("Stop clears buffered data and stale session commands cannot control a new session", async () => {
  const h = createHarness();
  const first = h.start();
  h.fire("click", h.node("button"));
  h.command("observer.stop", { sessionId: first.sessionId });
  await h.tick();
  assert.equal(h.recorded().length, 0);
  assert.equal(h.command("observer.start", { ...first, epoch: randomUUID() }).code, "INVALID_STATE");
  const second = h.start();
  assert.equal(h.command("observer.stop", { sessionId: first.sessionId }).code, "INVALID_SESSION");
  assert.equal(h.state().sessionId, second.sessionId);
  assert.equal(h.state().state, "observing");
});
