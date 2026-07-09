# Spec: sync stage-1 fixes — source-aware completeness, no-year blocking, doctor stop notice

Status: ready for implementation. Amends [sync](sync.md) and
[sync-backlog](sync-backlog.md); motivated by dogfooding findings #2 and #6
— both fold their amendments into the base specs as part of implementation
(this file stays as the change record).

## 1. Fix A — source-aware completeness (normative)

**Problem.** `classify()` in `scripts/zotero-fetch.js` treats a note as
complete only when `zotero`, `venue`, and `url` are all non-empty in the
note's frontmatter (`complete` flag computed in `loadPaperJoins()`). arXiv
items never carry `publicationTitle`/`conferenceName`/`proceedingsTitle`,
so their notes' `venue` can never be filled by any `enrich` pass — they
re-queue as no-op `enrich` forever and the queue can never drain.

**Rule.** A field is *fillable* when it is empty in the note **and** the
current fetch's Zotero metadata has a non-empty value for it (the `zotero`
link is always fillable when empty, since it derives from the item key).
Classification of an item whose note already exists:

- nothing fillable → **skip** (not queued);
- anything fillable → **enrich**.

Equivalently, skip iff: note `zotero` non-empty, AND (note `venue`
non-empty OR `metadata.venue === ''`), AND (note `url` non-empty OR
`metadata.url === ''`).

**Code changes** (`scripts/zotero-fetch.js`):

- `loadPaperJoins()`: replace the precomputed `complete` boolean in the
  per-note record with per-field non-emptiness (e.g. `hasZotero`,
  `hasVenue`, `hasUrl`). Keep `citekey`, `itemKey`, `path` as-is.
- `classify()`: compute skip/enrich from those flags plus the item's
  `metadata` per the rule above. The item-key-wins-over-repinned-citekey
  behavior (existing comment and test) must not change.

**Base-spec amendment** (fold in): specs/sync.md §4 step 5 currently reads
"the note's optional frontmatter fields (`zotero`, `venue`, `url`) are all
non-empty → skip", which contradicts itself (optional yet required).
Replace with the fillable-field rule; same change to the `enrich`
condition ("some of those fields are empty" → "some fillable field is
empty in the note").

## 2. Fix B — `blocked: no-year` (normative)

**Problem.** An item with no `date` in Zotero yields `metadata.year ===
null`; the note is authored with `year:` blank (correct — sync never
invents values) and permanently fails doctor D01, which `enrich` can never
repair (it only fills `zotero`/`venue`/`url`).

**Rule.** In `classify()`, on the **create path only** (no existing note
matched — an already-existing note is classified per Fix A regardless of
year): after the citekey resolves, if `metadata.year == null` → queue as
`action: 'blocked'`, `blockedReason: 'no-year'`. Never author the note.
The `no-citekey` check keeps precedence (an item missing both blocks as
`no-citekey`).

**Merge semantics** (`mergeQueue()`): generalize the existing
`no-citekey` unblock/regress logic to the set of *resolvable* reasons
`{no-citekey, no-year}`:

- entry `blocked` with a resolvable reason, fresh classification not
  blocked → `pending`, reason cleared;
- entry `blocked` with a resolvable reason, fresh classification blocked
  with a *different* resolvable reason → stays `blocked`, reason updated;
- entry not blocked, fresh classification blocked (resolvable reason) →
  `blocked` with that reason (existing regress behavior, extended);
- `repeated-failure` is **not** resolvable and must never auto-unblock
  (unchanged guarantee from sync-backlog §3).

**Base-spec amendments** (fold in):

- specs/sync-backlog.md §1: `blockedReason` enum becomes
  `no-citekey | no-year | repeated-failure | null`.
- specs/sync.md §4 step 3 area + §6 failure table: add the row
  "Zotero item has no date → entry `blocked: no-year`; other items
  proceed; resolves to `pending` once a date is set in Zotero; never
  invent a year."

**Not covered:** the existing broken note
(`papers/radfordImprovingLanguageUnderstanding.md`) — sync never rewrites
notes; a human sets the date in Zotero and edits the note once (see plan).

## 3. Fix C — doctor STOP notice in the /sync report (normative)

**Problem.** docs/dogfood-checklist.md's stop rule ("any doctor
`error`-severity finding → stop, record, fix, only then continue") is
enforced by no one: `/sync` runs doctor once and buries the result in its
report; the D01 error persisted across 8 batches unnoticed by the rule.

**Rule.** When `node scripts/doctor.js` exits non-zero at step 4 of the
`/sync` workflow, the final report must **open** with a STOP notice naming
the error count and the rule, e.g.:

> **STOP — doctor reported N error(s). Per the dogfood stop rule
> (docs/dogfood-checklist.md), resolve these before running `/sync`
> again.** followed by the error lines.

The rest of the report (table, counts, unassigned hint) follows unchanged.
This is report prose, not a behavioral gate — `/sync` still completes its
batch (the errors may have pre-existed the batch).

**File changes:** specs/sync.md §5 step 4 (add the notice requirement) and
§8 (acceptance criterion: "doctor errors present → report opens with the
STOP notice"); `.claude/commands/sync.md` step 5 and
`.codex/prompts/sync.md` (mirror each other); docs/dogfood-checklist.md
stop rule — append "(checked by the human reading each `/sync` report; the
tool does not halt on its own)".

## 4. Out of scope

Findings #1 (stale-`done` one-cycle drop), #3 (model cost), #4
(checkpoint granularity), #5 (DOI/title duplicate detection); deletion or
repair of existing notes; any write to Zotero.

## 5. Acceptance criteria

- [ ] `npm test` green, including the new cases in §6.
- [ ] Against the real repo (101 notes, all-preprint-heavy collection):
      `node scripts/zotero-fetch.js` → `0 create, 0 enrich, 0 blocked,
      101 skipped`; `.sync/queue.json` holds 0 pending entries afterward.
- [ ] Immediately re-run fetch → identical output, no queue growth
      (idempotency probe of docs/dogfood-checklist.md End-of-stage-1).
- [ ] A fixture item with no `date` and no note → `blocked: no-year`, no
      file authored; same item with a date on the next fetch → `pending`.
- [ ] specs/sync.md and specs/sync-backlog.md amendments folded in; the
      three workflow files updated consistently.
- [ ] docs/dogfood-findings.md #2 and #6 marked
      "promoted: specs/sync-stage1-fixes.md".

## 6. Tests (`test/zotero-fetch.test.js`)

Fix A — `classify()`:
1. note `zotero`+`url` set, `venue` empty, `metadata.venue === ''` →
   skip (the case that is broken today).
2. note `venue` empty, `metadata.venue` non-empty → enrich.
3. note `url` empty, `metadata.url === ''` (and `zotero` set, venue
   satisfied) → skip; with `metadata.url` non-empty → enrich.
4. note `zotero` empty → enrich regardless of other fields (the link is
   always fillable).
5. Existing tests "item-key match wins over re-pinned citekey" and
   "no note → create" pass unchanged.

Fix A — full run (`--from-fixture`):
6. Fixture where every item's note exists and is complete under the new
   rule (venue-less items included) → summary `0 create, 0 enrich,
   0 blocked, N skipped` and the written queue has 0 items (merge rule 3
   removes the stale entries).

Fix B:
7. `classify()`: citekey resolves, no note match, `metadata.year === null`
   → `blocked`, `blockedReason: 'no-year'`.
8. `mergeQueue()`: `no-year`-blocked entry whose fresh classification is
   unblocked → `pending`, reason `null` (mirror of the existing
   no-citekey test).
9. `mergeQueue()` regression guard: `repeated-failure`-blocked entry with
   a clean fresh classification stays `blocked`.
