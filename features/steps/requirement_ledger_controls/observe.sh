#!/bin/sh
# Observer control of features/steps/requirement_ledger_steps.js (Intent
# k-review-intent-requirement-ledger). In a scratch copy of this checkout (no Git repository
# needed) it applies good.patch, a known-good implementation, with patch -p1 to the unchanged
# review package files (mode good), or does that and then disables the rejection of an approval
# whose requirement has evidence none (mode bad). It then runs the Intent's acceptance feature and
# prints the scenario counts and the distinct failing steps. Exit 0: every scenario passed;
# 1: some failed; 3: the control could not be prepared.
set -u
mode=${1:-}
here=$(pwd)
controls="$here/features/steps/requirement_ledger_controls"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/kogen-review-ledger-control-XXXXXX") || exit 3
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/repo" && cp -R "$here/." "$scratch/repo/" || { echo "cannot copy the checkout"; exit 3; }
cd "$scratch/repo" || exit 3
patch -s -p1 < "$controls/good.patch" > "$scratch/patch.txt" 2>&1 || { echo "good.patch does not apply"; exit 3; }
case "$mode" in
good) ;;
bad)
  file=review/independent.go
  mark=$(printf '\t\tcase verdict == "approve" && q.Evidence == "none":')
  if [ "$(grep -c -x -F "$mark" "$file")" != 1 ]; then echo "good.patch does not hold the mutated line once"; exit 3; fi
  awk -v mark="$mark" '$0 == mark { print "\t\tcase false:"; next } { print }' "$file" > "$file.new" && mv "$file.new" "$file"
  if [ "$(grep -c -x -F "$mark" "$file")" != 0 ]; then echo "the mutation did not apply"; exit 3; fi
  ;;
*) echo "usage: observe.sh good|bad"; exit 3 ;;
esac
NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --strict \
  --require 'features/steps/*.js' --format "message:$scratch/report.ndjson" \
  .kogen/intents/k-review-intent-requirement-ledger/acceptance.feature > "$scratch/output.txt" 2>&1
status=$?
"$KOGEN_NODE" "$here/features/steps/kogen_review_cmd_controls/report.cjs" "$scratch/report.ndjson" || { cat "$scratch/output.txt"; exit 3; }
if [ "$status" = 0 ]; then exit 0; fi
exit 1
