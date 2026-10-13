# Claude Code notes

## Commits and pull requests

- Commits and PRs are authored as the repo owner, Oleksandr Ratushnyi <forcewizu@gmail.com> (set in `.claude/settings.json`).
- No AI attribution anywhere: no `Co-Authored-By: Claude`, no `Claude-Session:` trailer, no "Generated with Claude Code" line in commit messages, PR titles/bodies or PR comments.
- Commit messages follow Conventional Commits (see CONTRIBUTING.md).

## Running the app and e2e

- Never run the full Playwright e2e suite (`pnpm e2e`) unless the user asks for it.
- Never launch the Electron app (dev, e2e, smoke checks) in the foreground. Every window it opens takes macOS focus, and the owner can't use the Mac while it runs.
- If a running app is really needed, run only the spec you touched, in the background, with windows that never activate. If that can't be done, leave the spec unrun and say so.
- Default verification is `pnpm typecheck` + targeted vitest.

## UI style

- Never put a coloured side border (`border-left/top/...: 2px+ solid <colour>`, or `box-shadow: inset Npx 0 <colour>`) on a box with `border-radius` > 0: it bends around the corner into a crescent. Use a square box (`border-radius: 0`), or on rounded cards an inset straight bar drawn as a background layer (see `.details, .editor` in `apps/desktop/src/renderer/src/components/ui/ui.css`). Guarded by `apps/desktop/src/renderer/src/styles/borders.test.ts`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `a1exalexander/mysticals` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
