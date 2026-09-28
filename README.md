# Seurat Protocol (Seurat/1)

An asynchronous, server-authoritative protocol and viewer for streaming gigapixel images progressively as brush strokes (*pinceladas*) without ever transmitting the original master image or complete uncompressed bitmaps.

---

## Key Concepts

- **Points Over Bitmaps**: Resolution is measured in points/brushes across adaptive pyramid strata. As the user zooms in, only missing detail bands are transferred; zooming out requires zero network transfer.
- **Server Authority**: The server grants bounded density leases (`CONCESION`), tracks active loans (`LoanBook`), orders revocations (`RASPAR`), and regulates egress bandwidth based on viewer priority.
- **Bounded Client Memory**: The client maintains a strict cache budget, voluntarily evicting with the client-side **Horizon** policy (predicted time-to-need from gaze motion, attention heat, lease horizon; see `docs/adr-02-horizon-evict.md`) and acknowledging purged leases (`SOLTAR`).
- **Single Egress**: All outgoing brush tiles pass through a central chooser thread and virtual workers in `paint/Painter.java`, guaranteeing strict prioritization and rate regulation.

---

## Project Structure

```
.
├── server/src/seurat/          # Java 21 backend (single-responsibility modules <150 LoC)
├── server/test/seurat/         # Backend test suite (wire goldens and invariant tests <300 LoC)
├── client/                     # Modern React + TypeScript viewer (Feature-Sliced Design)
│   ├── src/                    # FSD layers (app, pages, widgets, features, entities, shared)
│   └── dist/                   # Compiled static production bundle
├── scripts/
│   ├── run-tests.sh            # Compiles & executes backend tests + checks LoC budgets
│   ├── check-loc.sh            # Validates strict line-of-code budgets
│   ├── clean.sh                # Cleans ephemeral build artifacts without touching runtime data
│   └── smoke-viewer.mjs        # Headless-browser smoke test of the viewer against a running server
├── run.sh                      # Bash server builder & launcher (Linux / macOS / WSL)
├── run.ps1                     # PowerShell server builder & launcher (Windows)
├── seurat.conf                 # Runtime server configuration
└── .seurat/                    # Unified runtime data and build outputs (uncommitted)
    ├── runtime/
    │   ├── inbox/              # Watched drop folder for raw master images & zip archives
    │   ├── obras/              # Processed multi-scale pyramidal strata & seed binaries
    │   └── cobertura/          # Persistent principal coverage token buckets
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
2. Compiles the Java backend using standard `javac` (zero external Maven/Gradle downloads).
3. Boots the asynchronous server on the configured port (default `8180` in `seurat.conf`).

### 2. Open the Viewer

Open your browser and navigate to:
```
http://localhost:8180/
```

The server serves the compiled Single Page Application (`client/dist/`) and manages WebSocket connections on `/seurat/v1/lienzo-ws`.

---

## Ingesting Images & Works

Images can be ingested into the pyramid store in two ways:

### Option A: Local Inbox Drop (Automatic Ingest)
Place any PNG, JPEG, TIFF image, or `.zip` archive directly into the `.seurat/runtime/inbox/` directory:
```bash
cp /path/to/my-image.png .seurat/runtime/inbox/mona-lisa.png
```
Or drop a multi-image zip archive:
```bash
cp /path/to/archive.zip .seurat/runtime/inbox/
```
The server's background intake watcher will detect the file, unpack zip archives into `.seurat/runtime/inbox/<archive>.d/` caches, construct multi-stratum pyramidal brushes and seed (`semilla.bin`), and register each work in the catalog (`.seurat/runtime/obras/`).

### Option B: HTTP Admin REST API
Upload an image with the admin token configured in `seurat.conf`:
```bash
curl -X PUT \
  -H "X-Admin-Token: cambia-esto" \
  --data-binary @/path/to/my-image.png \
  http://localhost:8180/seurat/v1/obras/mona-lisa
```

To update role-based density ceilings (`[stratum, bands]`) for a work:
```bash
curl -X PUT \
  -H "X-Admin-Token: cambia-esto" \
  -H "Content-Type: application/json" \
  -d '{"anonimo":[2,4],"autenticado":[1,4],"privilegiado":[0,4]}' \
  http://localhost:8180/seurat/v1/obras/mona-lisa/politica
```
Open sessions get the change at once (`CONCESION`, plus `RASPAR` when it lowers a ceiling). The ceilings are saved in the work's `meta.json` and survive restarts and new masters. The server answers `400` if a value is out of range (stratum 0–10, bands 1–4) or if a role would get more than a stronger one (anonymous ≤ `autenticado` ≤ `privilegiado`, §9.1).

To withdraw and delete a work:
```bash
curl -X DELETE \
  -H "X-Admin-Token: cambia-esto" \
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
| `http.port` | `8180` | Port for HTTP static files, handshake, and WebSocket traffic (protocol default `8080`). |
| `inbox` | `.seurat/runtime/inbox` | Directory watched for incoming image and archive intake. |
| `works` | `.seurat/runtime/obras` | Directory containing committed multi-scale work packages. |
| `coverage` | `.seurat/runtime/cobertura` | Persistent principal coverage tracking (fine strata token buckets). |
| `admin.token` | `cambia-esto` | Token required for admin REST routes (`X-Admin-Token`). |
| `session.max_brushes`| `1024` | Maximum concurrent active brush grants per session. |
| `rate.bytes_per_s` | `25000000` | Global egress bandwidth cap (bytes/sec). |
| `log.level` | `INFO` | Console logging verbosity (`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`). |

---

## Running Verification & Tests

### Backend Tests (JDK 21)
To run all 31 unit tests, golden wire vectors, loopback tests, and LoC budget validations:
```bash
bash scripts/run-tests.sh
```

To check strict line-of-code budgets manually (`main < 150 LoC`, `test < 300 LoC`):
```bash
bash scripts/check-loc.sh
```

### Frontend Tests (Vitest & TypeScript)
To run all client test suites and verify production build:
```bash
cd client
pnpm test          # Runs all 67 Vitest unit and integration tests across 12 test suites
pnpm build         # Validates TypeScript types and generates production bundle
```

### Viewer Smoke Test (headless browser)
With the server running, drive the real viewer in headless Chrome/Edge (Node >= 22, no dependencies, offline):
```bash
node scripts/smoke-viewer.mjs --work The_Night_Watch_-_HD   # use a large work (1.6-31 GP)
```
It opens the work, zooms in, and fails on page exceptions, `ERROR` frames, decode/CRC releases, no refinement past the first strata, or more than 2 % of deliveries refused on arrival. Set `CHROME` if the browser is not in a standard location; `--url`, `--seconds`, `--zoom` and `--shot` are optional.

### Cleaning Build Artifacts
To clean build outputs without touching runtime data:
```bash
bash scripts/clean.sh            # Cleans .seurat/build/ (.class files)
bash scripts/clean.sh --runtime  # Also cleans .seurat/runtime/cobertura/ and unpacked .d caches
```
