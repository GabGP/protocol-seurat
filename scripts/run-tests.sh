#!/usr/bin/env bash
# Compiles and runs every Java test (JDK-only mains, `java -ea`).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=".seurat/build/test-classes"
mkdir -p "$OUT" "/tmp/opencode"
FLAGS=()
RUN_FLAGS=()
if java -version 2>&1 | grep -q 'version "20\.'; then
  FLAGS=(--enable-preview --release 20)
  RUN_FLAGS=(--enable-preview)
fi
javac "${FLAGS[@]}" -d "$OUT" $(find server/src server/test -name '*.java')
pass=0
fail=0
for t in $(cd server/test && find . -name '*Test.java' | sed 's|^\./||; s|\.java$||; s|/|.|g'); do
  if java "${RUN_FLAGS[@]}" -ea -cp "$OUT" "$t" > "/tmp/opencode/test-$t.log" 2>&1; then
    echo "PASS $t"
    pass=$((pass + 1))
  else
    echo "FAIL $t (see /tmp/opencode/test-$t.log)"
    tail -n 15 "/tmp/opencode/test-$t.log"
    fail=$((fail + 1))
  fi
done
echo "---"
bash "$(dirname "$0")/check-loc.sh"
[ "$fail" -eq 0 ]
