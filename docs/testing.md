# Verification guide

## Foundation checks

Run from the repository root with Node 22 or newer:

```sh
npm run check
```

There are no npm dependencies to install. The check parses the manifest, checks its referenced resources and supported scaffold permissions, checks JavaScript syntax, validates local HTML resources and Markdown file links, and rejects trailing whitespace in source files. It does not launch Chrome or prove Chrome API behavior.

## M0 browser smoke check

1. Open Chrome's extensions manager, enable Developer mode, choose **Load unpacked**, and select the repository's `extension/` directory.
2. Confirm the extension card has no manifest errors. Pin RepeatFlow and click its toolbar icon. The side panel should open.
3. Confirm **Not observing**, **Development starter**, and the statement that recording/replay are planned are visible. No permission to read or change websites should be requested.
4. Toggle **Show the setup guide**. The guide should hide or show, and the status should confirm the preference was saved.
5. Close and reopen the panel, then reload the extension and reopen it. The preference should persist. Open another window and confirm changes stay consistent between panels.
6. Navigate and interact with an ordinary site. There should be no page injection, recording indicator, or replay action. M0 has no content script or page-access permission.
7. Inspect the extension service worker and side panel consoles. There should be no uncaught errors. Only `repeatflow.shell.settings` should be written to local extension storage when the preference changes.
8. Check keyboard navigation, visible checkbox focus, announced status text, narrow panels (320 px), and 200% zoom. Text should remain readable without horizontal page scrolling.

Serving `extension/sidepanel.html` over localhost is useful for layout inspection. That preview intentionally disables the saved preference and shows a preview message because extension APIs are unavailable. It is not a substitute for the unpacked-extension smoke check.

## Tests to add with product behavior

| Layer | Meaningful coverage |
| --- | --- |
| Observer | Nothing before consent or after Stop; tab/document isolation; no typed values or sensitive fields; exclude untrusted synthetic/replay events; bounded events. |
| Normalization and detection | Repeated non-overlapping 3–30-step sequences; below-threshold and noisy negatives; no cross-session matches in MVP; deterministic ranking and bounded processing. |
| Workflow contract | Invalid versions/steps rejected; variables checked; no executable code; reviewed locators; import size limits; approval invalidated after edits. |
| Replay | Missing/ambiguous/hidden targets; changed documents; explicit gates before external effects; Stop before next action; partial completion and unknown outcomes; no automatic repeated writes. |
| Storage and boundaries | Malformed/spoofed messages; sender scope; storage errors/quota; serialized writes; worker suspension; deletion/retention on startup, access, and export. |
| Browser integration | Real MV3 worker lifecycle, toolbar permission flow, navigation boundaries, supported DOM fixtures, keyboard use, and recovery. |

Use local fixture pages and synthetic data. Include a harmless local form that counts submissions to prove an uncertain result is never submitted twice. Add cross-document, iframe, shadow DOM, and restricted-page fixtures to verify unsupported cases fail clearly rather than extending scope silently.

## Evidence log

Keep milestone evidence concrete: revision, browser/version, command or manual scenario, result, and any limitation. The initialization's evidence is recorded here after checks are run. Target budgets and future acceptance criteria in [prd.md](../prd.md) and [roadmap.md](../roadmap.md) are not measured results.

### Milestone verification log, 2026-09-23

- `npm run check` passes: Validates Manifest V3 format, permissions (`sidePanel`, `storage`, `activeTab`, `scripting`), zero external packages in `extension/`, local file references, and syntax check across all 18 JS/MJS files and 10 Markdown documents.
- `npm test` passes (40 tests):
  - `tests/observer.test.mjs`: Consent, authorization, event minimization, epoch/segment boundaries, queue overflows, and lifecycle boundaries.
  - `tests/repository.test.mjs`: Retention (7 days / 10k events / 250 sessions / 1k run summaries), atomic IndexedDB transactions, corruption fail-close behavior.
  - `tests/detector.test.mjs`: Pure normalization, exact 3-repeat contiguous sequences, negative tests (<3 repeats), noise handling, length limits, contained candidate suppression.
  - `tests/workflow.test.mjs`: Declarative schema validation, locator structure, parameter binding, draft conversion from candidates.
  - `tests/coordinator.test.mjs`: Session lifecycle, candidate promotion, workflow CRUD & approval rev-gates, supervised execution, confirmation checkpoints, and crash-recovery `pendingIntent` logging.
- `npm run test:browser` passes (Playwright with Chromium extension loading):
  - Launches real unpacked MV3 extension in Chromium.
  - Verifies side-panel tabbed navigation, setup guide preference, workflow CRUD, candidate conversion, target locator preview against live DOM fixtures, and data management.

