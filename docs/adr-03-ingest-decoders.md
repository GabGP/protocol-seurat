# ADR-03 — Ingest decoders: own streaming readers, no vendored image library

Status: accepted. Date: 2026-09-28. Context: offline grade, JDK first.

## Question

Ingest reads a master once, band by band (`MasterReader`: 256 rows of packed RGB at a time), and
turns it into the pyramid. Which decoder should read each format: the JDK's ImageIO, a vendored
library (TwelveMonkeys, Bio-Formats, libvips), or readers of our own?

## Decision

`MasterReaders.open` picks the reader **by content, never by extension**, and falls through in this
order:

| Order | Reader | Takes | Notes |
|---|---|---|---|
| 1 | `PngReader` (existing) | PNG, non-interlaced | parallel inflate + unfilter |
| 2 | `JpegReader` | baseline JPEG, any sampling | **new:** 4:2:0 / 4:2:2 / 4:4:0 via `JpegUpsample` (libjpeg "fancy" upsampling, bit-exact with ImageIO) |
| 3 | `TiffReader` | TIFF and BigTIFF, strips or tiles, 8-bit gray/RGB(A), WhiteIsZero | **new:** none / LZW / Deflate / PackBits, horizontal predictor; chunks decode in parallel |
| 4 | `PsbReader` | PSB and PSD merged image, 8-bit RGB or gray | **new:** raw or RLE (PackBits) data, rows decode in parallel |
| 5 | `ImageIoReader` | everything else | progressive JPEG, interlaced PNG, 16-bit/palette/JPEG-compressed TIFF, GIF, BMP |

Intake admits `.png .jpg .jpeg .tif .tiff .psb .psd` and `.zip` (`MasterFormats`). A TIFF or
Photoshop file counts as fully transferred once every byte its reader needs is on disk.

**ICC profiles are ignored everywhere.** Samples are used as stored and treated as sRGB. This
includes the ImageIO fallback (`RasterSamples`: 16-bit samples keep their top byte).

**No image library is vendored.**

## Method

- **Machine:** 16 cores, 63.9 GB RAM, Windows 11 Pro, OpenJDK 21.0.12, `-Xmx20g`.
- **What is timed:** a full streaming decode through `MasterReader.next()`, from open to the last
  band, reported in Mpx/s.
- **Correctness:** every candidate was checked against ImageIO pixel by pixel. They matched
  exactly (max channel diff 0) except where ICC handling differs (see ICC).
- **Libraries tried**, each behind the same `MasterReader` interface:
  - TwelveMonkeys 3.15.2 (ImageIO plugins)
  - Bio-Formats 8.3.0 (`bioformats_package.jar`)
  - libvips 8.18.6 (via pyvips, as a stand-in for an FFM binding)
  - Pillow 12.0.0, as a native-C reference. Pillow is not a candidate.
- **libvips thread counts:** results are given as 1 thread / 16 threads.
- **Our readers:** TIFF was also measured at 1 thread and at 16 threads.

**Test files**

| File | Size | Encoding |
|---|---|---|
| `j444` / `j420` | 32768×16384 synthetic photo | JPEG 4:4:4 / 4:2:0 |
| `t_raw` / `t_deflate` / `t_lzw` | the same pixels, 256-row strips | TIFF: none / Deflate / LZW |
| `big_raw` | the same pixels | BigTIFF, no compression |
| `raw.psb` | the same pixels | PSB, raw data |
| ESO `eso1242a.tif` | 40000×30131, 4.2 GB | LZW + predictor, embedded ICC |
| Leipzig | 64172×45559, 1.6 GB | baseline JPEG 4:4:4 |
| `004-050-000-6650032.png` | 36743², 4.1 GB | PNG |

**Pass ceiling.** The rest of the ingest pass (transform, encode, store), fed from RAM, runs at
**65–71 Mpx/s**. That is as fast as any decoder can make ingest. Past it, extra decoder speed
buys nothing, but any decoder below it slows the whole ingest down.

## Results (Mpx/s)

"Before" is production before this change. "Now" is the production readers above, through
`MasterReaders.open`.

| File | Before | **Now** | ImageIO | TwelveMonkeys | Bio-Formats | libvips 1/16 | Pillow |
|---|---|---|---|---|---|---|---|
| JPEG 4:4:4 synthetic | 42 | **50.4** | 7.5 | 7.7 | 11.6 | 83 / 100 | 95 |
| JPEG 4:4:4 Leipzig | 80.2 | **82.0** | 5.4–63 ¹ | – | – | 111 / 146 | 138 |
| JPEG 4:2:0 | 11 | **69.9** | 11.2 | 11.5 | 12.1 | 107 / 136 | 133 |
| PNG 36743² | 344 | **342** | 1.5 | – | 6.3 | 186 / 246 | 254 |
| TIFF raw | 53 | **688** | 53.4 | 39.3 | 51.2 | 307 / 526 | 720 |
| TIFF Deflate | 40 | **879** | 39.5 | 20.5 | 54.2 | 250 / 421 | 442 |
| TIFF LZW | 32 | **772** | 31.8 | 12.7 | 43.9 | 157 / 206 | 233 |
| ESO (LZW + predictor, ICC) | 2.3 | **279** | 2.3 | 1.0 | 8.2 | 73 / 81 | 82 |
| BigTIFF raw | unsupported | **608** | unsupported | 38.6 | 50.1 | 311 / 611 | – |
| PSB raw | unsupported | **1091** | unsupported | 32.3 | 123.1 | unsupported | – |

¹ ImageIO slows down quadratically as it reads deeper into the file.

**Our TIFF reader on 1 thread:** raw 451, Deflate 148, LZW 138, ESO 42.4, BigTIFF 432. Even on
one core it beats every Java option.

**Wall time for the ESO decode:**

| Reader | Time |
|---|---|
| ImageIO | 525 s |
| TwelveMonkeys | 1158 s |
| Bio-Formats | 147 s |
| Ours | **4.3 s** |

**End to end:** ESO ingest went from about 9 min to about 18 s, and 4:2:0 JPEG ingest is about 6×
faster. Both now run at the pass ceiling.

## Why each alternative was rejected

- **ImageIO only (the JDK status quo).**
  - It decodes on one thread and applies ICC conversion per pixel. On ESO that runs at 2.3 Mpx/s.
  - It has no BigTIFF and no Photoshop support.
- **TwelveMonkeys.**
  - Its JPEG reader delegates to the JDK's decoder, so it gains nothing there.
  - Its TIFF reader is slower than the JDK's (ESO: 1158 s).
  - It adds BigTIFF and PSB, but at 32–39 Mpx/s, below the pass ceiling.
- **Bio-Formats.**
  - It is GPL and 54 MB.
  - It is the fastest Java library, but still 2–50× slower than our readers on every format
    except ESO. Even there it takes 147 s against our 4.3 s.
- **libvips.**
  - It only wins on dense JPEG (100–146 Mpx/s against our 50–82). Ingest is capped at 65–71
    Mpx/s anyway, so that edge mostly disappears.
  - It is slower than our readers on PNG, TIFF and BigTIFF, and it cannot read PSB.
  - From Java it needs FFM, which is a preview API in Java 21, plus native binaries for each OS
    and architecture shipped offline. It is LGPL.
- **Our own progressive JPEG decoder.** Progressive scans refine every coefficient of the whole
  image, so a streaming decoder has to keep all of them. For Leipzig that is about 17 GB.
  Progressive JPEG stays on ImageIO.

## ICC policy

Our readers use samples as stored. On ESO they produce checksum 46629, the same as Bio-Formats
(which also ignores ICC). ImageIO gives 54709 because it converts through the embedded profile.
That conversion was the entire 2.3 Mpx/s bottleneck.

- **Cost:** a master in a wide-gamut space (Adobe RGB, ProPhoto) shows slightly desaturated,
  because its samples are displayed as sRGB.
- **Why we accept it:** most gigapixel sources publish sRGB or untagged files, and the viewer
  paints sRGB.
- The fallback follows the same rule, so a master looks the same whichever reader takes it.

## Evidence

- **Reader tests** in `server/test/seurat/ingest/` (per format under `decode/<format>/`):
  - `TiffReaderTest`:
    - every compression, in strips and in tiles, including with the predictor
    - BigTIFF in both byte orders
    - RGBA, WhiteIsZero and BlackIsZero
    - the files it must reject
  - `PsbReaderTest`: PSD and PSB × raw and RLE × RGB(A) and gray, plus the files it must reject.
  - `JpegReaderTest`: each subsampling mode against ImageIO.
  - `MasterReadersTest`:
    - dispatch by content, with deliberately wrong extensions
    - the 16-bit linear-RGB fallback read as stored
    - transfer completeness
- **Mutation checks** (predictor, row flip, tile x, PSD/PSB entry sizes, RLE row base, the
  direct-sample test) were each caught by these tests.
