# ADR-06 — Failure recovery: cone-gated repair (replaces Selective Repeat)

Status: accepted. Date: 2026-10-02. Series: ADR-06 to ADR-10 make failure recovery, congestion
control and flow control normative parts of Seurat/1, using algorithms of our own.

## Context

The professor assigns each group distinct algorithms. Selective Repeat and Go-Back-N are taken and
may not be used, above all in transmission and failure recovery. What TCP and QUIC do inside the
transport is allowed: we neither configure nor reimplement it.

Seurat/1 v1.0 §5.3 uses Selective Repeat at the application level. `SOLTAR CRC` or
`SOLTAR DECODIFICACION` names the failed deliveries, and the server resends exactly those, once,
ahead of everything else. The code is `LoanHandlers` → `GrantController.resend` →
`Painter.resend`, which pushes a `Pending.RESEND` entry to the front of the queue outside any plan.
A second failure makes the brush unusable for the session (`Canvas.retryOnce`, `plannedBands = 4`),
but the client is never told.

**Series rule.** No ADR in this series may increase memory, wire bytes or latency on any bench
trace, and each must improve at least one of them. Every ADR states its budget and its gate.

## Decision

Principle: **nothing is retransmitted, it is wanted again.** A failed delivery is just a brush
that is missing from the book, and the planner already knows how to ask for missing brushes.

Normative rules (replace the rows `DECODIFICACION` and `CRC` of §5.3, extend §8):

1. **`SOLTAR CRC` / `SOLTAR DECODIFICACION`.** The server drops the book entries (as today) and
   counts the failure for each brush. It never queues an out-of-plan copy. It replans the
   canvas's current `MIRADA` at once, through the same replan that already serves partial
   deliveries and load recovery (one `PLAN INICIO`/`PLAN FIN` pair). The brush comes back only if
   it is still in the cone, in coarse-first pass order. If the gaze has left, nothing is sent, and
   a later plan that wants it again repairs it then. A hidden or retiring canvas is not replanned.
2. **Second failure of the same brush** (same session, same edition): the brush is
   **unrecoverable**. The planner counts it as held (as today). The next `PLAN INICIO` carries the
   new TLV `IRRECUPERABLES` (the replan of rule 1 carries it at once). The client learns that
   the area stays at the parent's density and stops expecting detail there. For `CRC`, the operator alert of §8 stays.
3. **Bad band on the server's disk** (CRC checked on read): the valid prefix is served, as today.
   If band 0 itself is bad, the brush is unrecoverable at once. The plan is marked due for a
   replan, so the 1 s liveness tick announces it within a second.
4. **Only the hole is refilled.** A plan entry stops at the first band the book already holds
   above its start (`BookView.heldFrom`). When a lower delivery fails while an upper one of the
   same brush is still held, the repair resends the lost bands only, never the held ones.
5. **Partial delivery** (`RESET_STREAM`, connection loss): unchanged. `PLAN CANCELADAS`, and the
   next plan wants it again with a new number (§8). This was already re-wanting, not retransmission.
6. **Resume after connection loss**: unchanged (`REANUDAR`, §8, and the client's capped
   backoff, which is not on the professor's list). A server "come back at" hint was considered
   and dropped: a server that shuts down cannot know when it will be back, and any guessed wait
   would make clients reconnect later than today.

### Wire

| Addition | Payload | Rule |
|---|---|---|
| TLV `0x04 IRRECUPERABLES` on `PLAN INICIO` | `vi n · u64 pincelada_id × n` | Brushes given up since the previous `PLAN INICIO` of the canvas |

A new TLV, which §3.5 allows in a minor version (unknown tags are skipped). No number is reused.

## Deviations from Seurat/1 v1.0

1. §5.3, rows `DECODIFICACION` and `CRC`: "se reenvía una vez" becomes cone-gated repair (rule 1),
   and a second failure is announced (rule 2).
2. §3.3: TLV `0x04 IRRECUPERABLES` on `PLAN INICIO`.
3. §8, row "Banda corrupta en disco": a bad band 0 is announced through `IRRECUPERABLES` (rule 3).

## Budget (series rule)

| Resource | Today (Selective Repeat) | Cone-gated repair |
|---|---|---|
| Payload bytes | Every failed delivery is resent, even if the user has looked away | Resent only if still in the cone: always ≤ today |
| Control bytes | 0 per repair | One `PLAN INICIO` + `PLAN FIN` (≈ 10–20 B) per failure `SOLTAR`, not per delivery. `IRRECUPERABLES` costs 9 B per brush given up, once. |
| Server memory | `retried` and `unusable` sets per canvas, plus the `RESEND` entry | The same two sets; the out-of-plan entry is gone |
| Client memory | — | Unrecoverable ids, bounded by failures (a second failure per brush) |
| Latency | The resend jumps the queue (`pushFront`) | Still view: the same order (the original plan was already coarse-first). After a pan: the new view's coarse entries no longer wait behind resends of the old view. |
| CPU | O(1) per failed delivery | One replan per failure `SOLTAR` (the cost of one `MIRADA`) |

The only cost that grows is the PLAN pair (≈ 20 B) and one replan per failure `SOLTAR`. Failures
are rare (TLS already rules out corruption on the wire; decoding fails on out-of-memory), and a
single failed delivery that is not resent saves about 35 kB (the mean delivery, §6.1).

## Evaluation gate

Painter rig (`server/test/seurat/kit/PainterRig`), a deterministic plan with failed deliveries,
in two cases: the gaze stays, and the gaze moves away before the failure arrives. Selective Repeat
resends every failed delivery, so its cost is the bytes of those deliveries. Compare on:
- payload bytes opened after the failure (must be ≤; zero when the gaze moved away);
- control bytes (the PLAN pair is the only increase, and is reported);
- order: no coarser entry of the same plan opens after the repair (Selective Repeat's
  `pushFront` put the repair before them);
- server state per canvas (must be ≤: the out-of-plan entry is gone).

The numbers go into this ADR before it is accepted.

## Evidence

`server/test/seurat/core/viewing/plan/RepairBenchTest.java`: the spec's slide-0421 view (§3.4),
the real planner over a real `LoanBook`, one failure every 25 deliveries (8 failures, 13 bands).
Bytes use a model of 8 KiB per band.

| Scenario | Selective Repeat | Cone-gated repair |
|---|---|---|
| A. Gaze stays | 13 bands (104 KiB) | 13 bands (104 KiB): the exact hole, nothing held is resent |
| B. Gaze panned before the failures arrived | 13 bands (104 KiB) | 0 bands |
| C. After the pan: coarser new-view entries delayed behind the repair | 141 | 0 |
| D. Cost per failure `SOLTAR` | 0 control bytes, 1 out-of-plan queue entry | 12 control bytes (`PLAN INICIO` 7 + `PLAN FIN` 5), 0 queue entries |

Without rule 4 (no `heldFrom` stop) scenario A resent 17 bands instead of 13: the replan asked
for whole brushes whose upper delivery was still held. The rule is what keeps the still view at
parity. The gate holds: payload ≤ in every case, strictly lower after a pan, no ordering
regression, and the only growth is the 12 control bytes per failure report.

## Implementation

- Server: `LoanHandlers` counts the failure and calls the replan (`GrantController.repair`).
  `LoanBook.heldFrom` and `BookView.heldFrom` stop plan entries at held bands (`ConePasses`), and
  `PlanIssuer.view` feeds the real book to every planner call.
  Remove `GrantController.resend`, `Painter.resend` and `Pending.RESEND`. `Canvas` keeps the
  brushes to announce, `PlanIssuer` emits `IRRECUPERABLES`, and `Opener` gives up a brush whose band
  0 is bad. Codec in `core/shared/proto/msg/MsgGaze.Plan`.
- Client: parse the TLV in `planDecode` and record those brushes per canvas.
- Tests: the repair rules and the new TLVs on both sides; then `docs/algorithms.md`.

## Consequences

- Seurat/1 has no retransmission at the application level: everything leaves through a plan,
  which makes hard rule 4 (single egress) stricter.
- The client knows when a brush will never come.
- Go-Back-N was never present, and this rule keeps it out: the protocol never resends a sequence
  of numbers.
