# ADR-10 — Client algorithms promoted into Seurat/1

Status: proposed. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

## Context

Several algorithms that shape what the protocol carries run only in the client, so the spec
neither states nor relies on them:
- **Horizon** eviction (ADR-02) runs in the client, while §5.2.3 still says LRU and `SOLTAR`
  motive 1 is still named `LRU`;
- the **gaze kinematics** (α-β filter) feed Horizon, but the server plans its rings without them;
- the `cola_ms` measurement, and the still-view keep-alive (`GAZE_KEEPALIVE_MS`, gallery cards),
  are client details.

Each one, made normative, lets the two ends share one model, at no cost on the wire.

## Decision

1. **Horizon is the eviction order of the protocol.** The order of §5.2.3 becomes ADR-02's
   (largest `T_eff` first), as a rule for conforming clients. `SOLTAR` motive 1 is renamed
   `HORIZONTE`; the number stays 1. The filter (leaves only, never the sketch or the core, never a
   cone the server may still be painting) and the thresholds are unchanged.
2. **Shared kinematics, with no new bytes.** Both ends run the same α-β filter (ADR-02 constants:
   α = 0.5, β = 0.2, velocity half-life 0.5 s, reset after a 2 s gap) on the same input: the
   sequence of `MIRADA` of a canvas. The client feeds what it sends; the server feeds what it
   accepts. The server uses the result in two places:
   - **leading rings**: ring 1 is shifted by `v · 0.5 s` and ring 2 by `v · 1 s` along the pan,
     clamped so that each ring still contains the one inside it (focus ⊆ ring 1 ⊆ ring 2), which
     keeps the cone ancestor-closed (§2.3);
   - **pass 3 order**: rings are sent by Horizon's time-to-need (largest last), instead of by
     squared distance only.

   Over WebTransport a lost datagram may leave the two filters slightly apart. Therefore the
   client's "may still be painted" test (`painted-cones.ts`) checks against each ring enlarged by
   the maximum lead (`|v|·τ_j`, capped), a superset of any box the server may have used. Eviction
   stays safe: it can never drop a brush the server is still painting.
3. **`cola_ms` is defined by the protocol** as the synthesis drain time,
   `(in worker + waiting) · t_dec / paralelo` (ADR-08 uses it).
4. **Still-view keep-alive.** A visible still view repeats `MIRADA QUIETA` every 30 s. That keeps it
   inside the 60 s inactivity floor of §2.3, so a slow link does not lose the detail it is still
   painting. The client already does this; the protocol now requires it.

Considered and kept internal: the S3-FIFO plane cache, attention heat, block-then-smooth upscale
and the other rendering algorithms. They never touch the wire, and the server could not use them.

## Deviations from Seurat/1 v1.0

1. §5.2.3: the order is Horizon (ADR-02, now normative). `SOLTAR` motive 1: the name `LRU` becomes
   `HORIZONTE` (same number).
2. §2.3 and §4.1: the rings lead along the gaze velocity, and pass 3 is ordered by time-to-need.
   The cone stays nested and ancestor-closed.
3. §6.1: definition of `cola_ms`. §2.3: keep-alive period of 30 s.

No wire change: the kinematics are derived from the `MIRADA` both ends already exchange.

## Budget (series rule)

| Resource | Today | With the promotions |
|---|---|---|
| Wire | — | 0 extra bytes (no TLV: both ends derive the kinematics) |
| Server memory per canvas | Last `MIRADA` | + filter state (≈ 64 B) |
| Server CPU per `MIRADA` | Plan | + one filter update (a few multiplications) |
| Ring bytes | Rings centred on the view | The same number of ring brushes, aimed along the pan |
| Client memory | — | Unchanged: the filter already runs for Horizon |

The ≈ 64 B per canvas is the only fixed cost of the series that grows. It is admitted only if the
gate shows a larger saving per session: fewer ring brushes that arrive and are evicted unseen.

## Evaluation gate

ADR-02's trace bench (`eviction-bench.test.ts`) with the server's ring planner in the loop. Compare
centred rings with leading rings on:
- stalls, meaning brushes on screen but missing (must be lower on pans; ≤ when still);
- ring brushes delivered and evicted before ever being on screen (must be lower);
- total bytes per trace (must be ≤);
- peak held memory (must be ≤).

## Implementation

- Server: an α-β filter per canvas (`core/viewing/plan` or `session`), fed by `GazeGate` on
  acceptance; `ConeTiling.ring` with the lead; `ConePasses` ordering pass 3 by time-to-need. The
  formula is shared, in `core/shared` if both packages need it.
- Client: `painted-cones.ts` with the enlarged rings; rename the motive in `shared/proto`.
- Docs: `docs/algorithms.md`, the `eviction-plugin` and `seurat-protocol` skills, and `AGENTS.md`
  rule 6 (Horizon is normative).
