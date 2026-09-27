# ADR-02 — Horizon voluntary eviction (replaces LRU)

Status: accepted. Date: 2026-09-27. Supersedes ADR-01. Context: LAN, offline grade.

## Constraint

Spec §5.2.3 orders voluntary eviction as outside-cone → finest stratum → farthest →
least-recently-painted (`SOLTAR LRU`). The professor forbids LRU: each group must use a
different algorithm.

## Where eviction lives

Only in the client. The client owns the memory (VRAM layers, band bytes). The server learns what
was dropped through `SOLTAR` and checks it by exact-set accounting (`RASPADO`/`INVENTARIO`,
`ERROR 7/8`). ADR-01's server-side `session/evict` Strategy never had a caller, and it cannot
have one, so it was deleted together with `seurat.conf eviction.policy`.

Code: `client/src/entities/delivery/{gaze-motion,attention-heat,evict-candidate,horizon-rank}.ts`,
wired in `client/src/app/providers/delivery-sink.ts` (`setView`, `relieve`).

## Decision: Horizon = kinematic Bélády + attention heat

Bélády's MIN (optimal) evicts the item whose next use is farthest in the future. Horizon
estimates that time from how the gaze moves.

1. **Gaze kinematics (α-β filter, `gaze-motion.ts`).** Every `setView` (one per MIRADA) feeds
   `(t, cx, cy, z = log2 image-px/screen-px, r = view half-diagonal)`. The filter runs per axis:
   `x̂ = x + v·dt; e = meas − x̂; x = x̂ + α·e; v += (β/dt)·e`, with α = 0.5 and β = 0.2.
   The velocity halves every 0.5 s without new views, and the filter restarts after a 2 s gap.
2. **Time-to-need (`horizon-rank.ts`)** per candidate brush:
   - spatial `T_s = gap / max(Vref·0.1, Vref + v·û)`, where `gap = max(0, |b − gaze| − r − side/2)`
     and the reference pan speed `Vref = 0.5·r`/s is scale-invariant;
   - scale `T_z = max(0, z − s − 1) / max(Zref·0.1, Zref − vz)`, where `Zref = 0.5` levels/s:
     a brush finer than the view is needed only after zooming in to it;
   - `T = max(T_s, T_z)`, because both gaps must close before reuse.
3. **Attention heat (`attention-heat.ts`).** When a view is replaced, the brushes it showed are
   credited the seconds it stayed on screen (capped at 30 s per view). Heat decays with a 120 s
   half-life. `T_eff = T / (1 + 0.5·heat)`. This measures dwell (how long something was
   studied), not recency.
4. **Order:** largest `T_eff` first, until under 75 %, as before.

With a still gaze it reduces to the old spatial order: farthest and finest first.

Unchanged from §5.2.3 (`evict-candidate.ts`, independent of the score):
- pressure thresholds (`max − 8`, 90 %, relieve to 75 %);
- leaves only (no owned children), never the sketch, never the on-screen core;
- whole brushes (all deliveries);
- the wire is `SOLTAR motivo=1`, sent before `RECIBO.libre`/`RASPADO`/`INVENTARIO`.

Only the scoring order deviates from the spec's text, and the server cannot observe it.

Rejected: a **lease-horizon** term (evict brushes whose lease ends before their predicted reuse
first). It never changed the order in any trace: renewals keep nearby leases fresh, and far
brushes already rank last.

## Evidence

`client/src/entities/delivery/__tests__/eviction-bench.test.ts` replays five deterministic
traces at 20 MIRADA/s. It uses the real candidate filter, gaze filter and heat, with ring
prefetch up to 75 % and 120 s leases renewed each second. A stall is a brush that is on screen
but not held (visible blur). Numbers are stalls / fetched brushes.

| cap | trace | previous order | kinematic only | **Horizon** |
|---|---|---|---|---|
| 128 | pan | 909 / 1335 | 909 / 1335 | 909 / 1335 |
| 128 | panReturn | 1366 / 1911 | 1316 / 1896 | 1316 / 1896 |
| 128 | zoomDive | 1309 / 1506 | 1311 / 1508 | 1316 / 1513 |
| 128 | hotspots | 3973 / 5777 | 3945 / 5771 | 3945 / 5773 |
| 128 | randomWalk | 2044 / 2825 | 1974 / 2761 | 1974 / 2761 |
| 128 | **total stalls** | 9601 | 9455 (−1.5 %) | 9460 (−1.5 %) |
| 256 | pan | 886 / 1395 | 886 / 1395 | 886 / 1395 |
| 256 | panReturn | 1068 / 1550 | 1055 / 1534 | 1050 / 1528 |
| 256 | zoomDive | 1236 / 1373 | 1225 / 1373 | 1222 / 1373 |
| 256 | hotspots | 3807 / 5615 | 3792 / 5607 | 3792 / 5607 |
| 256 | randomWalk | 1670 / 2391 | 1673 / 2395 | 1656 / 2372 |
| 256 | **total stalls** | 8667 | 8631 (−0.4 %) | 8606 (−0.7 %) |

What the numbers say:
- The gain comes mostly from the kinematics. The biggest wins are on reversals and free
  exploration (−3.7 % and −3.4 % at cap 128), because the previous order evicts "farthest"
  symmetrically, including what lies ahead.
- Heat adds a little when memory is generous (cap 256) and is neutral when it is tight.
- Pan is a tie: nothing is ever revisited. zoomDive is within ±0.5 %.
- The results barely move when `PAN_REF`/`ZOOM_REF` are swept over 0.25–2 (total 9450–9457
  at cap 128).
- The previous order was already a strong spatial heuristic. Horizon's gain is real but modest.

## Consequences

- The eviction algorithm is one pure function (`rankHorizon`) plus two small state holders.
  Changing it means touching `horizon-rank.ts` and re-running the benchmark.
- Constants live in `client/src/shared/config/constants.ts` (`GAZE_*`, `HORIZON_*`, `HEAT_*`,
  `EVICT_*`).
