# RepeatFlow experience design

Status: UX specification, updated 2026-09-23. **All surfaces across M1–M5 are fully implemented.** The side panel features tabbed navigation across Observe, Suggestions, Workflows (with editor), Run (with preview and checkpoints), and Settings (with export and data clear).

## 1. Experience principles

- Explain the current state before offering the next action.
- Keep observation scope and Stop visible whenever the product is active.
- Show concrete evidence for suggestions; never imply the extension knows the user's intent.
- Make workflow actions and external effects understandable before execution.
- Preserve context when something fails: show what completed, what did not, and the available next action.
- Use plain language. The interface should say “This page changed” rather than exposing document identifiers or message codes.

## 2. Surfaces and information hierarchy

The browser toolbar opens the side panel. The page remains visible beside the controls so a user can compare a proposed step with its target. The initial product has no separate web dashboard or account flow.

| Surface | Content | Primary action |
| --- | --- | --- |
| M0 welcome | Foundation status, planned flow, setup guide, local preference | Show/hide setup guide |
| Observe | Selected page, session status, capture summary, event count | Start observing / Pause / Stop |
| Suggestions | Candidate sequence, occurrence count, review/dismiss actions | Review steps |
| Workflows | Saved names, origins, step counts, last run status | Open workflow |
| Workflow editor | Ordered steps, reviewed targets, variables, checkpoints | Save workflow / Preview |
| Run view | Step progress, target preview, confirmation, outcome | Run / Continue / Pause / Stop |
| Settings | Site scope, retention explanation, export and deletion | Review export / Delete data |

For M1, prioritize Observe and Settings; introduce the other destinations when their capability ships. Do not fill unavailable screens with fictional activity or working-looking controls.

## 3. Observation journey

1. The user opens the panel from the toolbar on a chosen tab.
2. The panel states “Observation is off” and explains the current-tab scope and exclusions.
3. The user chooses **Start observing**. Start succeeds only after the temporary tab grant and document checks pass.
4. The panel shows “Observing this page”, the origin, elapsed session time, and accepted event count.
5. **Pause** stops event acceptance while preserving the current session. **Stop** ends it and opens the session summary.
6. Navigation, permission loss, document replacement, or extension restart ends the session with a reason.

Clicking Start in a panel that was already open is not assumed to authorize a newly selected tab. If access is missing, use “Click the RepeatFlow toolbar icon on the page you want to observe, then return here.” Keep Start unavailable until the grant is verified.

Switching tabs pauses collection and does not transfer observation. The panel must retain the original session scope and identify when the selected tab differs. Starting a different session first ends the existing one. Explicit Resume is available only when the original document is selected and its authorization remains valid.

### Observation wireframe

```text
┌────────────────────────────────────┐
│ RepeatFlow               Settings │
│ Observe   Suggestions   Workflows │
├────────────────────────────────────┤
│ ● Observing this page              │
│ dashboard.example                 │
│ This tab only · Ends on navigation │
│                                    │
│ 12 interactions · 01:24            │
│ Field values are not recorded.    │
│                                    │
│ [Pause]                  [Stop]   │
├────────────────────────────────────┤
│ Repeat a short task normally.     │
│ Suggestions appear after the     │
│ same sequence repeats 3 times.   │
└────────────────────────────────────┘
```

The counters above are illustrative, never starter/demo data shown as actual collection. Do not show field values, raw page labels, or URL query strings in an event feed. A minimized action summary may show “Click control” or “Change field” using only approved metadata.

## 4. Suggestion review

A candidate card should answer “What repeated?”, “How often?”, and “What needs review?”. Use “Repeated 3 times” and a short normalized step list. Do not display a probability or a confidence meter without a separately validated calibration method.

Evidence is a count of distinct matched occurrences and the permitted normalized sequence. Matching is evidence of repetition, not proof that a workflow is safe or useful. Missing inputs and unreviewed targets are prominent.

### Suggestion and editor wireframe

```text
┌────────────────────────────────────┐
│ Review suggestion                 │
│ Repeated 3 times · 4 steps         │
│ dashboard.example                 │
│                                    │
│ Name [Dashboard filter sequence ] │
│ 1. Click control        [Review]  │
│ 2. Change field         [Review]  │
│ 3. Change field         [Review]  │
│ 4. Click control        [Review]  │
│                                    │
│ Inputs still need your review.    │
│ [Dismiss]        [Save workflow] │
└────────────────────────────────────┘
```

Labels such as “Status filter” may be added during explicit workflow review; they must not imply that raw labels were silently stored in observations. Each step exposes its action, target, input requirement, and checkpoint. Unresolved target selection is an explicit review task, not a guessed locator.

The editor supports keyboard-accessible move up/down controls alongside any drag interaction. Removing a draft step is reversible with Undo. Save remains unavailable while required review is incomplete, with a visible reason rather than a disabled button alone.

Inputs default to **Ask each run**. Saving a non-secret value is a separate explicit choice. Passwords, one-time codes, payment details, and other secrets are entered through the website, with the workflow paused. The editor must not offer a secret vault.

## 5. Preview and supervised execution

Preview resolves targets and checks workflow validity without performing workflow actions. It lists the selected page, required inputs, unresolved targets, and checkpoints. Preview does not guarantee that page state will remain unchanged; targets are checked again immediately before each action.

The **Run** control starts one run on one selected tab/document. The run view remains open with current progress and persistent Pause/Stop controls. A preview highlight may identify a target, but never substitutes for the written step description or moves keyboard focus unexpectedly.

```text
┌────────────────────────────────────┐
│ Running: Dashboard filters         │
│ dashboard.example                 │
│ Step 3 of 4                       │
│                                    │
│ ✓ Open filters                    │
│ ✓ Set status                      │
│ → Set period                      │
│ ○ Apply view · Confirmation       │
│                                    │
│ [Pause]                  [Stop]   │
└────────────────────────────────────┘
```

For an unknown click or an action with an external effect, pause immediately before it and show the action, target, and consequence that can be established. Use explicit choices such as **Confirm this step** and **Stop run**. A button label alone cannot establish that the action is harmless, and user classification cannot remove the required gate.

Stop prevents subsequent actions; it cannot undo completed actions. Completion states must distinguish **Completed**, **Stopped after step N**, **Failed at step N**, and **Outcome needs checking**. After an uncertain external effect, direct the user to inspect the website before restarting; do not offer a blind Retry button.

## 6. State and recovery language

These are product UI states. Persistence enums and message contracts are defined in [docs/data-model.md](docs/data-model.md).

| State | Suggested copy | Available next action |
| --- | --- | --- |
| Foundation | “Project foundation. Observation and replay are planned.” | View guide |
| Off | “Observation is off.” | Start observing, if authorized |
| Authorization needed | “Choose a page using the toolbar icon.” | Follow authorization instruction |
| Observing | “Observing this page.” | Pause / Stop |
| Paused | “Observation is paused. New interactions are not recorded.” | Resume if valid / Stop |
| Session ended | “This page changed. Observation ended.” | Review session / Start new session |
| Unsupported page | “RepeatFlow cannot observe this page.” | Choose a supported page |
| No candidate | “No repeated sequence found in this session yet.” | Observe again / Review capture summary |
| Needs review | “Review targets and inputs before running.” | Open incomplete step |
| Target mismatch | “This step matches more than one control.” | Review target / Stop |
| Waiting for approval | “Confirm this step before it runs.” | Confirm this step / Stop |
| Interrupted | “The run was interrupted. Check the page before continuing.” | Inspect completed steps / Stop |
| Completed | “All N steps completed.” | View summary / Run again after preview |
| Storage unavailable | “Local changes could not be saved.” | Retry save / Keep unsaved draft visible |

Errors belong near the affected control and in a concise status region. Retain useful input when safe; never preserve run-only secret content. Do not replace an error with a success-looking toast.

## 7. Visual language and accessibility

Use a quiet, readable tool interface with one primary action per section. Distinguish observation, review, and execution through text and icons as well as color. The M0 shell's shipped stylesheet remains the implementation source; these tokens guide later screens.

| Token | Proposed value or rule |
| --- | --- |
| Canvas / surface | `#F6F8F7` / `#FFFFFF` |
| Main / secondary text | `#172B27` / `#53645E` |
| Primary action | `#17664E`, white text |
| Success / caution / danger | `#166534` / `#92400E` / `#B91C1C`, always paired with text |
| Focus | Visible 3px outline with separation from the control |
| Spacing | 4, 8, 12, 16, 24, 32px scale |
| Corners | 8px controls; 12px cards |
| Typography | System sans-serif; 14–16px body; 12–14px supporting copy; 1.45+ line height; verify readability in the rendered panel. |
| Controls | At least 40px high where practical; descriptive labels; 44px primary control targets |

Verify actual text, focus, and component contrast in the rendered UI; token values alone are not accessibility evidence. Support keyboard operation, semantic headings, native controls, and descriptive names. Use polite live announcements for state transitions; announce failures promptly without repeatedly reading every counter update.

At 320px width, stack controls and wrap content without horizontal page scrolling. Keep Stop visible in active states. At larger widths, preserve a readable single-column hierarchy. Support browser zoom, increased text size, reduced motion, and long origin/workflow names. Do not rely on hover-only explanations.

## 8. Data settings and design acceptance

Settings should explain the local data categories and their retention in ordinary language. Export opens a review of included categories before generating a file; it must not silently include run-only inputs. Deletion clearly states its scope. Clearing all data requires a concise destructive-action confirmation, ends active work, and reports success only after storage is cleared.

Before each milestone is accepted, exercise its screens with keyboard-only navigation, a narrow panel, empty and long content, permission loss, and storage/error states. For observation and execution, verify the real browser behavior as well as the rendered controls. See [docs/testing.md](docs/testing.md) for the evidence checklist.

The primary open design decisions are the pilot website, the exact reviewed-target selection interaction, and whether persistent site observation is worth its added permission and trust cost. Resolve them using pilot evidence before expanding the initial flow.
