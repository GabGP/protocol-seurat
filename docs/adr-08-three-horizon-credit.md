# ADR-08 — Flow control: three-horizon credit and receipts by need

Status: proposed. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

## Context

Seurat/1 v1.0 has receiver-driven flow control on the wire: `RECIBO.libre` (deliveries the client
accepts now), `RECIBO.cola_ms` (synthesis backlog, which drives the server's traffic light) and
`BIENVENIDA.max_en_vuelo`. But how a client sizes `libre` is left to the implementation, and both
the spec and the code describe it with borrowed algorithms:
- `libre` "es el análogo de la `rwnd` de TCP" (§6.1), sized by Little's law to
  `rate × (1 s + min RTT) / mean delivery` (`entities/delivery/credit.ts`);
- the RTT estimate is described as BBR's windowed `min_rtt` (`sink/min-rtt.ts`);
- `RECIBO` goes out every 8 deliveries or 100 ms (§4.1 step 6, `sink/receipts.ts`), TCP's
  delayed ACK.

The credit ignores two things the client already knows: how fast the view is changing, and how
much synthesis backlog it can still absorb.

## Decision

The wire meaning of `libre` does not change: it counts deliveries, and the server checks it
(§4.1 c). How a conforming client computes it, and when it sends `RECIBO`, become normative.

### Credit: the smallest of three horizons

```
libre   = min( L_mem, max(1, min(L_dec, L_vista, L_pres)) )          (0 if L_mem = 0)
L_mem   = room under max_pinceladas and max_kib, minus what may still arrive      (today's rule, §5.4)
L_dec   = ⌊ max(0, 150 ms − cola_ms) · paralelo / t_dec ⌋          decode room before amber
L_vista = ⌈ tasa · (T_perm + rtt) / tamaño_medio ⌉                  what the current view will use
L_pres  = ⌈ presupuesto · (T_perm + rtt) / tamaño_medio ⌉           only after a REGULACION (ADR-07)
T_perm  = clamp( min(0.5·r / |v|, 0.5 / |v_z|), 0.25 s, 1 s )       how long the current view lasts
```

- `T_perm` comes from the gaze kinematics the client already runs for Horizon (ADR-02's α-β
  filter): `v` is the pan speed in image px/s, `r` the view's half-diagonal, `v_z` the zoom speed in
  octaves/s. A still view gets 1 s, exactly today's `CREDIT_WINDOW_S`. A fast pan shrinks the
  credit to what will still be on screen when it lands. That matters most on the WebSocket mapping,
  where queued deliveries block the new view (head-of-line).
- `L_dec` clocks the credit by the consumer: the client never grants more than its synthesis
  workers drain before reaching the amber threshold, so its own credit no longer trips the
  server's traffic light.
- `rtt` stays the lowest `MIRADA`→first-`PLAN` sample of the last 30 s (`sink/min-rtt.ts` as it
  is). It is a plain windowed minimum, the propagation delay with no queueing in it; the doc
  comment drops the BBR reference. `tasa` and `tamaño_medio` stay as today (`rate-meter`, the mean
  of delivery sizes).
- `cola_ms` is defined as the drain time `(in worker + waiting) · t_dec / paralelo`. That is
  today's measure (`decode-queue.ts`), now normative.
- **No ramp.** Before any measurement, `libre = L_mem`, as today. The server's credit before the
  first `RECIBO` stays a fixed 8. Nothing doubles (no slow start).

**Why the new credit is never larger than today's:** `T_perm ≤ 1 s`, `rtt` is unchanged, and every
new term can only lower the minimum. So the deliveries in flight, and the memory and stale bytes
they carry, are bounded by today's.
**Why the link stays full:** `T_perm ≥ 0.25 s` with `rtt` on top always covers the bandwidth-delay
product `tasa × rtt`.

### Receipts by need (replace "every 100 ms or 8 deliveries")

A client sends `RECIBO` when one of these holds, and only then:

- (a) **the server is about to run dry**: the credit it still has (`granted − arrived`) is no more
  than the deliveries expected within one `rtt`;
- (b) **a state the server acts on changed**: the `cola_ms` band (green < 150 ms, amber, red
  > 400 ms), or `libre` moved by ≥ max(2, 25 %);
- (c) a `RENOVAR` was applied (`renov_hasta`);
- (d) a `RASPADO` or `INVENTARIO` is about to go out (the `SOLTAR` rule of §5.2.3 is unchanged);
- (e) the oldest unacknowledged delivery is 250 ms old.

A late acknowledgement only makes a lease safer (`vence_srv = t_acuse + L + δ`, §8). The server
reads credit from (a) and backlog from (b), so neither waits on (e).

## Deviations from Seurat/1 v1.0

1. §6.1: the way `libre` and `cola_ms` are computed becomes normative. The `rwnd` analogy and the
   Little's-law sizing are replaced by the three horizons.
2. §4.1 step 6: "Acusa con `RECIBO` cada 100 ms o cada 8 entregas" becomes receipts by need.
3. Annex A: the `rwnd` row becomes "consumer-clocked credit".

No wire change: same fields, same meaning, same server checks.

## Budget (series rule)

| Resource | Today | Three horizons + receipts by need |
|---|---|---|
| Deliveries in flight (client memory) | `rate × (1 s + rtt)` | ≤ today in every state (proof above); lower while panning or with a decode backlog |
| Stale bytes when the view changes | Up to 1 s + rtt of the old view | Up to `T_perm` + rtt: lower while moving, equal when still |
| Link use | Full | Full: ≥ the bandwidth-delay product at all times |
| `RECIBO` frames (upstream bytes, server CPU) | ≈ 12.5/s at 100 deliveries/s (every 8); up to 10/s from the 100 ms timer at low rates | ≈ 4/s from (e), plus (a) to (d) events |
| Server credit stalls | Avoided by the "free ≤ 8" flush | Avoided by (a), which tracks the actual `rtt` instead of a fixed 8 |
| Client CPU | Same arithmetic | Same, plus one read of the gaze filter |

## Evaluation gate

Extend the client trace bench (`entities/delivery/__tests__/eviction-sim.ts`, `eviction-traces.ts`)
with a link model (rate, RTT) and a decode model. Compare with today on every trace (still, slow
pan, fast pan, zoom, mixed) for:
- bytes arriving outside the view (must be lower on pan and zoom, ≤ when still);
- stalls (on-screen brushes missing; ≤ the ADR-02 baseline);
- link idle fraction (must be ≤);
- `RECIBO` frames per 1000 deliveries (must be lower);
- amber and red trips of `cola_ms` (must be ≤);
- peak held + in-flight bytes (must be ≤).

## Implementation

- Client: `entities/delivery/credit.ts` (three horizons), `sink/credit-window.ts` (inputs:
  `cola_ms`, parallelism, `T_perm` from `gaze-motion.ts`, the budget from ADR-07),
  `sink/receipts.ts` (triggers a–e), and constants in `shared/config/delivery.ts`. The doc comment of
  `min-rtt.ts` drops the BBR wording.
- Server: no change. Check (c) of §4.1 already enforces any `libre`.
- Tests: `credit.test.ts` and a receipts test, then the bench; `docs/algorithms.md`.
