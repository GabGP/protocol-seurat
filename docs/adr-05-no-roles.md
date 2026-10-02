# ADR-05 — No roles: every viewer gets full quality

Status: accepted. Date: 2026-10-02. Context: the project removes viewer roles, accounts, and brush
budgets so that every viewer experiences full pyramidal resolution without credentials or configuration.

## Question

How should the server and viewer simplify access control and resolution ceilings so that every
viewer receives the highest possible quality without managing accounts or per-user brush budgets,
while preserving the protocol wire format, session resumption, and intake security?

## Decision

There are **no roles, no accounts, and no admin**. Every canvas gets the full ceiling: stratum 0 with
all 4 bands. The brush budget is removed entirely.

- **Full ceilings everywhere.** Every canvas receives the maximum resolution ceiling: stratum 0 with
  all 4 bands. Ceilings are no longer differentiated by user tier or configured per work.
- **Open deletion.** `DELETE /seurat/v1/obras/{id}` stays and is open to any viewer, guarded only
  by the `Origin` check (`IntakeGate.sameOrigin`), exactly like master upload (ADR-04).
- **Policy endpoint removed.** `PUT /seurat/v1/obras/{id}/politica` is removed from the REST API.
- **Principal identity.** The anonymous cookie (`seurat_anon`) still names the principal, now
  formatted as `viewer-<hex>`. This principal identifier is preserved because `SALUDO REANUDAR`
  verifies that a resuming session belongs to the same principal.

## Deviations from Seurat/1 v1.0

The spec is not edited. These are the deltas from it:

1. **Spec 2.3 and 4.1 (`estrato_min` and `bandas_max` formula)**: the role ceilings are gone; `techo`
   is always stratum 0 with 4 bands, so `estrato_min = 0` and `bandas_max = 4` unless the sketch floor
   (`OCULTA` or inactivity) raises it. `ABIERTA` and `OBRA` still carry `techo_estrato` and
   `techo_bandas` on the wire, always 0 and 4.
2. **Spec 3.1 (`POST /seurat/v1/sesion`)**: no Bearer authentication and no `401`; the answer has no
   `rol` and no `cuenta` fields (it keeps `local` from ADR-04).
3. **Spec 3.1**: `PUT /seurat/v1/obras/{id}/politica` is removed. `DELETE /seurat/v1/obras/{id}` is no
   longer admin-only: any viewer may call it, guarded only by the `Origin` check. This supersedes
   the part of ADR-04 deviation 1 that kept `X-Admin-Token`. The `X-Admin-Token` header and the
   `admin.token` configuration key are gone.
4. **Spec 4.1 check (d) (brush budget before each open), spec 5.1 and spec 9 (`PresupuestoDePincel`, `cobertura/<principal>/<obra>.bits`)**:
   removed. The `Painter` checks (a), (b), (c) and (e), in order.
5. **Wire numbers that stay reserved but are never sent**: `CONCESION` motivo 5 (`ROL`), `PLAN INICIO`
   regulacion bit 1 (`PRESUPUESTO`), `SOLTAR` motivo 4 (`PRESUPUESTO`), `ERROR 10` (`PRESUPUESTO`).
   `CONCESION` motivo 2 (`POLITICA`) is no longer sent for a policy change (there is none); the server
   still uses it when a new edition of a work replaces the old one. Numbers are never reused.

Frames, messages, field layouts, and the wire goldens of spec §3.4 are unchanged.

## Why

- **Owner intent.** The project owner chose this: the demo and the grading should show the full
  experience without handing out keys.
- **Dead code elimination.** With one ceiling for everyone, the per-role policy, the role-nested masks,
  and the brush budget are dead code.
- **Protocol core preserved.** The brief requires the server to decide what to send and to raise and
  lower resolution by transfer and drop, which the concession, the plan, and eviction still do, and
  it does not require roles.

## Consequences

- `seurat.conf` loses `auth.accounts`, `admin.token`, and `coverage` (old keys in an existing
  `seurat.conf` are ignored).
- Old `meta.json` files with `techo.*` keys still load; the keys are ignored and are not written
  again.
- A leftover `.seurat/runtime/cobertura/` folder is unused and can be deleted by hand.
- Every viewer can delete a work from the same origin.
- Server code removed: `ViewerAccounts`, `RolePolicy`, `PolicySync`, and the `core/viewing/budget`
  package.
- Client code removed: the `features/sign-in` slice and the access key.
