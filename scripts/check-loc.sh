#!/usr/bin/env bash
# Enforces file budgets: prod <150 LoC, tests <300 LoC, for .java/.ts/.tsx.
# Scans server/src, server/test (Java) and client/src (TS/TSX; __tests__/ and *.test.ts(x) count as tests).
# Usage: bash check-loc.sh [--report] [--server] [root] — root defaults to the repo root.
#   --server checks server/ only (run-tests.sh uses it until the client budgets land).
#   --report lists every over-budget file and always exits 0 (for tracking a refactor in progress).
set -euo pipefail
REPORT=0
SERVER_ONLY=0
while [ "${1:-}" = "--report" ] || [ "${1:-}" = "--server" ]; do
  if [ "$1" = "--report" ]; then REPORT=1; else SERVER_ONLY=1; fi
  shift
done
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MAIN_MAX=150
TEST_MAX=300
fail=0
check() {
  local file="$1" max="$2" kind="$3"
  local n
  n=$(wc -l < "$file")
  if [ "$n" -ge "$max" ]; then
    echo "OVER BUDGET [$kind] $file: $n >= $max (split by responsibility)"
    fail=1
  fi
}
scan() { # scan <dir> <kind> <max> <find args...>
  local dir="$1" kind="$2" max="$3"
  shift 3
  [ -d "$dir" ] || return 0
  while IFS= read -r -d '' f; do check "$f" "$max" "$kind"; done < <(find "$dir" "$@" -print0)
}
scan "$ROOT/server/src" main "$MAIN_MAX" -name '*.java'
scan "$ROOT/server/test" test "$TEST_MAX" -name '*.java'
if [ "$SERVER_ONLY" -eq 0 ]; then
  TS=( \( -name '*.ts' -o -name '*.tsx' \) )
  TS_TEST=( \( -path '*/__tests__/*' -o -name '*.test.ts' -o -name '*.test.tsx' \) )
  scan "$ROOT/client/src" test "$TEST_MAX" "${TS[@]}" "${TS_TEST[@]}"
  scan "$ROOT/client/src" main "$MAIN_MAX" "${TS[@]}" -not "${TS_TEST[@]}"
fi
if [ "$fail" -eq 0 ]; then
  echo "LoC budgets OK (main<$MAIN_MAX, test<$TEST_MAX)"
elif [ "$REPORT" -eq 1 ]; then
  echo "LoC report only: over-budget files listed above (not failing)"
else
  exit 1
fi
