# ADR-11 — Protocol completion: both mappings served, unused wire removed

Status: accepted. Date: 2026-10-06.

An audit of the protocol document against the two code bases left a short list of things the
protocol defined and the delivery did not use. Each one is now either implemented or removed from
the protocol, so the document's "defined but not used" table is gone.

## Context

- The WebTransport mapping (spec §3.1, the primary one) was specified and the viewer had its side
  written, but the server served only WebSocket and announced the WebSocket URL twice.
- `RASPAR` had five predicates; the server emitted two (`ESTRATO_BAJO`, `TODO`). `CONCESION`
  carried `bandas_max` and `ABIERTA` a ceiling pair, constants since ADR-05 (no roles): always 4,
  and 0 and 4.
- `AUDITAR` had no deadline: a viewer that never answered was never closed.
- A work could be withdrawn (`DELETE`) but not renamed, and the viewer had no control for either.
- The viewer decoded `REGULACION` and showed nothing.

## Decision

1. **The server serves the WebTransport mapping.** QUIC comes from Kwik 0.11 (pure Java), vendored
   with its four dependencies in `server/vendor/` (the project's rule for a jar: a capability the JDK
   lacks; nothing is downloaded). The HTTP/3 on top is written here and is only what WebTransport
   needs (`adapters/in/net/h3`: varint framing, the SETTINGS, the extended CONNECT, the stream
   types); `adapters/in/net/wt` holds the mapping: control frames on the client's first
   bidirectional stream, one server unidirectional stream per delivery (FIN at its end,
   `RESET_STREAM` to cancel or after 30 s without progress), `MIRADA` in datagrams.
   - **Same port number, on UDP.** The `:authority` of the CONNECT is then the `Host` of the page,
     and the Origin rule of the WebSocket upgrade applies unchanged.
   - **Pinned certificate.** At boot the server generates a self-signed ECDSA P-256 certificate
     valid 13 days (the DER is written by hand and signed with the JDK). `POST /seurat/v1/sesion`
     answers `lienzo` = `https://<host>/seurat/v1/lienzo` plus `huella`, its SHA-256, and the
     viewer passes it as `serverCertificateHashes`. Nothing is installed in the browser. QUIC uses
     this certificate even when a TLS keystore is configured: pinning skips certificate
     validation, so one code path serves both cases.
   - **QUIC v1 and v2.** Firefox starts in v1 and asks to switch to v2 during the handshake. Kwik
     switches whenever the client asks, and then drops the v2 packets unless the listener lists
     v2, so the listener lists both (`WtListener.VERSIONS`).
   - **Fallback.** A browser offers WebTransport only to a secure page (`https`, `localhost`,
     `127.0.0.1`). On any other page, or when the session does not open in 3 s, the viewer uses
     WebSocket, which stays complete on its own. `webtransport=false` in `seurat.conf` turns the
     UDP listener off; so does a UDP port that cannot be bound.
2. **`RASPAR` keeps `ESTRATO_BAJO` (1) and `TODO` (5).** Predicates 2 (`FUERA`), 3 (`BANDAS`) and
   4 (`LISTA`) are retired and their numbers are not reused. `bandas_max` leaves `CONCESION`, and
   `techo_estrato` and `techo_bandas` leave `ABIERTA`: a concession allows a brush when
   `estrato >= estrato_min`.
3. **`INVENTARIO` has a deadline.** 10 s after its `AUDITAR`, like `RASPADO`; `ERROR 8` covers both.
4. **`PATCH /seurat/v1/obras/{id}` renames a work.** Same-origin; the body is the new name as plain
   text (1 to 120 characters, no control characters); 400, 403 or 404 otherwise. Only the display
   name changes, never the id or the files, and every viewer learns it through `OBRA` with event
   `ESTADO`. The gallery card has an edit button that renames and deletes.
5. **The viewer shows `REGULACION`**: a notice while the server is cutting the cone for load, and
   a "Server load" row in the details panel.

## Deviations from Seurat/1 v1.0

1. §3.3 `CONCESION`: no `bandas_max` byte after `estrato_min`. §3.3 `ABIERTA`: no ceiling bytes
   after the edition. §3.3 `RASPAR`: predicates 2 to 4 are a decode error.
2. §3.4 goldens: `CONCESION` initial `21 0c 01 01 07 00 43 00 80 00 90 00 40 78`, epoch 2
   `21 0c 01 02 00 01 43 00 80 00 90 00 40 78`, epoch 3 `21 0c 01 03 01 02 43 00 80 00 90 00 40 78`;
   `ABIERTA` `13 0f 01 80 03 00 00 80 02 80 00 0b 02 40 c0 40 a0`. Both test suites hold the same bytes.
3. §3.1: `POST /sesion` adds `huella`; a new `PATCH /obras/{id}`. The CONNECT is accepted with
   `:protocol` `webtransport` (what browsers send today) or `webtransport-h3`.
4. `INVENTARIO` is due 10 s after its `AUDITAR`, the deadline `RASPADO` already had.

## Evidence

- `WtLoopbackTest`: Kwik's own client against the listener on the loopback: the two refusals (404
  for another path, 403 for a foreign Origin), a session, a control frame split across two writes,
  a frame back, a delivery on a unidirectional stream, a `MIRADA` datagram, a cancelled delivery,
  the last frame before the close, and the end of the session when the peer leaves; the last
  client starts in QUIC v1 and prefers v2, as Firefox does.
  `H3WireTest` holds the SETTINGS and the CONNECT answer byte by byte; `SelfSignedCertTest` parses
  and verifies the certificate with the JDK.
- Chrome 154, Edge and Firefox 157, gigapixel works: from `http://localhost` and
  `http://127.0.0.1` the session opens over WebTransport (`caps` 0x7, datagrams on) and the image
  refines (to stratum 0 in the Chrome and Edge smoke runs); from the LAN address, not a secure page, the viewer uses WebSocket
  (`caps` 0x6). The server notices a closed tab in 0.3 s. `scripts/smoke-viewer.mjs` passes on both
  mappings (`--transport wt`, `--transport ws`).
- With a keystore (`tls.keystore`) the page is served over https, a secure page from any address:
  Chrome, Edge and Firefox, opened by LAN address through the certificate warning, use WebTransport.
- With the UDP port unreachable (the page served through a TCP-only proxy) the viewer opens over
  WebSocket; before the v2 fix Firefox showed the other path, the 3 s limit and then WebSocket.
- Eight viewers zooming at once on the gigapixel works, all over WebTransport: every one showed
  the load notice and a "Server load" row (rung 0 or 1, 6 to 8 viewers) and went back to normal.
- A rename reached a second gallery and a viewer with the work open in about 0.1 s; a delete took
  the card away in about 0.1 s and sent that viewer back to the gallery.
- Server: 77 test classes; client: 590 tests in 108 files.

## Limits

- The certificate is not renewed while the server runs: after 13 days up, WebTransport fails and
  viewers use WebSocket until a restart.
- Safari was not exercised (no macOS at hand). Chrome, Edge and Firefox negotiate WebTransport
  draft-02; the server also sends the settings of the later drafts (07 and 13), untested.
- Viewers that all start in the same second on a busy machine may miss the 3 s limit and use
  WebSocket: seen once with eight software-rendered browsers launched together.
- Kwik, agent15 and qpack are LGPL-3.0; hkdf is Apache-2.0 and siphash MIT (`server/vendor/README.md`).
