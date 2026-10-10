# Lotus Flame receipts

Till receipts: newest first, one per change a reader can see and one per correction. Each is short, and enough to
trace the change back to its commit, where the full detail is.

- **change**: what changed, who asked for it, the check that proves it (and the deliberately broken version that the
  check catches), and the commit.
- **correction**: what was claimed or shown before, what was wrong with it, and what made someone look.

## 2026-10-10 · change · these receipts

- **What:** RECEIPTS.md, backfilled from the commit history, and a link to it from the README.
- **Asked:** Doug Bristor.

## 2026-10-07 · change · live at bristorbrot.org/lotus · `6703d4e`

- **What:** the page is hosted at [bristorbrot.org/lotus](https://bristorbrot.org/lotus/), and `tools/check.mjs` can
  check the hosted copy (`LOTUS_BASE=https://bristorbrot.org/lotus/demo/ node tools/check.mjs`).
- **Asked:** Doug Bristor.
- **Proved by:** all six checks (G, J, R, F, X, V) pass against the hosted copy, as they do on the published files.

## 2026-10-07 · change · first commit · `f3bef07`

- **What:** a self-contained page: a 4-D IFS flame with rolling points, b-splats with covariance J Σ_A Jᵀ, a 4-D
  turn, a flatness meter and a 3DGS `.ply` export.
- **Asked:** Doug Bristor; built by insights.
- **Proved by:** `tools/check.mjs` runs six checks, each with a planted fault that must make it fail (see the README's
  Checks table).
- **Open:** no independent 3DGS viewer has loaded the exported `.ply` yet. The round trip agrees to 5e-7, but
  opening correctly elsewhere still needs a real viewer.
