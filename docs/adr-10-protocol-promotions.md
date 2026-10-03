# ADR-10 — Client algorithms promoted into Seurat/1

Status: accepted. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

The proposal had four parts. The bench refuted the only one that changed behaviour, shared
kinematics with rings that lead along the pan. This document records the three promotions as
accepted and why the fourth was dropped (Evidence). What is accepted changes no behaviour and no
byte: it puts into the protocol what both ends already do, and removes the last LRU from it.

## Context

Several algorithms that shape what the protocol carries run only in the client, so the spec
neither states nor relies on them:
- **Horizon** eviction (ADR-02) runs in the client, while §5.2.3 still orders by recency and calls
  `SOLTAR` motive 1 `LRU` (§3.3, §5.2.3, §5.3, §6.3); §5.1 still calls the worker's value cache LRU;
- the **gaze kinematics** (α-β filter) feed Horizon, but the server plans its rings without them;
- the `cola_ms` measurement and the still-view keep-alive (`GAZE_KEEPALIVE_MS`) are client details.

## Decision

1. **Horizon is the eviction order of the protocol.** The order of §5.2.3 becomes ADR-02's: largest
   `T_eff` first, as a rule for conforming clients. The filter (leaves only, never the sketch or the
   core, never a cone the server may still be painting) and the thresholds are unchanged.
   `SOLTAR` motive 1 is renamed **`DESALOJO`**; the number stays 1. The proposal said `HORIZONTE`, but
   the motive says why a delivery went, not which algorithm chose it: the gallery card also releases
   with motive 1 the deliveries finer than it needs, with no Horizon ranking involved.
   The §5.1 value cache of the synthesis worker is S3-FIFO (`workers/synth-cache.ts`), not LRU.
2. **`cola_ms` is defined by the protocol** as the synthesis drain time,
   `(in worker + waiting) · t_job / paralelo`, measured by the client (ADR-08 sizes `libre` with it).
3. **Still-view keep-alive.** A visible still view repeats `MIRADA QUIETA` every 30 s. That keeps it
   inside the 60 s inactivity floor of §2.3, so a slow link does not lose the detail it is still
   painting. The client already does this (`features/send-gaze`); the protocol now requires it.

Not adopted (Evidence): **shared kinematics.** Both ends were to run the α-β filter on the `MIRADA`
sequence; the server would lead ring 1 by `v · 0.5 s` and ring 2 by `v · 1 s`, kept nested, and order
pass 3 by Horizon's time-to-need. Leading rings deliver more brushes that never reach the screen and
more bytes on every link; the order alone moves nothing beyond the noise. The server keeps centred
rings ordered by distance and holds no filter state, and `painted-cones.ts` needs no enlarged rings.

Considered and kept internal: attention heat, block-then-smooth upscale and the other rendering
algorithms. They never touch the wire, and the server could not use them.

## Deviations from Seurat/1 v1.0

1. §5.2.3: the order is Horizon (ADR-02, now normative). §3.3, §5.2.3, §5.3 and §6.3: `SOLTAR` motive 1
   is named `DESALOJO` (same number); "lo desaloje el LRU" reads "lo desaloje el desalojo voluntario".
2. §5.1: the worker's value cache is S3-FIFO.
3. §6.1: definition of `cola_ms`. §2.3: a visible still view repeats `MIRADA QUIETA` every 30 s.

No wire change.

## Budget (series rule)

| Resource | v1.0 | Accepted | Proposal (refuted) |
|---|---|---|---|
| Wire | — | 0 bytes | +2.0 % to +3.3 % per link and decoder |
| Server memory per canvas | last `MIRADA` | unchanged | + filter state (≈ 64 B) |
| Ring brushes never on screen | — | unchanged | +10 % to +25 % |
| Client memory | — | unchanged | unchanged |

The accepted part changes no behaviour, so it cannot worsen any trace; what it improves is the protocol
itself: no LRU is left in it (professor's rule), and the three client rules a second implementation
needs to interoperate are now written down.

## Evidence

`client/src/entities/delivery/__tests__/cone-bench.test.ts` replays the ADR-08 flow bench (`flow-sim.ts`:
link, server gates, WebSocket writer, the client's real meters and synthesis pool; same six traces,
links and decoders, `flow-cases.ts`) with the cone the server builds (`cone-plan.ts`, after
`ConePlanner`): focus tiles at their bands, ancestors whole, ring 1 (×2) at focus + 1 with 2 bands,
ring 2 (×4) at focus + 2 with 1 band, ancestors of every ring brush, then the three passes coarse
first. The client sends the `QUIETA` copy 300 ms after the view rests; the server's filter is the
client's own `GazeMotion`, reset by `QUIETA`. Receipts and credit are ADR-08's. Noise: the same
centred arm with ADR-08's 250 ms receipt age moved by ±1 ms; tolerance the larger of 1 % and what
those arms moved.

New metric, **unseen**: bytes of brushes that arrived and were never on screen afterwards (the core of
a later view or one of its ancestors).

Totals over the six traces (centred → leading rings with time-to-need order):

| Group | Unseen MB | Wire MB | Stalls | Pass-3 order alone: stalls |
|---|---|---|---|---|
| lan / fast | 32.1 → 40.0 (+25 %) | 227.2 → 234.6 (+3.3 %) | 6496 → 6495 | −0.6 % |
| lan / slow | 21.3 → 25.4 (+20 %) | 153.0 → 157.4 (+2.9 %) | 17829 → 17987 | −0.4 % |
| wan / fast | 37.5 → 43.2 (+15 %) | 178.5 → 184.0 (+3.1 %) | 15912 → 16010 | −0.1 % |
| wan / slow | 27.8 → 31.6 (+14 %) | 153.0 → 157.3 (+2.8 %) | 23303 → 23446 | −0.1 % |
| slow / fast | 27.4 → 30.2 (+10 %) | 134.9 → 137.9 (+2.2 %) | 45503 → 45719 | −0.1 % |
| slow / slow | 27.3 → 30.0 (+10 %) | 134.6 → 137.3 (+2.0 %) | 45702 → 45938 | +0.1 % |
| **All** | 173.3 → 200.4 (+16 %) | 981.1 → 1008.5 (+2.8 %) | 154745 → 155595 (+0.5 %) | −0.1 % |

By trace, the cost sits where the gaze turns: `randomWalk` unseen 40.6 → 55.4 MB, `hotspots` 63.8 →
75.2 MB, while `pan` (44.2 → 44.8) and `zoomDive` (1.3 → 1.2) barely move and `still` is identical.
A lead aims the rings at where the gaze was heading; a gaze that wobbles, eases out or turns back
leaves those brushes behind. Centred rings already reach one and three view half-widths past the
view's edge on each side, one to three seconds of the bench's pans.

Also tried, same bench: half the lead (`0.25 s / 0.5 s`) cuts `pan` stalls by 1.6 % but still raises
unseen bytes by 2–17 % per group (+14 % on `randomWalk`); double the lead (`1 s / 2 s`) raises them by
17–30 %. Without the `QUIETA` reset the numbers are identical: the traces rarely rest on one view.
Time-to-need order alone moves stalls by −0.6 % to +0.1 %, inside the noise, and adds 24 ms of
pipeline bubbles on `wan / slow`.

The gate the bench asserts on every run: on every link and decoder, leading rings deliver more unseen
bytes and more wire bytes than centred rings beyond the tolerance; the order alone moves no stall count
beyond it.

## Implementation

- Server: `ProtoCodes.SOLTAR_DESALOJO` replaces `SOLTAR_LRU` (same value). Nothing else; the server
  never read motive 1.
- Client: the `ReleaseReason` comment names motive 1 `DESALOJO`. Horizon (`horizon-rank.ts`), `cola_ms`
  (`decode-queue.ts`) and the keep-alive (`features/send-gaze`) are already as specified.
- Bench: `cone-plan.ts`, `cone-bench.test.ts`, `flow-cases.ts`; `flow-sim.ts` takes a planner and counts
  bands and unseen bytes (the ADR-08 bench's output is unchanged byte for byte).
- Docs: `docs/algorithms.md`, the `eviction-plugin` skill, `AGENTS.md` rule 6.

## Consequences

- Horizon is normative and nothing in the protocol is LRU any more.
- The server stays stateless about the gaze: it plans each `MIRADA` on its own. Whatever gain gaze
  prediction has is already taken on the client, by Horizon's eviction order.
- Unseen bytes are 18 % of the bench's wire bytes with centred rings; most are ring brushes on the far
  side of a turn. A cheaper ring (fewer bands at ring 2, or ring 2 only after a rest) is where a later
  change would look, measured on the same bench.
