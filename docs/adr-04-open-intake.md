# ADR-04 — Open intake: upload, link and local path from the gallery

Status: accepted. Date: 2026-10-01. Context: the brief asks that new ultra-high-resolution images
can be added to the server; until now that meant copying a file into `inbox/` by hand.

## Question

How can a viewer add a master from the gallery without breaking the spec's intake model (one
ingest at a time, `inbox/` watched by `WatchService`), and without pushing gigabytes through the
browser when the file is already on the server's disk?

## Decision

The gallery header gets an **Add** button (a create-style menu). There are three sources, and all
of them land a *complete* file in `inbox/` through one path:

| Source | Route | Who | Cost |
|---|---|---|---|
| Upload file / `.zip` | `PUT /seurat/v1/obras/{nombre}` (streamed body) | any viewer | one copy |
| From link | `POST /seurat/v1/importar`, body = `http(s)://…` | any viewer | the server downloads it |
| From this computer | `POST /seurat/v1/importar`, body = a path | the server machine only | hard link: instant, the original stays; a copy across volumes |

- **Staging, then an atomic move.** Bytes go to `.seurat/runtime/staging/<nombre>.<hex>.part`.
  Only a finished file is moved (`ATOMIC_MOVE`) into `inbox/`, so the watcher never sees a partial
  file. Leftover `.part` files are deleted at boot.
- **One offerer.** The routes no longer call the intake directly. The move raises the watcher's
  `ENTRY_CREATE`, and the route also hands the file to `MasterIntake.arrived`, which goes through
  the watcher's `seen` dedupe. A file is never offered twice.
- **Same id everywhere.** `{nombre}` carries its extension (`png jpg jpeg tif tiff psb psd zip`,
  from `MasterNames` and `ZipNames`). The work id is the name without the extension, as for a file
  dropped into `inbox/`.
- **Answers.** `202 {"nombre","estado"|"modo"}`, with `modo` one of `descarga`, `enlace` or
  `copia`. Refusals: `409` (the work exists), `411` (empty body), `415` (not a master or zip
  name), `507` (no disk space), `502` (download failed), `400` (not a readable file), and `403`
  (foreign `Origin`, or a path import from another machine).
- **Locality.** A peer is local when its socket address is loopback or equals the server's own
  address. `POST /seurat/v1/sesion` also returns `"local"`, so the viewer can show the path tab.
  This is informational only: the server checks again on every call.
- **Progress** in the viewer comes from the existing `OBRA` pushes: `RECIBIENDO`, then the ingest
  percentage, then `LISTA`. No new message is added. Upload progress is the browser's own
  (`XMLHttpRequest.upload`).

## Deviations from Seurat/1 v1.0 (§3.1)

The spec is not edited. These are the deltas from it:

1. `PUT /seurat/v1/obras/{id}` is **no longer admin-only**. Any viewer may upload, guarded only by
   the `Origin` check. `PUT …/politica` and `DELETE` keep `X-Admin-Token`.
2. The path segment is the **file name with its extension**, and the upload goes to `staging/`
   before `inbox/`.
3. New route `POST /seurat/v1/importar` (link or local path).
4. `POST /seurat/v1/sesion` returns an extra field, `local`.

Seurat/1 itself (frames, messages, numbers, accounting) is unchanged.

## Why

- **Bandwidth.** A browser never sees a file's path, only its bytes. So even on localhost an
  upload is one full copy. For a master already on the server, a hard link adds it in constant
  time. This is the zero-copy route the inbox drop already allowed, now available from the UI.
- **Open to viewers.** The project owner chose this: adding works is part of the demo, and the
  server is a LAN service graded offline. The `Origin` check keeps a third-party page from driving
  uploads or path imports through a viewer's browser.
- **Path import stays local.** A path names a file on the server's disk. Letting a LAN peer ingest
  any image on that disk would be a file-read hole.
- **The link download** is the only outbound request the server makes, and only when a viewer
  asks for it. It is never needed at grade time; nothing is fetched at build or boot.

## Consequences

- The browser stays light. It streams the `File` from disk and never decodes it: rows show a
  format icon, not a preview.
- The server console follows each transfer (`TransferProgress`). It logs a `receiving` or
  `downloading` line with the size, then the shared progress bar (a line every 10 % when stdout is
  not a terminal; bytes so far when the size is unknown), then `received` or `downloaded` with took
  and rate. A cut transfer is a warning.
- A failed transfer leaves no trace in `inbox/`. A failed ingest is reported as before
  (`FALLIDA`), and a viewer can retry it.
- The code lives in `adapters/in/inbox/{Staging,PutUpload,PathImport,UrlDownload}` and
  `adapters/in/net/http/{IntakeGate,ImportRoute}` on the server, and in `features/add-work` plus
  `shared/api/intake.ts` on the client.
