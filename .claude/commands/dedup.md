---
description: Turn a D13 duplicate group into a reviewable choice checklist (report only)
---

Follow the `dedup` workflow defined in CLAUDE.md and specs/dedup.md. This is
**Unit A — report generation only**: read the duplicate findings, write one
reviewable checklist to `scratch/`, and stop. Never resolve anything yourself.

Reading budget (normative — never exceed it): `node scripts/doctor.js --json`
(D13 findings + the corpus gate); `catalog.json` fields `citekey`, `title`,
`depth`, `updated`, `contribution`; and `node scripts/propose-scan.js --json`
(each map's cluster + Reading-queue citekeys, under `topics[]`). Never open
paper-note bodies. Never touch the network.

## Behavior: `dedup`

1. **Gate.** Run `node scripts/doctor.js --json`. If `errors` > 0 (any
   `error`-severity finding): stop, show those findings, write nothing —
   deriving link consequences over a drifted corpus is unsafe. If the errors
   are generated-file drift (D05/D07), tell the human to run
   `node scripts/build-catalog.js` (or `doctor --fix`) and retry. D13 warnings
   are the *input*, not a block; ignore all other warnings.
2. **Collect D13 pairs.** From the findings, take every `id: "D13"` entry. Its
   `message` has the fixed format `duplicates papers/<a>.md (<reasons>)` (frozen
   by doctor-duplicates.md §2). Extract the `<a>` citekey from the message and
   the `<b>` citekey from the finding's `file` (`papers/<b>.md`), plus the
   parenthesized `<reasons>`. If any D13 message does not match that format,
   stop and report it — never guess the pair. If there are zero D13 findings:
   print "no duplicates detected" and write no file.
3. **Group.** Coalesce the pairs into connected-component groups: if A–B and
   B–C are both reported, the group is {A, B, C}. Union the citekeys
   transitively; one group per connected component. For each group's reason
   text, split every pairwise `<reasons>` on `; ` and keep the distinct
   sub-reasons in first-seen order (so a 3-way group folds to one reason list).
4. **Assemble facts.** Run `node scripts/propose-scan.js --json`. For each
   candidate citekey, look it up in `catalog.json`; if it is absent, stop and
   report (do not emit a degraded block). Pull `depth`, `updated`, and the
   `contribution` line (or `(empty)`); and, from the scan's `topics[]`
   (**not** `candidates[]`, which omits settled papers), the maps whose
   `clusters[].citekeys` or `readingQueue` name that citekey (`referenced by:`).
   A non-zero exit from either script: stop and show its stderr; write nothing.
5. **Order deterministically.** Sort candidates within each group by citekey
   ascending; sort groups by their lowest candidate citekey ascending; number
   them 1..N in that order.
6. **Write the checklist** to `scratch/dedup-<YYYY-MM-DD>.md` (date in UTC, to
   match propose-scan's stamp), following the grammar below exactly. A same-day
   re-run overwrites the file.
7. **Print a terminal summary**: number of groups, total notes involved, and
   the scratch path.

### Report grammar (normative)

```markdown
# Duplicate resolution — <YYYY-MM-DD>

Groups: N (M notes). Fill the blanks and check your decisions — check exactly
one of Delete / Defer per group; Delete assumes you have completed the Zotero
merge and chosen a body to preserve. Then follow the checklist (or, once
available, run `/dedup apply scratch/dedup-<date>.md`).

## Group 1 — "<subject>" (<distinct reasons>)

Candidates:
- `<citekey>`   depth=<depth>  updated=<date>
  contribution: <first line, or (empty)>
  referenced by: <topics/x.md, topics/y.md | (none)>
- `<citekey>`   depth=<depth>  updated=<date>
  contribution: <first line, or (empty)>
  referenced by: <... | (none)>

Decisions:
- [ ] Merged the items in Zotero; surviving citekey: `______________`
- [ ] Preserve the body of: `______________`  (hand-fold anything unique from the other(s) into it first)
- [ ] Delete the non-surviving note(s)  (every candidate except the surviving citekey above)
- [ ] Defer — keep all notes, revisit later

Consequences (derived — confirm you will repair these via `/topic`):
- deleting `<citekey>`  → dangles in: <topics/… | (none)>
- deleting `<citekey>`  → dangles in: <topics/… | (none)>
```

Rules:
- One block per group. The header `<subject>` is the candidates' shared title
  when they all share one; otherwise (a DOI/arXiv-id-only match, whose titles
  differ) use the shared key, e.g. `arXiv 2010.11929`. The `(<distinct
  reasons>)` are the deduped sub-reasons from step 3, verbatim (`same title` /
  `same arXiv id X` / `same DOI Y`), joined by `; `.
- Each candidate lists citekey, `depth`, `updated`, its `contribution` line (or
  `(empty)`), and its `referenced by:` maps (`(none)` if unreferenced).
- The four **Decisions** lines are fixed and appear in every block, unchecked,
  with the two blanks left as backtick placeholders for the human to edit.
  `Delete` and `Defer` are mutually exclusive — do not pre-check either. "The
  non-surviving note(s)" always means every candidate in the group except the
  citekey written in the survivor blank.
- **Consequences** are derived facts, never checkboxes: one line per candidate
  naming the maps that dangle if that note is the one deleted (`(none)` if it is
  referenced by no map), so the cost of either direction is visible.
- Facts are quoted/paraphrased from the catalog only. Never state which note
  *should* win, and never add project-relevance reasoning.

Writes only that one scratch file. `git status` after a run shows at most
`scratch/dedup-<date>.md`.

## Out of scope (do not do these, even if it seems convenient)

Resolving the duplicate (no delete, archive, `git rm`, frontmatter edit, or
body/prose merge — that is a human's job, or a future `dedup apply`); writing to
Zotero; inventing citekeys or paper facts; recommending a survivor as a
directive; any GitHub Actions or issue-form automation.
