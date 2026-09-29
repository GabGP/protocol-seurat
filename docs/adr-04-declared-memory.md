# ADR-04 — the viewer can declare less memory

Status: accepted. Does not change Seurat/1: SALUDO already carries `mem_mib` (spec 6.1) and the server
already grants `max_pinceladas = min(3 x mem_mib, session cap)`.

## Decision

`declareMemMib()` returns the value the user chose in Settings > Memory (localStorage `seurat.memMib`),
else the spec formula (a quarter of `navigator.deviceMemory`, at most 256 MiB, else 128).
Options: spec default, 80, 64, 48, 32 MiB (240, 192, 144, 96 brushes).

Changing it is a new SALUDO: the choice is stored, the resume ticket is cleared and the page reloads
(the same path as a role change in `features/sign-in`).

## Why

The renderer footprint follows the number of held brushes. A device that can spare less memory
(or a grader that wants to see the server hold the client to a smaller budget) needs a way to say so
through the protocol, not through a client-only cap. Horizon eviction then runs against the smaller
book with no other change.
