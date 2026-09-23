# RepeatFlow product requirements

Status: product specification, updated 2026-09-23. **All milestones M0–M5 are implemented.** See [readme.md](../readme.md) for current capabilities and [roadmap.md](roadmap.md) for milestone details.

## 1. Product direction

RepeatFlow will help people turn repetitive browser interactions into understandable, reusable workflows. Users deliberately observe a task, receive evidence that a sequence repeated, review the proposed steps, and manually start a supervised run.

The product must earn trust through clear scope, minimized data, explainable suggestions, and visible execution controls. Detecting a repetition does not authorize execution.

**Working name:** RepeatFlow. **Initial platform:** desktop Chrome 116+, Manifest V3. Edge requires a later validation pass; Firefox is outside the initial scope.

## 2. Problem and users

People repeat small browser tasks because existing automation tools require scripting, manual macro construction, or extensive setup. Recording everything creates a separate problem: users lose track of what was captured and what a saved automation might do.

| User | Repeated work | Desired outcome |
| --- | --- | --- |
| Operations coordinator | Adjusting the same dashboard filters for successive records | Reuse a short, reviewed sequence with clear inputs. |
| Support specialist | Opening a record view and applying the same local controls | Reduce repetitive clicks while supervising each run. |
| Individual analyst | Repeating a filter-and-view sequence within a web tool | Discover a candidate without writing a script. |

The initial pilot should select one or two ordinary dashboard pages with accessible controls and stable, single-document interactions. Compatibility with every website is not an MVP promise.

### Concrete example

On a dashboard that updates without navigation, a user repeatedly opens Filters, selects a status, selects a period, and applies the view. The user starts an observation session, performs that sequence three times, and stops. RepeatFlow suggests a four-step candidate, explaining that the same normalized sequence occurred three times. The user reviews targets and supplies non-secret filter choices, then starts a run. The extension previews each target and pauses where confirmation is required.

Captured observations do not include selected or typed values. A proposed workflow therefore needs explicit input review before it can run. If the page reloads during the example, the initial observer ends the session.

## 3. Goals and boundaries

MVP goals:

- Make observation an explicit, scoped action that users can stop immediately.
- Find short repeated sequences using understandable local rules.
- Let users inspect, edit, name, and save an executable workflow.
- Execute one supervised workflow reliably, with visible progress and bounded failure handling.
- Keep product data local and give users effective retention, export, and deletion controls.

Non-goals for the MVP:

- Passive observation across all browsing, cross-page or multi-tab workflows, and unattended schedules.
- Cloud accounts, synchronization, remote models, telemetry, or a hosted backend.
- Password management, payment automation, CAPTCHA bypass, or authentication bypass.
- Arbitrary generated JavaScript, pixel-based automation, screenshots, or full-page capture.
- Guaranteed understanding of user intent, every site, every iframe, or every custom control.
- Automatic rollback of actions already accepted by a website.

## 4. User journey

1. Install the extension and see an honest description of available capabilities.
2. On the chosen tab, click the extension toolbar action to establish temporary tab access when M1 adds it.
3. Review the tab/origin scope and explicitly choose **Start observing**.
4. Perform a short task repeatedly; pause or stop observation at any time.
5. Review a candidate showing its step sequence and repetition evidence.
6. Resolve targets, add permitted variables, classify steps, and save a workflow.
7. Preview the workflow against the chosen page, supply run inputs, and choose **Run**.
8. Supervise progress, approve checkpoints, and inspect completion or partial completion.

Opening an already-visible side panel on a different tab is not treated as granting access to that tab. The panel must direct the user to click the toolbar action on the target tab again when authorization is missing.

## 5. Functional requirements

| ID | Requirement | Acceptance criteria | Gate |
| --- | --- | --- | --- |
| FR-01 | Provide a truthful starter shell. | Toolbar opens a side panel; the setup-guide preference persists; future features are labeled planned; no page observation occurs. | M0 |
| FR-02 | Start only after explicit consent. | Installation, toolbar activation, and panel opening collect no events. Start displays the selected tab/origin and creates a session only with valid authorization. | M1 |
| FR-03 | Bound observation to one tab and document. | Events from other tabs, frames outside scope, stale documents, or invalid sessions are rejected. Navigation, permission loss, reload, and document replacement end observation. | M1 |
| FR-04 | Expose Pause and Stop. | Both prevent further event acceptance. Resume requires the same valid document and authorization; ended sessions require a new Start. State remains visible. | M1 |
| FR-05 | Record minimized interaction metadata. | Only approved trusted user interactions are accepted. No field values, keystrokes, raw labels, selectors, full DOM, screenshots, clipboard, cookies, or network data are persisted as observations. | M1 |
| FR-06 | Explain repeat candidates. | A deterministic normalized ordered sequence of 3–30 steps occurring at least three times can produce a candidate. Evidence includes occurrence count and step sequence, with no invented confidence percentage. | M2 |
| FR-07 | Keep suggestions optional. | Users can inspect or dismiss candidates. Detection never starts a run or silently creates an approved workflow. | M2 |
| FR-08 | Review and save workflows. | Editor supports naming, removing/reordering permitted steps, explicit target review, and non-secret variables. Invalid or unresolved steps prevent Run. Saved records include a schema version. | M3 |
| FR-09 | Preview before execution. | Preview reports target availability, ambiguity, inputs, and checkpoints without invoking workflow actions. Zero or multiple target matches block the affected step. | M4 |
| FR-10 | Run with visible supervision. | One user-started run operates on one selected tab/document. Current step, Pause, and Stop remain available. Page changes or authorization failure pause or end safely. | M4 |
| FR-11 | Confirm external effects. | Unknown clicks and actions that send, submit, delete, publish, or purchase require a checkpoint immediately before execution. A label or user classification cannot silently remove this gate. | M4 |
| FR-12 | Handle failure honestly. | Missing targets, timeouts, uncertain outcomes, and worker interruptions produce actionable status. Already completed steps are identified; uncertain external effects are never automatically retried. | M4 |
| FR-13 | Manage local data. | Users can inspect data categories, export reviewed content, delete a workflow/session, and clear all product data. Expired data is removed before display/export, including after idle time. | M1–M4 |
| FR-14 | Recover safely after interruption. | Extension/browser restart or loss of observer context never restarts collection silently. Normal worker suspension may reconnect to the same still-authorized observer; uncertain run outcomes require explicit user recovery. | M1–M4 |

### Repetition definition for the MVP

Detection compares exact ordered sequences after approved normalization. Normalization excludes values, timing noise, and sensitive content while retaining enough permitted action/target structure to compare interactions. Evidence must identify three distinct occurrences; overlapping windows must not inflate the repetition count for one occurrence.

The initial candidate range is 3–30 steps with a threshold of three occurrences. These are product defaults, not measured optimal values. Threshold configuration, fuzzy similarity, branching, loops, and cross-session matching require later decisions and validation.

## 6. Data and permissions

M1 declares `sidePanel`, `storage`, `activeTab`, and `scripting`. It injects a packaged observer only after explicit Start and has no host permissions or executor.

M1 uses `activeTab` and `scripting` for explicit current-tab sessions. Free-entry text/number fields are excluded entirely; only ordinary buttons, links, selects, checkboxes, and radio controls are supported. Each document requires a fresh observation decision; navigation ends the session even when the origin stays the same. Durable observation on selected origins may be considered later with separate opt-in settings and optional host permissions.

| Data category | Proposed policy |
| --- | --- |
| Observed events | Local only; at most seven days or 10,000 total events, whichever limit is reached first. |
| Saved workflows | Retain until deletion; only reviewed routes, locators, and explicitly saved non-secret inputs. |
| Run summaries | At most 30 days or 1,000 summaries, whichever limit is reached first; no input values or page content. |
| Run-only inputs | Ephemeral; never persisted in logs, exports, or recovery state. |
| URL context | Origin only in observations. User-reviewed workflow routes strip query, fragment, and credentials; paths still need review. |

Passwords, one-time codes, payment details, and secret fields are excluded. When a workflow reaches authentication or another sensitive input, it should pause and let the user act through the website itself.

Browser-local storage is not encrypted by this application and is not a secret vault. Retention, reviewed JSON export, session deletion, clear-all, and minimized capture are implemented in M1. Workflow and run-log requirements remain planned. The proposed event/workflow contract is in [data-model.md](data-model.md).

## 7. Quality requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| NFR-01 | Accessible core controls. | Keyboard-only completion of observation and run controls; visible focus, clear labels, non-color status, and screen-reader status announcements. |
| NFR-02 | Responsive side panel. | Core content is usable at 320px and wider without horizontal page scrolling; long step labels wrap. |
| NFR-03 | Controlled resource use. | Bounded event queues, storage limits, waits, and retries; no full DOM scans on every pointer event. Benchmark representative pilot pages before making overhead claims. |
| NFR-04 | Safe trust boundaries. | Validated message/schema/session/sender checks; packaged scripts only; untrusted content rendered as text; adversarial fixtures cover invalid senders and payloads. |
| NFR-05 | Deterministic core logic. | Normalization, repetition matching, workflow validation, and retention have repeatable fixture-based tests. |
| NFR-06 | Clear compatibility limits. | Unsupported pages and inaccessible targets show an actionable explanation; they never appear as successful observations or runs. |

## 8. Success targets and evaluation

These are proposed pilot targets, **not measured results**. Use consented manual evaluation and synthetic fixtures; no telemetry is required.

| Measure | Initial target | Evaluation |
| --- | --- | --- |
| Understanding of scope | At least 4 of 5 pilot users can explain when observation starts/stops. | Short task interview after onboarding. |
| Candidate usefulness | At least 4 of 5 reviewed suggestions on selected pilot tasks are recognized as the intended repeated task. | Record acceptance/dismissal reasons manually. |
| Supervised replay completion | At least 9 of 10 runs complete the selected stable fixture workflow. | Browser runs with recorded pass/failure evidence. |
| Consent and sensitive-data protection | Zero accepted out-of-scope events or forbidden stored values in the required test suite. | Negative tests and storage inspection. |
| Control availability | Stop remains reachable in every active execution state. | Keyboard and visual checks across states. |

Do not advertise time savings until comparable manual and supervised task durations have been measured. Pilot targets describe a small defined task set; they do not establish general website reliability.

## 9. Delivery and open decisions

| Milestone | Product outcome |
| --- | --- |
| M0 | Documents and directly loadable starter shell. |
| M1 | Explicit, minimized observation with validated session boundaries and data controls. |
| M2 | Explainable exact-sequence suggestions. |
| M3 | Reviewed workflow editor and non-secret inputs. |
| M4 | Preview and guarded supervised replay. |
| M5 | Small compatibility pilot and release-readiness evaluation. |

| Risk or decision | Initial response |
| --- | --- |
| Pages change between observation and execution. | Resolve and validate reviewed targets again; block ambiguity instead of guessing. |
| Minimal metadata may miss meaningful repetitions. | Start with a narrow pilot and measure candidate usefulness before expanding capture. |
| User mistakes a suggestion for understanding. | Show concrete repetition evidence and require workflow review. |
| Website accepts an action before interruption. | Report uncertainty and partial completion; never imply automatic rollback. |
| Dynamic controls, frames, and shadow roots vary. | Establish explicit supported fixtures before expanding compatibility. |
| Pilot site, distribution model, and license are undecided. | Choose before M5; no store launch or public distribution is implied by initialization. |
| Future model use or cross-page support changes the product boundary. | Require a separate design decision covering permissions, privacy, lifecycle, and measurable benefit. |

Implementation details belong in [arc.md](arc.md); interaction details belong in [design.md](design.md). Changes to the product boundary must update these documents together.
