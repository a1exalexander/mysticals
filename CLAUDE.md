# Claude Code notes

## Commits and pull requests

- Commits and PRs are authored as the repo owner, Oleksandr Ratushnyi <forcewizu@gmail.com> (set in `.claude/settings.json`).
- No AI attribution anywhere: no `Co-Authored-By: Claude`, no `Claude-Session:` trailer, no "Generated with Claude Code" line in commit messages, PR titles/bodies or PR comments.
- Commit messages follow Conventional Commits (see CONTRIBUTING.md).

## UI style

- Never put a coloured side border (`border-left/top/...: 2px+ solid <colour>`, or `box-shadow: inset Npx 0 <colour>`) on a box with `border-radius` > 0: it bends around the corner into a crescent. Use a square box (`border-radius: 0`), or on rounded cards an inset straight bar drawn as a background layer (see `.details, .editor` in `apps/desktop/src/renderer/src/components/ui/ui.css`). Guarded by `apps/desktop/src/renderer/src/styles/borders.test.ts`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `a1exalexander/mysticals` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
