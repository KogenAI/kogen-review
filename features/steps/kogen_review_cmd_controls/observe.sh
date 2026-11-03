#!/bin/sh
# Observer control of features/steps/kogen_review_cmd.js (Intent k-review-cmd-entry). It runs the
# Intent's acceptance feature in a scratch copy of this checkout whose cmd/kogen-review/main.go is
# good_main.go.txt (mode good) or good_main.go.txt changed to exit 0 after every review (mode
# bad), and prints the scenario counts and the distinct failing steps. Exit 0: every scenario
# passed; 1: some failed; 3: the control could not be prepared.
set -u
mode=${1:-}
here=$(pwd)
controls="$here/features/steps/kogen_review_cmd_controls"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/kogen-review-control-XXXXXX") || exit 3
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/repo" && cp -R "$here/." "$scratch/repo/" || { echo "cannot copy the checkout"; exit 3; }
rm -rf "$scratch/repo/cmd/kogen-review"
mkdir -p "$scratch/repo/cmd/kogen-review"
main="$scratch/repo/cmd/kogen-review/main.go"
cp "$controls/good_main.go.txt" "$main"
case "$mode" in
good) ;;
bad)
  mark=$(printf '\treturn out, se.Exit')
  if [ "$(grep -c -x -F "$mark" "$main")" != 1 ]; then echo "good_main.go.txt does not hold the mutated line once"; exit 3; fi
  sed "s/^$mark\$/$(printf '\t')return out, 0/" "$main" > "$main.new" && mv "$main.new" "$main"
  if [ "$(grep -c -x -F "$mark" "$main")" != 0 ]; then echo "the mutation did not apply"; exit 3; fi
  ;;
*) echo "usage: observe.sh good|bad"; exit 3 ;;
esac
cd "$scratch/repo" || exit 3
NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --strict \
  --require 'features/steps/*.js' --format "message:$scratch/report.ndjson" \
  .kogen/intents/k-review-cmd-entry/acceptance.feature > "$scratch/output.txt" 2>&1
status=$?
"$KOGEN_NODE" "$controls/report.cjs" "$scratch/report.ndjson" || { cat "$scratch/output.txt"; exit 3; }
if [ "$status" = 0 ]; then exit 0; fi
exit 1
