# Algorithms in protocol-seurat

This file catalogues the algorithms in the server (Java, `server/src/seurat/`) and in the client
(TypeScript/React, `client/src/`). For each one it gives:

- what it is called, and whether it is a known algorithm;
- how it works, in short;
- where it lives;
- what it does in the system.

Paths are relative to `server/src/seurat/` for the server and to `client/src/` for the client.
Formulas and constants come from the code. When code and spec disagree, the spec
(`Seurat protocol-3.md`) wins.

Each entry is tagged with one of three kinds:

- **Known**: a published or standard algorithm, used as described in the literature or the RFC.
- **Adapted**: a known algorithm or technique, applied here with project-specific inputs or rules.
- **Project**: a procedure designed for this project (usually to implement a spec rule). It is
  real logic, but it has no name outside this codebase.

The last column of every table, **Seurat/1**, says whether the algorithm is part of the protocol itself, that is, defined by `Seurat protocol-3.md` (Seurat/1 v1.0):

- `● §x`: the spec defines or mandates it, in section x. Whichever side runs it (server, client or both) must behave this way to follow the spec. `(ADR-05)` after the section means ADR-05 changed part of that rule.
- `◐ ADR-x`: the spec defines a rule here, and an accepted ADR replaces it (Horizon eviction replaces the LRU of spec §5.2, ADR-02).
- `—`: not part of the protocol. It is an implementation choice of this server or client (decoders, intake, rendering, caches, gestures) and could change without touching the wire.

Plain plumbing (open queues, transport fallback, memory polling, loader animation, context-loss
handling, …) is not listed.

Several algorithms run on both sides as mirrored halves of one codec or wire format, for example
forward on the server and inverse on the client. They are listed once per side and summarised in
[Shared algorithms](#3-shared-algorithms-server--client).

---

## 1. Server (Java)

### 1.1 Image codec and compression

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **YCoCg-R colour transform**<br>*Known* (Malvar & Sullivan, 2003) | Integer lifting: `Co = R − B`, `t = B + (Co>>1)`, `Cg = G − t`, `Y = t + (Cg>>1)`. The inverse is exact. | `core/shared/codec/YCoCgR.java` (`forwardRow`), `core/works/ingest/BandFeeder.java` | Decorrelates RGB into luma and chroma losslessly, so chroma can be quantised harder than luma. | ● §2.1 |
| **Integer Haar S-transform by lifting**<br>*Known* (S-transform; lifting, Sweldens 1996) | On each 2×2 block: `l1=(a+b)>>1, h1=a−b`, the same for the second row, then `S=(l1+l2)>>1, V=l1−l2, H=(h1+h2)>>1, D=h1−h2`. Integer and reversible. Row slices run in parallel. | `core/shared/codec/TransformS.java` (`blockForward`) | Builds the S-pyramid. Each stratum is the mean image of the one below it. H/V/D are the detail a brush carries to rebuild the finer stratum. | ● §2.1 |
| **S+P prediction**<br>*Adapted* (Said & Pearlman, 1996) | Predicts the detail from the neighbouring means: `Ĥ = (S[x−1] − S[x+1] + 2) >> 2`, `V̂` the same way vertically, D not predicted. Open loop, with the border replicated. Only the residual is coded. Simpler than the paper's predictor set. | `core/shared/codec/PredictSP.java`, inlined in `core/shared/codec/BrushEncoder.java` | Removes the predictable part of the detail, which lowers entropy before quantisation. | ● §2.1 |
| **Dead-zone uniform quantisation**<br>*Known* (as in JPEG 2000) | `i = x / q`, truncating toward zero, which leaves a dead zone around 0. The reconstruction is `sign(i)·(abs(i)·q + q/2)`. Steps per plane and stratum: table 1 is Y (6,4,2,1) and C (0,6,3,2); table 2 is stratum 0 at q=2, coarser strata lossless. | `core/shared/codec/Quant.java` | Controls loss. Small detail becomes zero and costs almost nothing after DEFLATE. | ● §2.1 |
| **Energy ranking into significance bands**<br>*Project* (with LSD radix sort, *Known*) | Per parent (one 2×2 group of detail): `E = Σ_c w_c·(abs(qH) + abs(qV) + abs(qD))`, with weight 2 for Y and 1 for Co and Cg (chroma is skipped when its q is 0). Parents are sorted by E descending, ties by Morton ascending, with a stable LSD radix sort on `max − E` (11-bit digits). Bands are cut at 1/8, 1/8, 1/4 and 1/2 of the parents. Parents with E = 0 are left out. | `core/shared/codec/BandSplit.java`, `core/shared/codec/BandsOrder.java` | Orders a brush's detail by importance into 4 bands. Each extra band sharpens the image, so resolution can be raised or lowered one band at a time. | ● §2.1 |
| **Morton (Z-order) encoding**<br>*Known* (Morton, 1966) | Interleaves the bits of (x, y). Parent = `m >> 2`, child k = `(m << 2) + k`. A precomputed `PARENTS_16K` table holds the Morton code of each of a brush's 128×128 parents, used for band ordering. Brush id = `stratum << 56` plus the Morton code. | `core/shared/codec/Morton.java`, `core/shared/codec/BrushId.java` (`parentCapped`) | Gives a brush id that sorts with spatial locality and makes parent/child arithmetic O(1). | ● §2.1 |
| **Zigzag + unsigned LEB128**<br>*Known* (zigzag from Protocol Buffers; LEB128 from DWARF) | Zigzag maps signed to unsigned: `(n << 1) ^ (n >> 31)`. LEB128 writes 7 bits per byte, with the high bit meaning "more follows". | `core/shared/proto/Leb128.java` | Compact integers: small residuals take one byte. | ● §2.1, §3.2 |
| **DEFLATE raw**<br>*Known* (RFC 1951) | LZ77 plus Huffman, through `java.util.zip.Deflater` with `nowrap`. Each thread reuses its own Deflater. The seed is compressed at `BEST_COMPRESSION`. | `core/shared/codec/Deflate.java`, `core/shared/codec/SeedCodec.java` | Entropy-codes each band and the seed. The browser inflates with native `deflate-raw`. | ● §2.1, §3.2 |
| **DPCM (left-neighbour prediction)**<br>*Known* | Each seed sample is coded as its difference from the left neighbour, then zigzag + LEB128 + DEFLATE. | `core/shared/codec/SeedCodec.java` | Compresses the seed (the top, coarsest stratum: the opening sketch). | ● §3.2 |
| **Brush encode pipeline**<br>*Project* | Per brush: predict → quantise → energy → band split → counting sort of members per band → membership bitmap plus planar LEB128 values → deflate → CRC32C. All scratch space is in a thread-local `BrushWorkspace`, so nothing is allocated per brush. | `core/shared/codec/BrushEncoder.java`, `core/shared/codec/BrushWorkspace.java` | Encodes the millions of brushes of a gigapixel work without GC pressure. Defines the band format the client decodes. | ● §2.1, §3.2 |

### 1.2 Integrity and checksums

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **CRC-32C**<br>*Known* (Castagnoli, 1993) | `java.util.zip.CRC32C`. The CRC is computed per band at ingest and stored in the index. It is checked when the band is read, and the band goes out with it on the wire. | `core/shared/codec/BrushEncoder.java`, `adapters/out/disk/BandReader.java`, `core/viewing/paint/DeliveryWriter.java` | Detects corrupt bands on disk and on the wire. A failed read is retried once, then the band is remembered as bad and the delivery shrinks to its valid prefix. | ● §3.2, §8 |
| **CRC-32C as ETag**<br>*Adapted* (HTTP validators, RFC 9110) | The ETag of a static file is its CRC-32C. `If-None-Match` uses the weak comparison. | `adapters/in/net/http/ETags.java` | HTTP cache validation for the client files (`304 Not Modified`). | — |
| **CRC-32 of zip entries**<br>*Known* | Checks each entry's CRC-32 from the zip directory against the extracted bytes. | `adapters/in/inbox/FileCrc.java` | Verifies that uploaded archives arrived intact. | — |

### 1.3 Protocol and wire format

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **QUIC variable-length integer**<br>*Known* (RFC 9000 §16) | The 2 top bits give the length (1/2/4/8 bytes), the rest is big-endian. | `core/shared/proto/VarInt.java` | Integer field encoding in every Seurat/1 frame. | ● §3.2 |
| **ACK-range set encoding**<br>*Adapted* (RFC 9000 ACK frame) | A set of numbers is written as `largest, gap_count, first_range` followed by `(gap, len)` pairs, from high to low. In memory it is a sorted `TreeSet<Long>` of numbers, and runs of consecutive numbers are grouped into spans when encoding. | `core/shared/proto/RangesCodec.java`, `core/shared/proto/Ranges.java` | Compact sets for `RECIBO`, `RASPADO`, `INVENTARIO` and `SOLTAR`, even with thousands of numbers. | ● §3.3 |
| **TLV extensions**<br>*Known* | Each extension is tag, length, value. Unknown tags are skipped by length. | `core/shared/proto/Tlv.java` | Forward-compatible message extensions (spec §3, hard rule 1). | ● §3.2 |
| **WebSocket framing and handshake**<br>*Known* (RFC 6455) | Unmasks client payloads (XOR with a 4-byte key) and reassembles fragments, with size caps. Handshake: `Sec-WebSocket-Accept = Base64(SHA-1(key + GUID))`, plus an Origin check. | `adapters/in/net/ws/WsFraming.java`, `adapters/in/net/ws/WsHandshake.java` | Message transport over the HTTP socket. Rejects cross-origin pages. | ● §3.1 |
| **Strict two-priority output queue**<br>*Known* (strict priority queueing) | Control frames always go before deliveries. Repeated PONGs collapse into one. A delivery can be cancelled only before its first byte is written. | `adapters/in/net/ws/WsOutbound.java` | Keeps control (ACKs, revocations, heartbeats) fast while large deliveries are being written. | — |
| **Content negotiation + gzip**<br>*Known* (RFC 9110, RFC 1952) | Parses `Accept-Encoding` with q-values. Text-like static files are gzipped once at `BEST_COMPRESSION` and cached. Images and fonts are left as they are. | `adapters/in/net/http/StaticGzip.java` | Smaller frontend download from the Java server. | — |

### 1.4 Delivery planning (what to send)

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Fractional level-of-detail selection**<br>*Adapted* (mipmap LOD, Williams 1983) | `ideal = log2(max(w/vw, h/vh))`, `s_i = floor(ideal)`, `φ = frac(ideal)`, `bands = 4 − floor(4φ)`. Then `s_f = max(s_i, minStratum)`, where `minStratum` comes from the concession. | `core/viewing/plan/ConePlanner.java` | Turns a `MIRADA` (viewport + screen size) into the stratum and number of bands that just meet the screen's pixel density. The fractional part picks bands, like trilinear mipmapping. | ● §2.2 |
| **Foveated delivery cone**<br>*Project* | The focus tiles at `s_f` get `b_f` bands. Their ancestors get all 4 bands (the skeleton). Ring 1 at `s_f+1` (view box ×2) gets 2 bands. Ring 2 at `s_f+2` (×4) gets 1 band. Tiles come from `floorDiv` rectangle tiling, and rings scale the box ×2^j about its centre. | `core/viewing/plan/ConePlanner.java`, `core/viewing/plan/ConeTiling.java` | Full detail where the user looks, falling off around it, to absorb small pans and zoom-outs. | ● §2.3 |
| **Monotone closure (bottom-up max)**<br>*Project* | Walks the quadtree from fine to coarse with `want(parent) = max(want(parent), want(child))`. | `core/viewing/plan/ConePlanner.java` | Keeps the plan ancestor-closed and monotone: `bandas(padre) ≥ bandas(hijo)` (hard rule 5). | ● §2.3 |
| **Load-adaptive degradation rungs**<br>*Project* | `rung(share)` is a staircase. Share ≥ 0.75 gives the normal cone. Below 0.75, ring 2 is dropped and ring 1 gets 1 band. Below 0.5, the focus is also capped at 2 bands. Below 0.25, the focus moves one stratum coarser. When the receiver queue is amber, the focus is capped at 2 bands. | `core/viewing/plan/ConePlanner.java` | Lowers resolution smoothly under congestion instead of stalling. | ● §6.3 |
| **Three-pass progressive ordering**<br>*Adapted* (progressive transmission) | Core = focus ∪ ancestors. Pass 1 sends bands `[have, min(want, 2))`. Pass 2 sends `[2, want)` for the core. Pass 3 is the periphery. Inside a pass the order is (coarse first, squared distance to the gaze, Morton). Each entry stops at the first band the book already holds (`BookView.heldFrom`, ADR-06). | `core/viewing/plan/ConePasses.java` | Coarse-to-fine, centre-out order: a usable image first, then refinement, then prefetch. | ● §4.1 |

### 1.5 Scheduling and fairness (who goes next)

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Priority with aging**<br>*Known* | Effective class = `stratum + wait / 500 ms`, capped at 10 (the sketch). Higher class goes first. | `core/viewing/paint/Pending.java` (`effectiveClass`), `core/viewing/paint/PaintQueue.java` | Coarse strata first, but a fine brush that has waited long enough rises (no starvation). | ● §6.2 |
| **Stride scheduling**<br>*Known* (Waldspurger & Weihl, 1995) | Ties on class break by pass, then by the lowest `session.stride`. After each delivery, `stride += bytes` (every session has the same weight). A session that becomes active starts at the current minimum stride, so it cannot claim a backlog of credit. | `core/viewing/paint/PaintQueue.java`, `core/viewing/paint/Opener.java` | Equal byte shares between clients, so one client cannot monopolise the painter. | ● §6.2 |
| **Bounded producer–consumer**<br>*Known* (monitor + counting semaphore) | Per-canvas FIFOs behind a Java monitor (`wait`/`notifyAll`). A global `Semaphore(512)` bounds the open deliveries, and each one is written on its own virtual thread. | `core/viewing/paint/PaintQueue.java`, `core/viewing/paint/Painter.java`, `core/viewing/paint/DeliveryWriter.java` | Many concurrent clients without a thread per socket and without unbounded work. | ● §6.2 |
| **Ordered admission gates a–e**<br>*Project* (spec §4.1) | Before each `PINCELADA`, under the canvas lock: (a) concession and edition, (b) monotone parent, (c) book in brushes and `RECIBO.libre` (`BookGate`), (e) the session slots, rate and `cola_ms`, then one of the 512 global slots. Check (d), the brush budget, is gone (ADR-05). The delivery number and book entry are written before any bytes. | `core/viewing/paint/Opener.java`, `core/viewing/paint/BookGate.java`, `core/viewing/paint/Painter.java` | Single egress (hard rule 4): nothing leaves without passing every check in spec order. | ● §4.1 (ADR-05) |

### 1.6 Congestion control, flow control and rate limiting

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **CoDel**<br>*Adapted* (Nichols & Jacobson, 2012; RFC 8289) | Every 250 ms, the queue counts as congested if the minimum dwell time of the deliveries that started in that interval was above 25 ms. Deliveries started while congested are marked. | `core/viewing/session/Regulator.java`, `boot/Timers.java` | Tells a standing queue in the painter apart from a passing burst. | ● §6.3 |
| **DCTCP response + AIMD**<br>*Adapted* (Alizadeh et al., 2010; Chiu & Jain, 1989) | Per session, `α = (1−g)·α + g·F`, with `g = 1/16` and F the fraction of the session's deliveries marked in the tick. If any were marked: `share = max(1/8, share·(1 − α/2))`. Otherwise `share = min(1, share + 1/32)`. | `core/viewing/session/Regulator.java` | Backs off in proportion to how congested the queue is and recovers linearly. The share feeds the planner's rungs. | ● §6.3 |
| **Token bucket with debt**<br>*Adapted* | Byte rate with a 1 s deep bucket. A delivery may push the balance below zero, and nothing new opens until it is positive again. | `core/viewing/session/SessionRate.java` | Per-session byte rate (e.g. 25 MB/s) without cutting a delivery in half. | ● §6.1 |
| **Token bucket + coalescing**<br>*Adapted* | `MIRADA` bucket of 20/s with burst 40. Over the limit, only the highest seq per canvas waits for the next token. More than 200/s for 5 s counts as abuse (`ERROR 9`). | `core/viewing/grant/GazeGate.java` | Stops gaze floods. Replanning always uses the newest view. | ● §4.1, §6.2 |
| **Hysteresis thresholds (traffic light)**<br>*Adapted* | Driven by the client's reported queue (`cola_ms`). Amber at ≥150 ms halves `max_in_flight` (12 → 6). Red above 400 ms stops new flows until the queue drops below 150 ms. The in-flight count uses a CAS loop. | `core/viewing/session/SessionSlots.java` | Receiver-driven flow control: the client's decoder backlog throttles the server without oscillating. | ● §6.1 |

### 1.7 Accounting, leases and revocation

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Exact set reconciliation**<br>*Project* | `expected = book ∩ [1, N] \ predicate \ cancelled`. A `RASPADO` or `INVENTARIO` must equal `expected` exactly, or the session ends with `ERROR 7` (or `ERROR 8` on deadline). | `core/viewing/grant/LoanVerifier.java` | `LoanBook` stays authoritative: the server always knows what each client holds (hard rule 5). | ● §4.2 |
| **Predicate-based revocation**<br>*Project* | A `RASPAR` carries a predicate (`LOW_STRATUM`, `BANDS`, ...). Its matches are computed from the book. | `core/viewing/grant/Reductions.java`, `core/viewing/grant/ScrapeIssuer.java`, `core/viewing/loans/CanvasOrders.java` | Lowers a client's resolution by removing data when the concession shrinks. | ● §4.2 |
| **Leases**<br>*Known* (Gray & Cheriton, 1989) | Each delivery expires at `vence = t + L + δ`, with `δ = max(1 s, 2·max RTT)`. `RENOVAR` extends only deliveries that are still allowed, so revocation can also happen passively. | `core/viewing/loans/LoanLeases.java`, `core/viewing/session/RoundTrip.java`, `core/viewing/grant/Liveness.java` | Data on loan expires unless renewed, and network delay never causes a false expiry. | ● §4.1, §8 |
| **Heartbeat failure detection + periodic audit**<br>*Adapted* | A 1 s tick checks scrape deadlines (`ERROR 8`), prunes expired loans, applies the idle floor, sends an `AUDITAR` every 60 s or 500 deliveries, and closes a session that missed its heartbeats. | `core/viewing/grant/Liveness.java` | Detects dead clients and drifted books. | ● §4.2, §8 |
| **Contiguous-prefix interval map**<br>*Project* | A `TreeMap` from first band to delivery per brush and edition. The walk returns how many bands from 0 are held contiguously; `heldFrom` returns the first held band at or above a given one. | `core/viewing/loans/BrushHoldings.java` | Works out which bands a brush really has, since only a contiguous prefix is usable, and where a repair must stop. | — |
| **Concession arithmetic**<br>*Project* (spec §2.3) | `max_brushes = min(3·mem_MiB, sessionMax)`, `max_KiB = 48 × max_brushes`. The ceiling is always stratum 0 with 4 bands (ADR-05), so `stratum_min = max(0, floor)`, where the floor is the sketch stratum (`SKETCH_MIN`, 7 on large works) while the canvas is hidden or idle. `Concession.allows` lets through any brush coarser than `stratum_min`, and at `stratum_min` only up to `max_bands`. A withdrawn work grants only the sketch. | `core/viewing/concession/Concessions.java`, `core/viewing/concession/Concession.java`, `core/viewing/grant/WorkPolicy.java` | Turns the client declared memory into a possession right. The sketch floor is the only thing that lowers it. | ● §2.3 (ADR-05) |
| **Cone-gated repair**<br>*Project* (ADR-06) | On `SOLTAR CRC` or `DECODIFICACION` the failed deliveries leave the book and the live `MIRADA` is planned again at once: the brush returns, in pass order, only if the cone still wants it, and only its lost bands are sent. A second failure, or a bad band 0 on disk, gives the brush up; the next `PLAN INICIO` names it in the TLV `IRRECUPERABLES`. | `core/viewing/easel/LoanHandlers.java`, `core/viewing/grant/GrantController.java` (`repair`), `core/viewing/session/Canvas.java` (`retryOnce`, `giveUp`), `core/viewing/grant/PlanIssuer.java` | Failure recovery with no retransmission: nothing leaves outside a plan, and no bytes go to brushes the user has looked away from. | ◐ ADR-06 |
| **CSPRNG session tokens with TTL**<br>*Known* | 32 random bytes from `SecureRandom`, used once, with an expiry. Resume tickets keep the book alive for `L + δ`, and `REANUDAR` also checks that the principal (the anonymous `viewer-<hex>` cookie, ADR-05) is the same. | `core/viewing/session/Sessions.java`, `adapters/in/net/http/SessionRoute.java` | Single-use session start and reconnect-with-state. There is no login (ADR-05). | ● §3.1 |

### 1.8 Ingest (adding new images)

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Strip-based (line-based) wavelet pyramid**<br>*Adapted* (Chrysafis & Ortega, 2000) | Rows stream into a 256-row int16 accumulator per stratum. When a strip fills, the S-transform runs on it in parallel, brushes are encoded on a bounded pool (`MAX_TASKS`), and the means cascade into the next stratum's accumulator. The seed is collected at the top. | `core/works/ingest/Accumulator.java`, `core/works/ingest/Drain.java`, `core/works/ingest/BandFeeder.java`, `core/works/ingest/ImagePass.java`, `core/works/ingest/Window.java` | Ingests gigapixel images in one sequential read, with memory bounded by a few strips per stratum. | ● §7.1 |
| **Bounded-buffer read-ahead**<br>*Known* (producer–consumer) | A virtual thread decodes rows into an `ArrayBlockingQueue` while the pyramid consumes them. | `core/works/ingest/ReadAheadReader.java` | Overlaps decoding with transform and encode work. | — |
| **Sketch from an embedded overview**<br>*Project* | Picks the smallest reduced TIFF pyramid page that is still at least the sketch size and matches the master's aspect within tolerance. Samples it at a 1/q stride (nearest neighbour), then builds the mean pyramid and seed with zero-detail brushes. | `core/works/ingest/sketch/SketchBuilder.java`, `adapters/out/decode/imageio/Overview.java` | A browsable sketch in seconds, before the full ingest finishes. | — |
| **Magic-number format detection**<br>*Known* | Reads magic bytes (JPEG SOI, PNG signature, TIFF II/MM, PSB `8BPS`). Unknown formats fall back to ImageIO. | `adapters/out/decode/Decoders.java`, `adapters/out/decode/raster/FormatMarkers.java` | Picks a decoder from the content, not the file extension. | — |
| **Canonical Huffman decoding**<br>*Known* (ITU T.81, Annex C/F) | A 9-bit lookahead table decodes short codes in one step. Longer codes walk the `maxcode` table. | `adapters/out/decode/jpeg/JpegHuffman.java` | Fast entropy decoding of baseline JPEG. | — |
| **JPEG scan decoding**<br>*Known* (ITU T.81) | Bit reader with `FF00` unstuffing and RST realignment. DC is DPCM from the previous block. AC is (run, size) pairs with `receiveExtend`. Zigzag order is mapped to natural order, then dequantised. | `adapters/out/decode/jpeg/JpegBits.java`, `adapters/out/decode/jpeg/JpegScan.java`, `adapters/out/decode/jpeg/JpegTables.java` | Rebuilds the DCT coefficients. | — |
| **Integer IDCT (libjpeg islow)**<br>*Known* (Loeffler, Ligtenberg & Moschytz, 1989) | Separable 8×8 IDCT in two 1-D passes with fixed-point constants. | `adapters/out/decode/jpeg/JpegIdct.java` | Turns coefficients into pixels, bit-exact with libjpeg. | — |
| **Fancy chroma upsampling**<br>*Known* (libjpeg) | Triangle filter with weights 3/4, 1/4 for h2v1/h2v2. Box replication for other factors. | `adapters/out/decode/jpeg/JpegUpsample.java` | Smooth chroma at full resolution. | — |
| **YCbCr → RGB in fixed point**<br>*Known* (JFIF) | Lookup tables of the scaled coefficients, no floating point. | `adapters/out/decode/raster/RasterRgb.java` | Colour conversion of decoded JPEG pixels. | — |
| **Pipelined MCU decoding**<br>*Adapted* (pipeline parallelism) | Entropy-decodes MCU row group N+1 while row group N runs IDCT in parallel. | `adapters/out/decode/jpeg/JpegReader.java` | Uses every core on a format whose entropy coding is sequential. | — |
| **PNG unfiltering (incl. Paeth)**<br>*Known* (PNG spec; Paeth, 1991) | Per-row filters None, Sub, Up, Average and Paeth (`p = a + b − c`, then whichever of a/b/c is nearest to p). | `adapters/out/decode/png/PngUnfilter.java` | Reverses PNG prediction. | — |
| **zlib inflate of streamed IDAT**<br>*Known* (RFC 1950/1951) | IDAT chunks are joined into one stream and passed to `InflaterInputStream`. | `adapters/out/decode/png/IdatInputStream.java` | PNG decompression without buffering the whole file. | — |
| **LZW decoding**<br>*Known* (Welch, 1984; TIFF 6.0) | 9–12-bit codes, Clear/EOI, early change, a table that copies from the output, and the KwKwK case. | `adapters/out/decode/tiff/TiffLzw.java` | LZW-compressed TIFF strips and tiles. | — |
| **TIFF horizontal predictor**<br>*Known* (TIFF 6.0, predictor 2) | Each strip or tile is decompressed (LZW, Deflate, PackBits or none), then the predictor is undone as a running prefix sum per row. WhiteIsZero is inverted. Chunks decode in parallel. | `adapters/out/decode/tiff/TiffChunk.java`, `adapters/out/decode/tiff/TiffReader.java` | TIFF masters, including the usual GigaPixel export. | — |
| **PackBits RLE**<br>*Known* (Apple) | A signed header byte n: `0..127` means copy n+1 literal bytes, `−1..−127` means repeat the next byte 1−n times. | `adapters/out/decode/raster/PackBits.java` | PackBits TIFF and PSB channels. PSB rows decode in parallel. | — |

### 1.9 Storage, recovery and intake

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Data-before-index commit**<br>*Adapted* (ordered writes, as in journaling file systems) | Spans are reserved atomically (`AtomicLongArray`) and written with positional writes. The 40 B index record is written only after its data. A sentinel marks a missing brush. | `adapters/out/disk/StoreWriter.java`, `adapters/out/disk/IndexEntry.java` | Parallel writers without locks, and the index never points at bytes that are not there. | ● §7.2 |
| **Crash recovery by truncation**<br>*Adapted* | On open, every `.pinc` is truncated to the largest end its index records. On restart, works are rebuilt from their `meta.json`: ready works (and works still serving their sketch) are loaded again, and withdrawn works and superseded sketches are deleted. | `adapters/out/disk/StoreWriter.java`, `adapters/out/disk/WorkRecovery.java` | Removes partial writes after a crash and restores the catalogue. | ● §7.2, §8 |
| **Bounded FIFO map**<br>*Known* (FIFO eviction) | A `LinkedHashMap` in insertion order whose `removeEldestEntry` drops the oldest entry past a fixed size. | `adapters/out/disk/BadBands.java` | Remembers corrupt bands in bounded memory, so each is reported once. | — |
| **Post-order tree deletion**<br>*Known* | Walks the tree and deletes the deepest entries first. | `adapters/out/disk/Trees.java` | Removes a work's directory tree. | — |
| **Deferred reclamation**<br>*Project* | A withdrawn work's files are deleted only once its last canvas is closed and every book that references it has expired (`L + δ`). A superseded edition goes once no canvas uses it. Checked on a clock tick. | `boot/DiskReaper.java` | Deletes works while clients still hold loans on them, without breaking those loans. | ● §7.4 |
| **Transfer-completion detection**<br>*Project* | Polls until the file size is stable, with stall and empty timeouts. Then checks the trailer for the format: zip EOCD, PNG `IEND`, JPEG `EOI`. This covers files dropped straight into `inbox/`; uploads and imports are staged first (see Staged intake with atomic publish). | `adapters/in/inbox/FileTransferWaiter.java` | Ingests an inbox file only after it has fully arrived. | — |
| **Staged intake with atomic publish**<br>*Adapted* (write to a temporary name, then rename) | Bytes go to `staging/<name>.<hex>.part`. Before that, the name is checked (admitted master or zip name, no path separators), duplicates in `inbox/` and the catalog are refused, and the free disk space is compared with the size. Only a finished file is moved into `inbox/` with `ATOMIC_MOVE` (a plain move if the file system cannot). Leftover `.part` files from an interrupted transfer are deleted at boot (`sweep`). | `adapters/in/inbox/Staging.java`, `adapters/in/inbox/PutUpload.java`, `adapters/in/inbox/UrlDownload.java` | The inbox watcher never sees a partial file. | — |
| **Hard link import with copy fallback**<br>*Project* | An absolute local path is resolved with `toRealPath`, refused if it is under a forbidden root, then hard-linked into staging with `Files.createLink`. If linking fails (for example another volume) the file is copied instead. | `adapters/in/inbox/PathImport.java` | Adds a master that is already on the server disk in constant time, without sending it through the browser. | — |
| **Download name resolution**<br>*Project* | The file name comes from the last URL path segment, then the `Content-Disposition` `filename`, then the `Content-Type` MIME type mapped to an extension (with common aliases). The result must be an admitted master or zip name. | `adapters/in/inbox/DownloadName.java` | Gives a downloaded link the same id rules as a file dropped into `inbox/`. | — |
| **Chunked transfer framing**<br>*Known* (RFC 9112, chunked transfer coding) | Each write becomes `<hex length>\r\n<bytes>\r\n`. Closing writes the terminating `0\r\n\r\n`. | `adapters/in/net/socket/ChunkedOutput.java` | Streams the progress lines (NDJSON) of a link or path import while the server works. | — |
| **Same-origin gate**<br>*Project* | A request is accepted when it has no `Origin`, or the `Origin` equals `http://` or `https://` plus the `Host`, or it is in the configured origin list. | `adapters/in/net/http/IntakeGate.java` | Guards upload, import and delete, which are open to every viewer (ADR-04, ADR-05), so third-party pages cannot drive them. Path imports also require a local peer (`ImportRoute`). | — |

---

## 2. Client (TypeScript / React)

### 2.1 Decoding and image synthesis

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Table-driven CRC-32C**<br>*Known* (Sarwate, 1988) | 256-entry table of the reflected polynomial `0x82F63B78`, one byte per step. | `shared/codec/crc32c.ts` | Checks each band before decoding. A mismatch is refused (spec §5.4) and fetched again. | ● §5.4 |
| **Raw inflate**<br>*Known* (RFC 1951) | Native `DecompressionStream('deflate-raw')`. | `shared/codec/inflate.ts` | Decompresses bands and the seed without a JS inflate library. | ● §2.1, §3.2 |
| **LEB128 / zigzag decoding**<br>*Known* | 7-bit groups, with a guard at 53 bits (the JS safe-integer limit). Zigzag back to signed. | `shared/codec/leb128.ts`, `shared/codec/byte-reader.ts` | Reads coefficient values and header integers. | ● §2.1, §3.2 |
| **Sparse band decoding**<br>*Project* | Walks the band's membership bitmap. Each set bit takes the next planar values for Y, Co and Cg. | `workers/synth-decode.ts` | Rebuilds the quantised residuals of the parents a band carries (inverse of the server's encode pipeline). | ● §2.1 |
| **DPCM decoding (seed)**<br>*Known* | Prefix sum along each row, the inverse of left-neighbour prediction. | `workers/synth-decode.ts` (`decodeSeedPlanes`), `shared/codec/seed.ts` | Rebuilds the opening sketch. | ● §3.2 |
| **Inverse S+P and inverse S-transform**<br>*Known* | `deq` gives the midpoint reconstruction. `spPredict` adds the predicted H/V back, with the parent crop clamped at the image edge. `liftBlock` undoes the Haar lifting on each 2×2 block. Missing bands count as zero detail. | `shared/codec/spInverse.ts`, `workers/synth-lift.ts` (`liftPlanes`), `workers/synth-parents.ts` | Builds the finer stratum from the parent's means plus the bands held. More bands give a sharper image. | ● §2.1 |
| **Inverse YCoCg-R**<br>*Known* | `t = Y − (Cg>>1)`, `G = Cg + t`, `B = t − (Co>>1)`, `R = B + Co`, clamped to 0–255 and packed as RGBA. | `shared/codec/ycocgr.ts`, `workers/planes-rgba.ts` | Converts the planes to displayable pixels. | ● §2.1 |
| **S3-FIFO cache**<br>*Known* (Yang et al., SOSP 2023) | Three FIFO queues: small, main and ghost. A hit raises a frequency counter capped at 3, without reordering. Evicting from small promotes items with freq > 0 to main and leaves a ghost key for the rest. A ghost hit is admitted straight to main. | `workers/synth-cache.ts` (`ParentPlaneCache`), sized in `workers/synth-parents.ts` | Keeps parent planes in each worker, so refining a brush does not decode its ancestors again. Scan-resistant during pans, with no LRU list. | — |
| **Area-weighted box downsampling**<br>*Known* (area averaging) | For each output pixel, `spans` computes source spans with fractional coverage weights. Rows are reduced, then columns (separable). `patchRegion` recomputes only a dirty rectangle. | `workers/plane-shrink.ts`, `workers/preview-finish.ts` | Alias-free gallery thumbnails at any size. | — |
| **Block-then-smooth upscale**<br>*Adapted* | When the image is enlarged at least `IMAGE_SMOOTHING_THRESHOLD` times, each sample first becomes a sharp k×k block (k = whole scale factor). Only the remaining fraction is scaled with the canvas's high-quality smoothing. | `shared/codec/seed.ts` (`drawScaledRgba`) | Draws the seed at screen size without heavy blur or blockiness. | — |
| **Hash-chained incremental recomposition**<br>*Adapted* (Merkle-style invalidation + dirty rectangles) | Each brush of a preview level carries a signature: its delivery numbers plus its parent's signature, so a change above invalidates everything below. Only brushes whose signature changed are decoded and placed again. The changed area grows as a bounding-box union. | `features/preview-works/model/preview-compose.ts`, `features/preview-works/model/preview-levels.ts` | Gallery cards refine progressively without decoding the whole thumbnail again. | — |

### 2.2 Protocol and accounting

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **QUIC variable-length integer**<br>*Known* (RFC 9000 §16) | Same as the server. The 8-byte form goes through `BigInt`. | `shared/proto/varint.ts` | Frame field codec. | ● §3.2 |
| **ACK-range set encoding**<br>*Adapted* (RFC 9000) | Same layout as the server. | `shared/proto/ranges.ts` | `RECIBO`, `SOLTAR`, `RASPADO`, `INVENTARIO` sets. | ● §3.3 |
| **Scrape predicate evaluation**<br>*Project* | ALL, LOW_STRATUM, BANDS, LIST, and OUTSIDE (rectangle intersection test). | `entities/delivery/scrape.ts` | Finds the deliveries a `RASPAR` matches, so the reply is an exact set. | ● §3.3, §4.2 |
| **Cumulative-ACK floor**<br>*Adapted* (TCP cumulative ACK) | A floor below which every number is settled, plus a sparse set above it. When a number arrives, the floor advances while the next number is in the set. | `entities/delivery/settlement.ts` | Says when every delivery up to N has arrived or been cancelled, as `RASPADO`/`INVENTARIO` require, in memory proportional to the gaps. | ● §4.2, §8 |
| **Delayed / batched acknowledgement**<br>*Adapted* (TCP delayed ACK, RFC 1122) | A `RECIBO` is flushed every 8 deliveries or 100 ms, whichever comes first. `RENOVAR` is applied here as well. | `entities/delivery/sink/receipts.ts` | Fewer control frames, with bounded acknowledgement latency. | ● §4.1 |
| **Lazy lease expiry with inheritance**<br>*Adapted* (leases + lazy expiration) | Effective lease = `min(own, parent's effective)`, computed recursively. It is checked before each paint and on each incoming message, not on a timer, and skipped until the earliest lease in the book ends. Expired brushes go out in one batched `SOLTAR`. | `entities/delivery/sink/lease-expiry.ts` | Drops data whose loan ended, keeping the held set ancestor-closed. | ● §5.2 |

### 2.3 Memory management and eviction (Horizon, ADR-02)

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **α-β tracking filter**<br>*Known* | Per axis (x, y, zoom z): `x̂ = x + v·dt`, `e = meas − x̂`, `x = x̂ + α·e`, `v += (β/dt)·e`, with α = 0.5 and β = 0.2. The velocity halves every 0.5 s without views and resets after a 2 s gap. | `entities/delivery/gaze-motion.ts` | Estimates where and how fast the user is panning and zooming. | ◐ ADR-02 |
| **Horizon: kinematic Bélády**<br>*Adapted* (Bélády's MIN, 1966; this project's approximation) | MIN evicts the item needed furthest in the future. Horizon estimates that time from the gaze motion. `T_s = gap / max(0.1·Vref, Vref + v·û)`, `T_z = max(0, z − s − 1) / max(0.1·Zref, Zref − v_z)`, `T = max(T_s, T_z)`. The brush with the largest `T_eff` goes first. | `entities/delivery/horizon-rank.ts` (`timeToNeed`, `rankHorizon`) | Eviction order: drop what the gaze will reach last. No LRU (professor's rule). | ◐ ADR-02 |
| **Attention heat**<br>*Adapted* (exponentially decayed frequency) | When a view is replaced, its brushes are credited the seconds it was on screen, capped at 30 s per view. Heat decays with a 120 s half-life. `T_eff = T / (1 + 0.5·heat)`. | `entities/delivery/attention-heat.ts` | Keeps regions the user studied, so revisits are cheap. Measures dwell, not recency. | ◐ ADR-02 |
| **Eviction candidate filter**<br>*Project* (spec §5.2.3) | Leaves only (no held children), never the sketch, never the on-screen core, and never a brush inside a cone the server may still be painting (unless the book is full, so nothing can be on the wire). The cone test uses rings ×2^j and rectangle intersection. | `entities/delivery/evict-candidate.ts` | Eviction never breaks ancestor closure or removes what is in flight or visible. | ● §5.2.3 |
| **High/low watermark reclamation**<br>*Adapted* | Triggers at `max − 8` brushes, above 90 % of bytes, when the byte window has room for fewer than 8 more deliveries, or on a VRAM allocation failure. Evicts in Horizon order down to 75 %, out-of-cone brushes first. A second phase frees room for a missing core. | `entities/delivery/sink/eviction.ts` (`relieve`) | Keeps the browser under its memory budget (brief requirement). `SOLTAR motivo=1` tells the server. | ● §5.2.3, §5.3 |
| **Conservative cone merging**<br>*Project* | Past views whose cones may still be painted are kept as rectangles. Beyond 16 entries, the two oldest merge into their bounding box with the finer focus. A box that contains another still contains it after scaling, so the merged test is a superset. | `entities/delivery/painted-cones.ts` | Cheap, never-wrong "may still be painted" test for the candidate filter. | — |
| **Subtree removal (DFS)**<br>*Known* (depth-first search) | DFS over `descendants`. `parentFor` picks the best held ancestor. | `entities/delivery/sink/removal.ts`, `entities/delivery/sink/brush-graph.ts` | Removes a brush and its subtree as one unit, and finds what to draw in its place. | — |
| **Nearest-k residency**<br>*Adapted* (k-nearest selection) | A brush keeps its decoded planes only while a child of it can be planned soon (in the current cone above the focus, a root stratum, under a pixel readout, or awaited). Beyond `PLANES_HELD_MAX` (16) such brushes, the farthest from the view drop first. Under WebGL the bitmap is closed once the tile is uploaded. Band bytes always stay, so both can be rebuilt. | `entities/delivery/sink/plane-keep.ts`, `entities/delivery/sink/cold-planes.ts`, `entities/delivery/sink/pixel-residency.ts` | A second memory tier: bounds RAM spent on decoded pixels without dropping loans. | — |
| **Windowed priority rebuild queue**<br>*Project* | Released brushes are rebuilt coarse first (children come from them), then nearest the focus, with at most `PIXEL_RESTORE_WINDOW` running. | `entities/delivery/sink/restore-queue.ts` | Re-decodes in the order that improves the screen fastest, without flooding the workers. | — |

### 2.4 Flow control and measurement

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Little's-law receiver window**<br>*Adapted* (Little, 1961; bandwidth-delay product) | `window = ceil(rate × (CREDIT_WINDOW_S + minRTT) / avgDelivery)`, at least `CREDIT_MIN` and at most the memory window. `byteRoom` and `coming` take off what may already be on its way. | `entities/delivery/credit.ts` (`receiverWindow`, `byteRoom`, `coming`), `entities/delivery/sink/credit-window.ts` (`free`) | The credit the client advertises in `RECIBO.libre`: enough to keep the link full, no more than memory allows. | ● §6.1 |
| **Windowed min-RTT filter**<br>*Adapted* (BBR's min_rtt, Cardwell et al., 2016) | An RTT sample is the time from a `MIRADA` to the first `PLAN` for it. The minimum over a sliding time window is used. | `entities/delivery/sink/min-rtt.ts` | Propagation delay without queueing delay, as input to the window. | — |
| **EWMA**<br>*Known* | Decode time: `avg = 0.8·avg + 0.2·sample`, and `cola_ms = (inWorker + waiting)·avg / parallel`. The same averaging is applied to delivery sizes. | `entities/delivery/decode-queue.ts`, `entities/delivery/sink/ingest.ts` | The backlog reported to the server (drives its traffic light), and the average delivery size the window uses. | — |
| **Bucketed sliding-window rate meter**<br>*Known* | A ring of 240 buckets of 250 ms (60 s). Live rate over a recent window, and the peak 1 s rate. | `shared/lib/rate-meter.ts` | Link rate for the receiver window, and the stats panel. | — |

### 2.5 Scheduling and concurrency

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Binary heap priority queue**<br>*Known* (Williams, 1964) | Key: newest epoch, coarser stratum, nearer the focus, delivery number, then insertion seq. Push and pop are O(log n). | `entities/delivery/synth-queue.ts` | Synthesises the brushes that matter most first, and lets them reorder while they wait. | — |
| **Least-loaded dispatch (depth 1)**<br>*Known* | Pool size = cores − 1, clamped. A job goes only to an idle worker, so nothing queues inside a worker's mailbox. | `entities/delivery/worker-pool.ts` | Parallel decoding off the main thread while priorities stay controllable. | — |
| **Cache-affinity dispatch**<br>*Known* (affinity scheduling) | If the worker that synthesised the parent is idle, the child goes there by reference. Otherwise the bytes are sent. | `entities/delivery/sink/synth-dispatch.ts` (`pickWorker`) | Hits that worker's S3-FIFO cache and skips copying the parent planes. | — |
| **Bounded FIFO maps**<br>*Known* (FIFO eviction) | `Map` in insertion order. The oldest key is deleted past a fixed size (1024 departures, `maxHandles` ledgers). | `entities/delivery/departures.ts`, `entities/delivery/ledgers.ts` (`HandleLedgers`) | Bounded history for diagnostics and for answering server audits on retired handles. | — |
| **Frame coalescing, throttle and debounce**<br>*Known* | Updates inside one animation frame are merged into one `requestAnimationFrame` callback. `MIRADA` goes out at most once per frame, plus a final "still" view after the user stops (debounce), and a keep-alive resend while the view stays still. The seq is monotonic. On the WebSocket mapping, moving views also pass a sliding-window log that drops any beyond 20 in the last second (`GAZE_PER_S`). Over WebTransport they are datagrams and the spec sets no cap. | `shared/lib/frame-batch.ts`, `features/send-gaze/index.ts` (`GazeSender`), `shared/api/ws.ts` (`sendGazeDatagram`) | Responsive view updates without flooding the server or redrawing twice per frame. | ● §3.1 |
| **Capped exponential backoff**<br>*Known* | `delay = min(MAX, BASE·2^retries)`. | `app/providers/seurat/reconnect.ts` | Reconnects without hammering a server that is restarting. | — |
| **Watchdog timer**<br>*Known* | A deadline that resets on every frame received. When it expires, the client declares the link dead. | `entities/session/client/watchdog.ts` | Detects silent connection loss. | — |
| **Gaze keep-alive for gallery cards**<br>*Project* | Each gallery card whose work has more than the seed stratum (`top > 0`) sends its still `MIRADA` again once `PREVIEW_GAZE_KEEPALIVE_MS` has passed since its last one. | `features/preview-works/model/preview-gaze.ts` (`keepGazing`) | Stops the server inactivity floor from dropping visible thumbnails back to the sketch. | — |

### 2.6 Rendering

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Painter's algorithm**<br>*Known* (Newell et al., 1972) | Brushes are drawn from the coarsest stratum to the finest, so finer ones cover coarser ones. Only the newest delivery per brush is used. | `entities/delivery/lib/brush-cull.ts` (`collectBrushes`) | Correct layering without a depth buffer. Coarse data shows through where fine data is missing. | — |
| **Quadtree LOD and occlusion culling**<br>*Adapted* (mipmap selection) | Skips a brush when an ancestor already gives ≤ 1 texel per device pixel. Skips a parent when all 4 children are drawn. Results are memoised (`BrushCuller`). | `entities/delivery/lib/brush-cull.ts` (`cullBrushes`) | Draws nothing finer than the screen can show and nothing that is fully covered. Also used for the minimap. | — |
| **Recursive quadtree coverage test**<br>*Project* | A region counts as covered if each tile is drawn, or all 4 of its children are covered, recursively. Pigeonhole early exit: if the region has more tiles than the drawn set, it cannot be covered. | `widgets/viewer-canvas/canvas2d/tile-cover.ts` (`tilesCover`) | Coverage test behind the occlusion culling. | — |
| **Pixel snapping**<br>*Known* | Rounds tile edges to device pixels, so neighbouring tiles share an edge. | `widgets/viewer-canvas/canvas2d/tile-cover.ts` (`snapSpan`) | No hairline gaps between tiles. | — |
| **Texture-array slot allocator**<br>*Adapted* (lowest-free-slot allocation) | Layers of a `TEXTURE_2D_ARRAY` are given out lowest index first. Arrays grow and shrink. Each frame, the set of live brushes is diffed against the uploaded layers. Uploads go out within a per-frame time budget (at least one per frame), sketch first, then coarse to fine. | `widgets/viewer-canvas/gl/tile-atlas.ts`, `widgets/viewer-canvas/gl/layer-arrays.ts`, `widgets/viewer-canvas/gl/gl-renderer.ts` | Packs tiles into GPU memory compactly and avoids frame drops when many tiles arrive at once. | — |
| **Hashed jittered dot mask**<br>*Adapted* (jittered sampling, Cook 1986; integer hash with xxHash32 primes) | `hash3` mixes cell coordinates by multiply–xorshift into 3 values in [0, 1], which set each dot's offset and size. Canvas2D punches the dots out with `destination-out`. The GL shader computes antialiased dot coverage analytically. | `widgets/viewer-canvas/lib/pointillism.ts`, `shared/lib/hash3.ts`, `widgets/viewer-canvas/gl/shaders/tiles.ts` | The Seurat pointillist look, the same on every frame and stable while panning. | — |
| **Closed-form Gaussian rectangle shadow**<br>*Known* (erf via Abramowitz & Stegun 7.1.27) | A Gaussian-blurred rectangle is a product of erf differences on x and y. `erf(x) ≈ 1 − 1/(1 + a1·x + a2·x² + a4·x⁴)⁴`, with the tiny cubic term dropped. | `widgets/viewer-canvas/gl/shaders/scene.ts` (`SHADOW_FS`), `widgets/viewer-canvas/gl/shaders/common.ts` (`ERF`) | Soft canvas shadow in one shader pass, with no blur pass. | — |
| **9-slice scaling**<br>*Known* | Shadow corners stay fixed and edges stretch. A frame is a rectangle minus a hole, split into 4 bands. | `widgets/viewer-canvas/lib/sprite-geometry.ts` | Canvas2D fallback for the shadow and frame. | — |
| **Frame-time percentiles**<br>*Known* | Ring of 120 frame gaps. Mean, and p95 by sorting. Gaps longer than 250 ms count as idle and are left out. | `widgets/viewer-canvas/model/frame-meter.ts` | Frame meter overlay. | — |
| **Backing-store pixel cap**<br>*Project* | `scale = sqrt(maxPx / px)`, so `(css × dpr × scale)² ≤ RENDER_MAX_BACKING_PX`, snapped down onto a fixed step. | `shared/lib/render-scale.ts` | Caps the number of pixels shaded on large or high-DPI screens. | — |
| **JIT detection microbenchmark**<br>*Project* | Times a loop over a typed array against a native sort of the same data. A slow machine slows both, a missing JIT only the loop. | `shared/lib/script-speed.ts` | Detects an interpreter-only JS engine and lowers the work accordingly. | — |

### 2.7 View and interaction

| Algorithm | How it works | Where | Function | Seurat/1 |
|---|---|---|---|---|
| **Fractional level-of-detail selection**<br>*Adapted* (mipmap LOD) | `idealDensity = log2(image px / screen px)`, then `strataFor` and `bandsFor` (same formula as the server). `viewToRoi` clamps the region to the image and never inverts it. Gallery cards use the same formula (`gazeLevel`). | `entities/viewport/math.ts`, `features/preview-works/model/preview-gaze.ts` | Client-side mirror of the cone: what is on screen and what it needs. | ● §2.2 |
| **Zoom about a fixed point**<br>*Known* (affine transform) | `t' = p − (p − t)·(s'/s)`, which keeps the point under the cursor or pinch centre fixed. | `features/zoom-view/zoom.ts` (`zoomTarget`) | Zooms about the cursor or the pinch centre. | — |
| **Logarithmic zoom mapping**<br>*Known* | Wheel: `s' = s·exp(−dy·k)`. Slider: `frac = log(s/min) / log(max/min)`, with the inverse `logUnfrac`. | `features/zoom-view/zoom.ts` (`wheelZoom`), `shared/lib/zoom.ts` (`logFrac`, `logUnfrac`) | Zoom speed feels the same at every scale. | — |
| **Pinch zoom**<br>*Known* | Ratio of the current to the starting two-finger distance, about their midpoint. | `features/pan-view/pointer-gestures.ts` | Touch zoom. | — |
| **EMA velocity + inertial fling**<br>*Adapted* (kinetic scrolling) | Drag velocity: `v = 0.8·(dx/dt) + 0.2·v`. On release within 60 ms of the last move, target = position + `v × 170 ms`. | `features/pan-view/pointer-gestures.ts`, `features/pan-view/pan.ts` (`flingTarget`) | Natural momentum after a drag. | — |
| **Exponential smoothing in log scale**<br>*Known* (exponential smoothing) | Each frame: `s ← s·exp(log(ts/s)·0.2)`, so zoom moves geometrically, keeping the anchor point fixed. The pan residual eases with `t += (target − t)·0.2`. Both stop below an epsilon. | `features/zoom-view/model.ts` (`tickView`), constants in `shared/config/view.ts` | Smooth zoom and pan, independent of the input rate. | — |
| **Page slicing and sibling window**<br>*Project* | `paginate` clamps the page and slices the list. `pageRange` always keeps the first page, the last page, the active page and `siblings` pages around it; one hidden page is shown as itself and two or more hidden pages become a gap. | `shared/lib/pagination.ts` | Pages the gallery (8 cards per page) so thumbnails load only for the visible page. | — |

---

## 3. Shared algorithms (server ↔ client)

These come in pairs: the server runs the forward or encode direction and the client runs the
inverse or decode. They must stay bit-exact with each other and with the spec's wire goldens
(§3.4.1–3.4.4).

Every row of this table is marked `●` in the Seurat/1 column of sections 1 and 2.

| Algorithm | Server (forward / encode) | Client (inverse / decode) |
|---|---|---|
| YCoCg-R | `core/shared/codec/YCoCgR.java` | `shared/codec/ycocgr.ts`, `workers/planes-rgba.ts` |
| Integer S-transform | `core/shared/codec/TransformS.java` | `shared/codec/spInverse.ts`, `workers/synth-lift.ts` |
| S+P prediction | `core/shared/codec/PredictSP.java` | `shared/codec/spInverse.ts` (`spPredict`) |
| Dead-zone quantisation | `core/shared/codec/Quant.java` | `shared/codec/spInverse.ts` (`deq`) |
| Band format (bitmap + planar values) | `core/shared/codec/BrushEncoder.java` | `workers/synth-decode.ts` |
| Seed DPCM | `core/shared/codec/SeedCodec.java` | `workers/synth-decode.ts`, `shared/codec/seed.ts` |
| Zigzag + LEB128 | `core/shared/proto/Leb128.java` | `shared/codec/leb128.ts` |
| DEFLATE raw | `core/shared/codec/Deflate.java` | `shared/codec/inflate.ts` |
| CRC-32C | `core/shared/codec/BrushEncoder.java`, `adapters/out/disk/BandReader.java` | `shared/codec/crc32c.ts` |
| QUIC varint | `core/shared/proto/VarInt.java` | `shared/proto/varint.ts` |
| ACK ranges | `core/shared/proto/RangesCodec.java` | `shared/proto/ranges.ts` |
| Fractional LOD (stratum/bands) | `core/viewing/plan/ConePlanner.java` | `entities/viewport/math.ts` |
| Morton / brush id | `core/shared/codec/Morton.java`, `core/shared/codec/BrushId.java` | `shared/proto/brush.ts` |
