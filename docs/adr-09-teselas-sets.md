# ADR-09 — Sets on the wire: `Teselas` (replaces SACK ranges)

Status: accepted. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

## Context

Every set of delivery numbers in Seurat/1 v1.0 uses `Rangos`, QUIC's ACK-range layout (§3.3,
RFC 9000 §19.3.1): `mayor · n_huecos · primer_rango · (hueco · largo_rango)×`. It appears in
`RECIBO`, `SOLTAR`, `RENOVAR`, `RASPADO`, `INVENTARIO`, `PLAN CANCELADAS`, `RASPAR LISTA` and the
`REANUDAR` claim. The code called it SACK (`Ranges.java`, `RangesCodec.java`, `ranges.ts`), and
Annex A traces it to "SACK y rangos de ACK". SACK is on the professor's list.

These sets are not acknowledgements that drive retransmission (ADR-06 removed that). They are
sets for loan accounting, compared by exact equality (hard rule 5). Their weak case is the
scattered set. Horizon evicts leaves (ADR-02), and leaves interleave with their parents in paint
order. So `SOLTAR`, `INVENTARIO` and `RENOVAR` after evictions are full of isolated numbers, and
each isolated number costs a `(hueco, largo)` pair. In memory the server held every set as a
`TreeSet<Long>`: a tree node and a boxed `Long` per number.

## Decision

`Teselas`: one set codec with two forms, for every peer. The encoder computes both and sends the
shorter; on a tie it sends the run form. The choice is a function of the set, so equal sets give
equal bytes and golden vectors stay exact.

```
Teselas  empty set   vi 0 · vi 0
         run form    vi menor (≥ 1) · vi n_saltos · vi primer_largo · (vi salto · vi largo) × n_saltos
                     first run [menor, menor + primer_largo]; each next run starts at the previous run's
                     last number + salto + 2 and holds largo + 1 numbers (ascending)
         block form  vi 0 · vi menor (≥ 1) · vi n_piezas · pieza × n_piezas
                     block b holds menor + 64b … menor + 64b + 63; the pieces cover blocks 0, 1, 2… in order
pieza    vi cab · cuerpo
         cab & 3 = 0 SALTO    (cab >> 2) empty blocks                                 no body
                   1 LLENO    (cab >> 2) full blocks                                  no body
                   2 MAPA     one block: u64 little-endian, bit i ⇒ menor + 64b + i
                   3 TRAMOS   one block: (cab >> 2) runs of u8 desde · u8 (largo − 1), inside the block
```

The decoder tells the forms apart by the first varint (delivery numbers start at 1). Inside the
block form, consecutive empty or full blocks merge into one `SALTO` or `LLENO`; any other block is
`TRAMOS` when that is strictly shorter than `MAPA` (at most 3 runs), else `MAPA`. A decoder accepts
any well-formed bytes, also a form the encoder would not have chosen. Malformed sets (a `TRAMOS` run
leaving its block, a truncated `MAPA`, more than 2^20 numbers, a number past 2^62) are fatal `ERROR 1`
as before; the count limit is checked before a run or a `LLENO` is expanded.

**Never longer than `Rangos`, for every set:**
- The run form is the ascending mirror of `Rangos`: `salto` carries the value `Rangos` calls
  `hueco`, `largo` is the same, both in the same varints, and `menor ≤ mayor`. So it is never
  longer, and the block form is sent only when it is shorter still.
- The empty set takes 2 bytes, against `Rangos`' 3 (`00 00 00`).

| Set | `Rangos` | `Teselas` |
|---|---|---|
| empty | 3 B | 2 B |
| `[1, 256]` (§3.4.3 `RASPADO`) | 5 B | 4 B (run form; the block form `00 01 01 11` ties) |
| `[45, 51] ∪ [53, 60]` (§3.4.2 `RECIBO`) | 5 B | 5 B |
| 20 isolated numbers within 64 (evicted leaves) | 41 B | 12 B (block form, one `MAPA`) |

**Every peer, no capability bit.** The proposal put `Teselas` behind a caps bit `0x08` with `Rangos`
as the fallback. Dropped: the fallback would keep the SACK layout in the protocol, which is what
this ADR removes; the `REANUDAR` claim travels in `SALUDO`, before any caps are confirmed; and
two codecs on both ends is the duplication hard rule 3 forbids. Both ends of this repository
change together, so there is no older peer to keep.

**In memory.** The server's `Ranges` keeps sorted 64-number blocks: the block keys `n >>> 6` and a
`long` bitmap per non-empty block, 16 B per block. Membership is a binary search plus a bit test; the
builder ORs one mask per block, so a range costs one step per 64 numbers. The client's sets stay
plain arrays: they are short-lived (built, encoded, sent), and its settled set is already a floor
plus the few numbers above it (`entities/delivery/settlement.ts`), so blocks would not shrink it.

## Deviations from Seurat/1 v1.0

1. §3.3: every `Rangos` field is encoded as `Teselas`. This changes the encoding of core fields
   inside version 1, which §3.5 reserves for a major version; it is accepted as a deviation, and
   both ends of this repository implement only `Teselas`.
2. §3.4: the set bytes of the golden examples are superseded by the vectors in the appendix. Every
   other byte of the goldens is unchanged, and hard rule 1 keeps applying to them; three frames get
   one byte shorter.
3. §3.3 "Por qué rangos": the argument holds for `Teselas` (exact equality, few bytes); the 5-byte
   `RASPADO` of §3.4.3 becomes 4 bytes.
4. Annex A: the "SACK y rangos de ACK" row becomes "run-length intervals and 64-number bitmap
   containers (Roaring-style)".

## Budget (series rule)

| Resource | `Rangos` | `Teselas` |
|---|---|---|
| Wire bytes per set | — | ≤ `Rangos` for every set (asserted on every recorded set); −16.9 % over the bench corpus |
| Server memory per set | 62–72 B per number (`TreeSet<Long>`) | 0.3–0.9 B per number (16 B per non-empty block of 64); 9.5 B for an 8-number receipt |
| Client encode CPU | 28.0 ms over the corpus | 12.6 ms |
| Client decode CPU | 6.3 ms | 6.1 ms |
| Server encode CPU, per shape | `Rangos` over a `TreeSet` | 0.04× to 0.81× |
| Server decode CPU, per shape | `Rangos` into a `TreeSet` | 0.005× to 0.45× |

## Evidence

**Bytes and client time.** `client/src/entities/delivery/__tests__/teselas-bench.test.ts` records the
sets the benches put on the wire and encodes each as `Rangos` (`shared/proto/testing/rangos-ref.ts`,
the v1.0 codec kept as the baseline) and as `Teselas`:
- `soltar` (one per eviction pass or lease sweep) and `held` (the whole book at each renewal: what
  `RENOVAR`, `INVENTARIO` or a claim carries) from the ADR-02 eviction replay (`eviction-sim.ts`,
  real §5.2.3 filter and Horizon ranker), five traces at `max_pinceladas` 128 and 256;
- `recibo` from the ADR-08 flow replay (`flow-sim.ts`) with the server's centred cone (ADR-10), six
  traces on three links and two decoders.

10141 sets, 166803 numbers. Every set decodes back to itself and is never longer than `Rangos`.

| Trace | `RECIBO` | `SOLTAR` | Held book |
|---|---|---|---|
| `pan` | 10442 → 10432 B (−0.1 %) | 4002 → 2374 B (−40.7 %) | 5002 → 3669 B (−26.6 %) |
| `panReturn` | 3296 → 3289 (−0.2 %) | 4076 → 2595 (−36.3 %) | 5398 → 4676 (−13.4 %) |
| `zoomDive` | 5311 → 5304 (−0.1 %) | 2454 → 2045 (−16.7 %) | 4310 → 3810 (−11.6 %) |
| `hotspots` | 6812 → 6802 (−0.1 %) | 15643 → 9698 (−38.0 %) | 6241 → 5537 (−11.3 %) |
| `randomWalk` | 11688 → 11675 (−0.1 %) | 7770 → 5610 (−27.8 %) | 9493 → 7027 (−26.0 %) |
| `still` | 828 → 822 (−0.7 %) | — | — |
| **All** | | | 102766 → 85365 B (−16.9 %) |

`RECIBO` sets are a few consecutive deliveries: the run form wins and saves a byte only where `menor`
takes a shorter varint than `mayor` (or the set is empty). The gain is where the proposal put it: the
sets eviction leaves scattered take the block form (63 of 63 `SOLTAR` on `pan`, 240 of 240 on
`hotspots`).

Codec time over the whole corpus, fastest of 7 passes (Node, the client codecs): encode 28.0 ms
(`Rangos`) → 12.6 ms (`Teselas`), decode 6.3 → 6.1 ms. The first `Teselas` encoder was 25 % slower
than `Rangos` (both forms built in arrays, varints through `BigInt`); it now writes plain numbers
(`viPush`) and skips the dedupe and sort when its input is already ascending.

**Server memory and time.** `server/test/seurat/core/shared/proto/TeselasBenchTest.java` compares
the block set and `TeselasCodec` with the v1.0 `TreeSet<Long>` and `Rangos` (`RangosRef.java`) on
four shapes: `book` (the sketch 1–44 and 400 leaves interleaved with parents), `run` (1–5000),
`evicted` (150 alternate numbers), `receipt` (8 in a row). Heap is the retained size of 300 copies.

| Shape | Bytes | Heap per number | Encode | Decode |
|---|---|---|---|---|
| `book` | 580 → 152 B | 61.7 → 0.7 B | 5235 → 3447 ns | 15510 → 2312 ns |
| `run` | 5 → 4 B | 63.8 → 0.3 B | 30113 → 1335 ns | 288691 → 1464 ns |
| `evicted` | 303 → 49 B | 64.5 → 0.9 B | 2152 → 1751 ns | 4487 → 1121 ns |
| `receipt` | 4 → 4 B | 72.5 → 9.5 B | 70 → 42 ns | 121 → 55 ns |

Time is the fastest of 7 passes after a warm-up (Java 21, one run; three runs agree within 15 %).
Decoding a run costs one mask per 64 numbers instead of a boxed `Long` and a tree insert per number.
The first server encoder built both forms in full through a `List` of spans and a
`ByteArrayOutputStream`, and was 1.8× slower than v1.0 on `book` and `evicted`. It now walks the
set's spans twice without allocating, first measuring both forms and then writing only the winner
(`TeselasRunWalker`, `TeselasBlockWalker`), with a fast path for a span inside one block.

The bench asserts, per shape: `Teselas` bytes ≤ `Rangos`, block heap < `TreeSet` heap (not for the
8-number receipt), encode and decode time ≤ v1.0 with 10 % for timer noise.

**Agreement.** Both sides test the appendix vectors; 5000 random sets (1952 in block form) encoded
by the client and by the server gave identical bytes.

## Implementation

- Server: `core/shared/proto/TeselasCodec.java` (choice, run-form decode), `TeselasRunWalker.java` and
  `TeselasBlockWalker.java` (measure, then write the winner), `TeselasBlocks.java` (block-form decode); `Ranges.java` + `RangesBits.java` on 64-number blocks, same public API (adds
  `smallest()` and the package-private `forEachSpan`); `RangesCodec.java` removed; `SeuratConstants.TESELAS_MAX_NUMBERS` (was
  `RANGES_MAX_NUMBERS`).
- Client: `shared/proto/teselas.ts`, `teselas-blocks.ts`; `Reader.teselas()`; `viPush` in
  `varint.ts`; `ranges.ts` removed; `TESELAS_MAX_NUMBERS` in `shared/config/protocol.ts`.
- Tests: `TeselasTest.java`, `teselas.test.ts` (appendix vectors, forms, limits, round trips);
  the golden frames of `GazeGoldensTest`, `ScrapeGoldensTest` and `goldens.test.ts`; the two benches.
- Docs: `docs/algorithms.md`, `AGENTS.md`, the `seurat-client` and `java-guardrails` skills.

## Consequences

- No SACK or ACK-range layout is left in the protocol or the code.
- On the eviction traces, `SOLTAR` sets cost 17–41 % less on the wire and held-book sets 11–27 % less;
  no set costs more.
- The server's sets take 16 B per 64 numbers instead of a tree node per number, so a renewal or an
  audit of a large book no longer allocates per number.
- A peer that speaks only Seurat/1 v1.0 `Rangos` cannot talk to this server. The version number stays 1;
  the deviation is listed above.

## Appendix: golden vectors

Tested byte for byte on both sides (`TeselasTest.java`, `teselas.test.ts`); `odd` = 1, 3, 5 … 39.

| Set | `Teselas` | Form |
|---|---|---|
| empty | `00 00` | empty |
| `[45, 51] ∪ [53, 60]` (§3.4.2 `RECIBO`) | `2d 01 06 00 07` | run |
| `[285, 289]` (§3.4.3 `PLAN CANCELADAS`) | `41 1d 00 04` | run |
| `[1, 256]` (§3.4.3 `RASPADO`) | `01 00 40 ff` | run (ties block `00 01 01 11`) |
| `[1, 256] ∪ [290, 336]` (§3.4.4 `RENOVAR`, claim) | `01 01 40 ff 20 2e` | run |
| `odd` | `00 01 01 02 55 55 55 55 55 00 00 00` | block: `MAPA` |
| `odd ∪ [70, 80]` | `00 01 02 02 55 55 55 55 55 00 00 00 07 05 0a` | block: `MAPA`, `TRAMOS` |
| `odd ∪ {1000}` | `00 01 03 02 55 55 55 55 55 00 00 00 38 07 27 00` | block: `MAPA`, `SALTO` 14, `TRAMOS` |
| `[1, 128] ∪ (odd + 128)` | `00 01 02 09 02 55 55 55 55 55 00 00 00` | block: `LLENO` 2, `MAPA` |

Decoded but never chosen: `00 01 01 11` ⇒ `[1, 256]`; `00 2d 01 0b 00 06 08 07` ⇒ `[45, 51] ∪ [53, 60]`.

Golden frames (only the set bytes and the lengths change):

| Frame | v1.0 | ADR-09 |
|---|---|---|
| §3.4.2 `RECIBO` | `26 0a 01 3c 01 07 00 06 28 42 c4 00` | `26 0a 01 2d 01 06 00 07 28 42 c4 00` |
| §3.4.3 `PLAN CANCELADAS` | `23 07 01 0c 02 41 21 00 04` | `23 07 01 0c 02 41 1d 00 04` |
| §3.4.3 `RASPADO` | `25 0d 01 03 03 41 21 1c 40 d8 41 00 00 40 ff` | `25 0c 01 03 03 41 21 1c 40 d8 01 00 40 ff` |
| §3.4.4 `RENOVAR` | `28 0b 01 0c 40 78 41 50 01 2e 20 40 ff` | `28 0a 01 0c 40 78 01 01 40 ff 20 2e` |
| §3.4.4 `SALUDO` with `REANUDAR` | `largo` 89, TLV `01 31` | `largo` 88, TLV `01 30` |
| `RECIBO` with nothing new | `01 00 00 00 28 42 c4 00` | `01 00 00 28 42 c4 00` |
