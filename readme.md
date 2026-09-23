# RepeatFlow

A local browser extension for observing repetitive browser tasks, detecting repeated interaction patterns, creating reviewed declarative workflows, and executing supervised replays.

**Current status: M5 — complete local browser extension.** Scoped observation (M1), deterministic repetition suggestions (M2), reviewed declarative workflows (M3), supervised replay with checkpoints (M4), and browser integration verification (M5) are fully implemented.

The runtime targets desktop Chrome 116+ with Manifest V3 and loads directly from the repository root. Automated test suites include static validation, unit/protocol tests, and Playwright Chromium browser tests.

## Project documents

| File | Purpose |
| --- | --- |
| [docs/prd.md](docs/prd.md) | Product goals, requirements, and acceptance criteria. |
| [docs/arc.md](docs/arc.md) | Architecture, permission boundaries, and execution design. |
| [docs/rule.md](docs/rule.md) | Engineering, consent, and data-handling rules. |
| [docs/design.md](docs/design.md) | Panel UX, review flows, and navigation. |
| [docs/roadmap.md](docs/roadmap.md) | Delivery milestones and acceptance gates. |
| [docs/data-model.md](docs/data-model.md) | Implemented schemas, workflow models, and message protocol. |
| [docs/decisions.md](docs/decisions.md) | Architecture decisions and tradeoffs. |
| [docs/testing.md](docs/testing.md) | Automated checks, browser evidence, and manual scenarios. |

## Install and use

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select this repository's root directory (`brow-ext-rep-auto`).
3. Open an ordinary HTTP(S) page. Click the pinned **RepeatFlow** toolbar action (or its shortcut, normally Ctrl+Shift+Y).
4. The side panel displays five functional tabs:
   - **Observe**: Authorize and record user interactions (`click`, `select`, `checkbox`, `radio`) with Start, Pause, Resume, and Stop controls.
   - **Suggestions**: View detected contiguous repeated patterns ($\ge 3$ occurrences, 3–30 steps), inspect structural steps, dismiss suggestions, or convert them into draft workflows.
   - **Workflows**: Inspect, edit, approve, or delete declarative workflows. Define input parameters, test locators, and review step checkpoints.
   - **Run**: Preview workflow targets against the active document, bind parameter values, execute one-step supervised runs, and confirm sensitive/external effect checkpoints.
   - **Settings**: Review data retention rules, export data as JSON, and clear local storage.

Installing, opening the panel, and granting temporary tab access do not start observation. Switching tabs pauses observation; navigation, route changes, document replacement, and closing the tab end it.

## What is captured

RepeatFlow stores only an action (`click`/`change`), a field-kind enum, a salted structural target digest, event sequence/segment, generated IDs, and receipt time. Session metadata contains origin and browser scope needed for authorization. Raw paths, URL queries, element labels/IDs/classes/selectors, form values, keystrokes, screenshots, clipboard contents, cookies, and network payloads are not recorded during observation.

**Text and number inputs are excluded entirely during observation** to protect user privacy and avoid capturing passwords, OTPs, or sensitive data. Parameters and locators are added explicitly by the user during workflow review.

Data stays in IndexedDB in the local extension profile. Retention is seven days and at most 10,000 events across all sessions, 250 session summaries, and 1,000 run summaries (30 days). Expiry runs before read/export and on writes/startup.

## Permissions and implementation

The only permissions are `sidePanel`, `storage`, `activeTab`, and `scripting`. There are no host permissions, background analytics, external services, or remote scripts. CSP enforces `script-src 'self'` and `connect-src 'none'`.

```text
manifest.json          # Root MV3 manifest
background.js          # Browser event adapters & service worker
observer.js            # Isolated, consent-scoped interaction capture
executor.js            # Isolated, supervised action execution & target preview
lib/
  protocol.js          # Message envelope, schema, and sender validation
  coordinator.js       # Session, candidate, workflow, and run lifecycle coordinator
  repository.js        # Atomic IndexedDB storage, pruning, and retention
  detector.js          # Deterministic sequence normalization and detection
  workflow.js          # Declarative workflow validation and parameter binding
sidepanel.html         # Tabbed UI (Observe, Suggestions, Workflows, Run, Settings)
sidepanel.js           # Panel controller and interactive editors
sidepanel.css          # Responsive layout and styling
docs/                  # Consolidated project specifications and architecture
tests/                 # Node.js unit tests and Playwright browser integration tests
scripts/check.mjs      # Static repository validation
```

## Development and verification

Use Node 22+:

```sh
npm ci
npm run check          # Validates manifest, permissions, syntax, and markdown links
npm test               # Runs Node.js unit & integration tests
npm run test:browser   # Runs Playwright Chromium extension integration suite
npm run verify         # Runs check, test, and test:browser in sequence
```

All tests execute in isolated environments with zero network calls.
