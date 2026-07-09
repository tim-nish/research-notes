# Contributing

It's early — issues and PRs are welcome, including "this step of the setup lost
me" reports, which are as valuable as code.

Before opening a PR:

- `npm test` must pass (fixture-based; no Zotero or network needed).
- `node scripts/doctor.js` must exit clean.
- Never hand-edit `catalog.json` or `INDEX.md` — run
  `node scripts/build-catalog.js`.

Design changes: read [specs/](specs/) first; the rest of the design rationale
lives in the README. The facts/judgments split and the depth ladder are
load-bearing — proposals that weaken them need a strong case.
