# ADR-07 — Congestion control: tiered sharpness filling, announced in `REGULACION`

Status: accepted. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

## Context

Seurat/1 v1.0 §6.3 regulates the Painter with three borrowed algorithms:
- **CoDel** gives the signal: a minimum dwell above 25 ms in a 250 ms tick marks deliveries.
- **DCTCP** gives the response: `α_i ← (1−g)·α_i + g·F_i`.
- **AIMD** drives the share: `e_i` is multiplied down, then grows +1/32 per tick.

A staircase maps `e_i` to cone cuts. Congestion control, CoDel/DCTCP and AIMD are on the professor's list. The code
was `core/viewing/session/Regulator.java`, `ConePlanner.rung` and `boot/Timers`.

Its weaknesses, on paper:
- it probes: it has to cut before it learns there was room, and then it oscillates;
- it recovers slowly: from ⅛ back to 1 takes 28 ticks, or 7 s;
- only the server sees it: the client gets a single bit, `PLAN INICIO.regulación CARGA`.

The bench (Evidence, below) found a worse one: **as built, it never fires.** The dwell starts when an entry becomes
the head of its canvas queue ("lista"). Under stride scheduling across sessions, some fresh head always opens within
a few ms, so the minimum over a tick stays near 0 at any load.

Even a stronger variant that measures CoDel's usual sojourn from `PLAN INICIO` fires only under a heavy overload.
There it oscillates (10 rung changes per viewer-minute) and leaves 7–9 % of the Painter idle.

## Decision

Principle: **nothing is probed, it is allotted.** The server measures what it can paint and hands it out by
sharpness, coarsest first, to every session at once. Capacity and demand are both in bytes per second.

1. **Capacity** (every 250 ms tick, `CapacityMeter`).
   - *Busy time* is the share of the tick during which the Painter had a ready entry it could not open: either it
     waits for a global slot, or it is serving another while it waits. `PaintQueue.take` reports it on every
     decision. Waiting on a session's own gates (`RECIBO.libre`, slots, rate, `cola_ms`) is flow control, not busy
     time.
   - A tick busy for at least half its length is *saturated*, and measures `C = bytes opened / busy time`.
   - The capacity is the median of the saturated ticks of the last 10 s (at most 5). With none, it is unbounded and
     nobody is cut.
   - A tick that is not saturated adds nothing and does not unbound it, so a cut that empties the queue does not
     invite everyone back: that would be a probe by another name.
2. **Demand: the rate of new want, by tier** (`TierDemand`, one per canvas, in `PlanProgress`).
   - The tiers are the plan passes that already exist (`PlanEntry.pass`): tier 1 is pass 1 (core, bands
     `[have, 2)`), tier 2 is pass 2 (core refinement), tier 3 is pass 3 (rings).
   - Every plan is costed on its **uncut** cone. While a session is cut, the planner runs a second time at rung 3.
     Otherwise a cut session would look as if its demand fit, climb, and drop again.
   - Bytes are estimated as bands × the running mean bytes per band of the stratum (11 numbers for the server, fed
     by every opened delivery). No store lookups are added.
   - A plan for a new `MIRADA` brings its whole uncut cone. A replan of the same `MIRADA` brings only what it adds to
     what the live plan still wants.
   - Each tick folds the arrivals into a smoothed rate (gain ¼, about 1 s of memory).
   - A hidden canvas, or an empty plan, wants nothing.
3. **Allotment** (`Allotment`), lexicographic by sharpness. Let `R = C`. For tiers 1, 2 and 3 in order:
   - if every session's demand in the tier fits in `R`, every session gets it, and `R` shrinks by the sum;
   - otherwise whole demands are admitted while they fit (first fit), the least-served session first (the spec
     §6.2 stride). A session already granted the tier keeps its place until it is 4 s of that tier's demand ahead in
     stride, which damps rotation. The others are cut at this tier, and the filling stops.

   No partial shares are granted, because a cut plan drops the whole tier, so a partial share would go unused (the
   first version used max-min shares and idled 20 % of the Painter). This applies §6.2's goal at admission time:
   "no session gets fine points while another waits for coarse ones".
4. **Rung = the tiers granted whole.** The staircase of §6.3 stays; what selects the rung is new:

   | Granted | Rung | Cone (same cuts as §6.3) |
   |---|---|---|
   | tiers 1–3 | 3 | normal |
   | tiers 1–2 | 2 | no ring 2, ring 1 with 1 band |
   | tier 1 | 1 | focus ≤ 2 bands (pass 2 postponed) |
   | tier 1 cut | 0 | focus one stratum coarser |

5. **Hysteresis.** A session drops a rung at once. It climbs only after a higher tier has fit for 2 consecutive
   ticks (500 ms), to the lowest grant of the two. A climb replans the live `MIRADA` at once (`Liveness.climbed`),
   not at the next 1 s tick.
6. **In the protocol.** A new optional type `0x40 REGULACION` (S→C, control):
   `u8 peldaño · vi presupuesto_kib_s · vi capacidad_kib_s · vi sesiones_activas`.
   - `presupuesto` 0 means no budget, and `capacidad` 0 means unbounded. A bounded value is at least 1.
   - Only a cut session (rung < 3) has a budget: what it was granted, in KiB/s.
   - It goes only to a session that offered caps `0x04 REGULACION`, and only when its rung changes or its budget
     moves by ≥ 25 %, at most once per tick. A session that is never cut never receives one; the first one after a
     cut ends lifts the budget (rung 3, budget 0).
   - Client duties:
     - keep the last one (`Runtime.regulation`; a new session starts unregulated);
     - cap `libre` by the budget (ADR-08 `L_pres`);
     - never treat a missing periphery as loss.

   `PLAN INICIO.regulación` keeps its `CARGA` bit.

The per-session byte rate (`SessionRate`), the `MIRADA` token bucket, stride scheduling and aging (§6.2) stay as they
are. The stamp of when an entry became ready (`Pending.readyNs`) fed only the CoDel dwell, and it is gone.

## Deviations from Seurat/1 v1.0

1. §6.3 is replaced: tiered filling instead of CoDel + DCTCP + AIMD. `α_i`, `e_i`, the marks and `g` are gone. The
   staircase stays, now indexed by the tiers granted.
2. §3.3/§3.5: a new optional type `0x40 REGULACION` and a capability bit `0x04 REGULACION` in `caps`. This is an
   addition §3.5 allows: unknown types ≥ 0x40 are skipped. No number is reused.
3. Annex A: the AIMD/Chiu–Jain, CoDel/bufferbloat and ECN/DCTCP rows become "capacity measured in busy time" and
   "lexicographic tier filling (first fit by stride)".

## Budget (series rule)

| Resource | v1.0 (CoDel + DCTCP + AIMD) | Tiered filling |
|---|---|---|
| Server memory per session | `alpha`, `share`, `tickDeliveries`, `tickMarked` (32 B) | `rung`, `rise`, `riseTo`, `sentRung`, `sentBudgetKibS` (24 B) |
| Server memory per canvas | — | `TierDemand`: 9 numbers (≈ 140 B with headers) |
| Server memory per queued entry | `Pending.readyNs` (8 B) | 0 B: with the ~200 entries of a plan, a canvas saves ≈ 1.5 KB |
| Server memory, global | `minDwell` (8 B) | 5 capacity samples and their times, 11 stratum means (< 300 B) |
| CPU per tick | O(sessions) | O(canvases) to fold rates, plus a sort of the sessions in the cut tier: microseconds |
| CPU per plan | one planner call | a second planner call only while the session is cut |
| CPU per entry | one synchronized call (`onStart`) | two (`meter.opened`, `demand.opened`); the queue reports busy time once per decision |
| Wire | 0 | `REGULACION`, 8 B per frame, only to cut sessions: 3.8 KB over the 30 s bench (16 viewers at peak), 0.001 % of the payload |
| Latency | see Evidence | see Evidence |

## Evidence

`server/test/seurat/core/viewing/session/RegulationBenchTest.java` (with `RegulationSim`, `RegulationViewer` and
`RegulationStats`):
- the world: the spec's slide-0421 view (§3.4) and the real `ConePlanner` over a real `LoanBook` per viewer;
- one Painter of fixed capacity, simulated in 1 ms steps in spec §6.2 order (aged class, pass, stride);
- each viewer pans half a view every 500 ms;
- phases: 4 viewers for 10 s, 12 more join for 10 s (load step), then they leave (step down) for 10 s.

The sizes are a model, not a measurement: band b of a brush weighs 2, 4, 8 or 16 KiB.

The arms:
- `v1.0 (as built)` is a copy of the retired regulator (`LegacyRegulation`);
- `v1.0 (sojourn)` is the same, measuring dwell from `PLAN INICIO`;
- `tiered` is the server's own `Regulator`, `CapacityMeter` and `TierDemand`.

Load-step phase (16 viewers), Painter at 24 MiB/s (the 4-viewer phases use 30 % of it):

| Metric | v1.0 as built | v1.0 sojourn | Tiered |
|---|---|---|---|
| Cores (passes 1–2) completed before the next `MIRADA` | 7 | 7 | **294** |
| p95 time to complete a core | 493 ms | 493 ms | **282 ms** |
| p95 queue dwell | 25 ms | 25 ms | **5 ms** |
| Plans replaced before their core completed | 297 | 297 | **34** |
| Jain index of bytes per viewer | 0.997 | 0.997 | 0.958 (≥ 0.9) |
| Painter utilization | 1.00 | 1.00 | 0.94 |
| Rung changes per viewer-minute (whole run) | 0 (never acts) | 0 (never acts) | 10.5 |
| Back to the normal cone after the step down | — | — | **250 ms** (target ≤ 500 ms) |
| Payload, whole run | 398.6 MB | 398.6 MB | 382.2 MB |
| `REGULACION`, whole run | 0 | 0 | 3.8 KB |

Heavy case, Painter at 6 MiB/s (even 4 viewers overload it):

| Metric | v1.0 as built | v1.0 sojourn | Tiered |
|---|---|---|---|
| Cores completed (phases 1 / 2 / 3) | 0 / 0 / 0 | 12 / 0 / 16 | **17 / 91 / 14** |
| p95 queue dwell in the step | 57 ms | 58 ms | **33 ms** |
| Painter utilization (phases 1 / 2 / 3) | 1.00 / 1.00 / 1.00 | 0.93 / 1.00 / 0.91 | **1.00 / 1.00 / 1.00** |
| Rung changes per viewer-minute | 0 | 10.0 | 14.5 |
| Payload, whole run | 188.7 MB | 178.6 MB | 188.7 MB |

The gate:
- **Latency improves.** Queue dwell, time to a complete core, and cores completed are better in every case.
- **Wire bytes never grow.** Payload is at most the unregulated run's: regulation only withholds. The only addition
  is 3.8 KB of `REGULACION`.
- **Memory falls** per canvas with any real plan.
- **Accepted costs.**
  - At 24 MiB/s the Painter idles 6 % in the step. That is the admission remainder: at most one session's tier
    demand. The bytes not sent are fine bands, sent once the load drops.
  - Rung changes, 10–15 per viewer-minute, are the cost of acting at all. v1.0 shows 0 because it never acts. The
    sojourn variant, which does act, changes 10 times per viewer-minute while idling 7–9 % of the Painter.

The bench asserts the gate on every run: Jain ≥ 0.9, dwell ≤ v1.0, cores ≥ v1.0, payload ≤ unregulated, and the
normal cone back within 500 ms.

## Implementation

- Server, in `core/viewing/session`:
  - `CapacityMeter`, `TierDemand`, `Allotment`, `Regulator` (the tick and the rung hysteresis) and
    `RegulationNotice`.
  - The `Session` fields above; the canvas demand lives in `PlanProgress`.
- Server, outside it:
  - `PaintQueue` reports busy time, and `Opener` feeds the stratum means and spends the demand.
  - `PlanIssuer.cone` is the one place that plans a `MIRADA` and costs its uncut cone.
  - `Liveness.climbed` replans a climb at once, and `boot/Timers` runs the tick.
  - `ConePlanner.plan` takes the rung.
  - `MsgRegulation`, `FrameType.REGULACION` and `ProtoCodes.CAP_REGULACION` carry the wire format, and
    `SessionHandshake` offers the cap.
- Client:
  - `shared/proto/messages/control.ts` decodes `REGULACION`, and the control router passes it to
    `SessionEvents.onRegulation`;
  - `app/providers/seurat` keeps it in `Runtime.regulation`;
  - SALUDO offers caps `0x04`.
- Tests:
  - `CapacityMeterTest`, `TierDemandTest`, `AllotmentTest`, `RegulatorTest`, `RegulationNoticeTest`,
    `RegulationCodecTest`, `ConeDemandTest` and the bench;
  - the client golden in `regulation.test.ts`, with the same 8 bytes as the server: `01 48 00 80 00 60 00 10`.

## Consequences

- Seurat/1 regulates by admission, not by probing. It never cuts unless the Painter has measured itself saturated
  in the last 10 s.
- The client learns its rung and budget (`REGULACION`). ADR-08 measured capping the credit by the budget and found
  it changes nothing (the window never binds while the Painter is the bottleneck), so it stays informational.
- The open question of the proposal (max-min sharing inside a tier) is gone. The cut tier admits whole demands in
  stride order, which the spec already uses (§6.2).
