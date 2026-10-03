# ADR-08 — Flow control: synthesis-clocked credit and receipts by need

Status: accepted. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

The proposal was titled "three-horizon credit". The bench refuted two of its three horizons; this
document records the decision as built and why the other two were dropped (Evidence).

## Context

Seurat/1 v1.0 has receiver-driven flow control on the wire: `RECIBO.libre` (the deliveries the server
may have unsettled, checked in §4.1 c), `RECIBO.cola_ms` (synthesis backlog, which drives the server's
traffic light) and `BIENVENIDA.max_en_vuelo`. How a client sizes `libre` and when it sends `RECIBO`
is left to the implementation, and both the spec and the code describe them with borrowed algorithms:
- `libre` "es el análogo de la `rwnd` de TCP" (§6.1), sized by Little's law to
  `rate × (1 s + min RTT) / mean delivery` (`entities/delivery/credit.ts`);
- the RTT estimate is described as BBR's windowed `min_rtt` (`sink/min-rtt.ts`);
- `RECIBO` goes out every 8 deliveries or 100 ms (§4.1 step 6, `sink/receipts.ts`), TCP's delayed ACK.

The credit ignores what the client knows best: how fast its own synthesis workers drain. A client
with slow workers grants a full second of link, the backlog crosses amber and red, and the server's
traffic light, not the credit, ends up throttling it.

## Decision

The wire meaning of `libre` does not change: it counts deliveries, and the server checks it (§4.1 c).
How a conforming client computes it, and when it sends `RECIBO`, become normative.

### Credit: the link horizon or the synthesis horizon, whichever is smaller

```
libre   = min( L_mem, max(2, min(L_link, L_synth)) )         (L_mem before any measurement)
L_mem   = room under max_pinceladas and max_kib, minus what may still arrive      (§5.4, unchanged)
L_link  = ⌈ tasa · (1 s + rtt) / tamaño_medio ⌉                                   (unchanged)
L_synth = ⌈ 4/3 · (75 ms + rtt) · paralelo / t_job ⌉                              (new)
```

- `L_synth` is what the synthesis workers drain in one round trip plus half the amber threshold
  (75 ms of backlog), grown by a third because a quarter of the window may be waiting for its `RECIBO`
  (below). The client never grants more than its workers drain, so its own credit no longer pushes
  `cola_ms` to amber: the credit is clocked by the consumer.
- `paralelo` is the synthesis pool size and `t_job` the moving mean of one synthesis job, both from
  the meter that already computes `cola_ms` (`decode-queue.ts`). `cola_ms` stays defined as the drain
  time `(in worker + waiting) · t_job / paralelo`, now normative.
- `rtt` stays the lowest `MIRADA`→first-`PLAN` sample of the last 30 s: a plain windowed minimum, the
  round trip with no queueing in it. The doc comment drops the BBR reference.
- **No ramp.** Before any measurement `libre = L_mem`, as today; the server's credit before the first
  `RECIBO` stays a fixed 8. Nothing doubles (no slow start).
- **Never larger than today's:** `L_link` is today's window and every new term only lowers the minimum.

### Receipts by need (replace "every 8 deliveries or 100 ms")

A client sends `RECIBO` when one of these holds, and only then:

- (a) on a landing (a synthesis finished), when the unconfirmed deliveries reach a quarter of the last
  `libre` sent, or when `libre` moved by a quarter (at least 2) since the last one sent;
- (b) when `cola_ms` changes band in a direction the server acts on: into amber (≥ 150 ms), into red
  (> 400 ms), or back to green;
- (c) when a `RENOVAR` was applied (`renov_hasta`), as today;
- (d) when a `SOLTAR`, `RASPADO` or `INVENTARIO` must go after it (the §5.2.3 rule is unchanged);
- (e) when the oldest unconfirmed delivery is 250 ms old.

The quarter in (a) is what the 4/3 of `L_synth` pays for: at most a quarter of the window sits
unconfirmed, so the rest keeps the pipe full. A late acknowledgement only makes a lease safer
(`vence_srv = t_acuse + L + δ`, §8).

## Deviations from Seurat/1 v1.0

1. §6.1: the way `libre` and `cola_ms` are computed becomes normative. The `rwnd` analogy is replaced
   by the link and synthesis horizons.
2. §4.1 step 6: "Acusa con `RECIBO` cada 100 ms o cada 8 entregas" becomes receipts by need (a–e).
3. Annex A: the `rwnd` row becomes "synthesis-clocked credit"; the delayed-ACK row becomes "receipts by need".

No wire change: same fields, same meaning, same server checks. The server is untouched.

## Budget (series rule)

| Resource | v1.0 | Synthesis horizon + receipts by need |
|---|---|---|
| Client memory per sink | — | 0 B: two getters on the existing decode meter |
| Deliveries in flight (opened, not synthesized) | `tasa × (1 s + rtt)` | ≤ v1.0 always (the minimum only shrinks); peak in-flight bytes −59 % to −88 % when synthesis is the bottleneck |
| Downstream bytes | stale deliveries for views already left | −2.0 % over the bench (−11 % stale bytes) |
| Upstream bytes (`RECIBO`, ≈ 12 B each) | 146–301 per 1000 deliveries | 69–171 per 1000 with fast workers; 260–469 per 1000 when slow workers bind (≈ +28 KB over the LAN run, against 23 MB less downstream) |
| Client CPU | same arithmetic | same, plus one comparison per landing and per worker answer |
| Server | — | no change |

## Evidence

`client/src/entities/delivery/__tests__/flow-bench.test.ts` (with `flow-sim.ts` and `flow-policies.ts`):
a 1 ms replay of six gaze traces (`still` and the five ADR-02 traces) through:
- the server's gates as built: a plan per `MIRADA` (core with ancestors, nearest first, then the 2×
  ring), gate (c) `unsettled < libre` (8 before the first `RECIBO`), 12 flow slots (6 amber, none red),
  the WebSocket writer (control first, one message at a time) and a kernel send buffer;
- a link (rate, one-way delay, send buffer): `lan` 40 MiB/s · 1 ms · 256 KiB, `wan` 4 MiB/s · 40 ms ·
  256 KiB, `slow` 1 MiB/s · 100 ms · 128 KiB;
- the client's real `DecodeQueue`, `MinRtt` and `RateMeter` and a synthesis pool: `fast` 4 workers,
  3 ms + 0.08 ms/KiB; `slow` 2 workers, 10 ms + 0.5 ms/KiB;
- brushes of 8–64 KiB, fixed per tile.

The sizes and job times are a model, not a measurement. The arms are v1.0 (the retired receipt rule
and `receiverWindow` without the synthesis term) and ADR-08 through the client's own `receiverWindow`,
`receiptDue` and `bandChanged`.

**Noise.** The replay is chaotic: moving v1.0's 100 ms timer by 1 ms moves the stalls of one group by
5.4 % and its stale bytes by 13 %. The gate therefore allows the larger of 1 % and what those ±1 ms arms
moved; a difference inside it is noise.

Totals per link/decoder over the six traces (v1.0 → ADR-08). Stalls: core tiles missing, summed over the
50 ms frames. Bubbles: ms with demand waiting while the link and a worker both sat idle.

| Group | Stalls | Bubbles (ms) | Stale MB | Peak in flight MB | Wire MB | Amber / red trips | `RECIBO` per 1000 |
|---|---|---|---|---|---|---|---|
| lan / fast | 4000 → **3648** | 131 → **0** | 4.5 → **3.4** | 7.55 → **3.13** | 449.7 → 449.9 | 16 / 0 → **0 / 0** | 146 → **69** |
| lan / slow | 28232 → **16699** | 35 → **1** | 3.3 → **0.05** | 4.07 → **0.50** | 309.2 → **285.9** | 247 / 134 → **0 / 0** | 178 → 469 |
| wan / fast | 13826 → **13623** | 1025 → **658** | 65.4 → 65.7 | 1.07 → 1.07 | 329.9 → 330.2 | 0 / 0 → 0 / 0 | 184 → **88** |
| wan / slow | 25976 → **19678** | 657 → **252** | 47.9 → **28.5** | 2.02 → **0.76** | 297.4 → **286.0** | 246 / 161 → **79 / 0** | 191 → 260 |
| slow / fast | 65934 → 66022 | 685 → **620** | 48.3 → 47.9 | 0.85 → 0.85 | 186.2 → 186.4 | 0 / 0 → 0 / 0 | 301 → **171** |
| slow / slow | 66783 → **66064** | 810 → 898 | 48.2 → **47.2** | 0.88 → 0.88 | 186.0 → **185.6** | 0 / 0 → 0 / 0 | 294 → **163** |
| **All** | 204751 → **185734 (−9.3 %)** | 3343 → **2428 (−27 %)** | 217.6 → **192.7 (−11 %)** | | 1758.5 → **1724.0 (−2.0 %)** | 509 / 295 → **79 / 0** | |

The gate the bench asserts on every run:
- in every group, every column above except `RECIBO` count is ≤ v1.0 plus the noise tolerance;
- with a slow decoder on `lan` and `wan`: at least a fifth fewer stalls, and no red trip;
- the one known cost, below, stays within 15 % and is paid with fewer stalls.

**Accepted costs.**
- `slow / slow` bubbles +11 % (88 ms over six traces). On a 1 MiB/s link the loop also runs through the
  server's 12 open flows and its send buffer, which the minimum round trip leaves out, so `L_synth`
  sometimes leaves the link idle. What it holds back is ring prefetch: stalls still fall 1.1 %, 19 times the
  noise, and stale bytes fall.
- When slow workers bind, `RECIBO` frames rise to 260–469 per 1000 deliveries: a tight window needs
  frequent confirmations. Total wire bytes still fall in those groups (−11 MB and −23 MB).
- `wan / fast` stale bytes +0.3 MB (+0.5 %, inside the tolerance): the bubbles fall 36 %, so the link
  carries more, some of it for views just left.

**What the bench refuted** (the proposal and the variants tried on the way, same bench):
- **`L_vista`** (`tasa · (T_perm + rtt)`, with `T_perm` from the gaze speed, 0.25–1 s). The stale bytes it
  saves are mostly bounded already by the server's 12 open flows and send buffer, which a window cannot
  reach. Its 0.25 s floor starves the pipe when a fling lands: bubbles 6048 ms against 2270 ms without it
  (v1.0: 3343). Dropped.
- **`L_pres`** (`presupuesto · (T_perm + rtt)` from `REGULACION`). When the Painter is the bottleneck,
  the window never binds, so capping it changes nothing. Dropped; `REGULACION` stays informational on the
  client.
- **`L_dec` as proposed** (`(150 ms − cola_ms) · paralelo / t_dec`). It counted the decode queue twice (the
  window already contains it) and ignored what is still on the way: up to 2479 ms of bubbles on one trace,
  and, moving with every `cola_ms` reading, a `RECIBO` per delivery (987–996 per 1000). Replaced by `L_synth`.
- **Receipts as proposed** ("granted − arrived ≤ one rtt of deliveries" for (a)). Today's 100 ms timer with the
  new window gives 2310 ms of bubbles on `lan / slow`; a quarter of the window is what keeps it fed.
- **A 150 ms backlog target** instead of 75 ms: 906 amber trips. **Half-window batches** (gain 2): 1849.
- **Applying `L_synth` only while synthesis is slower than the link**, or adding the open flows' drain
  time to its loop: both read the measured link rate, which the window itself censors. They oscillated
  and brought back 23–97 red trips on `lan / slow`.

## Implementation

- Client:
  - `entities/delivery/credit.ts`: `synthesisHorizon` and the optional `synthesis` input of `receiverWindow`;
  - `entities/delivery/receipt-need.ts`: `queueBand`, `bandChanged`, `receiptDue`;
  - `entities/delivery/decode-queue.ts`: the `jobMs` and `workers` getters;
  - `sink/credit-window.ts` passes the synthesis input; `sink/receipts.ts` sends by need, and its timer
    measures the oldest unconfirmed delivery; `sink/synth-result.ts` and `sink/ingest.ts` call
    `onQueueChange` when the backlog may have changed band;
  - constants in `shared/config/delivery.ts` (`CREDIT_QUEUE_TARGET_MS`, `CREDIT_BATCH_GAIN`,
    `RECEIPT_BATCH`, `RECEIPT_MOVE`, `RECEIPT_MOVE_MIN`, `RECEIPT_MAX_AGE_MS`); `RECEIPT_EVERY_N`,
    `RECEIPT_EVERY_MS` and `COLA_BUSY_MS` are gone. `min-rtt.ts` drops the BBR wording.
- Server: no change. Check (c) of §4.1 already enforces any `libre`.
- Tests: `credit.test.ts`, `receipt-need.test.ts`, and the bench.

## Consequences

- The credit is clocked by the consumer: a client grants what its workers drain, and the server's traffic
  light becomes a backstop (red trips 295 → 0 over the bench).
- A `RECIBO` carries news: a quarter of the window, a moved window, a band change, a renewal, or a
  250 ms-old delivery.
- Stale bytes are now bounded mainly by the server's open flows, which a client window cannot reach; a
  later change on the server side (cancelling queued flows of a superseded plan) is where more would come from.

## Amendment (2026-10-03): Slow-link responsiveness and clean inputs (ADR-08a)

On slow, throttled links (such as the 33 kB/s 3G DevTools profile on ultra-high-resolution images), a pan
experienced 3.2–9.4 s of delay before refining. The formula `⌈rate · (1 s + rtt) / avg⌉` remained mathematically
sound, but the inputs fed into it were contaminated:
1. **Unmeasured opening credit**: before the link was measured, `libre` defaulted to the whole memory window
   (`L_mem`), causing the server to dump an entire plan onto a link that could not carry it without seconds of queuing.
2. **Rate overstatement from blockiness**: measuring peak bytes in a rolling 1-second window counts deliveries when they
   finish; when a delivery is 25–48 KiB on a 33 kB/s link, a single boundary crossing overstates the true link rate.
3. **Queue-polluted RTT**: round-trip time sampled from `MIRADA` to `PLAN` was measuring its own standing link queue,
   hitting the 4 s cap and causing credit inflation.

### Decision

Keep the ADR-08 credit and synthesis formulas unchanged; fix the three inputs:
- **`CREDIT_UNMEASURED = 8`**: before the link is measured, `libre = min(L_mem, 8)`, matching the server's own opening
  credit (§4.1 c) so slow links are not handed excessive credit at the start.
- **`ArrivalRate` / `linkRate`**: track the median inter-arrival spacing (`bytes / gap`) over the last 16 deliveries
  (`ARRIVAL_SAMPLES`), requiring at least 8 (`ARRIVAL_MIN_SAMPLES`). `linkRate` uses `min(peakBps, arrivalBps)`.
- **Clean RTT samples**: only sample RTT from views dispatched when no standing delivery queue is in flight, avoiding
  self-induced delay spikes.

### Evidence & Benchmarks

Benchmarked in `credit-bench.test.ts` (with `flow-sim.ts` and `credit.json`):
- **3G links (`dt3g/fast`, `dt3g/slow`)**:
  - `planLagMs` reduced from 3287 ms / 3264 ms to 2525 ms / 2506 ms (**−23.2 %, −760 ms**).
  - Stale bytes reduced from 4.2 MB to 3.3 MB (**−20.3 % to −22.3 %, −0.9 MB**).
  - First-zoom delay in browser testing fell from 6.33 s to **0.52 s** (`init=8`).
- **All other links (`far`, `lan`, `slow`, `wan`)**:
  - Strict invariants preserved; zero degradation on stalls, starved time, or transit across all fast/slow decoder profiles.

