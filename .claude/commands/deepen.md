---
description: Upgrade a paper note one rung on the cost ladder
argument-hint: <citekey> [sections...]
---

Follow the `deepen` workflow defined in CLAUDE.md for: $ARGUMENTS

The first token is the citekey; any remaining tokens name the sections to read.

Steps:
1. Open `papers/<citekey>.md` and check its current `depth`.
2. Read only the named sections (or, if none were named, the minimum sections needed
   to move one rung up the ladder: metadata → abstract → sections → full). Never read
   the full PDF end-to-end unless the target depth is `full`.
3. Update **Method**, **Evidence**, and **Sections read** with facts only (what the
   paper contributes/claims/shows) — no project-relevance judgments.
4. Bump `depth` to the new rung and set `updated` to today.
5. Run `node scripts/build-catalog.js` to reflect the new depth in `catalog.json`
   and `INDEX.md`. Never hand-edit either file.

Report what the upgrade changed (old depth → new depth, which sections were read,
what was added to the note).
