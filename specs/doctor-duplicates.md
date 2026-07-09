# Spec: doctor D13 — duplicate paper detection, and the manual dedup playbook

Status: ready for implementation (the check is mechanical; resolution stays
human). Amends [doctor](doctor.md); motivated by dogfooding finding #5. Two confirmed live
pairs exist in the repo today:
`vaswaniAttentionAllYou2023`/`vaswaniAttentionAllYou2023a` and
`dosovitskiyImageWorth16x162021`/`dosovitskiyImageWorth16x162021a`.

## 1. Problem

Duplicate Zotero items (same paper saved twice, different item keys, BBT
minting a `...a`-suffixed citekey for the second) flow through `/sync`
faithfully — the join is by item key and citekey only, per spec — and
produce two paper notes for one paper. Nothing flags the pair afterwards:
doctor has no duplicate check, `/propose` sees two placeable candidates,
`/survey` would count one paper's claims twice. In the live run the pairs
were caught by a human noticing near-identical contribution lines, then
handled by deferring both — detection by luck, not by invariant.

## 2. Fix — doctor check D13 (normative)

New finding, `warn` severity (a duplicate does not corrupt the repo; it
must not block `/propose`'s error gate, which is how this run kept working
around the live pairs):

| ID | Severity | Rule |
|----|----------|------|
| D13 | warn | No two `papers/*.md` share a normalized DOI or a normalized title |

Detection, computed over frontmatter only (no note bodies):

- **DOI key:** if `url` contains a DOI (`10\.\d{4,9}/\S+`, case-folded),
  that DOI. arXiv IDs count as DOI-equivalent keys: extract
  `\d{4}\.\d{4,5}` from arXiv URLs (version suffix stripped).
- **Title key:** `title` lowercased, Unicode-normalized (NFKC), punctuation
  and whitespace collapsed.
- Two notes sharing either key → one D13 warning naming both files, e.g.
  `warn D13 papers/vaswaniAttentionAllYou2023a.md duplicates papers/vaswaniAttentionAllYou2023.md (same title; same arXiv id 1706.03762)`.

Same-title-different-paper false positives are accepted as the cost of a
`warn` (a human reads the pair and moves on); do not add fuzzy matching or
similarity thresholds — exact normalized-key equality only.

`--fix` does **not** touch D13 (it regenerates generated files only, and
dedup deletes a note — never automatic).

## 3. Manual dedup playbook (documentation, not code)

Add to specs/doctor.md (and echo in the doctor command files) the
resolution steps for a D13 pair. All steps are human actions:

1. In Zotero: merge the duplicate items (Zotero's native merge keeps one
   item key; BBT keeps that item's citekey pinned).
2. In this repo: pick the surviving note (the one whose citekey matches the
   merged Zotero item). If the doomed note's body contains anything the
   survivor lacks (deeper depth, filled Method/Evidence), fold it into the
   survivor by hand and bump the survivor's `updated`.
3. Delete the doomed note file; `git rm` it.
4. Run `node scripts/build-catalog.js`, then `node scripts/doctor.js` —
   D13 clears; a D06 error now names any topic map still linking the
   deleted citekey; fix those links via the `topic <t>` workflow (the
   deleted paper's frontmatter is gone, so re-derivation drops it).
5. If the deleted citekey was referenced from a project repo (via `link`),
   update that link — the join key is gone everywhere.

Note the interaction with `/sync`: after the Zotero merge, the next fetch
sees the doomed item key gone from the collection and drops any queue
entry for it (merge rule: absent from discovery → removed). No sync-side
change is needed.

## 4. Out of scope

Structuring the resolution as a reviewable choice checklist is specced
separately in [dedup](dedup.md) (which consumes D13's findings); this unit
covers detection and the manual playbook only.

Automatic merging or deletion of any kind; fuzzy/similarity matching;
preventing duplicates at `/sync` time (rejected for now — sync's contract
is "never invent, never judge"; a create-time D13-style warning in the
sync report may be worth a future amendment but is not part of this unit);
fixing the two live pairs (that is a human playbook run, tracked in the
dogfood checklist, not an implementation task).

## 5. Acceptance criteria

- [x] Fixture with two notes sharing an arXiv id but different titles →
      one D13 warning naming both files; exit code stays 0 when no errors
      exist (warn severity).
- [x] Fixture with two notes sharing a normalized title, no DOI → D13.
- [x] Distinct papers, distinct keys → no D13.
- [x] `doctor --fix` leaves both notes of a D13 pair untouched.
- [x] Live repo: exactly two D13 warnings (the vaswani and dosovitskiy
      pairs) until a human runs the playbook; zero after.
- [x] specs/doctor.md check table and playbook updated; both doctor
      command files mention D13 and point to the playbook.
