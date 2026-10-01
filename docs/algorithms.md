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

Plain plumbing (open queues, transport fallback, memory polling, loader animation, context-loss
handling, …) is not listed.

Several algorithms run on both sides as mirrored halves of one codec or wire format, for example
forward on the server and inverse on the client. They are listed once per side and summarised in
[Shared algorithms](#3-shared-algorithms-server--client).

---

## 1. Server (Java)

### 1.1 Image codec and compression

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **YCoCg-R colour transform**<br>*Known* (Malvar & Sullivan, 2003) | Integer lifting: `Co = R − B`, `t = B + (Co>>1)`, `Cg = G − t`, `Y = t + (Cg>>1)`. The inverse is exact. | `codec/YCoCgR.java` (`forwardRow`), `ingest/BandFeeder.java` | Decorrelates RGB into luma and chroma losslessly, so chroma can be quantised harder than luma. |
| **Integer Haar S-transform by lifting**<br>*Known* (S-transform; lifting, Sweldens 1996) | On each 2×2 block: `l1=(a+b)>>1, h1=a−b`, the same for the second row, then `S=(l1+l2)>>1, V=l1−l2, H=(h1+h2)>>1, D=h1−h2`. Integer and reversible. Row slices run in parallel. | `codec/TransformS.java` (`blockForward`) | Builds the S-pyramid. Each stratum is the mean image of the one below it. H/V/D are the detail a brush carries to rebuild the finer stratum. |
| **S+P prediction**<br>*Adapted* (Said & Pearlman, 1996) | Predicts the detail from the neighbouring means: `Ĥ = (S[x−1] − S[x+1] + 2) >> 2`, `V̂` the same way vertically, D not predicted. Open loop, with the border replicated. Only the residual is coded. Simpler than the paper's predictor set. | `codec/PredictSP.java`, inlined in `codec/BrushEncoder.java` | Removes the predictable part of the detail, which lowers entropy before quantisation. |
| **Dead-zone uniform quantisation**<br>*Known* (as in JPEG 2000) | `i = x / q`, truncating toward zero, which leaves a dead zone around 0. The reconstruction is `sign(i)·(abs(i)·q + q/2)`. Steps per plane and stratum: table 1 is Y (6,4,2,1) and C (0,6,3,2); table 2 is stratum 0 at q=2, coarser strata lossless. | `codec/Quant.java` | Controls loss. Small detail becomes zero and costs almost nothing after DEFLATE. |
| **Energy ranking into significance bands**<br>*Project* (with LSD radix sort, *Known*) | Per parent (one 2×2 group of detail): `E = Σ_c w_c·(abs(qH) + abs(qV) + abs(qD))`, with weight 2 for Y and 1 for Co and Cg (chroma is skipped when its q is 0). Parents are sorted by E descending, ties by Morton ascending, with a stable LSD radix sort on `max − E` (11-bit digits). Bands are cut at 1/8, 1/8, 1/4 and 1/2 of the parents. Parents with E = 0 are left out. | `codec/BandSplit.java`, `codec/BandsOrder.java` | Orders a brush's detail by importance into 4 bands. Each extra band sharpens the image, so resolution can be raised or lowered one band at a time. |
| **Morton (Z-order) encoding**<br>*Known* (Morton, 1966) | Interleaves the bits of (x, y). Parent = `m >> 2`, child k = `(m << 2) + k`. A precomputed `PARENTS_16K` table holds the Morton code of each of a brush's 128×128 parents, used for band ordering. Brush id = `stratum << 56` plus the Morton code. | `codec/Morton.java`, `codec/BrushId.java` (`parentCapped`) | Gives a brush id that sorts with spatial locality and makes parent/child arithmetic O(1). |
| **Zigzag + unsigned LEB128**<br>*Known* (zigzag from Protocol Buffers; LEB128 from DWARF) | Zigzag maps signed to unsigned: `(n << 1) ^ (n >> 31)`. LEB128 writes 7 bits per byte, with the high bit meaning "more follows". | `proto/Leb128.java` | Compact integers: small residuals take one byte. |
| **DEFLATE raw**<br>*Known* (RFC 1951) | LZ77 plus Huffman, through `java.util.zip.Deflater` with `nowrap`. Each thread reuses its own Deflater. The seed is compressed at `BEST_COMPRESSION`. | `codec/Deflate.java`, `codec/SeedCodec.java` | Entropy-codes each band and the seed. The browser inflates with native `deflate-raw`. |
| **DPCM (left-neighbour prediction)**<br>*Known* | Each seed sample is coded as its difference from the left neighbour, then zigzag + LEB128 + DEFLATE. | `codec/SeedCodec.java` | Compresses the seed (the top, coarsest stratum: the opening sketch). |
| **Brush encode pipeline**<br>*Project* | Per brush: predict → quantise → energy → band split → counting sort of members per band → membership bitmap plus planar LEB128 values → deflate → CRC32C. All scratch space is in a thread-local `BrushWorkspace`, so nothing is allocated per brush. | `codec/BrushEncoder.java`, `codec/BrushWorkspace.java` | Encodes the millions of brushes of a gigapixel work without GC pressure. Defines the band format the client decodes. |

### 1.2 Integrity and checksums

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **CRC-32C**<br>*Known* (Castagnoli, 1993) | `java.util.zip.CRC32C`. The CRC is computed per band at ingest and stored in the index. It is checked when the band is read, and the band goes out with it on the wire. | `codec/BrushEncoder.java`, `store/BandReader.java`, `paint/DeliveryWriter.java` | Detects corrupt bands on disk and on the wire. A failed read is retried once, then the band is remembered as bad and the delivery shrinks to its valid prefix. |
| **CRC-32C as ETag**<br>*Adapted* (HTTP validators, RFC 9110) | The ETag of a static file is its CRC-32C. `If-None-Match` uses the weak comparison. | `net/http/ETags.java` | HTTP cache validation for the client files (`304 Not Modified`). |
| **CRC-32 of zip entries**<br>*Known* | Checks each entry's CRC-32 from the zip directory against the extracted bytes. | `intake/FileCrc.java` | Verifies that uploaded archives arrived intact. |

### 1.3 Protocol and wire format

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **QUIC variable-length integer**<br>*Known* (RFC 9000 §16) | The 2 top bits give the length (1/2/4/8 bytes), the rest is big-endian. | `proto/VarInt.java` | Integer field encoding in every Seurat/1 frame. |
| **ACK-range set encoding**<br>*Adapted* (RFC 9000 ACK frame) | A set of numbers is written as `largest, gap_count, first_range` followed by `(gap, len)` pairs, from high to low. In memory it is a sorted `TreeSet<Long>` of numbers, and runs of consecutive numbers are grouped into spans when encoding. | `proto/RangesCodec.java`, `proto/Ranges.java` | Compact sets for `RECIBO`, `RASPADO`, `INVENTARIO` and `SOLTAR`, even with thousands of numbers. |
| **TLV extensions**<br>*Known* | Each extension is tag, length, value. Unknown tags are skipped by length. | `proto/Tlv.java` | Forward-compatible message extensions (spec §3, hard rule 1). |
| **WebSocket framing and handshake**<br>*Known* (RFC 6455) | Unmasks client payloads (XOR with a 4-byte key) and reassembles fragments, with size caps. Handshake: `Sec-WebSocket-Accept = Base64(SHA-1(key + GUID))`, plus an Origin check. | `net/ws/WsFraming.java`, `net/ws/WsHandshake.java` | Message transport over the HTTP socket. Rejects cross-origin pages. |
| **Strict two-priority output queue**<br>*Known* (strict priority queueing) | Control frames always go before deliveries. Repeated PONGs collapse into one. A delivery can be cancelled only before its first byte is written. | `net/ws/WsOutbound.java` | Keeps control (ACKs, revocations, heartbeats) fast while large deliveries are being written. |
| **Content negotiation + gzip**<br>*Known* (RFC 9110, RFC 1952) | Parses `Accept-Encoding` with q-values. Text-like static files are gzipped once at `BEST_COMPRESSION` and cached. Images and fonts are left as they are. | `net/http/StaticGzip.java` | Smaller frontend download from the Java server. |

### 1.4 Delivery planning (what to send)

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Fractional level-of-detail selection**<br>*Adapted* (mipmap LOD, Williams 1983) | `ideal = log2(max(w/vw, h/vh))`, `s_i = floor(ideal)`, `φ = frac(ideal)`, `bands = 4 − floor(4φ)`. Then `s_f = max(s_i, minStratum)`, where `minStratum` comes from the concession. | `plan/ConePlanner.java` | Turns a `MIRADA` (viewport + screen size) into the stratum and number of bands that just meet the screen's pixel density. The fractional part picks bands, like trilinear mipmapping. |
| **Foveated delivery cone**<br>*Project* | The focus tiles at `s_f` get `b_f` bands. Their ancestors get all 4 bands (the skeleton). Ring 1 at `s_f+1` (view box ×2) gets 2 bands. Ring 2 at `s_f+2` (×4) gets 1 band. Tiles come from `floorDiv` rectangle tiling, and rings scale the box ×2^j about its centre. | `plan/ConePlanner.java`, `plan/ConeTiling.java` | Full detail where the user looks, falling off around it, to absorb small pans and zoom-outs. |
| **Monotone closure (bottom-up max)**<br>*Project* | Walks the quadtree from fine to coarse with `want(parent) = max(want(parent), want(child))`. | `plan/ConePlanner.java` | Keeps the plan ancestor-closed and monotone: `bandas(padre) ≥ bandas(hijo)` (hard rule 5). |
| **Load-adaptive degradation rungs**<br>*Project* | `rung(share)` is a staircase. Share ≥ 0.75 gives the normal cone. Below 0.75, ring 2 is dropped and ring 1 gets 1 band. Below 0.5, the focus is also capped at 2 bands. Below 0.25, the focus moves one stratum coarser. When the receiver queue is amber, the focus is capped at 2 bands. | `plan/ConePlanner.java` | Lowers resolution smoothly under congestion instead of stalling. |
| **Three-pass progressive ordering**<br>*Adapted* (progressive transmission) | Core = focus ∪ ancestors. Pass 1 sends bands `[have, min(want, 2))`. Pass 2 sends `[2, want)` for the core. Pass 3 is the periphery. Inside a pass the order is (coarse first, squared distance to the gaze, Morton). | `plan/ConePasses.java` | Coarse-to-fine, centre-out order: a usable image first, then refinement, then prefetch. |

### 1.5 Scheduling and fairness (who goes next)

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Priority with aging**<br>*Known* | Effective class = `stratum + wait / 500 ms`, capped at 10 (the sketch). Higher class goes first. | `paint/Pending.java` (`effectiveClass`), `paint/PaintQueue.java` | Coarse strata first, but a fine brush that has waited long enough rises (no starvation). |
| **Stride scheduling**<br>*Known* (Waldspurger & Weihl, 1995) | Ties on class break by pass, then by the lowest `session.stride`. After each delivery, `stride += bytes / weight`, where the weight is `ROLE_WEIGHT = 1` for every role. A session that becomes active starts at the current minimum stride, so it cannot claim a backlog of credit. | `paint/PaintQueue.java`, `paint/Opener.java` | Equal byte shares between clients, so one client cannot monopolise the painter. |
| **Bounded producer–consumer**<br>*Known* (monitor + counting semaphore) | Per-canvas FIFOs behind a Java monitor (`wait`/`notifyAll`). A global `Semaphore(512)` bounds the open deliveries, and each one is written on its own virtual thread. | `paint/PaintQueue.java`, `paint/Painter.java`, `paint/DeliveryWriter.java` | Many concurrent clients without a thread per socket and without unbounded work. |
| **Ordered admission gates a–e**<br>*Project* (spec §4.1) | Before each `PINCELADA`, under the canvas lock: (a) concession and edition, (b) monotone parent, (c) book in brushes and `RECIBO.libre` (`BookGate`), (e) the session's slots, rate and `cola_ms`, then one of the 512 global slots, (d) brush budget. If the budget refuses, the s+1 version is sent instead. The delivery number and book entry are written before any bytes. | `paint/Opener.java`, `paint/BookGate.java`, `paint/Painter.java` | Single egress (hard rule 4): nothing leaves without passing every check in spec order. |

### 1.6 Congestion control, flow control and rate limiting

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **CoDel**<br>*Adapted* (Nichols & Jacobson, 2012; RFC 8289) | Every 250 ms, the queue counts as congested if the minimum dwell time of the deliveries that started in that interval was above 25 ms. Deliveries started while congested are marked. | `session/Regulator.java`, `app/Timers.java` | Tells a standing queue in the painter apart from a passing burst. |
| **DCTCP response + AIMD**<br>*Adapted* (Alizadeh et al., 2010; Chiu & Jain, 1989) | Per session, `α = (1−g)·α + g·F`, with `g = 1/16` and F the fraction of the session's deliveries marked in the tick. If any were marked: `share = max(1/8, share·(1 − α/2))`. Otherwise `share = min(1, share + 1/32)`. | `session/Regulator.java` | Backs off in proportion to how congested the queue is and recovers linearly. The share feeds the planner's rungs. |
| **Token bucket**<br>*Known* | The bucket refills at `rate` per second up to `capacity`. `take(n)` succeeds only if n tokens are there. One bucket per (user, work), in bands, only on the finest stratum the role may reach (0 or 1). Defaults: 20 000 bands at 10/s authenticated, 1 000 at 1/s anonymous. | `budget/TokenBucket.java`, `budget/BudgetPolicy.java` | Caps how fast one user can draw full-resolution detail. |
| **Token bucket with debt**<br>*Adapted* | Byte rate with a 1 s deep bucket. A delivery may push the balance below zero, and nothing new opens until it is positive again. | `session/SessionRate.java` | Per-session byte rate (e.g. 25 MB/s) without cutting a delivery in half. |
| **Token bucket + coalescing**<br>*Adapted* | `MIRADA` bucket of 20/s with burst 40. Over the limit, only the highest seq per canvas waits for the next token. More than 200/s for 5 s counts as abuse (`ERROR 9`). | `grant/GazeGate.java` | Stops gaze floods. Replanning always uses the newest view. |
| **Hysteresis thresholds (traffic light)**<br>*Adapted* | Driven by the client's reported queue (`cola_ms`). Amber at ≥150 ms halves `max_in_flight` (12 → 6). Red above 400 ms stops new flows until the queue drops below 150 ms. The in-flight count uses a CAS loop. | `session/SessionSlots.java` | Receiver-driven flow control: the client's decoder backlog throttles the server without oscillating. |
| **Coverage budget**<br>*Project* | Each stratum-0/1 brush has a 4-bit counter (highest band delivered) in a memory-mapped file. Redelivery is free. The fraction of the stratum's brushes covered is capped per user and work: 15 % authenticated, 25 % anonymous. | `budget/Coverage.java`, `budget/BrushBudget.java`, `budget/BudgetPolicy.java` | Limits how much of the full-resolution image one user can collect (the brief's "never sent whole"). |
| **Fixed-window global cap**<br>*Project* | A BitSet of brushes newly covered per (work, role, stratum), across all users, reset every 24 h. At most 30 % of the stratum per window. | `budget/GlobalCoverage.java` | Stops several same-role accounts from colluding to assemble the full image. |

### 1.7 Accounting, leases and revocation

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Exact set reconciliation**<br>*Project* | `expected = book ∩ [1, N] \ predicate \ cancelled`. A `RASPADO` or `INVENTARIO` must equal `expected` exactly, or the session ends with `ERROR 7` (or `ERROR 8` on deadline). | `grant/LoanVerifier.java` | `LoanBook` stays authoritative: the server always knows what each client holds (hard rule 5). |
| **Predicate-based revocation**<br>*Project* | A `RASPAR` carries a predicate (`LOW_STRATUM`, `BANDS`, ...). Its matches are computed from the book. | `grant/Reductions.java`, `grant/ScrapeIssuer.java`, `session/CanvasOrders.java` | Lowers a client's resolution by removing data when the concession shrinks. |
| **Leases**<br>*Known* (Gray & Cheriton, 1989) | Each delivery expires at `vence = t + L + δ`, with `δ = max(1 s, 2·max RTT)`. `RENOVAR` extends only deliveries that are still allowed, so revocation can also happen passively. | `session/LoanLeases.java`, `session/RoundTrip.java`, `grant/Liveness.java` | Data on loan expires unless renewed, and network delay never causes a false expiry. |
| **Heartbeat failure detection + periodic audit**<br>*Adapted* | A 1 s tick checks scrape deadlines (`ERROR 8`), prunes expired loans, applies the idle floor, sends an `AUDITAR` every 60 s or 500 deliveries, and closes a session that missed its heartbeats. | `grant/Liveness.java` | Detects dead clients and drifted books. |
| **Contiguous-prefix interval map**<br>*Project* | A `TreeMap` from first band to delivery per brush and edition. The walk returns how many bands from 0 are held contiguously. | `session/BrushHoldings.java` | Works out which bands a brush really has, since only a contiguous prefix is usable. |
| **Concession arithmetic**<br>*Project* (spec §2.3) | `max_brushes = min(3·mem_MiB, sessionMax)`, `max_KiB = 48 × max_brushes`, `stratum_min = max(ceiling, floor)`. `Concession.allows` lets through any brush coarser than `stratum_min`, and at `stratum_min` only up to `max_bands`. | `concession/Concessions.java`, `concession/Concession.java` | Turns the client's declared memory and role into a possession right. |
| **Role-ceiling nesting check**<br>*Project* | Each ceiling is {stratum, bands}. Roles must nest (a finer stratum covers any bands of a coarser one, the same stratum needs as many bands). | `catalog/RolePolicy.java` | Rejects a role policy where combining roles would exceed the highest role. |
| **CSPRNG bearer tokens with TTL**<br>*Known* | 32 random bytes from `SecureRandom`, used once, with an expiry. Resume tickets keep the book alive for `L + δ`. | `session/Sessions.java`, `net/http/SessionRoute.java` | Authentication and reconnect-with-state. |

### 1.8 Ingest (adding new images)

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Strip-based (line-based) wavelet pyramid**<br>*Adapted* (Chrysafis & Ortega, 2000) | Rows stream into a 256-row int16 accumulator per stratum. When a strip fills, the S-transform runs on it in parallel, brushes are encoded on a bounded pool (`MAX_TASKS`), and the means cascade into the next stratum's accumulator. The seed is collected at the top. | `ingest/Accumulator.java`, `ingest/Drain.java`, `ingest/BandFeeder.java`, `ingest/ImagePass.java`, `ingest/Window.java` | Ingests gigapixel images in one sequential read, with memory bounded by a few strips per stratum. |
| **Bounded-buffer read-ahead**<br>*Known* (producer–consumer) | A virtual thread decodes rows into an `ArrayBlockingQueue` while the pyramid consumes them. | `ingest/ReadAheadReader.java` | Overlaps decoding with transform and encode work. |
| **Sketch from an embedded overview**<br>*Project* | Picks the smallest reduced TIFF pyramid page that is still at least the sketch size and matches the master's aspect within tolerance. Samples it at a 1/q stride (nearest neighbour), then builds the mean pyramid and seed with zero-detail brushes. | `ingest/sketch/SketchBuilder.java`, `ingest/sketch/Overview.java` | A browsable sketch in seconds, before the full ingest finishes. |
| **Magic-number format detection**<br>*Known* | Reads magic bytes (JPEG SOI, PNG signature, TIFF II/MM, PSB `8BPS`). Unknown formats fall back to ImageIO. | `ingest/MasterReaders.java`, `ingest/decode/FormatMarkers.java` | Picks a decoder from the content, not the file extension. |
| **Canonical Huffman decoding**<br>*Known* (ITU T.81, Annex C/F) | A 9-bit lookahead table decodes short codes in one step. Longer codes walk the `maxcode` table. | `ingest/decode/jpeg/JpegHuffman.java` | Fast entropy decoding of baseline JPEG. |
| **JPEG scan decoding**<br>*Known* (ITU T.81) | Bit reader with `FF00` unstuffing and RST realignment. DC is DPCM from the previous block. AC is (run, size) pairs with `receiveExtend`. Zigzag order is mapped to natural order, then dequantised. | `ingest/decode/jpeg/JpegBits.java`, `ingest/decode/jpeg/JpegScan.java`, `ingest/decode/jpeg/JpegTables.java` | Rebuilds the DCT coefficients. |
| **Integer IDCT (libjpeg islow)**<br>*Known* (Loeffler, Ligtenberg & Moschytz, 1989) | Separable 8×8 IDCT in two 1-D passes with fixed-point constants. | `ingest/decode/jpeg/JpegIdct.java` | Turns coefficients into pixels, bit-exact with libjpeg. |
| **Fancy chroma upsampling**<br>*Known* (libjpeg) | Triangle filter with weights 3/4, 1/4 for h2v1/h2v2. Box replication for other factors. | `ingest/decode/jpeg/JpegUpsample.java` | Smooth chroma at full resolution. |
| **YCbCr → RGB in fixed point**<br>*Known* (JFIF) | Lookup tables of the scaled coefficients, no floating point. | `ingest/decode/RasterRgb.java` | Colour conversion of decoded JPEG pixels. |
| **Pipelined MCU decoding**<br>*Adapted* (pipeline parallelism) | Entropy-decodes MCU row group N+1 while row group N runs IDCT in parallel. | `ingest/decode/jpeg/JpegReader.java` | Uses every core on a format whose entropy coding is sequential. |
| **PNG unfiltering (incl. Paeth)**<br>*Known* (PNG spec; Paeth, 1991) | Per-row filters None, Sub, Up, Average and Paeth (`p = a + b − c`, then whichever of a/b/c is nearest to p). | `ingest/decode/png/PngUnfilter.java` | Reverses PNG prediction. |
| **zlib inflate of streamed IDAT**<br>*Known* (RFC 1950/1951) | IDAT chunks are joined into one stream and passed to `InflaterInputStream`. | `ingest/decode/png/IdatInputStream.java` | PNG decompression without buffering the whole file. |
| **LZW decoding**<br>*Known* (Welch, 1984; TIFF 6.0) | 9–12-bit codes, Clear/EOI, early change, a table that copies from the output, and the KwKwK case. | `ingest/decode/tiff/TiffLzw.java` | LZW-compressed TIFF strips and tiles. |
| **TIFF horizontal predictor**<br>*Known* (TIFF 6.0, predictor 2) | Each strip or tile is decompressed (LZW, Deflate, PackBits or none), then the predictor is undone as a running prefix sum per row. WhiteIsZero is inverted. Chunks decode in parallel. | `ingest/decode/tiff/TiffChunk.java`, `ingest/decode/tiff/TiffReader.java` | TIFF masters, including the usual GigaPixel export. |
| **PackBits RLE**<br>*Known* (Apple) | A signed header byte n: `0..127` means copy n+1 literal bytes, `−1..−127` means repeat the next byte 1−n times. | `ingest/decode/PackBits.java` | PackBits TIFF and PSB channels. PSB rows decode in parallel. |

### 1.9 Storage, recovery and intake

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Data-before-index commit**<br>*Adapted* (ordered writes, as in journaling file systems) | Spans are reserved atomically (`AtomicLongArray`) and written with positional writes. The 40 B index record is written only after its data. A sentinel marks a missing brush. | `store/StoreWriter.java`, `store/IndexEntry.java` | Parallel writers without locks, and the index never points at bytes that are not there. |
| **Crash recovery by truncation**<br>*Adapted* | On open, every `.pinc` is truncated to the largest end its index records. On restart, works are rebuilt from their `meta.json`: ready works (and works still serving their sketch) are loaded again, and withdrawn works and superseded sketches are deleted. | `store/StoreWriter.java`, `catalog/WorkRecovery.java` | Removes partial writes after a crash and restores the catalogue. |
| **Bounded FIFO map**<br>*Known* (FIFO eviction) | A `LinkedHashMap` in insertion order whose `removeEldestEntry` drops the oldest entry past a fixed size. | `store/BadBands.java` | Remembers corrupt bands in bounded memory, so each is reported once. |
| **Post-order tree deletion**<br>*Known* | Walks the tree and deletes the deepest entries first. | `store/Trees.java` | Removes a work's directory tree. |
| **Deferred reclamation**<br>*Project* | A withdrawn work's files are deleted only once its last canvas is closed and every book that references it has expired (`L + δ`). A superseded edition goes once no canvas uses it. Checked on a clock tick. | `app/DiskReaper.java` | Deletes works while clients still hold loans on them, without breaking those loans. |
| **Transfer-completion detection**<br>*Project* | Polls until the file size is stable, with stall and empty timeouts. Then checks the trailer for the format: zip EOCD, PNG `IEND`, JPEG `EOI`. | `intake/FileTransferWaiter.java` | Ingests an inbox file only after it has fully arrived. |

---

## 2. Client (TypeScript / React)

### 2.1 Decoding and image synthesis

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Table-driven CRC-32C**<br>*Known* (Sarwate, 1988) | 256-entry table of the reflected polynomial `0x82F63B78`, one byte per step. | `shared/codec/crc32c.ts` | Checks each band before decoding. A mismatch is refused (spec §5.4) and fetched again. |
| **Raw inflate**<br>*Known* (RFC 1951) | Native `DecompressionStream('deflate-raw')`. | `shared/codec/inflate.ts` | Decompresses bands and the seed without a JS inflate library. |
| **LEB128 / zigzag decoding**<br>*Known* | 7-bit groups, with a guard at 53 bits (the JS safe-integer limit). Zigzag back to signed. | `shared/codec/leb128.ts`, `shared/codec/byte-reader.ts` | Reads coefficient values and header integers. |
| **Sparse band decoding**<br>*Project* | Walks the band's membership bitmap. Each set bit takes the next planar values for Y, Co and Cg. | `workers/synth-decode.ts` | Rebuilds the quantised residuals of the parents a band carries (inverse of the server's encode pipeline). |
| **DPCM decoding (seed)**<br>*Known* | Prefix sum along each row, the inverse of left-neighbour prediction. | `workers/synth-decode.ts` (`decodeSeedPlanes`), `shared/codec/seed.ts` | Rebuilds the opening sketch. |
| **Inverse S+P and inverse S-transform**<br>*Known* | `deq` gives the midpoint reconstruction. `spPredict` adds the predicted H/V back, with the parent crop clamped at the image edge. `liftBlock` undoes the Haar lifting on each 2×2 block. Missing bands count as zero detail. | `shared/codec/spInverse.ts`, `workers/synth-lift.ts` (`liftPlanes`), `workers/synth-parents.ts` | Builds the finer stratum from the parent's means plus the bands held. More bands give a sharper image. |
| **Inverse YCoCg-R**<br>*Known* | `t = Y − (Cg>>1)`, `G = Cg + t`, `B = t − (Co>>1)`, `R = B + Co`, clamped to 0–255 and packed as RGBA. | `shared/codec/ycocgr.ts`, `workers/planes-rgba.ts` | Converts the planes to displayable pixels. |
| **S3-FIFO cache**<br>*Known* (Yang et al., SOSP 2023) | Three FIFO queues: small, main and ghost. A hit raises a frequency counter capped at 3, without reordering. Evicting from small promotes items with freq > 0 to main and leaves a ghost key for the rest. A ghost hit is admitted straight to main. | `workers/synth-cache.ts` (`ParentPlaneCache`), sized in `workers/synth-parents.ts` | Keeps parent planes in each worker, so refining a brush does not decode its ancestors again. Scan-resistant during pans, with no LRU list. |
| **Area-weighted box downsampling**<br>*Known* (area averaging) | For each output pixel, `spans` computes source spans with fractional coverage weights. Rows are reduced, then columns (separable). `patchRegion` recomputes only a dirty rectangle. | `workers/plane-shrink.ts`, `workers/preview-finish.ts` | Alias-free gallery thumbnails at any size. |
| **Block-then-smooth upscale**<br>*Adapted* | When the image is enlarged at least `IMAGE_SMOOTHING_THRESHOLD` times, each sample first becomes a sharp k×k block (k = whole scale factor). Only the remaining fraction is scaled with the canvas's high-quality smoothing. | `shared/codec/seed.ts` (`drawScaledRgba`) | Draws the seed at screen size without heavy blur or blockiness. |
| **Hash-chained incremental recomposition**<br>*Adapted* (Merkle-style invalidation + dirty rectangles) | Each brush of a preview level carries a signature: its delivery numbers plus its parent's signature, so a change above invalidates everything below. Only brushes whose signature changed are decoded and placed again. The changed area grows as a bounding-box union. | `features/preview-works/model/preview-compose.ts`, `features/preview-works/model/preview-levels.ts` | Gallery cards refine progressively without decoding the whole thumbnail again. |

### 2.2 Protocol and accounting

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **QUIC variable-length integer**<br>*Known* (RFC 9000 §16) | Same as the server. The 8-byte form goes through `BigInt`. | `shared/proto/varint.ts` | Frame field codec. |
| **ACK-range set encoding**<br>*Adapted* (RFC 9000) | Same layout as the server. | `shared/proto/ranges.ts` | `RECIBO`, `SOLTAR`, `RASPADO`, `INVENTARIO` sets. |
| **Scrape predicate evaluation**<br>*Project* | ALL, LOW_STRATUM, BANDS, LIST, and OUTSIDE (rectangle intersection test). | `entities/delivery/scrape.ts` | Finds the deliveries a `RASPAR` matches, so the reply is an exact set. |
| **Cumulative-ACK floor**<br>*Adapted* (TCP cumulative ACK) | A floor below which every number is settled, plus a sparse set above it. When a number arrives, the floor advances while the next number is in the set. | `entities/delivery/settlement.ts` | Says when every delivery up to N has arrived or been cancelled, as `RASPADO`/`INVENTARIO` require, in memory proportional to the gaps. |
| **Delayed / batched acknowledgement**<br>*Adapted* (TCP delayed ACK, RFC 1122) | A `RECIBO` is flushed every 8 deliveries or 100 ms, whichever comes first. `RENOVAR` is applied here as well. | `entities/delivery/sink/receipts.ts` | Fewer control frames, with bounded acknowledgement latency. |
| **Lazy lease expiry with inheritance**<br>*Adapted* (leases + lazy expiration) | Effective lease = `min(own, parent's effective)`, computed recursively. It is checked before each paint and on each incoming message, not on a timer, and skipped until the earliest lease in the book ends. Expired brushes go out in one batched `SOLTAR`. | `entities/delivery/sink/lease-expiry.ts` | Drops data whose loan ended, keeping the held set ancestor-closed. |

### 2.3 Memory management and eviction (Horizon, ADR-02)

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **α-β tracking filter**<br>*Known* | Per axis (x, y, zoom z): `x̂ = x + v·dt`, `e = meas − x̂`, `x = x̂ + α·e`, `v += (β/dt)·e`, with α = 0.5 and β = 0.2. The velocity halves every 0.5 s without views and resets after a 2 s gap. | `entities/delivery/gaze-motion.ts` | Estimates where and how fast the user is panning and zooming. |
| **Horizon: kinematic Bélády**<br>*Adapted* (Bélády's MIN, 1966; this project's approximation) | MIN evicts the item needed furthest in the future. Horizon estimates that time from the gaze motion. `T_s = gap / max(0.1·Vref, Vref + v·û)`, `T_z = max(0, z − s − 1) / max(0.1·Zref, Zref − v_z)`, `T = max(T_s, T_z)`. The brush with the largest `T_eff` goes first. | `entities/delivery/horizon-rank.ts` (`timeToNeed`, `rankHorizon`) | Eviction order: drop what the gaze will reach last. No LRU (professor's rule). |
| **Attention heat**<br>*Adapted* (exponentially decayed frequency) | When a view is replaced, its brushes are credited the seconds it was on screen, capped at 30 s per view. Heat decays with a 120 s half-life. `T_eff = T / (1 + 0.5·heat)`. | `entities/delivery/attention-heat.ts` | Keeps regions the user studied, so revisits are cheap. Measures dwell, not recency. |
| **Eviction candidate filter**<br>*Project* (spec §5.2.3) | Leaves only (no held children), never the sketch, never the on-screen core, and never a brush inside a cone the server may still be painting (unless the book is full, so nothing can be on the wire). The cone test uses rings ×2^j and rectangle intersection. | `entities/delivery/evict-candidate.ts` | Eviction never breaks ancestor closure or removes what is in flight or visible. |
| **High/low watermark reclamation**<br>*Adapted* | Triggers at `max − 8` brushes, above 90 % of bytes, when the byte window has room for fewer than 8 more deliveries, or on a VRAM allocation failure. Evicts in Horizon order down to 75 %, out-of-cone brushes first. A second phase frees room for a missing core. | `entities/delivery/sink/eviction.ts` (`relieve`) | Keeps the browser under its memory budget (brief requirement). `SOLTAR motivo=1` tells the server. |
| **Conservative cone merging**<br>*Project* | Past views whose cones may still be painted are kept as rectangles. Beyond 16 entries, the two oldest merge into their bounding box with the finer focus. A box that contains another still contains it after scaling, so the merged test is a superset. | `entities/delivery/painted-cones.ts` | Cheap, never-wrong "may still be painted" test for the candidate filter. |
| **Subtree removal (DFS)**<br>*Known* (depth-first search) | DFS over `descendants`. `parentFor` picks the best held ancestor. | `entities/delivery/sink/removal.ts`, `entities/delivery/sink/brush-graph.ts` | Removes a brush and its subtree as one unit, and finds what to draw in its place. |
| **Nearest-k residency**<br>*Adapted* (k-nearest selection) | A brush keeps its decoded planes only while a child of it can be planned soon (in the current cone above the focus, a root stratum, under a pixel readout, or awaited). Beyond `PLANES_HELD_MAX` (16) such brushes, the farthest from the view drop first. Under WebGL the bitmap is closed once the tile is uploaded. Band bytes always stay, so both can be rebuilt. | `entities/delivery/sink/plane-keep.ts`, `entities/delivery/sink/cold-planes.ts`, `entities/delivery/sink/pixel-residency.ts` | A second memory tier: bounds RAM spent on decoded pixels without dropping loans. |
| **Windowed priority rebuild queue**<br>*Project* | Released brushes are rebuilt coarse first (children come from them), then nearest the focus, with at most `PIXEL_RESTORE_WINDOW` running. | `entities/delivery/sink/restore-queue.ts` | Re-decodes in the order that improves the screen fastest, without flooding the workers. |

### 2.4 Flow control and measurement

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Little's-law receiver window**<br>*Adapted* (Little, 1961; bandwidth-delay product) | `window = ceil(rate × (CREDIT_WINDOW_S + minRTT) / avgDelivery)`, at least `CREDIT_MIN` and at most the memory window. `byteRoom` and `coming` take off what may already be on its way. | `entities/delivery/credit.ts` (`receiverWindow`, `byteRoom`, `coming`), `entities/delivery/sink/credit-window.ts` (`free`) | The credit the client advertises in `RECIBO.libre`: enough to keep the link full, no more than memory allows. |
| **Windowed min-RTT filter**<br>*Adapted* (BBR's min_rtt, Cardwell et al., 2016) | An RTT sample is the time from a `MIRADA` to the first `PLAN` for it. The minimum over a sliding time window is used. | `entities/delivery/sink/min-rtt.ts` | Propagation delay without queueing delay, as input to the window. |
| **EWMA**<br>*Known* | Decode time: `avg = 0.8·avg + 0.2·sample`, and `cola_ms = (inWorker + waiting)·avg / parallel`. The same averaging is applied to delivery sizes. | `entities/delivery/decode-queue.ts`, `entities/delivery/sink/ingest.ts` | The backlog reported to the server (drives its traffic light), and the average delivery size the window uses. |
| **Bucketed sliding-window rate meter**<br>*Known* | A ring of 240 buckets of 250 ms (60 s). Live rate over a recent window, and the peak 1 s rate. | `shared/lib/rate-meter.ts` | Link rate for the receiver window, and the stats panel. |

### 2.5 Scheduling and concurrency

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Binary heap priority queue**<br>*Known* (Williams, 1964) | Key: newest epoch, coarser stratum, nearer the focus, delivery number, then insertion seq. Push and pop are O(log n). | `entities/delivery/synth-queue.ts` | Synthesises the brushes that matter most first, and lets them reorder while they wait. |
| **Least-loaded dispatch (depth 1)**<br>*Known* | Pool size = cores − 1, clamped. A job goes only to an idle worker, so nothing queues inside a worker's mailbox. | `entities/delivery/worker-pool.ts` | Parallel decoding off the main thread while priorities stay controllable. |
| **Cache-affinity dispatch**<br>*Known* (affinity scheduling) | If the worker that synthesised the parent is idle, the child goes there by reference. Otherwise the bytes are sent. | `entities/delivery/sink/synth-dispatch.ts` (`pickWorker`) | Hits that worker's S3-FIFO cache and skips copying the parent planes. |
| **Bounded FIFO maps**<br>*Known* (FIFO eviction) | `Map` in insertion order. The oldest key is deleted past a fixed size (1024 departures, `maxHandles` ledgers). | `entities/delivery/departures.ts`, `entities/delivery/ledgers.ts` (`HandleLedgers`) | Bounded history for diagnostics and for answering server audits on retired handles. |
| **Frame coalescing, throttle and debounce**<br>*Known* | Updates inside one animation frame are merged into one `requestAnimationFrame` callback. `MIRADA` goes out at most once per frame, plus a final "still" view after the user stops (debounce), and a keep-alive resend while the view stays still. The seq is monotonic. | `shared/lib/frame-batch.ts`, `features/send-gaze/index.ts` (`GazeSender`) | Responsive view updates without flooding the server or redrawing twice per frame. |
| **Capped exponential backoff**<br>*Known* | `delay = min(MAX, BASE·2^retries)`. | `app/providers/seurat/reconnect.ts` | Reconnects without hammering a server that is restarting. |
| **Watchdog timer**<br>*Known* | A deadline that resets on every frame received. When it expires, the client declares the link dead. | `entities/session/client/watchdog.ts` | Detects silent connection loss. |

### 2.6 Rendering

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Painter's algorithm**<br>*Known* (Newell et al., 1972) | Brushes are drawn from the coarsest stratum to the finest, so finer ones cover coarser ones. Only the newest delivery per brush is used. | `entities/delivery/lib/brush-cull.ts` (`collectBrushes`) | Correct layering without a depth buffer. Coarse data shows through where fine data is missing. |
| **Quadtree LOD and occlusion culling**<br>*Adapted* (mipmap selection) | Skips a brush when an ancestor already gives ≤ 1 texel per device pixel. Skips a parent when all 4 children are drawn. Results are memoised (`BrushCuller`). | `entities/delivery/lib/brush-cull.ts` (`cullBrushes`) | Draws nothing finer than the screen can show and nothing that is fully covered. Also used for the minimap. |
| **Recursive quadtree coverage test**<br>*Project* | A region counts as covered if each tile is drawn, or all 4 of its children are covered, recursively. Pigeonhole early exit: if the region has more tiles than the drawn set, it cannot be covered. | `widgets/viewer-canvas/canvas2d/tile-cover.ts` (`tilesCover`) | Coverage test behind the occlusion culling. |
| **Pixel snapping**<br>*Known* | Rounds tile edges to device pixels, so neighbouring tiles share an edge. | `widgets/viewer-canvas/canvas2d/tile-cover.ts` (`snapSpan`) | No hairline gaps between tiles. |
| **Texture-array slot allocator**<br>*Adapted* (lowest-free-slot allocation) | Layers of a `TEXTURE_2D_ARRAY` are given out lowest index first. Arrays grow and shrink. Each frame, the set of live brushes is diffed against the uploaded layers. Uploads go out within a per-frame time budget (at least one per frame), sketch first, then coarse to fine. | `widgets/viewer-canvas/gl/tile-atlas.ts`, `widgets/viewer-canvas/gl/layer-arrays.ts`, `widgets/viewer-canvas/gl/gl-renderer.ts` | Packs tiles into GPU memory compactly and avoids frame drops when many tiles arrive at once. |
| **Hashed jittered dot mask**<br>*Adapted* (jittered sampling, Cook 1986; integer hash with xxHash32 primes) | `hash3` mixes cell coordinates by multiply–xorshift into 3 values in [0, 1], which set each dot's offset and size. Canvas2D punches the dots out with `destination-out`. The GL shader computes antialiased dot coverage analytically. | `widgets/viewer-canvas/lib/pointillism.ts`, `shared/lib/hash3.ts`, `widgets/viewer-canvas/gl/shaders/tiles.ts` | The Seurat pointillist look, the same on every frame and stable while panning. |
| **Closed-form Gaussian rectangle shadow**<br>*Known* (erf via Abramowitz & Stegun 7.1.27) | A Gaussian-blurred rectangle is a product of erf differences on x and y. `erf(x) ≈ 1 − 1/(1 + a1·x + a2·x² + a4·x⁴)⁴`, with the tiny cubic term dropped. | `widgets/viewer-canvas/gl/shaders/scene.ts` (`SHADOW_FS`), `widgets/viewer-canvas/gl/shaders/common.ts` (`ERF`) | Soft canvas shadow in one shader pass, with no blur pass. |
| **9-slice scaling**<br>*Known* | Shadow corners stay fixed and edges stretch. A frame is a rectangle minus a hole, split into 4 bands. | `widgets/viewer-canvas/lib/sprite-geometry.ts` | Canvas2D fallback for the shadow and frame. |
| **Frame-time percentiles**<br>*Known* | Ring of 120 frame gaps. Mean, and p95 by sorting. Gaps longer than 250 ms count as idle and are left out. | `widgets/viewer-canvas/model/frame-meter.ts` | Frame meter overlay. |
| **Backing-store pixel cap**<br>*Project* | `scale = sqrt(maxPx / px)`, so `(css × dpr × scale)² ≤ RENDER_MAX_BACKING_PX`, snapped down onto a fixed step. | `shared/lib/render-scale.ts` | Caps the number of pixels shaded on large or high-DPI screens. |
| **JIT detection microbenchmark**<br>*Project* | Times a loop over a typed array against a native sort of the same data. A slow machine slows both, a missing JIT only the loop. | `shared/lib/script-speed.ts` | Detects an interpreter-only JS engine and lowers the work accordingly. |

### 2.7 View and interaction

| Algorithm | How it works | Where | Function |
|---|---|---|---|
| **Fractional level-of-detail selection**<br>*Adapted* (mipmap LOD) | `idealDensity = log2(image px / screen px)`, then `strataFor` and `bandsFor` (same formula as the server). `viewToRoi` clamps the region to the image and never inverts it. Gallery cards use the same formula (`gazeLevel`). | `entities/viewport/math.ts`, `features/preview-works/model/preview-gaze.ts` | Client-side mirror of the cone: what is on screen and what it needs. |
| **Zoom about a fixed point**<br>*Known* (affine transform) | `t' = p − (p − t)·(s'/s)`, which keeps the point under the cursor or pinch centre fixed. | `features/zoom-view/zoom.ts` (`zoomTarget`) | Zooms about the cursor or the pinch centre. |
| **Logarithmic zoom mapping**<br>*Known* | Wheel: `s' = s·exp(−dy·k)`. Slider: `frac = log(s/min) / log(max/min)`, with the inverse `logUnfrac`. | `features/zoom-view/zoom.ts` (`wheelZoom`), `shared/lib/zoom.ts` (`logFrac`, `logUnfrac`) | Zoom speed feels the same at every scale. |
| **Pinch zoom**<br>*Known* | Ratio of the current to the starting two-finger distance, about their midpoint. | `features/pan-view/pointer-gestures.ts` | Touch zoom. |
| **EMA velocity + inertial fling**<br>*Adapted* (kinetic scrolling) | Drag velocity: `v = 0.8·(dx/dt) + 0.2·v`. On release within 60 ms of the last move, target = position + `v × 170 ms`. | `features/pan-view/pointer-gestures.ts`, `features/pan-view/pan.ts` (`flingTarget`) | Natural momentum after a drag. |
| **Exponential smoothing in log scale**<br>*Known* (exponential smoothing) | Each frame: `s ← s·exp(log(ts/s)·0.2)`, so zoom moves geometrically, keeping the anchor point fixed. The pan residual eases with `t += (target − t)·0.2`. Both stop below an epsilon. | `features/zoom-view/model.ts` (`tickView`), constants in `shared/config/view.ts` | Smooth zoom and pan, independent of the input rate. |

---

## 3. Shared algorithms (server ↔ client)

These come in pairs: the server runs the forward or encode direction and the client runs the
inverse or decode. They must stay bit-exact with each other and with the spec's wire goldens
(§3.4.1–3.4.4).

| Algorithm | Server (forward / encode) | Client (inverse / decode) |
|---|---|---|
| YCoCg-R | `codec/YCoCgR.java` | `shared/codec/ycocgr.ts`, `workers/planes-rgba.ts` |
| Integer S-transform | `codec/TransformS.java` | `shared/codec/spInverse.ts`, `workers/synth-lift.ts` |
| S+P prediction | `codec/PredictSP.java` | `shared/codec/spInverse.ts` (`spPredict`) |
| Dead-zone quantisation | `codec/Quant.java` | `shared/codec/spInverse.ts` (`deq`) |
| Band format (bitmap + planar values) | `codec/BrushEncoder.java` | `workers/synth-decode.ts` |
| Seed DPCM | `codec/SeedCodec.java` | `workers/synth-decode.ts`, `shared/codec/seed.ts` |
| Zigzag + LEB128 | `proto/Leb128.java` | `shared/codec/leb128.ts` |
| DEFLATE raw | `codec/Deflate.java` | `shared/codec/inflate.ts` |
| CRC-32C | `codec/BrushEncoder.java`, `store/BandReader.java` | `shared/codec/crc32c.ts` |
| QUIC varint | `proto/VarInt.java` | `shared/proto/varint.ts` |
| ACK ranges | `proto/RangesCodec.java` | `shared/proto/ranges.ts` |
| Fractional LOD (stratum/bands) | `plan/ConePlanner.java` | `entities/viewport/math.ts` |
| Morton / brush id | `codec/Morton.java`, `codec/BrushId.java` | `shared/proto/brush.ts` |
