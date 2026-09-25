# Chrome Web Store Listing — RepeatFlow

> Last Updated: 2026-09-25

## Store Listing

**Extension Name**
RepeatFlow

**Short Description**
Observe repetitive browser tasks, detect repeated patterns, create reviewed declarative workflows, and execute supervised replays.

**Detailed Description**
Automate your repetitive browser routines with complete privacy and supervision.

RepeatFlow observes the tasks you perform repeatedly, detects contiguous interaction patterns, and helps you create reliable, reviewed workflows that you can replay under your direct supervision.

Key Features:
- Explicit task observation: You control exactly when observation starts, pauses, and ends.
- Smart repetition suggestions: Automatically highlights repetitive sequences that occurred 3 or more times.
- Visual workflow editor: Name workflows, reorder steps, set target locators, and define custom non-secret parameters.
- Supervised replay: Watch each step run live on your page with interactive previews and status indicators.
- Action checkpoints: Sensitive actions (submitting forms, applying changes, external updates) pause for your explicit confirmation before executing.
- Complete data control: Review retained data, export your workflows as JSON, or clear all data at any time.

How to Use:
1. Open the page where you do repetitive work and click the RepeatFlow toolbar icon to open the side panel.
2. Click "Start observing" and perform your repetitive task normally 3 or more times.
3. Open the "Suggestions" tab to review the detected pattern.
4. Click "Convert to workflow" to inspect steps, configure parameters or locators, and click "Approve & Save".
5. In the "Run" tab, preview step targets against your page and start a supervised replay with checkpoints.

Privacy First:
RepeatFlow never records typed text, passwords, payment info, form values, cookies, browsing history, or full page content. All data stays strictly inside your local browser. There are no cloud accounts, remote servers, background analytics, or network transmissions.

Support & Feedback:
For documentation, bug reports, and suggestions, visit the project repository: https://github.com/Sajid-ul-Islam/brow-ext-rep-auto

**Category**
Productivity

**Single Purpose**
Enables users to observe repetitive web interactions and execute reviewed automations under supervision.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Extension Icon | 128×128 PNG | Ready | icons/icon-128.png |
| Medium Icon | 48×48 PNG | Ready | icons/icon-48.png |
| Small / Toolbar Icon | 16×16 PNG | Ready | icons/icon-16.png |
| Screenshot 1: Observation Tab | 1280×800 | Planned | docs/assets/screenshot-observe.png |
| Screenshot 2: Repetition Suggestions | 1280×800 | Planned | docs/assets/screenshot-suggestions.png |
| Screenshot 3: Workflow Editor | 1280×800 | Planned | docs/assets/screenshot-editor.png |
| Screenshot 4: Supervised Replay | 1280×800 | Planned | docs/assets/screenshot-replay.png |
| Promo Tile | 440×280 | Planned | docs/assets/promo-small.png |

### Screenshot Notes
- Screenshot 1: Shows the side panel in Observe mode attached to an operations dashboard with interaction counter.
- Screenshot 2: Demonstrates a detected 4-step sequence repeated 3 times with conversion controls.
- Screenshot 3: Illustrates the step editor with testAttribute locators, parameters, and approval status.
- Screenshot 4: Displays supervised execution with target highlights, step progress, and confirmation checkpoint.

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `sidePanel` | permissions | Displays the extension interface beside the active tab so users can supervise automation while keeping the target webpage visible. |
| `storage` | permissions | Saves user-reviewed workflows, execution history summaries, and user interface preferences locally in the browser profile. |
| `activeTab` | permissions | Grants temporary, explicit access to the active tab only when the user clicks the toolbar icon, preventing passive background website access. |
| `scripting` | permissions | Injects the isolated interaction observer and execution replay helpers into the active tab upon explicit user command. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

RepeatFlow does NOT transmit any user data off-device. All interaction processing, repetition detection, and replay occur locally in the user's browser. Content security policy strictly enforces `connect-src 'none'`.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Personally identifiable info | No | No | N/A | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | N/A | No |
| Authentication info | No | No | N/A | No |
| Personal communications | No | No | N/A | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | Local only | No | Local repetition detection | No |
| Website content | No | No | N/A | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
https://github.com/Sajid-ul-Islam/brow-ext-rep-auto/blob/main/docs/rule.md

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**: RepeatFlow Team
**Contact Email**: saajiidi@gmail.com
**Homepage URL**: https://github.com/Sajid-ul-Islam/brow-ext-rep-auto

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 0.2.0 | 2026-09-25 | Complete M1-M5 release: scoped observation, deterministic repetition detection, declarative workflow editor with multi-type locators, supervised replay with action checkpoints, and Chromium test suites. | Ready |

