#!/usr/bin/env bash
# Enforces the server package layering: a package may import only packages of a LOWER rank.
# Two distinct packages of the same rank never import each other. Scans server/src (tests may reach anywhere).
# core/works never imports core/viewing.
# adapters/in and adapters/out never import each other.
# Checks `import seurat.x.Y` lines, wildcard `import seurat.x.*` lines and fully qualified `seurat.x.Y` uses in code.
# Usage: bash check-layers.sh [--report] [root] — root defaults to the repo root.
#   --report lists every violation and always exits 0 (for tracking a refactor in progress).
set -euo pipefail
REPORT=0
if [ "${1:-}" = "--report" ]; then REPORT=1; shift; fi
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SRC="$ROOT/server/src"
# Rank table (lowest first). A new package must be ranked here before it compiles past this gate.
RANKS='
seurat.core.shared.config 0
seurat.core.shared.observe 1
seurat.core.shared.proto 2
seurat.core.shared.proto.msg 3
seurat.core.shared.codec 4
seurat.core.works.store 5
seurat.core.viewing.concession 5
seurat.core.viewing.loans 5
seurat.core.works.catalog 6
seurat.core.viewing.plan 7
seurat.core.works.ingest.port 7
seurat.core.works.ingest.sketch 8
seurat.core.works.ingest 9
seurat.core.viewing.session 10
seurat.core.viewing.paint 11
seurat.core.viewing.grant 12
seurat.core.viewing.easel 13
seurat.adapters.in.inbox 13
seurat.adapters.in.net.http 14
seurat.adapters.in.net.ws 14
seurat.adapters.in.net.socket 15
seurat.adapters.out.decode.raster 13
seurat.adapters.out.disk 13
seurat.adapters.out.decode.imageio 14
seurat.adapters.out.decode.jpeg 14
seurat.adapters.out.decode.tiff 14
seurat.adapters.out.decode.png 14
seurat.adapters.out.decode.psb 14
seurat.adapters.out.decode 15
seurat.boot 16
seurat 17
'
find "$SRC" -name '*.java' -print0 | xargs -0 awk -v ranks="$RANKS" '
BEGIN {
    n = split(ranks, lines, "\n")
    for (i = 1; i <= n; i++) if (split(lines[i], kv, " ") == 2) rank[kv[1]] = kv[2] + 0
}
FNR == 1 { pkg = "" }
/^package / { pkg = $2; sub(/;.*/, "", pkg); if (!(pkg in rank)) { print "UNRANKED " pkg " (" FILENAME ")"; bad = 1 } }
/^\s*(\/\/|\*|\/\*)/ { next }
{
    line = $0
    gsub(/\.\*;/, ".X;", line)
    while (match(line, /seurat(\.[a-z][a-z0-9]*)*\.[A-Z]/)) {
        ref = substr(line, RSTART, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
        if (ref == pkg || !(pkg in rank)) continue
        if (!(ref in rank)) { print "UNRANKED " ref " (" FILENAME ")"; bad = 1; continue }
        if (index(pkg, "seurat.core.works") == 1 && index(ref, "seurat.core.viewing") == 1) {
            ckey = "ctx:" pkg " -> " ref " (" FILENAME ")"
            if (!(ckey in seen)) { seen[ckey] = 1; print "CONTEXT " pkg " -> " ref " " FILENAME; bad = 1 }
        }
        if ((index(pkg, "seurat.adapters.in") == 1 && index(ref, "seurat.adapters.out") == 1) || \
            (index(pkg, "seurat.adapters.out") == 1 && index(ref, "seurat.adapters.in") == 1)) {
            ckey = "ctx:" pkg " -> " ref " (" FILENAME ")"
            if (!(ckey in seen)) { seen[ckey] = 1; print "CONTEXT " pkg " -> " ref " " FILENAME; bad = 1 }
        }
        if (rank[ref] >= rank[pkg]) {
            key = pkg " -> " ref " (" FILENAME ")"
            if (!(key in seen)) { seen[key] = 1; print "UPWARD " pkg "[" rank[pkg] "] -> " ref "[" rank[ref] "] " FILENAME; bad = 1 }
        }
    }
}
END { exit bad }
' | sed "s|$SRC/||" && status=0 || status=$?
if [ "$status" -eq 0 ]; then
  echo "Layers OK (every server import points to a lower rank)"
elif [ "$REPORT" -eq 1 ]; then
  echo "Layer report only: violations listed above (not failing)"
else
  exit 1
fi
