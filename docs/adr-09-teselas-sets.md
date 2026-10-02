# ADR-09 — Sets on the wire: `Teselas` (replaces SACK ranges)

Status: proposed. Date: 2026-10-02. Series: ADR-06 to ADR-10 (series rule in ADR-06: no ADR may
increase memory, wire bytes or latency on any bench trace, and each must improve one).

## Context

Every set of delivery numbers in Seurat/1 v1.0 uses `Rangos`, QUIC's ACK-range layout (§3.3,
RFC 9000 §19.3.1): `mayor · n_huecos · primer_rango · (hueco · largo_rango)×`. It appears in
`RECIBO`, `SOLTAR`, `RENOVAR`, `RASPADO`, `INVENTARIO`, `PLAN CANCELADAS`, `RASPAR LISTA` and the
`REANUDAR` claim. The code calls it SACK (`core/shared/proto/Ranges.java`, `RangesCodec.java`,
`client/src/shared/proto/ranges.ts`), and Annex A traces it to "SACK y rangos de ACK". SACK is on
the professor's list.

These sets are not acknowledgements that drive retransmission (ADR-06 removes that). They are
sets for loan accounting, compared by exact equality (hard rule 5). Their weak case is the
scattered set. Horizon evicts leaves (ADR-02), and leaves interleave with their parents in paint
order. So `SOLTAR`, `INVENTARIO` and `RASPADO` after evictions are full of isolated numbers, and
each isolated number costs a `(hueco, largo)` pair.

## Decision

`Teselas`: one set codec with two forms. The encoder writes both and sends the smaller; on a tie
it sends the run form. The choice is deterministic, so equal sets give equal bytes and golden
vectors stay exact.

```
Teselas  run form    vi menor (≥ 1) · vi n_saltos · vi primer_largo · (vi salto · vi largo) × n_saltos
                     first run [menor, menor + primer_largo]; each next run starts at
                     previous end + salto + 2 and holds largo + 1 numbers (ascending)
         block form  vi 0 · vi menor (≥ 1) · vi n_bloques · bloque × n_bloques
                     block b holds menor + 64b … menor + 64b + 63
         empty set   vi 0 · vi 0
bloque   vi cab · cuerpo
         cab & 3 = 0 SALTO    (cab >> 2) empty blocks                      no body
                   1 LLENO    (cab >> 2) full blocks                       no body
                   2 MAPA     one block, u64 little-endian: bit i ⇒ menor + 64b + i
                   3 TRAMOS   one block, (cab >> 2) runs: (u8 desde · u8 largo − 1) × runs
```

Inside the block form each block takes the smallest of its containers (ties: MAPA, then TRAMOS);
runs of empty or full blocks merge into one SALTO or LLENO. A decoder tells the forms apart by the
first value, since delivery numbers start at 1.

**Never larger than `Rangos`, for every set:**
- The run form is the ascending mirror of `Rangos`: `salto` carries the value `Rangos` calls
  `hueco`, `largo` is the same, both in the same varints, and `menor ≤ mayor`. So it is never
  longer.
- The block form is sent only when it is shorter still.
- The empty set takes 2 bytes, against `Rangos`' 3 (`00 00 00`).

| Set | `Rangos` | `Teselas` |
|---|---|---|
| empty | 3 B | 2 B |
| `[1, 256]` | 5 B | 4 B (run form) |
| 8 deliveries in a row near 5000 (a typical `RECIBO`) | 4 B | 4 B |
| 20 isolated numbers within 64 (eviction leaves) | ≈ 40 B | 12 B (block form, one MAPA) |

**In memory.** The server's `Ranges` keeps a `TreeSet<Long>`, about 40 B per number. It moves to
the same 64-number blocks: a `long` bitmap per block, plus run spans for full stretches. The
client's settled set (`entities/delivery/settlement.ts`, today a floor plus a `Set`) uses the same
blocks. One set structure for the wire and the accounting.

## Deviations from Seurat/1 v1.0

1. §3.3: with the capability bit `0x08 TESELAS` (offered in `SALUDO.caps`, confirmed in
   `BIENVENIDA.caps`), every `Rangos` field is encoded as `Teselas`. This changes the encoding of
   core fields inside version 1, which §3.5 reserves for a major version. It is accepted as a
   deviation, behind the capability bit.
2. §3.4: the set bytes of the golden examples are superseded by vectors in this ADR's appendix,
   generated when this ADR lands and tested on both sides. Every other byte of the goldens is
   unchanged, and hard rule 1 keeps applying to them.
3. Annex A: the "SACK y rangos de ACK" row becomes "adaptive set containers (runs or bitmaps)".

## Budget (series rule)

| Resource | `Rangos` | `Teselas` |
|---|---|---|
| Wire bytes per set | — | ≤ `Rangos` for every set (shown above); much lower for scattered sets |
| Server memory per set | ≈ 40 B per number (`TreeSet<Long>`) | ≤ 8 B per 64 numbers in a bitmap block; a span for runs |
| Encode CPU | One pass over spans | Two passes (run form and block form), both linear: within a few microseconds for sets of thousands |
| Decode CPU | Linear | Linear; bitmaps decode a word at a time |

## Evaluation gate

Sets recorded from the ADR-02 and ADR-08 traces (`RECIBO`, `SOLTAR`, `INVENTARIO`, `RASPADO`,
`RENOVAR`), plus the §3.4 examples. Compare with `Rangos` on:
- bytes per set (must be ≤ for every set, by construction, and the bench asserts it);
- bytes per trace (must be lower on eviction traces);
- encode and decode time (must be ≤ per trace on both sides);
- peak heap of the server's set objects during an audit (must be lower).

## Implementation

Last of the series: it is the only wire change to existing fields.
- Server: `core/shared/proto` gets the `Teselas` codec and block-backed sets. `Ranges` and
  `RangesCodec` are replaced (each file < 150 LoC). The caps bit goes in the `SALUDO`/`BIENVENIDA`
  codecs.
- Client: the `shared/proto` codec; `settlement.ts` on blocks.
- Goldens: the appendix vectors, on both sides. Retire the test names and comments that say SACK.
- Docs: `docs/algorithms.md`, and the `seurat-client` and `seurat-protocol` skills.

## Appendix: golden vectors

To be generated when this ADR lands. They cover the §3.4.1–3.4.4 sets in both forms, the empty
set, and one MAPA and one TRAMOS block.
