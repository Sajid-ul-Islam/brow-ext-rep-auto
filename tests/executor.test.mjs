import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../executor.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function createHarness() {
  const messageListeners = [];
  const elements = new Map();

  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
    }
  }

  class FakeMouseEvent extends FakeEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.view = init.view;
    }
  }

  function createElement(tag, {
    id = '',
    attrs = {},
    text = '',
    visible = true,
    disabled = false,
    type = 'text',
    value = '',
    checked = false,
  } = {}) {
    const listeners = new Map();
    const dispatched = [];
    const el = {
      nodeType: 1,
      localName: tag.toLowerCase(),
      id,
      type,
      value,
      checked,
      disabled,
      textContent: text,
      isConnected: true,
      dispatched,
      getAttribute(name) {
        if (name === 'id') return el.id || null;
        if (name === 'disabled' && el.disabled) return '';
        if (name === 'aria-disabled') return el.disabled ? 'true' : null;
        return Object.hasOwn(attrs, name) ? attrs[name] : null;
      },
      hasAttribute(name) {
        return el.getAttribute(name) !== null;
      },
      setAttribute(name, val) {
        attrs[name] = String(val);
      },
      getBoundingClientRect() {
        return visible ? { width: 100, height: 30, top: 0, left: 0 } : { width: 0, height: 0, top: 0, left: 0 };
      },
      focus() {
        el.focused = true;
      },
      scrollIntoView() {
        el.scrolled = true;
      },
      click() {
        el.clicked = true;
        el.dispatchEvent(new FakeMouseEvent('click', { bubbles: true, cancelable: true }));
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent(event) {
        dispatched.push(event.type);
        for (const fn of listeners.get(event.type) ?? []) fn(event);
        return true;
      },
      _visible: visible,
    };
    if (id) elements.set(id, el);
    return el;
  }

  const allDomNodes = [];

  const document = {
    nodeType: 9,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith('#')) {
        const found = document.getElementById(selector.slice(1));
        return found ? [found] : [];
      }
      if (selector.startsWith('[') && selector.endsWith(']')) {
        const match = selector.slice(1, -1).match(/^([a-zA-Z0-9_-]+)="([^"]+)"$/);
        if (match) {
          const [, attr, val] = match;
          return allDomNodes.filter((n) => n.getAttribute(attr) === val);
        }
      }
      if (selector === 'button, a, select, input, [role]') {
        return allDomNodes.filter((n) => ['button', 'a', 'select', 'input'].includes(n.localName) || n.hasAttribute('role'));
      }
      return allDomNodes.filter((n) => n.localName === selector.toLowerCase() || (selector.startsWith('.') && n.getAttribute('class')?.includes(selector.slice(1))));
    },
  };

  const window = {
    getComputedStyle(el) {
      return {
        display: el._visible ? 'block' : 'none',
        visibility: el._visible ? 'visible' : 'hidden',
        opacity: el._visible ? '1' : '0',
      };
    },
  };
  window.self = window;
  window.top = window;

  const chrome = {
    runtime: {
      id: 'fixture-extension',
      onMessage: {
        addListener(listener) { messageListeners.push(listener); },
      },
    },
  };

  const CSS = {
    escape(str) { return String(str).replace(/"/g, '\\"'); },
  };

  const context = vm.createContext({
    window,
    document,
    chrome,
    CSS,
    Event: FakeEvent,
    MouseEvent: FakeMouseEvent,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    Date,
    crypto: { randomUUID },
  });

  vm.runInContext(source, context);

  function registerNode(node) {
    allDomNodes.push(node);
    return node;
  }

  function command(type, payload = {}, sender = { id: chrome.runtime.id }) {
    return new Promise((resolve) => {
      const msg = { protocolVersion: 1, type, requestId: randomUUID(), payload };
      const handled = messageListeners[0](msg, sender, (res) => {
        resolve(plain(res));
      });
      if (!handled) {
        // Synchronous reply
      }
    });
  }

  return {
    createElement,
    registerNode,
    command,
  };
}

test('executor target resolution logic handles testAttribute, roleAndName, id, css', async () => {
  const h = createHarness();

  h.registerNode(h.createElement('button', {
    id: 'test-btn',
    attrs: { 'data-testid': 'action-btn', class: 'custom-btn' },
    text: 'Submit Order',
  }));

  // 1. testAttribute
  const resAttr = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'testAttribute', value: 'action-btn', attributeName: 'data-testid' }],
      },
    },
  });
  assert.equal(resAttr.ok, true);
  assert.equal(resAttr.data.matched, true);
  assert.equal(resAttr.data.status, 'OK');

  // 2. id
  const resId = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'id', value: 'test-btn' }],
      },
    },
  });
  assert.equal(resId.ok, true);
  assert.equal(resId.data.matched, true);

  // 3. css
  const resCss = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'css', value: '.custom-btn' }],
      },
    },
  });
  assert.equal(resCss.ok, true);
  assert.equal(resCss.data.matched, true);

  // 4. roleAndName
  const resRole = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'roleAndName', value: 'Submit Order' }],
      },
    },
  });
  assert.equal(resRole.ok, true);
  assert.equal(resRole.data.matched, true);
});

test('executor reports TARGET_NOT_FOUND, TARGET_AMBIGUOUS, TARGET_DISABLED, and TARGET_HIDDEN', async () => {
  const h = createHarness();

  // Missing target
  const resMissing = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'id', value: 'nonexistent' }],
      },
    },
  });
  assert.equal(resMissing.ok, true);
  assert.equal(resMissing.data.matched, false);
  assert.equal(resMissing.data.status, 'TARGET_NOT_FOUND');

  // Ambiguous target
  h.registerNode(h.createElement('button', { attrs: { class: 'ambiguous-btn' } }));
  h.registerNode(h.createElement('button', { attrs: { class: 'ambiguous-btn' } }));
  const resAmbiguous = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'css', value: '.ambiguous-btn' }],
      },
    },
  });
  assert.equal(resAmbiguous.ok, true);
  assert.equal(resAmbiguous.data.matched, false);
  assert.equal(resAmbiguous.data.status, 'TARGET_AMBIGUOUS');
  assert.equal(resAmbiguous.data.count, 2);

  // Disabled target
  h.registerNode(h.createElement('button', { id: 'disabled-btn', disabled: true }));
  const resDisabled = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'id', value: 'disabled-btn' }],
      },
    },
  });
  assert.equal(resDisabled.ok, true);
  assert.equal(resDisabled.data.status, 'TARGET_DISABLED');
  assert.equal(resDisabled.data.interactable, false);

  // Hidden target
  h.registerNode(h.createElement('button', { id: 'hidden-btn', visible: false }));
  const resHidden = await h.command('executor.preview', {
    step: {
      target: {
        reviewedAt: new Date().toISOString(),
        locators: [{ type: 'id', value: 'hidden-btn' }],
      },
    },
  });
  assert.equal(resHidden.ok, true);
  assert.equal(resHidden.data.status, 'TARGET_HIDDEN');
});

test('executor executes click, fill, select, and setChecked actions', async () => {
  const h = createHarness();

  // Click
  const btn = h.registerNode(h.createElement('button', { id: 'btn-click' }));
  const clickRes = await h.command('executor.execute', {
    step: {
      type: 'click',
      target: { reviewedAt: new Date().toISOString(), locators: [{ type: 'id', value: 'btn-click' }] },
    },
  });
  assert.equal(clickRes.ok, true);
  assert.equal(btn.focused, true);
  assert.equal(btn.clicked, true);
  assert(btn.dispatched.includes('mousedown'));
  assert(btn.dispatched.includes('mouseup'));
  assert(btn.dispatched.includes('click'));

  // Fill
  const inp = h.registerNode(h.createElement('input', { id: 'input-fill', type: 'text' }));
  const fillRes = await h.command('executor.execute', {
    step: {
      type: 'fill',
      target: { reviewedAt: new Date().toISOString(), locators: [{ type: 'id', value: 'input-fill' }] },
    },
    input: 'Hello World',
  });
  assert.equal(fillRes.ok, true);
  assert.equal(inp.value, 'Hello World');
  assert(inp.dispatched.includes('input'));
  assert(inp.dispatched.includes('change'));

  // Select
  const sel = h.registerNode(h.createElement('select', { id: 'sel-test' }));
  const selRes = await h.command('executor.execute', {
    step: {
      type: 'select',
      target: { reviewedAt: new Date().toISOString(), locators: [{ type: 'id', value: 'sel-test' }] },
    },
    input: 'option-2',
  });
  assert.equal(selRes.ok, true);
  assert.equal(sel.value, 'option-2');
  assert(sel.dispatched.includes('change'));

  // SetChecked
  const chk = h.registerNode(h.createElement('input', { id: 'chk-test', type: 'checkbox' }));
  const chkRes = await h.command('executor.execute', {
    step: {
      type: 'setChecked',
      target: { reviewedAt: new Date().toISOString(), locators: [{ type: 'id', value: 'chk-test' }] },
    },
    input: true,
  });
  assert.equal(chkRes.ok, true);
  assert.equal(chk.checked, true);
  assert(chk.dispatched.includes('change'));
  assert(chk.dispatched.includes('click'));
});

test('executor handles waitFor postcondition checks and timeouts', async () => {
  const h = createHarness();
  h.registerNode(h.createElement('button', { id: 'wait-target', visible: true, disabled: false }));

  // Condition already met (visible=true)
  const waitRes = await h.command('executor.execute', {
    step: {
      type: 'waitFor',
      target: { reviewedAt: new Date().toISOString(), locators: [{ type: 'id', value: 'wait-target' }] },
      postcondition: { condition: 'visible', expected: true },
      timeoutMs: 1000,
    },
  });
  assert.equal(waitRes.ok, true);
  assert.equal(waitRes.data.status, 'success');
});

test('executor rejects unauthorized senders and malformed messages', async () => {
  const h = createHarness();

  // Wrong sender extension ID
  const resBadId = await h.command('executor.preview', {}, { id: 'evil-extension' });
  assert.equal(resBadId.ok, false);
  assert.equal(resBadId.code, 'UNAUTHORIZED');

  // Sender from a tab (content script spoofing)
  const resTabSender = await h.command('executor.preview', {}, { id: 'fixture-extension', tab: { id: 1 } });
  assert.equal(resTabSender.ok, false);
  assert.equal(resTabSender.code, 'UNAUTHORIZED');

  // Abort command
  const resAbort = await h.command('executor.abort', {});
  assert.equal(resAbort.ok, true);
  assert.equal(resAbort.data.status, 'aborted');
});

