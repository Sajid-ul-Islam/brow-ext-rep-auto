# Repository instructions

This repository is RepeatFlow, a browser extension foundation. Read `readme.md` and `rule.md` before editing. Use `prd.md`, `arc.md`, `design.md`, `roadmap.md`, and `docs/data-model.md` for the proposed product contract.

- Preserve the distinction between implemented M0 shell behavior and planned observation/detection/replay.
- Follow `rule.md`, especially consent, data minimization, sender validation, and guarded execution.
- Do not add page access, external services, remote scripts, or telemetry incidentally while working on the shell.
- Keep all extension runtime resources in `extension/`; it must load unpacked without a build step.
- Use `npm run check`; see `docs/testing.md` for integration acceptance and limits of static checks.
- Update the relevant documents when behavior, permissions, or contracts change.

The current initialization does not implement a recorder or automation engine. Start the next implementation milestone from M1 in `roadmap.md`.
