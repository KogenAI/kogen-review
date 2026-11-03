#!/bin/sh
# Observer control of features/steps/public_tree_steps.js (Intent k-public-ready-review). It runs
# the scenarios of the Intent's acceptance feature whose names begin with "The README" or "The
# tree" in a scratch copy of this checkout after apply.cjs made the known-good edits (mode good),
# or those edits and a README paragraph saying that issues and pull requests are disabled (mode
# bad), and prints the scenario counts and the distinct failing steps
# (kogen_review_cmd_controls/report.cjs). A copy that is not a Git work tree gets a new empty
# repository, so the tree is its files that .gitignore does not ignore. Exit 0: every scenario
# passed; 1: some failed; 3: the control could not be prepared.
set -u
mode=${1:-}
case "$mode" in
good|bad) ;;
*) echo "usage: observe.sh good|bad"; exit 3 ;;
esac
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
here=$(pwd)
controls="$here/features/steps/public_tree_controls"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/kogen-review-public-XXXXXX") || exit 3
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/repo" && cp -R "$here/." "$scratch/repo/" || { echo "cannot copy the checkout"; exit 3; }
"$KOGEN_NODE" "$controls/apply.cjs" "$scratch/repo" "$mode" || exit 3
cd "$scratch/repo" || exit 3
if [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$(pwd -P)" ]; then
  rm -rf .git && git init -q . || { echo "cannot create a Git repository in the copy"; exit 3; }
fi
NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --strict \
  --require 'features/steps/*.js' --name '^The (README|tree)' --format "message:$scratch/report.ndjson" \
  .kogen/intents/k-public-ready-review/acceptance.feature > "$scratch/output.txt" 2>&1
status=$?
"$KOGEN_NODE" "$here/features/steps/kogen_review_cmd_controls/report.cjs" "$scratch/report.ndjson" || { cat "$scratch/output.txt"; exit 3; }
if [ "$status" = 0 ]; then exit 0; fi
exit 1
