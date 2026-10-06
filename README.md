# Seurat Protocol (Seurat/1)

An asynchronous, server-authoritative protocol and viewer for streaming gigapixel images progressively as brush strokes (*pinceladas*) without ever transmitting the original master image or complete uncompressed bitmaps.

---

## Key Concepts

- **Points Over Bitmaps**: Resolution is measured in points/brushes across adaptive pyramid strata. As the user zooms in, only missing detail bands are transferred; zooming out requires zero network transfer.
- **Server Authority**: The server grants bounded density leases (`CONCESION`), tracks active loans (`LoanBook`), orders revocations (`RASPAR`), and regulates egress bandwidth based on viewer priority.
- **Bounded Client Memory**: The client maintains a strict cache budget, voluntarily evicting with the client-side **Horizon** policy (predicted time-to-need from gaze motion, attention heat, lease horizon; see `docs/adr-02-horizon-evict.md`) and acknowledging purged leases (`SOLTAR`).
- **Single Egress**: All outgoing brush tiles pass through a central chooser thread and virtual workers in `core/viewing/paint/Painter.java`, guaranteeing strict prioritization and rate regulation.

---

## Project Structure

```
.
├── server/src/seurat/          # Java 21 backend (single-responsibility modules <150 LoC)
├── server/test/seurat/         # Backend test suite (wire goldens and invariant tests <300 LoC)
├── client/                     # Modern React + TypeScript viewer (Feature-Sliced Design)
│   ├── src/                    # FSD layers (app, pages, widgets, features, entities, shared), files <150 LoC, tests <300 LoC
│   └── dist/                   # Compiled static production bundle
├── scripts/
│   ├── run-tests.sh            # Compiles & executes backend tests + checks LoC budgets (server and client)
│   ├── check-loc.sh            # Validates strict line-of-code budgets for .java, .ts and .tsx
│   ├── clean.sh                # Cleans ephemeral build artifacts without touching runtime data
│   └── smoke-viewer.mjs        # Headless-browser smoke test of the viewer against a running server
├── run.sh                      # Bash server builder & launcher (Linux / macOS / WSL)
├── run.ps1                     # PowerShell server builder & launcher (Windows)
├── seurat.conf                 # Runtime server configuration
└── .seurat/                    # Unified runtime data and build outputs (uncommitted)
    ├── runtime/
    │   ├── inbox/              # Watched drop folder for raw master images & zip archives
    │   └── obras/              # Processed multi-scale pyramidal strata & seed binaries
    └── build/                  # Compiled Java classes and test classes
```

---

## Prerequisites

- **Java 21 JDK**: Required for virtual threads, pattern matching, and modern NIO (or Java 20 with `--enable-preview`).
- **Node.js (v20+) & pnpm**: Required for building or developing the frontend client (`node -v >= 20`, `pnpm >= 9` or `npm`).

---

## Quick Start (How to Run)

### 1. Launch the Server

Run the unified bootstrap script from the repository root:

**Linux / macOS / WSL (Bash):**
```bash
bash run.sh
```

**Windows (PowerShell):**
```powershell
./run.ps1
```

This script automatically:
1. Rebuilds the frontend client if a Node toolchain is present (or serves pre-built assets in `client/dist/`).
2. Compiles the Java backend using standard `javac` (zero external Maven/Gradle downloads; the QUIC jars are vendored in `server/vendor/`).
3. Boots the asynchronous server on the configured port (default `8180` in `seurat.conf`).

### 2. Open the Viewer

Open your browser and navigate to:
```
http://localhost:8180/
```

The server serves the compiled Single Page Application (`client/dist/`) and serves both transport mappings on that port number: WebTransport (HTTP/3 over QUIC, UDP) on `/seurat/v1/lienzo` and WebSocket (TCP) on `/seurat/v1/lienzo-ws`. A page opened from `localhost` or over https uses WebTransport; a page opened by LAN address over plain http uses WebSocket, because browsers offer WebTransport only to secure pages (see `docs/adr-11-protocol-completion.md`). Every viewer gets full quality (stratum 0 with all 4 detail bands and no brush budget; see `docs/adr-05-no-roles.md`).

### 3. HTTPS (automatic)

The same port answers `http://` and `https://`, with nothing to configure: the server tells them apart by the first byte of each connection and, for https, presents a certificate it generates at boot (the one WebTransport already uses).

- **On the server machine** open `http://localhost:8180/`. Browsers treat `localhost` as a secure page, so the viewer uses WebTransport with no warning.
- **From another machine** `http://<address>:8180/` works at once over WebSocket, because browsers do not give WebTransport to a plain-http page. `https://<address>:8180/` uses WebTransport; the certificate is self-signed, so the browser warns once (*Advanced*, then *Proceed*). No public authority issues a certificate for a LAN address without internet, so that click cannot be removed.

A certificate of your own replaces the generated one on the TCP port: put a PKCS#12 keystore next to `seurat.conf` and set `tls.keystore` and `tls.password`.

---

## Ingesting Images & Works

Images can be ingested into the pyramid store directly through the viewer, by dropping files on the server disk, or via HTTP:

### Adding Works from the Gallery

The gallery header provides an **Add** button (top right) with a menu offering three intake options (see `docs/adr-04-open-intake.md` for the design and how it departs from the spec):

- **Upload file**: Select a local master image or a `.zip` archive to stream directly from your browser to the server (`PUT /seurat/v1/obras/{nombre}`). Open to all viewers (Origin check only; see `docs/adr-04-open-intake.md` and `docs/adr-05-no-roles.md`).
- **From link**: Paste an `http://` or `https://` URL; the server downloads the master directly into its staging area (`POST /seurat/v1/importar`).
- **From this computer** (available only when connecting from the server machine itself): Enter an absolute path to a master file already on the server's disk (`POST /seurat/v1/importar`). This is instant on the same volume because the server creates a hard link, leaving the original file intact (and falling back to copying only across different volumes).

A transfer dialog tracks upload progress, displays live ingest percentages from server `OBRA` notifications, and offers an **Open** button once ready. Gallery cards display a *Receiving* or *Processing N%* badge until the work is `LISTA`. Incoming files stream into `.seurat/runtime/staging/<nombre>.<hex>.part` and are moved atomically into `inbox/` only upon completion, preventing the file watcher from reading partial uploads (any leftover `.part` files are swept on boot).

### Dropping Files into Inbox (Automatic Ingest)

Place any PNG, JPEG, TIFF/BigTIFF, PSB/PSD image, or `.zip` archive of them directly into the `.seurat/runtime/inbox/` directory:
```bash
cp /path/to/my-image.png .seurat/runtime/inbox/mona-lisa.png
```
Or drop a multi-image zip archive:
```bash
cp /path/to/archive.zip .seurat/runtime/inbox/
```
The reader is picked by content: streaming parallel readers for PNG, baseline JPEG, 8-bit TIFF (none/LZW/Deflate/PackBits) and 8-bit RGB/gray Photoshop (raw/RLE), ImageIO for the rest. Embedded ICC profiles are ignored. See `docs/adr-03-ingest-decoders.md` for the benchmarks behind these choices. The server's background intake watcher will detect the file, unpack zip archives into `.seurat/runtime/inbox/<archive>.d/` caches, move each master out of the inbox into `.seurat/runtime/obras/<id>/master/`, construct multi-stratum pyramidal brushes and seed (`semilla.bin`), and register each work in the catalog (`.seurat/runtime/obras/`). A pass cut short by a restart runs again from that master.

### HTTP REST API

Master images and archives can be streamed over HTTP (the work ID is the filename without extension; Origin check only; see `docs/adr-04-open-intake.md` and `docs/adr-05-no-roles.md`):
```bash
curl -X PUT \
  --data-binary @/path/to/my-image.png \
  http://localhost:8180/seurat/v1/obras/mona-lisa.png
```

Or imported from a remote URL or server path:
```bash
curl -X POST \
  -H "Content-Type: text/plain" \
  -d "https://example.org/mona-lisa.tif" \
  http://localhost:8180/seurat/v1/importar
```

To rename a work (the display name only; the id and the files stay), or from the gallery with the edit button on its card:
```bash
curl -X PATCH -H "Content-Type: text/plain" \
  -d "Mona Lisa" \
  http://localhost:8180/seurat/v1/obras/mona-lisa
```

To withdraw and delete a work (open to any viewer, Origin check only; see `docs/adr-05-no-roles.md`), also available from the same edit dialog:
```bash
curl -X DELETE \
  http://localhost:8180/seurat/v1/obras/mona-lisa
```

---

## Development Mode

If you are developing the frontend client with hot-module reloading:

1. **Start Backend**:
   ```bash
   bash run.sh
   ```
2. **Start Frontend Dev Server**:
   ```bash
   cd client
   pnpm dev
   ```
   Open `http://localhost:5173/` in your browser. The Vite development proxy connects directly to the backend.

---

## Configuration (`seurat.conf`)

Server parameters can be customized in `seurat.conf`:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `http.port` | `8180` | Port number: TCP for HTTP static files, handshake and WebSocket; UDP for WebTransport (protocol default `8080`). |
| `webtransport` | `true` | Serve the WebTransport mapping on UDP; `false` leaves WebSocket only. |
| `tls.keystore` | *(empty)* | PKCS#12 keystore, relative to `seurat.conf`, used for https and wss instead of the certificate generated at boot (see *HTTPS* above). |
| `tls.password` | *(empty)* | Password of that keystore. |
| `inbox` | `.seurat/runtime/inbox` | Directory watched for incoming image and archive intake. |
| `works` | `.seurat/runtime/obras` | Directory containing committed multi-scale work packages. |
| `session.max_brushes`| `1024` | Maximum concurrent active brush grants per session. |
| `rate.bytes_per_s` | `25000000` | Global egress bandwidth cap (bytes/sec). |
| `ingest.keep_master` | `true` | Keep `obras/<id>/master/` after the ingest (`meta.json` `keepMaster`); `false` deletes it once the work is `LISTA`. |
| `log.level` | `INFO` | Console logging verbosity (`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`). |

---

## Running Verification & Tests

### Backend Tests (JDK 21)
To run all backend unit tests, golden wire vectors, loopback tests, and the LoC budget validation (server and client):
```bash
bash scripts/run-tests.sh
```

To check strict line-of-code budgets manually (`main < 150 LoC`, `test < 300 LoC`, for every `.java`, `.ts` and `.tsx` file; `--server` limits it to the backend):
```bash
bash scripts/check-loc.sh
```

### Frontend Tests (Vitest & TypeScript)
To run all client test suites and verify production build:
```bash
cd client
pnpm test          # Runs all Vitest unit and integration tests (590 tests in 108 files)
pnpm build         # Validates TypeScript types and generates production bundle
pnpm check         # Typecheck, tests, LoC budgets and the FSD import gate in one go
```

### Viewer Smoke Test (headless browser)
With the server running, drive the real viewer in headless Chrome/Edge (Node >= 22, no dependencies, offline):
```bash
node scripts/smoke-viewer.mjs --work The_Night_Watch_-_HD   # use a large work (1.6-31 GP)
```
It reads the Seurat/1 traffic on either mapping: from `localhost` the viewer uses WebTransport, and `--transport ws` hides it from the page to exercise the WebSocket fallback (`--transport wt` fails the run unless the session went over WebTransport). It opens the work, zooms in, and fails on page exceptions, `ERROR` frames, decode/CRC releases, no refinement past the first strata, or more than 2 % of deliveries refused on arrival. Set `CHROME` if the browser is not in a standard location; `--url`, `--seconds`, `--zoom` and `--shot` are optional. `--pan N` drags the view N times after zooming. The run reports the bands delivered at stratum 0, which shows that every viewer gets full detail (ADR-05):
```bash
node scripts/smoke-viewer.mjs --work 093-494-000-120123412 --zoom 7 --pan 6 --seconds 40
```

### Cleaning Build Artifacts
To clean build outputs without touching runtime data:
```bash
bash scripts/clean.sh            # Cleans .seurat/build/ (.class files)
bash scripts/clean.sh --runtime  # Also cleans unpacked .d caches and a leftover cobertura/ (unused since ADR-05)
```
