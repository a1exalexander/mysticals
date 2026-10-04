#!/usr/bin/env sh
# Bumps the version, commits it to main, then tags it and pushes both, which runs .github/workflows/release.yml.
#   scripts/release.sh [patch|minor|major|X.Y.Z] ["what changed"]
# Defaults to patch. Passing the current version skips the bump and only tags it.
set -eu
cd "$(dirname "$0")/.."

files="apps/desktop/package.json apps/terminal/package.json packages/core/package.json"
ver() { node -p "require('./$1').version"; }

cur=$(ver apps/desktop/package.json)
for f in $files; do
  [ "$(ver "$f")" = "$cur" ] || { echo "apps/desktop/package.json is $cur but $f is $(ver "$f")" >&2; exit 1; }
done

bump=${1:-patch}
note=${2:-}
case $bump in
  patch|minor|major) v=$(node -e '
    const [a, b, c] = process.argv[1].split(".").map(Number)
    console.log({ major: `${a + 1}.0.0`, minor: `${a}.${b + 1}.0`, patch: `${a}.${b}.${c + 1}` }[process.argv[2]])
  ' "$cur" "$bump") ;;
  [0-9]*.[0-9]*.[0-9]*) v=$bump ;;
  *) echo "usage: scripts/release.sh [patch|minor|major|X.Y.Z] [\"what changed\"]" >&2; exit 1 ;;
esac

[ "$(git branch --show-current)" = main ] || { echo "not on main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main: push or pull first" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "tag v$v already exists" >&2; exit 1; }

msg="chore: release $v${note:+ ($note)}"
if [ "$v" = "$cur" ]; then
  echo "Version is already $v: no bump, tag $(git log -1 --format='%h %s')."
else
  echo "Bump $cur -> $v in: $files"
  echo "Commit to main: $msg"
fi
printf 'Push main and tag v%s? [y/N] ' "$v"
read -r ok
[ "$ok" = y ] || { echo "aborted, nothing changed"; exit 1; }

if [ "$v" != "$cur" ]; then
  for f in $files; do
    node -e '
      const fs = require("fs"), [f, v] = process.argv.slice(1)
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/("version":\s*")[^"]+"/, `$1${v}"`))
    ' "$f" "$v"
  done
  git commit -q -m "$msg" -- $files
  git push -q origin main
fi
git tag "v$v"
git push -q origin "v$v"
echo "Pushed v$v: https://github.com/$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')/actions"
