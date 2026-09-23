# Repository instructions

This repository is RepeatFlow, a local browser extension. Read `readme.md` and `docs/rule.md` before editing. Use `docs/prd.md`, `docs/arc.md`, `docs/design.md`, `docs/roadmap.md`, and `docs/data-model.md` for the product contracts and documentation.

- Follow `docs/rule.md`, especially consent, data minimization, sender validation, and guarded execution.
- Do not add page access, external services, remote scripts, or telemetry.
- Keep all extension runtime resources in the repository root; it must load unpacked without a build step.
- Use `npm run check`; see `docs/testing.md` for integration acceptance and limits of static checks.
- Update the relevant documents when behavior, permissions, or contracts change.

