---
description: Create a new paper note from a citekey or DOI/arXiv URL
argument-hint: <citekey or DOI/arXiv URL> [topic]
---

Follow the `add` workflow defined in CLAUDE.md for: $ARGUMENTS

The first token is the citekey or DOI/arXiv URL. An optional second token names
a topic map explicitly.

Steps:
1. If given a DOI/arXiv URL, fetch metadata (title, authors, year, venue, abstract) for it.
   If given a bare citekey, ask the user for the identifier if no existing source is found.
2. Create `papers/<citekey>.md` from `templates/paper.md`, filling the frontmatter
   (`citekey`, `title`, `authors`, `year`, `venue`, `url`, `added`, `updated` = today).
   Set `depth: metadata`.
3. If an abstract is available, fill in **Contribution** and **Key claims** from it
   (facts only — no relevance/priority judgments) and bump `depth: abstract`.
4. Placement only happens if the user explicitly named a topic (the second
   argument): set `topics: [<topic>]` in the frontmatter, then run the
   `/topic <topic>` workflow so the map picks the new paper up. Otherwise the
   note is born `topics: []` — never open or edit `topics/*.md` on your own
   judgment; placement is `/propose`'s job (specs/sync-placement.md).
5. Run `node scripts/build-catalog.js` to regenerate `catalog.json` and `INDEX.md`.
   Never hand-edit either file.

Report which files were created/changed, the resulting depth, and whether a
topic was explicitly assigned.
