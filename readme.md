# RepeatFlow

A browser extension project that will observe tasks you choose, find repeated interaction sequences, and turn them into workflows you can review and run.

**Current status: M0 — project foundation.** This repository contains the product plan, technical architecture, UX design, development rules, and a directly loadable Chrome extension shell. Observation, repetition detection, workflow editing, and replay are **not implemented yet**.

RepeatFlow is a working name. The initial target is desktop Chrome 116+ using Manifest V3. Edge validation and Firefox support are future decisions.

## Start here

| File | Purpose |
| --- | --- |
| [prd.md](prd.md) | Problem, target users, MVP boundaries, functional requirements, and acceptance criteria. |
| [arc.md](arc.md) | Architecture, permissions, browser lifecycle, security boundaries, and replay design. |
| [rule.md](rule.md) | Engineering rules for consent, data handling, execution, and verification. |
| [design.md](design.md) | User journeys, side panel layout, states, wireframes, and accessibility. |
| [roadmap.md](roadmap.md) | Delivery milestones and the next implementation tasks. |
| [docs/data-model.md](docs/data-model.md) | Proposed versioned events, workflows, sessions, and run contracts. |
| [docs/decisions.md](docs/decisions.md) | Initial decisions and their tradeoffs. |
| [docs/testing.md](docs/testing.md) | Static checks, browser smoke checks, and future regression coverage. |
| [AGENTS.md](AGENTS.md) | Repository instructions for coding assistants. |

## Intended product flow

1. Click the extension on the target tab and explicitly start observing a task.
2. Repeat a short task. The extension records minimized interaction metadata locally.
3. Review a suggestion explaining which sequence repeated, with the initial threshold set to three occurrences.
4. Edit the proposed steps and provide any variables without recording secrets.
5. Preview the workflow and start a supervised run. Pause, Stop, and confirmation before external effects keep the user in control.

The MVP focuses on short tasks within one document, such as repeating the same dashboard filter controls. Navigation ends observation in the first implementation. Persistent observation across selected sites, cross-page workflows, unattended schedules, and cloud AI are later possibilities.

## What works in this starter

- A Manifest V3 extension package with a module service worker.
- A toolbar action configured to open a side panel.
- A responsive welcome panel that accurately labels future features.
- A **Show the setup guide** preference stored locally and synchronized between open panels.
- A dependency-free check command for repository and extension resources.

The only declared permissions are `sidePanel` and `storage`. The shell contains no page observer, host permissions, automation executor, account system, analytics, or network calls. The initial APIs follow Chrome's [Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) and [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage) documentation.

## Load the extension

No build step or dependency installation is needed.

1. In desktop Chrome, open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project's `extension/` folder, not the repository root.
4. Pin **RepeatFlow — Development Starter** and click its toolbar icon.
5. Toggle **Show the setup guide**, then reopen the panel to check persistence.

After editing runtime files, reload the extension from its extensions-manager card and reopen the panel. See [the verification guide](docs/testing.md) for additional checks and preview limitations.

## Development

Use Node 22+ for checks; Node is not required to run the extension.

```sh
npm run check
```

The check uses Node's built-in modules and performs no network requests. There is no install/build/dev-server command because the browser loads the package directly. Read [rule.md](rule.md) before implementing new capabilities.

```text
.
├── prd.md                 # Product definition
├── arc.md                 # System architecture
├── rule.md                # Development and execution rules
├── design.md              # UX specification
├── readme.md              # Entry point and implemented status
├── roadmap.md             # Milestones and acceptance gates
├── AGENTS.md              # Coding-assistant guidance
├── docs/
│   ├── data-model.md
│   ├── decisions.md
│   └── testing.md
├── extension/             # Load this directory unpacked
│   ├── manifest.json
│   ├── background.js
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
├── scripts/check.mjs
└── package.json
```

## Data and permissions

M0 stores only the guide-visibility preference under `repeatflow.shell.settings` when the user changes it. It does not collect browser activity. Incognito operation is disabled.

The proposed MVP is local-only and off by default. It will not record typed values, passwords, one-time codes, payment details, clipboard contents, full DOM snapshots, or screenshots. Stored metadata can still be sensitive, so retention, deletion, reviewed exports, and scoped authorization are explicit implementation requirements. Browser storage is not a secure secret vault.

M1 will add temporary current-tab access through `activeTab` and `scripting`. Clicking a control in an already-open side panel is not assumed to grant access to a newly selected tab; the toolbar authorization flow is part of M1. Chrome documents the grant's lifecycle under [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

## Next milestone

Implement **M1: scoped observation** from [roadmap.md](roadmap.md): consent and session controls, a minimized observer, validated messages, and real browser checks proving collection stops at the session boundary. Build repetition detection after that foundation is verified.

No distribution license has been selected. The package is private and marked `UNLICENSED`; choose a license before distributing it for reuse.
