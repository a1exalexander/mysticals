#!/usr/bin/env sh
# Tags the current version and pushes the tag, which runs .github/workflows/release.yml.
# Bump `version` in apps/desktop, apps/terminal (and packages/core) package.json and push that commit first.
set -eu
cd "$(dirname "$0")/.."

v=$(node -p "require('./apps/desktop/package.json').version")
t=$(node -p "require('./apps/terminal/package.json').version")
[ "$v" = "$t" ] || { echo "apps/desktop is $v but apps/terminal is $t" >&2; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo "not on main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main: push or pull first" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "tag v$v already exists" >&2; exit 1; }

printf 'Release v%s from %s? [y/N] ' "$v" "$(git log -1 --format='%h %s')"
read -r ok
[ "$ok" = y ] || exit 1
git tag "v$v"
git push origin "v$v"
echo "Pushed v$v: https://github.com/$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')/actions"
