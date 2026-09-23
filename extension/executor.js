/* Packaged classic script, injected into the authorized top frame for supervised execution. */
(() => {
  "use strict";

  if (window.top !== window.self || globalThis.__repeatflowExecutor) return;
  Object.defineProperty(globalThis, "__repeatflowExecutor", { value: Object.freeze({ installed: true }) });

  const PROTOCOL = 1;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const identifier = value => typeof value === "string" && UUID.test(value);
  const ok = (data = {}) => ({ ok: true, data });
  const fail = (code, details = "") => ({ ok: false, code, details });

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInteractable(element) {
    if (!isVisible(element)) return false;
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  /**
   * Resolves target element using ordered locator alternatives.
   */
  function resolveTarget(target) {
    if (!target || !Array.isArray(target.locators) || target.locators.length === 0) {
      return { status: "NO_LOCATORS", element: null };
    }

    for (const locator of target.locators) {
      let matches = [];
      try {
        if (locator.type === "testAttribute") {
          const attr = locator.attributeName || "data-testid";
          matches = Array.from(document.querySelectorAll(`[${attr}="${CSS.escape(locator.value)}"]`));
        } else if (locator.type === "id") {
          const el = document.getElementById(locator.value);
          matches = el ? [el] : [];
        } else if (locator.type === "css") {
          matches = Array.from(document.querySelectorAll(locator.value));
        } else if (locator.type === "roleAndName") {
          // Find elements matching role / text
          const candidates = Array.from(document.querySelectorAll("button, a, select, input, [role]"));
          matches = candidates.filter((el) => {
            const text = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim();
            return text.toLowerCase() === locator.value.toLowerCase();
          });
        }
      } catch {
        continue;
      }

      if (matches.length === 1) {
        const element = matches[0];
        if (!isVisible(element)) return { status: "TARGET_HIDDEN", element };
        if (!isInteractable(element)) return { status: "TARGET_DISABLED", element };
        return { status: "OK", element };
      } else if (matches.length > 1) {
        return { status: "TARGET_AMBIGUOUS", element: null, count: matches.length };
      }
    }

    return { status: "TARGET_NOT_FOUND", element: null };
  }

  function checkCondition(element, condition, expected) {
    if (condition === "visible") return isVisible(element) === expected;
    if (condition === "hidden") return !isVisible(element) === expected;
    if (condition === "enabled") return (element && !element.disabled) === expected;
    if (condition === "checked") return (element && Boolean(element.checked)) === expected;
    return true;
  }

  async function executeAction(step, input) {
    if (step.type === "waitFor") {
      const condition = step.postcondition?.condition || "visible";
      const expected = step.postcondition?.expected ?? true;
      const timeout = step.timeoutMs || 5000;
      const start = Date.now();

      return new Promise((resolve) => {
        const interval = setInterval(() => {
          let el = null;
          if (step.target) {
            const res = resolveTarget(step.target);
            el = res.element;
          }
          if (checkCondition(el, condition, expected)) {
            clearInterval(interval);
            resolve(ok({ status: "success" }));
          } else if (Date.now() - start > timeout) {
            clearInterval(interval);
            resolve(fail("WAIT_TIMEOUT", `Condition ${condition}=${expected} timed out after ${timeout}ms`));
          }
        }, 100);
      });
    }

    const { status, element, count } = resolveTarget(step.target);
    if (status !== "OK") {
      return fail(status, `Target resolution failed: ${status}${count ? ` (${count} matches)` : ""}`);
    }

    // Scroll element into view smoothly if needed
    element.scrollIntoView({ block: "nearest", inline: "nearest" });

    if (step.type === "click") {
      element.focus();
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      element.click();
      return ok({ status: "success" });
    }

    if (step.type === "fill") {
      const val = String(input !== undefined && input !== null ? input : (step.value ?? ""));
      element.focus();
      element.value = val;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return ok({ status: "success" });
    }

    if (step.type === "select") {
      const val = String(input !== undefined && input !== null ? input : (step.value ?? ""));
      element.focus();
      element.value = val;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return ok({ status: "success" });
    }

    if (step.type === "setChecked") {
      const val = Boolean(input !== undefined && input !== null ? input : (step.value ?? true));
      element.focus();
      element.checked = val;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return ok({ status: "success" });
    }

    return fail("UNKNOWN_STEP_TYPE");
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
    if (message.type === "executor.preview") {
      const { status, element, count } = resolveTarget(payload.step?.target);
      respond(ok({
        matched: status === "OK",
        status,
        count: count ?? (element ? 1 : 0),
        interactable: element ? isInteractable(element) : false,
      }));
      return false;
    }

    if (message.type === "executor.execute") {
      executeAction(payload.step, payload.input).then((res) => {
        respond(res);
      }).catch((err) => {
        respond(fail("EXECUTION_ERROR", err.message));
      });
      return true; // Asynchronous response
    }

    if (message.type === "executor.abort") {
      respond(ok({ status: "aborted" }));
      return false;
    }

    respond(fail("INVALID_MESSAGE"));
    return false;
  }

  chrome.runtime.onMessage.addListener(onMessage);
})();
