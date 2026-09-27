# ADR-01 — Pluggable voluntary eviction (no LRU as final)

Status: superseded by `adr-02-horizon-evict.md` (2026-09-27): eviction is client-only, LRU and the server seam were removed. Date: 2026-09-24. Context: LAN, offline grade.

## Constraint

Professor feedback: LRU cannot be the final algorithm. Spec §5.2.3 currently
describes LRU tie-break + `SOLTAR LRU` (motive 1). We keep implementing, but
behind a seam.

## Decision

- `session/evict/EvictionPolicy` (Strategy) is the only caller-facing type.
- `LruEvictionPolicy` is the interim default. It implements the §5.2.3 order
  (outside cone → finest stratum → farthest → least-recently-painted).
- `EvictionPolicies.fromName()` + `ServiceLoader` registration. Switch via
  `seurat.conf eviction.policy=<name>`. No caller change to add CLOCK, LFU-aging,
  GDSS, etc.
- Wire stays stable: `SOLTAR` motive 1 is still sent (protocol compliance).
  What changes is the internal scoring, not the frame.
- Server never trusts the score: it validates leaf-only, sketch/core protected,
  and never-drop-lower-keeping-upper before applying `SOLTAR` to the loan book.

## Consequences

- Replacement work is one new class + one config line + tests.
- `LruEvictionPolicy` stays until the final algorithm is approved, then it is
  either deleted or kept as a benchmark behind the same flag.
