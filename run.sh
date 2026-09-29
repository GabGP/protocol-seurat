#!/usr/bin/env bash
# Seurat/1 LAN run: static viewer + Java server on one port. Offline-safe.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .seurat/runtime/{inbox,obras,cobertura} .seurat/build/classes

# Rebuild the viewer when a JS toolchain is available; otherwise serve the
# committed client/dist. Never fails the boot.
if [ -f client/package.json ] && { command -v pnpm >/dev/null || command -v npm >/dev/null; }; then
  (cd client && (pnpm build 2>/dev/null || npm run build 2>/dev/null)) || echo "client build skipped"
fi

FLAGS=()
RUN_FLAGS=()
if java -version 2>&1 | grep -q 'version "20\.'; then
  FLAGS=(--enable-preview --release 20)
  RUN_FLAGS=(--enable-preview)
fi

javac "${FLAGS[@]}" -d .seurat/build/classes $(find server/src -name '*.java')
jar -cf .seurat/build/seurat.jar -C .seurat/build/classes .
# Ingest heap grows with image width (~2.5 GB live at 196,608 px); 6G leaves GC headroom.
HEAP="${SEURAT_HEAP:--Xmx6G}"
# Colours and the sticky progress bar only on a terminal: a redirected log stays plain text.
LOG_FLAGS=(-Dseurat.log.tty=false)
if [ -t 1 ]; then
  LOG_FLAGS=(-Dseurat.log.tty=true "-Dseurat.log.columns=$(tput cols 2>/dev/null || echo 80)")
fi
exec java "${RUN_FLAGS[@]}" $HEAP -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=.seurat/runtime/ "${LOG_FLAGS[@]}" ${JAVA_OPTS:-} -cp .seurat/build/seurat.jar:.seurat/build/classes seurat.SeuratServer "$@"
