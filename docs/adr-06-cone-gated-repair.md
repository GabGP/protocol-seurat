# ADR-06 — Failure recovery: cone-gated repair (replaces Selective Repeat)

Status: proposed. Date: 2026-10-02. Series: ADR-06 to ADR-10 make failure recovery, congestion
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
   marks each brush *under repair*. It never queues an out-of-plan copy. Then:
   - if the canvas's current plan is still running (no `PLAN FIN` yet), the server inserts the
     repair entry into that plan in its pass order. No new frames go out;
   - otherwise it replans the canvas's current `MIRADA` at once (one `PLAN INICIO`/`PLAN FIN`
     pair). The brush comes back only if it is still in the cone. If the gaze has left, nothing is
     sent, and a later plan that wants it again repairs it then.
2. **Second failure of the same brush** (same session, same edition): the brush is
   **unrecoverable**. The planner counts it as held (as today). The next `PLAN INICIO` carries the
   new TLV `IRRECUPERABLES`, and the client stops waiting for it and draws the parent's density
   there. For `CRC`, the operator alert of §8 stays.
3. **Bad band on the server's disk** (CRC checked on read): the valid prefix is served, as today.
   If band 0 itself is bad, the brush is unrecoverable at once and is announced the same way.
4. **Partial delivery** (`RESET_STREAM`, connection loss): unchanged. `PLAN CANCELADAS`, and the
   next plan wants it again with a new number (§8). This was already re-wanting, not retransmission.
5. **Resume after connection loss.** The capped exponential backoff of the client stays (it is not
   on the professor's list), with two additions that can only make it faster or lighter:
   - the new TLV `REINTENTO` (`vi espera_ms`) on `ADIOS` or `ERROR`. A server that is restarting or
     shedding load says when to come back, and the client makes no attempt before then. This
     removes futile attempts;
   - a deterministic per-session offset from a hash of the session id, applied only to bring an
     attempt **earlier** (0–20 % of the wait, never later). After a server restart the clients no
     longer arrive on the same tick, and no client waits longer than today.

### Wire

| Addition | Payload | Rule |
|---|---|---|
| TLV `0x04 IRRECUPERABLES` on `PLAN INICIO` | `vi n · u64 pincelada_id × n` | Brushes given up since the previous `PLAN INICIO` of the canvas |
| TLV `0x05 REINTENTO` on `ADIOS` and `ERROR` | `vi espera_ms` | No resume attempt before that |

Both are new TLVs, which §3.5 allows in a minor version (unknown tags are skipped). No number is
reused.

## Deviations from Seurat/1 v1.0

1. §5.3, rows `DECODIFICACION` and `CRC`: "se reenvía una vez" becomes cone-gated repair (rule 1),
   and a second failure is announced (rule 2).
2. §3.3: TLVs `0x04` and `0x05`.
3. §8, rows "Banda corrupta en disco" and "Entrega parcial": announced through `IRRECUPERABLES`
   (rules 2–4). Row "Cambio de red": `REINTENTO` and the early-only offset (rule 5).

## Budget (series rule)

| Resource | Today (Selective Repeat) | Cone-gated repair |
|---|---|---|
| Payload bytes | Every failed delivery is resent, even if the user has looked away | Resent only if still in the cone: always ≤ today |
| Control bytes | 0 per repair | 0 while the plan runs; otherwise one `PLAN INICIO` + `PLAN FIN` (≈ 10–20 B) per `SOLTAR`, not per delivery. `IRRECUPERABLES` costs 9 B per brush given up, once. |
| Server memory | `retried` and `unusable` sets per canvas, plus the `RESEND` entry | The same two sets; the out-of-plan entry is gone |
| Client memory | Waits for a resend that may never come | Unrecoverable ids (bounded by failures); stops waiting |
| Latency | The resend jumps the queue (`pushFront`), so coarse work waits behind it | The repair takes its place in coarse-first order. The focus finishes after the same bytes as today, and coarse work is no longer delayed. |
| Resume | Same backoff curve | Same curve or earlier; no attempt during a `REINTENTO` window |

The only cost that can grow is the PLAN pair (≈ 20 B) for a failure that arrives after the plan has
finished, while the brush is still wanted. A single repaired delivery that is not resent saves
about 35 kB (the mean delivery, §6.1).

## Evaluation gate

Painter rig (`server/test/seurat/kit/PainterRig`) with deterministic pans and 1 % of deliveries
failing CRC. Compare with Selective Repeat on:
- total bytes on the wire, both directions (must be ≤);
- p95 time until the focus is complete (must be ≤);
- p95 delay of coarse entries behind repairs (must be ≤);
- peak server and client memory per session (must be ≤).

The numbers go into this ADR before it is accepted.

## Implementation

- Server: `LoanHandlers` marks the brush and calls the planner (insert into the running plan, or
  replan). Remove `GrantController.resend`, `Painter.resend` and `Pending.RESEND`. `PlanIssuer` emits
  `IRRECUPERABLES`, and the Painter's disk path reports a bad band 0. Codecs in `core/shared/proto/msg`.
  `ADIOS`/`ERROR` carry `REINTENTO` when the server is shutting down.
- Client: parse the TLV and mark those brushes so the canvas draws the parent and the settlement
  stops waiting; `app/providers/seurat/reconnect.ts` honours `REINTENTO` and the early-only offset.
- Tests: the repair rules and the new TLVs on both sides; then `docs/algorithms.md`.

## Consequences

- Seurat/1 has no retransmission at the application level: everything leaves through a plan,
  which makes hard rule 4 (single egress) stricter.
- The client knows when a brush will never come, instead of waiting until the next audit.
- Go-Back-N was never present, and this rule keeps it out: the protocol never resends a sequence
  of numbers.
