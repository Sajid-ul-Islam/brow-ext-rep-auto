# Architecture decisions

Initial decisions: 2026-09-22. These are practical defaults for starting development, subject to revision with a recorded reason.

| ID | Decision | Reason and tradeoff |
| --- | --- | --- |
| ADR-001 | Working name: RepeatFlow | Makes documents and package names consistent. Branding, trademark checks, and store listing remain open. |
| ADR-002 | Chrome desktop 116+ and Manifest V3 first | Provides a clear browser baseline for the side panel and planned API use. Edge needs its own validation; Firefox is outside the first release. |
| ADR-003 | Native ES modules, JavaScript/JSDoc, browser DOM, no build tool | Makes the starter directly loadable and easy to inspect. Revisit TypeScript and bundling if implementation complexity justifies them. |
| ADR-004 | Local processing and storage for MVP | Avoids an account or server dependency. Workflows do not sync across devices and browser profile loss can lose local data. |
| ADR-005 | Explicit, scoped observation sessions first | Lets users choose which task is observed and limits access. Always-on discovery is a later, separately consented capability. |
| ADR-006 | Deterministic repeated sequences before AI | Produces explainable suggestions and reproducible tests. It will miss semantically similar tasks that use different sequences. |
| ADR-007 | User-reviewed declarative workflows and supervised replay | Keeps steps inspectable and execution bounded. The MVP intentionally requires user participation around external effects. |
| ADR-008 | Request capabilities when their milestone exists | M0 needs only `sidePanel` and `storage`; current-page observation later adds `activeTab` and `scripting`. Broad persistent site access is deferred. |
| ADR-009 | No automatic retry of uncertain writes | Reduces duplicate submissions after crashes. The user may need to inspect website state before recovery. |
| ADR-010 | No license grant chosen yet | Package is private and `UNLICENSED`; choose a distribution license before public reuse. |

The side panel is a packaged extension page supported by Chrome's [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel). Permission and lifecycle details are documented in [arc.md](arc.md).

For a change, append an entry with date, status, context, chosen option, tradeoffs, and which prior decision it supersedes. Keep actual product status in [readme.md](../readme.md).

## M1 implementation decisions, 2026-09-23

- Exclude all free-entry text/number fields to avoid observing unmarked secret inputs. Supported controls are buttons, links, selects, checkboxes, and radio controls with conservative sensitive-metadata exclusions.
- Use an atomic bounded IndexedDB snapshot for M1; preserve the option to migrate to separate stores if scale warrants it. Keep at most 250 session summaries, including empty stopped sessions, for visible end reasons.
- Record segment boundaries at Pause/Resume and sequence gaps so M2 cannot combine interrupted sequences. Session epochs invalidate stale batches after Resume.
- Add Playwright and fake-indexeddb only as development dependencies. Runtime remains dependency-free. Use an isolated Chromium profile and local fixtures for browser tests.
- Remove identical flattened upload copies and untrack generated node_modules; extension/, docs/, tests/, and scripts/ are the canonical paths.

## M2–M5 implementation decisions, 2026-09-23

- **M2 (Detector):** Pure sequence detection matching $L \in [3, 30]$ contiguous steps repeated $\ge 3$ times non-overlapping. Deterministic ranking: longer length > occurrence count > earlier first occurrence. Contained shorter candidates whose occurrences are covered by a longer candidate are suppressed.
- **M3 (Workflows):** Declarative steps (`click`, `fill`, `select`, `setChecked`, `waitFor`). Locators support ordered alternatives (`testAttribute`, `roleAndName`, `id`, `css`). Edits increment workflow revision and reset `reviewedRevision` to null, preventing execution until explicitly approved.
- **M4 (Supervised Replay):** Top-frame isolated execution via `executor.js`. Pre-commit `pendingIntent` logging prior to step dispatch. Unknown/external effects enforce confirmation checkpoints. Failures or scope loss transition the run to `needsAttention` or `failed` with zero automatic write retries.
- **M5 (Testing & Packaging):** Full MV3 zero-build packaging directly in repository root. Automated test matrix covers static checks (`scripts/check.mjs`), 40 Node.js unit/integration tests (`tests/*.test.mjs`), and Playwright Chromium extension tests (`tests/browser.spec.js`).

## Production readiness decisions, 2026-09-25

- **Executor comprehensive testing (`tests/executor.test.mjs`):** Implemented unit test coverage simulating the top-frame DOM environment for `executor.js`. Verifies target resolution priority (`testAttribute` > `id` > `css` > `roleAndName`), error handling (`TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`, `TARGET_DISABLED`, `TARGET_HIDDEN`), DOM action dispatch (`click`, `fill`, `select`, `setChecked`), condition polling (`waitFor`), and sender validation.
- **End-to-end multi-cycle browser integration testing (`tests/browser.spec.js`):** Added live fixture-based E2E test verifying real interaction observation across 3 cycles (12 interactions), pattern detection into candidates, conversion to workflow, locator review, and replay execution with user confirmation checkpoints on external effect elements (`#apply-btn`). Added workflow import and 320px narrow panel responsive layout tests.
- **Side panel step editor enhancements (`sidepanel.js`, `sidepanel.css`):** Expanded step editor to expose locator strategy configuration (`testAttribute` with custom attribute name, `id`, `css`, `roleAndName`), condition wait configuration (`waitFor` condition and timeout), and static value vs parameter binding toggles.
- **Production branding & extension packaging:** Designed and packaged standard Chrome extension icons (`icons/icon-16.png`, `icons/icon-48.png`, `icons/icon-128.png`) in brand emerald-green (`#17664e`) with circular repeat arrow glyph. Declared icon resources in `manifest.json` and static verification checks in `scripts/check.mjs`. All extension runtime assets are kept directly in the repository root for zero-build direct loading.
- **Chrome Web Store documentation (`CHROMEWEBSTORE.md`):** Authored full distribution documentation including short/detailed listing copy, single-purpose description, permissions justifications (`sidePanel`, `storage`, `activeTab`, `scripting`), privacy disclosures, and zero-telemetry certification.

