# ADR-07 — Congestion control: tiered sharpness filling, announced in `REGULACION`

Status: proposed. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

## Context

Seurat/1 v1.0 §6.3 regulates the Painter with three borrowed algorithms. CoDel gives the signal (a
minimum dwell above 25 ms in a 250 ms tick marks deliveries). DCTCP gives the response
(`α_i ← (1−g)·α_i + g·F_i`). AIMD drives the share (`e_i` multiplied down, +1/32 per tick). The
staircase maps `e_i` to cone cuts. Congestion control, CoDel/DCTCP and AIMD are on the
professor's list. The code is `core/viewing/session/Regulator.java`, `ConePlanner.rung`,
`boot/Timers`.

Its weaknesses:
- it probes: it has to cut before it learns there was room, and then oscillates;
- it recovers slowly: from ⅛ back to 1 takes 28 ticks, or 7 s (§6.3);
- it works only inside the server: the client sees a single bit (`PLAN INICIO.regulación CARGA`).

## Decision

Principle: **nothing is probed, it is allotted.** The server measures what it can paint and hands
it out by sharpness, coarsest first, to every session at once.

1. **Capacity** (every 250 ms tick). The **busy fraction** is the share of the tick during which
   the Painter had a ready entry it could not open (the ready time is already tracked:
   `Pending.readyNs`). Then `C = bytes opened in the tick / busy fraction`. If the busy fraction is
   below ½, the Painter is not the bottleneck: `C` is unbounded and no session is cut. Otherwise `C`
   is the median of the last 5 saturated ticks.
2. **Demand by tier.** Each queued entry already has a pass (`PlanEntry.pass`):
   - tier 1 = pass 1 (core, bands `[have, 2)`);
   - tier 2 = pass 2 (core refinement);
   - tier 3 = pass 3 (rings).

   A session's demand in a tier is the count of its queued entries in that tier times the mean
   delivery size of their stratum. That mean is a running average kept per stratum from deliveries
   actually opened (11 numbers for the whole server). No store index lookups are added. Counts move
   when entries are queued, opened or dropped, all in `PaintQueue`, which touches them anyway.
3. **Allotment** over the next horizon `H = 1 s`, lexicographic by sharpness. Let `R = C·H`. For
   tiers 1, 2, 3 in order:
   - if the sum of every session's demand in the tier fits in `R`, every session gets it and `R`
     shrinks by that sum;
   - otherwise `R` is shared max-min among the sessions in the tier. The ones whose demand does
     not fit are cut at this tier, and the filling stops.

   This applies §6.2's goal, "no session gets fine points while another waits for coarse ones",
   directly at admission, instead of approximating it with a share.
4. **Rung = highest tier granted.** The staircase of §6.3 stays; what selects the rung is new:

   | Granted | Cone (same cuts as §6.3) |
   |---|---|
   | tiers 1–3 | normal |
   | tiers 1–2 | no ring 2, ring 1 with 1 band |
   | tier 1 | focus ≤ 2 bands (pass 2 postponed) |
   | tier 1 only partly | focus one stratum coarser |

5. **Hysteresis.** A session drops a rung at once. It climbs only after the higher tier has fit
   for 2 consecutive ticks (500 ms). On a climb the current `MIRADA` is replanned (as today).
6. **In the protocol.** A new optional type `0x40 REGULACION` (S→C, control):
   `u8 peldaño · vi presupuesto_kib_s · vi capacidad_kib_s · vi sesiones_activas`. It is sent only
   when the session's rung changes or its budget moves by ≥ 25 %, at most once per tick. A session
   that is never regulated never receives one. Client duties:
   - cap `libre` by the budget (ADR-08 `L_pres`), so it never asks for more than the server will
     spend;
   - never treat a missing periphery as loss.

   `PLAN INICIO.regulación` keeps its `CARGA` bit.

The per-session byte rate (`SessionRate`), the `MIRADA` token bucket, stride scheduling and aging
(§6.2) stay as they are. They are not on the list, and stride stays the tie-break inside a tier.

## Deviations from Seurat/1 v1.0

1. §6.3 is replaced: tiered filling instead of CoDel + DCTCP + AIMD. `α_i`, `e_i`, the marks and
   `g` are gone. The staircase stays, now indexed by the tier granted.
2. §3.3/§3.5: new optional type `0x40 REGULACION` and capability bit `0x04 REGULACION` in `caps`.
   This is an addition that §3.5 allows; unknown types ≥ 0x40 are skipped.
3. Annex A: the AIMD/Chiu–Jain, CoDel/bufferbloat and ECN/DCTCP rows become "lexicographic max-min
   allotment" and "capacity measured in busy time".

## Budget (series rule)

| Resource | Today (CoDel + DCTCP + AIMD) | Tiered filling |
|---|---|---|
| Server memory per session | `alpha`, `share`, `tickDeliveries`, `tickMarked` (32 B) | 3 tier counts, rung, rise counter (32 B) |
| Server memory, global | `minDwell` | 5 capacity samples + 11 stratum means (< 200 B) |
| CPU per tick | O(n sessions) | O(n log n) for the max-min share, n in the hundreds, every 250 ms: microseconds |
| CPU per entry | — | One counter update where `PaintQueue` already handles the entry |
| Wire | 0 | `REGULACION` (≈ 6–10 B) only on a rung change or a ≥ 25 % budget change, ≤ 4/s, and only while regulated. Offset by `L_pres` (ADR-08), which keeps stale deliveries off the wire under load. |
| Latency | Back to the normal cone in ≈ 7 s; oscillation | Back in 500 ms; no probing |

## Evaluation gate

Painter rig with N sessions of equal demand: steady load, a load step up, and a step down. Compare
with the current `Regulator` on:
- Jain index of sharpness served (≥ 0.9, §6.2, and ≥ today);
- time back to the normal cone after the load drops (must be lower; target ≤ 0.5 s);
- rung changes per minute (must be ≤);
- p95 time to complete the core (passes 1–2) (must be ≤);
- total bytes on the wire and peak memory per session (must be ≤).

## Implementation

- Server: replace `Regulator` with a capacity meter and an allotment
  (`core/viewing/session`, each file < 150 LoC). `PaintQueue` keeps the tier counts, and `Opener`
  feeds the stratum means. `ConePlanner.rung` takes the granted tier. `Timers` ticks the allotment.
  `MsgRegulation` and the caps bit go in `core/shared/proto/msg`. Retire `RegulatorTest` and add
  tests for the filling.
- Client: parse `REGULACION` and store the budget for ADR-08.
- Docs: `docs/algorithms.md`, and the code comments that say CoDel or DCTCP.

## Open question

Max-min sharing is a classic, though not on the professor's list, and §6.2 already uses it. If the
professor counts it, the alternative inside a tier is proportional sharing by demand.
