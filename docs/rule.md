# RepeatFlow development rules

Status: foundation rules, 2026-09-22. Applies to code, tests, documentation, and future automation behavior.

## 1. Sources of truth

Read [readme.md](../readme.md) for implemented status, [prd.md](prd.md) for product requirements, [arc.md](arc.md) for architecture, and [design.md](design.md) for UX. [roadmap.md](roadmap.md) defines delivery order. Record meaningful architecture changes in [decisions.md](decisions.md).

Keep implemented behavior separate from proposed behavior. A UI mockup, passing unit test, or manifest entry is not evidence that recording or replay works in a browser. Update status and acceptance evidence when a milestone ships.

## 2. Observation and consent

- Observation is off by default. Installing, opening the panel, and granting browser permission do not by themselves start observation.
- Bind each observation session to an explicitly chosen tab, document, and origin. Show the actual scope and an immediate Stop control.
- Request only permissions needed for the current milestone. M0 requests `sidePanel` and `storage`. Add `activeTab` and `scripting` when the observer exists; keep blanket host permissions out of the MVP.
- Treat navigation, permission loss, extension reload, and document replacement as session boundaries. Re-establish authorization before collecting more events.
- Collect only trusted user interactions while observing. Replayed actions must never become training observations.
- Future persistent observation on selected sites requires a separate product decision, explicit opt-in, and revocable site permission.

## 3. Data boundaries

- Do not record form values, keystrokes, passwords, one-time codes, payment details, clipboard contents, cookies, network payloads, screenshots, or page HTML.
- Event metadata can still identify a person. Do not persist raw element text, accessible labels, IDs, CSS selectors, or arbitrary attributes as observation metadata. Use the approved minimal model in [data-model.md](data-model.md).
- Store only origin in observed URL context. User-reviewed workflow routes must strip query strings, fragments, and credentials. Do not assume a path is free of personal data.
- Store non-secret workflow variables only after explicit review. Run-only inputs must stay ephemeral; request secrets through the website's own UI.
- Keep MVP data in the local browser. No analytics, external model calls, sync, or backend uploads by default.
- Enforce retention and deletion where data is written and read. Proposed caps: observed events seven days or 10,000 total; run summaries 30 days or 1,000 total; saved workflows until deletion. Age expiry must also be enforced before display/export after idle time.
- Logs describe state transitions and error codes, not page content or variable values. Never commit real recordings, browser profiles, tokens, or credentials.
- Local browser storage is not a secure secret vault. Keep storage accessible only to trusted extension contexts; send sanitized events through validated messages.

## 4. Execution rules

- Generate declarative, versioned workflows with allowlisted step types. Never execute page-provided JavaScript, generated code, `eval`, or downloaded scripts.
- Require workflow review and an explicit user Run action. A repetition suggestion is not permission to run it.
- Preview targets and required inputs before execution. Zero or multiple matches, invisible targets, changed origins, and uncertain outcomes must pause or fail visibly.
- Default unknown clicks to requiring confirmation. Button text alone cannot prove an action harmless. Sending, submitting, deleting, publishing, and purchasing require a checkpoint immediately before the action; user-provided classification cannot silently remove this gate.
- Keep Stop reachable throughout a run. Check cancellation immediately before every action; acknowledge that already completed external effects cannot be undone by Stop.
- Run one workflow at a time in one explicitly selected tab for MVP. No unattended scheduling, concurrent runs, or silent background recovery.
- Bound waits and retries. Never retry an action with an external effect if the outcome is unknown. After a worker interruption, ask the user to inspect the result before continuing.
- Do not claim rollback for actions a website has already accepted. Report partial completion accurately.

## 5. Implementation conventions

- Use native ES modules and JavaScript with JSDoc for the foundation. The extension loads directly from the repository root; Node is for development checks only.
- Keep browser adapters separate from the future pure normalization, matching, and workflow validation modules.
- Validate message type, size, payload schema, sender extension identity, tab, frame, document, session, and origin at trust boundaries. A page is untrusted even when the user chose it.
- Register event listeners synchronously when the service worker starts. Persist recoverable state; memory and timers do not guarantee worker continuity.
- Serialize state changes and make migrations explicit. Do not let multiple panels overwrite workflow state independently.
- Render untrusted strings with `textContent`. Keep scripts and styles in packaged files. Use no remote fonts, trackers, or executable dependencies.
- Add dependencies only for a concrete need; document the reason and include a lockfile if dependencies are introduced.
- Prefer stable, reviewed locators and observable postconditions to coordinates or fixed sleeps. Never silently choose the first matching element.

## 6. UX and accessibility

Use the state names and interaction rules in [design.md](design.md). Every control needs a real outcome; label upcoming capabilities explicitly. Support keyboard interaction, visible focus, readable errors, and status that does not depend on color alone. Avoid fabricated success counts, confidence percentages, or time savings.

## 7. Verification and delivery

Run `npm run check` for every change. Follow [testing.md](testing.md) for browser checks; add meaningful tests as observation, detection, and replay arrive. Future fixes involving privacy, authorization, or replay must include regression coverage for the failure path.

Before calling a milestone complete, map evidence to its acceptance criteria, inspect changes for accidental data collection or permission growth, and record what remains untested. Keep the starter usable throughout development. No release dates or performance claims should be presented as measured results without evidence.
