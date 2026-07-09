# Spec: `dedup` — turn a D13 duplicate group into a reviewable choice checklist

Status: **Unit A (report generation) ready for implementation.** Unit B (`dedup
apply`) and the issue-automation layer are marked future increments below and
are intentionally shallow. Depends on: [doctor](doctor.md) /
[doctor-duplicates](doctor-duplicates.md) (D13 is the detector — this spec adds
no new detection), [propose-scan](propose-scan.md) (topic-map membership scan,
reused to derive link consequences), [build-catalog](build-catalog.md),
[topic](topic.md) (the eventual apply path). Mirrors the report/apply contract
of [propose](propose.md) wholesale.

Motivated by the same dogfood finding as `doctor-duplicates` (finding #5): the
manual dedup playbook resolves duplicates through ad-hoc file inspection and
free-form CLI steps. This spec replaces that free-form path with a structured,
checkbox-based decision record — the human still decides everything; the system
only structures the decision.

## 1. Goal and command boundary

D13 detects that two or more notes are the same paper. Resolving that is a
sequence of *human* decisions (which Zotero item survives, which body to keep,
delete vs defer, which links to repair). Today those decisions are made in
prose. `dedup` makes them a reviewable checklist instead.

The normative division of labor:

- **`doctor` (D13)** detects duplicate pairs. It decides nothing and writes
  nothing; it already exists.
- **`dedup`** reads D13's findings and writes one reviewable checklist to
  `scratch/`. It presents candidate notes, the facts relevant to each choice,
  and the explicit decisions to make — as `- [ ]` items. It **never** modifies
  `papers/`, `topics/`, generated files, or Zotero. It decides nothing.
- **`dedup apply <report>`** (future increment, §9) will execute exactly the
  mechanical steps a human has checked. Not part of Unit A.

Because the checklist is `- [ ]` markdown, it is a decision record that works
identically in a scratch file or pasted into a GitHub Issue — no automation
required to get that benefit (see §10).

## 2. Type and files (Unit A)

Judgment work → agent workflow; the underlying detection and topic-map scan are
already deterministic scripts (`doctor.js`, `propose-scan.js`). Unit A adds no
new script — it is a thin agent command over existing `--json` outputs:

- `.claude/commands/dedup.md`, `.codex/prompts/dedup.md`

No new file under `scripts/`. If profiling later shows the grouping/consequence
derivation wants to be deterministic and unit-testable in isolation, it can be
extracted to `scripts/dedup-scan.js` at that point — not before.

## 3. Inputs and reading budget (normative)

`dedup` may read only:

1. `node scripts/doctor.js --json` — the D13 findings (the duplicate pairs) and
   the corpus-health gate (§4.1).
2. `catalog.json` records, for each candidate named by a D13 finding:
   `citekey`, `title`, `depth`, `updated`, `contribution`. (Look each candidate
   up by `citekey`; a lookup miss is a hard stop, not a degraded block.)
3. Topic-map membership via `node scripts/propose-scan.js --json`: which maps
   list each candidate, read from the scan's `topics[]` (cluster or
   Reading-queue members) — **not** its `candidates[]`, which omits settled
   papers — to derive the link consequences in §5.

It never opens paper-note bodies, never opens topic-map prose beyond the
scanner's extraction, and never touches the network. The candidate set is
whatever D13 named — duplicates are rare, so this is a handful of catalog lines
plus one topic-map scan per run; no batching is contemplated. **Body comparison
is deliberately not in the budget**: the "which body to preserve" decision is
presented as a human-filled blank grounded in `depth`/`updated`/`contribution`,
and the human opens the two files to fold prose. Richer body introspection is a
possible Unit-B-era enhancement, not Unit A.

## 4. Behavior — `dedup`

1. **Gate.** Run `doctor --json`. Any `error`-severity finding: stop, show the
   findings, write nothing — deriving reliable link consequences over a drifted
   corpus is unsafe. If the errors are generated-file drift (D05/D07), the
   remediation is `build-catalog` (or `doctor --fix`) then retry. D13 warnings
   are the *input*, not a block; other warnings are ignored.
2. **Collect pairs.** Each D13 finding's `message` has the fixed format
   `duplicates papers/<a>.md (<reasons>)` (frozen by
   [doctor-duplicates](doctor-duplicates.md) §2); the partner `<b>` is the
   finding's `file`. Extract both citekeys and the `<reasons>`. A message that
   does not match is a hard stop, never a guess. Zero D13 findings → print "no
   duplicates detected" and write no file.
3. **Group.** Coalesce the pairs into connected-component groups (if A–B and
   B–C are reported, the group is {A, B, C}). This is where the n-way case D13
   reports as separate pairs becomes one presentable group. A group's reason
   list is the distinct sub-reasons (split each pairwise `<reasons>` on `; `)
   in first-seen order.
4. **Assemble facts.** For each candidate in each group, pull its catalog facts
   (§3.2) and the maps that reference it (§3.3).
5. **Order deterministically.** Candidates within a group sort by citekey
   ascending; groups sort by their lowest candidate citekey ascending, numbered
   1..N in that order — so a same-day re-run is byte-stable.
6. **Write the checklist** to `scratch/dedup-<YYYY-MM-DD>.md` (date in UTC, per
   §5). A same-day re-run overwrites the file — the report is derived state and
   `scratch/` is disposable.
7. **Print a terminal summary**: number of duplicate groups and total notes
   involved, and the scratch path.

## 5. Report format (normative grammar)

The report is human-reviewable and structured so a future `dedup apply` can
parse the checked decisions. Structure — one block per group:

```markdown
# Duplicate resolution — <YYYY-MM-DD>

Groups: N (M notes). Fill the blanks and check your decisions — check exactly
one of Delete / Defer per group; Delete assumes the Zotero merge is done and a
body chosen. Then follow the checklist (or, once available, run
`/dedup apply scratch/dedup-<date>.md`).

## Group 1 — "Attention Is All You Need" (same arXiv id 1706.03762)

Candidates:
- `vaswaniAttentionAllYou2023`   depth=abstract  updated=2026-07-08
  contribution: Introduces the Transformer, an attention-only sequence model.
  referenced by: (none)
- `vaswaniAttentionAllYou2023a`  depth=abstract  updated=2026-07-08
  contribution: Introduces the Transformer, an attention-only sequence model.
  referenced by: topics/foundation-architectures.md

Decisions:
- [ ] Merged the items in Zotero; surviving citekey: `______________`
- [ ] Preserve the body of: `______________`  (hand-fold anything unique from the other(s) into it first)
- [ ] Delete the non-surviving note(s)
- [ ] Defer — keep all notes, revisit later

Consequences (derived — confirm you will repair these via `topic`):
- deleting `vaswaniAttentionAllYou2023`  → dangles in: (none)
- deleting `vaswaniAttentionAllYou2023a` → dangles in: topics/foundation-architectures.md
```

Rules:

- One block per group. The header subject is the candidates' shared title when
  they all share one; otherwise (a DOI/arXiv-id-only match, whose titles differ)
  the shared key, e.g. `arXiv 2010.11929`. The parenthesized reasons are the
  distinct sub-reasons from step 3, verbatim (`same title` / `same arXiv id X` /
  `same DOI Y`), joined by `; `.
- Each candidate lists its citekey, `depth`, `updated`, its `contribution` line
  (or `(empty)`), and the maps referencing it (`referenced by:`, `(none)` if
  unreferenced).
- The four **Decisions** lines are fixed and appear in every block. `Delete` and
  `Defer` are mutually exclusive — the human checks exactly one; a future
  `apply` enforces that. "The non-surviving note(s)" always means every
  candidate except the citekey in the survivor blank. The two blanks are
  backtick placeholders the human edits in place.
- **Consequences** are derived facts, never checkboxes — one line per candidate
  showing which maps dangle if that note is the one deleted, so the human sees
  the cost of either direction before choosing the survivor.
- Justifications and facts are quoted/paraphrased from the catalog only. No
  project-relevance reasoning, ever. `dedup` never states which note *should*
  win — depth/updated/consequences are presented; the choice is the human's.

## 6. Safety rules (normative, Unit A)

- `dedup` writes only `scratch/dedup-<date>.md`. `git status` after a run shows
  at most that one file.
- It never edits note bodies or frontmatter, never deletes or archives a file,
  never writes topic maps or generated files, and never writes to Zotero.
- It never invents citekeys or paper facts, and never recommends a survivor as a
  directive — it surfaces facts and consequences for a human to decide.

## 7. Acceptance criteria (Unit A)

- [ ] Fixture with one D13 pair (e.g. the vaswani pair) → report has exactly one
      group block naming both citekeys, both candidates' catalog facts, and a
      `Consequences` line per candidate; `git status` shows only the scratch
      file.
- [ ] Fixture with a 3-way duplicate (A~B, B~C reported as two D13 pairs) → one
      group block listing all three candidates, not three blocks.
- [ ] A candidate referenced by a topic map → its `referenced by:` and the
      matching `deleting … → dangles in:` line name that map; a candidate
      referenced by none shows `(none)` on both.
- [ ] Zero D13 findings → terminal message "no duplicates detected", no scratch
      file created.
- [ ] `doctor` error-severity finding present → `dedup` refuses past the gate;
      no scan, no report.
- [ ] Same-day second run overwrites `scratch/dedup-<date>.md`; no second file.

## 8. Tests

Agent-workflow behavior → golden-run review checks against fixtures (report
exists, expected group blocks and candidate facts present, `Consequences` lines
correct, no other file changed). Fixtures reuse the `doctor` D13 fixtures
(`test/fixtures/doctor/`) so detection and presentation share ground truth. If
grouping/consequence derivation is later extracted to a script, it gains
standalone unit tests at that point.

## 9. Future increment — `dedup apply <report>` (Unit B, not specified deeply)

A later unit will execute the checked, *mechanical* decisions from a completed
checklist, on the same strict-grammar / hard-stop discipline as
[`propose apply`](propose.md#6):

- Parse checked items; any checked line that does not parse, or a group with
  both/neither of Delete/Defer checked → stop before any write.
- For a `Delete` group: `git rm` the non-surviving note(s), run
  `build-catalog`, re-derive affected topic maps via the `topic` workflow (which
  drops the now-absent citekeys), and print the project-repo `link` TODOs.
- For a `Defer` group: no writes.
- **Never** folds body prose (that judgment stays human, done before apply);
  **never** touches an unchecked group; **never** archives (see Out of scope).

Grammar details, acceptance criteria, and tests for Unit B are deferred to when
it is built — the §5 grammar is designed to make that parse straightforward.

## 10. Ahead-of-need — issue automation

The §5 checklist is checkbox markdown, so it drops into a GitHub Issue and is
tick-able in place with no CLI, exactly like the `propose` report. A workflow
that files/updates a "Duplicate papers detected" issue from `doctor --json` and
runs `dedup apply` on approval would reuse the authorization/doctor-gate pattern
from [propose-issue](propose-issue.md) / [survey-issue](survey-issue.md)
wholesale. It is **specced ahead of need only** — build it after the local
`dedup` workflow has been boringly reliable through dogfooding, the same
sequencing guard those specs carry. No Actions or issue-form spec is written
yet.

## 11. Out of scope

Any auto-detection beyond D13 (this spec adds none); auto-delete or auto-archive
of any kind; an **archive** store as a real feature (the checklist records
Delete-or-Defer only — a tombstone/archive subsystem is a separate future
decision); automated body/prose merging; similarity/fuzzy matching (D13 is
exact-key only, by design); the GitHub Actions/issue-form plumbing (§10).
